// The local pressure solver for several lanes at once, on a list of cells (the land). Prototype of what the GPU can
// run: each lane holds one pressure field with fixed pressures at its terminals, a few damped iterations per step.
// The adaptation is the one of flow.ts (Tero 2007, Eq. 5, per cell; a slow tube body; a starvation mark that fades).
import { pcg } from './jones.ts';
import type { World } from './world.ts';

export interface MultiParams {
  i0: number;
  gamma: number;
  rate: number;
  base: number;
  trailRef: number;
  trailLow: number;
  bodyRate: number;
  bodyLow: number;
  dNew: number;
  dFloor: number;
  recover: number;
  foodG: number;
  iterations: number;
  weight: number;
  radius: number;
  virtual: number;
  /** Factor on f before the mean over the lanes, capped at 1: for layouts that feed a tube only part of the time. */
  fScale: number;
  /**
   * 'pressure': a source cell holds the pressure +1 and a sink cell −1; the flux is scaled so that a source gives i0,
   * and it counts only when the currents out and in agree (the gate). 'current': a source cell gives the flux i0 and a
   * sink cell takes i0, as Tero's source and sink do; no scaling and no gate.
   */
  mode: 'pressure' | 'current' | 'walkers';
  /** 'walkers' (Ma et al. 2013): walkers that a source gets and a sink loses per step, and the time step of the walk. */
  walkers: number;
  dt: number;
  seed: number;
}

export const defaultMulti = (): MultiParams => ({
  i0: 8,
  gamma: 1.8,
  rate: 0.003,
  base: 0.02,
  trailRef: 5,
  trailLow: 1,
  bodyRate: 0.02,
  bodyLow: 0.05,
  dNew: 0.2,
  dFloor: 1e-4,
  recover: 0.00023,
  foodG: 4,
  iterations: 16,
  weight: 0.9,
  radius: 0.99999,
  virtual: 1e-5,
  fScale: 1,
  mode: 'pressure',
  walkers: 2000,
  dt: 0.8,
  seed: 1,
});

/** The terminals of a lane: the source cells at pressure +1, the sink cells at −1. */
export interface Terminals {
  sources: number[];
  sinks: number[];
}

export class FlowMulti {
  readonly D: Float32Array;
  readonly body: Float32Array;
  readonly g: Float32Array;
  /** Mean flux of the lanes, for pictures. */
  readonly Q: Float32Array;
  /** Domain cells and, per domain cell, the grid index of each neighbour in the domain or −1. */
  private readonly cells: Int32Array;
  private readonly east: Int32Array;
  private readonly west: Int32Array;
  private readonly south: Int32Array;
  private readonly north: Int32Array;
  /** Edge conductances per grid cell: east and south, real and with the virtual conductivity. */
  private readonly gE: Float32Array;
  private readonly gS: Float32Array;
  private readonly eE: Float32Array;
  private readonly eS: Float32Array;
  private p: Float64Array[] = [];
  private pPrev: Float64Array[] = [];
  private pNext: Float64Array[] = [];
  /** Pinned pressure of a cell per lane: 0 free, else the pressure. */
  private pin: Int8Array[] = [];
  /** 'walkers': walkers per cell and lane, the capacitance of a cell, and the sampled net flow of each edge. */
  private N: Float64Array[] = [];
  private readonly C: Float64Array;
  private readonly fE: Float64Array;
  private readonly fS: Float64Array;
  private readonly out: Float64Array;
  private rs = 0;
  private stepNo = 0;
  private last: Terminals[] = [];
  gates: number[] = [];
  gate = 0;
  private first = true;
  private readonly fSum: Float32Array;

  constructor(
    readonly world: World,
    readonly fp: MultiParams,
    domain: Uint8Array,
  ) {
    const { w, h } = world;
    const n = w * h;
    this.D = new Float32Array(n).fill(fp.dNew);
    this.body = new Float32Array(n);
    this.g = new Float32Array(n);
    this.Q = new Float32Array(n);
    this.gE = new Float32Array(n);
    this.gS = new Float32Array(n);
    this.eE = new Float32Array(n);
    this.eS = new Float32Array(n);
    this.fSum = new Float32Array(n);
    this.C = new Float64Array(n);
    this.fE = new Float64Array(n);
    this.fS = new Float64Array(n);
    this.out = new Float64Array(n);
    const list: number[] = [];
    for (let c = 0; c < n; c++) if (domain[c] && world.open[c]) list.push(c);
    this.cells = Int32Array.from(list);
    const inDom = (c: number) => c >= 0 && c < n && domain[c] === 1 && world.open[c] === 1;
    this.east = Int32Array.from(list, (c) => (c % w < w - 1 && inDom(c + 1) ? c + 1 : -1));
    this.west = Int32Array.from(list, (c) => (c % w > 0 && inDom(c - 1) ? c - 1 : -1));
    this.south = Int32Array.from(list, (c) => (inDom(c + w) ? c + w : -1));
    this.north = Int32Array.from(list, (c) => (inDom(c - w) ? c - w : -1));
  }

  tube(c: number): number {
    const b = this.body[c]!;
    return b < this.fp.bodyLow ? 0 : b;
  }

  private lanes(k: number) {
    const n = this.world.w * this.world.h;
    while (this.p.length < k) {
      this.p.push(new Float64Array(n));
      this.pPrev.push(new Float64Array(n));
      this.pNext.push(new Float64Array(n));
      this.pin.push(new Int8Array(n));
      this.N.push(new Float64Array(n));
      this.last.push({ sources: [], sinks: [] });
    }
  }

  /** One step: body, conductances, the iterations of every lane, the fluxes and the adaptation. */
  advance(trail: Float32Array, terminals: Terminals[], adapt = true) {
    const { food } = this.world;
    const fp = this.fp;
    const { cells, east, west, south, north, g, gE, gS, eE, eS } = this;
    const m = cells.length;
    const K = terminals.length;
    this.lanes(K);
    // Body and conductivity.
    for (let i = 0; i < m; i++) {
      const c = cells[i]!;
      const pres = Math.min(1, Math.max(0, (trail[c]! - fp.trailLow) / (fp.trailRef - fp.trailLow)));
      this.body[c] = this.first ? pres : this.body[c]! + fp.bodyRate * (pres - this.body[c]!);
      g[c] = food[c] ? fp.foodG : this.tube(c) * (fp.base + this.D[c]!);
    }
    this.first = false;
    const hm = (a: number, b: number) => (a > 0 && b > 0 ? (2 * a * b) / (a + b) : 0);
    for (let i = 0; i < m; i++) {
      const c = cells[i]!;
      const [e, s] = [east[i]!, south[i]!];
      gE[c] = e >= 0 ? hm(g[c]!, g[e]!) : 0;
      gS[c] = s >= 0 ? hm(g[c]!, g[s]!) : 0;
      eE[c] = e >= 0 ? hm(g[c]! + fp.virtual, g[e]! + fp.virtual) : 0;
      eS[c] = s >= 0 ? hm(g[c]! + fp.virtual, g[s]! + fp.virtual) : 0;
    }
    // Pins of each lane.
    for (let k = 0; k < K; k++) {
      const [was, now] = [this.last[k]!, terminals[k]!];
      const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
      if (!same(was.sources, now.sources) || !same(was.sinks, now.sinks)) {
        for (const c of was.sources) this.pin[k]![c] = 0;
        for (const c of was.sinks) this.pin[k]![c] = 0;
        for (const c of now.sinks) this.pin[k]![c] = -1;
        for (const c of now.sources) this.pin[k]![c] = 1;
        this.last[k] = { sources: now.sources.slice(), sinks: now.sinks.slice() };
      }
    }
    if (fp.mode === 'walkers') {
      this.walk(K, adapt);
      return;
    }
    const omega = 2 / (1 + Math.sqrt(1 - fp.radius * fp.radius));
    const byCurrent = fp.mode === 'current';
    for (let it = 0; it < fp.iterations; it++) {
      for (let k = 0; k < K; k++) {
        const [p, pPrev, pNext, pin] = [this.p[k]!, this.pPrev[k]!, this.pNext[k]!, this.pin[k]!];
        for (let i = 0; i < m; i++) {
          const c = cells[i]!;
          if (pin[c] !== 0 && !byCurrent) {
            pNext[c] = pin[c]!;
            continue;
          }
          const [e, wv, s, nv] = [east[i]!, west[i]!, south[i]!, north[i]!];
          const ce = e >= 0 ? eE[c]! : 0;
          const cw = wv >= 0 ? eE[wv]! : 0;
          const cs = s >= 0 ? eS[c]! : 0;
          const cn = nv >= 0 ? eS[nv]! : 0;
          const sum = ce + cw + cs + cn;
          if (sum <= 0) {
            pNext[c] = p[c]!;
            continue;
          }
          let avg =
            (ce * (e >= 0 ? p[e]! : 0) +
              cw * (wv >= 0 ? p[wv]! : 0) +
              cs * (s >= 0 ? p[s]! : 0) +
              cn * (nv >= 0 ? p[nv]! : 0)) /
            sum;
          // A source or a sink of a fixed flux: Kirchhoff's law of the cell with the term ± i0.
          if (pin[c] !== 0) avg += (pin[c]! * fp.i0) / sum;
          const jac = p[c]! + fp.weight * (avg - p[c]!);
          pNext[c] = omega * jac + (1 - omega) * pPrev[c]!;
        }
        this.pPrev[k] = p;
        this.p[k] = pNext;
        this.pNext[k] = pPrev;
      }
    }
    // Fluxes, gates and the sum of gate · f.
    const fSum = this.fSum;
    fSum.fill(0);
    this.Q.fill(0);
    let gates = 0;
    this.gates = [];
    const cellIndex = new Map<number, number>();
    const idx = (c: number) => {
      let i = cellIndex.get(c);
      if (i === undefined) {
        i = this.cells.indexOf(c);
        cellIndex.set(c, i);
      }
      return i;
    };
    for (let k = 0; k < K; k++) {
      const p = this.p[k]!;
      // Net current that leaves a cell through its real edges.
      const current = (c: number) => {
        const i = idx(c);
        if (i < 0) return 0;
        const [e, wv, s, nv] = [east[i]!, west[i]!, south[i]!, north[i]!];
        let sum = 0;
        if (e >= 0) sum += gE[c]! * (p[c]! - p[e]!);
        if (wv >= 0) sum += gE[wv]! * (p[c]! - p[wv]!);
        if (s >= 0) sum += gS[c]! * (p[c]! - p[s]!);
        if (nv >= 0) sum += gS[nv]! * (p[c]! - p[nv]!);
        return sum;
      };
      // The current that leaves the sources and the current that reaches the sinks. Only terminals with a tube count:
      // the flux is scaled so that a source gives i0 on average.
      let [out, into, givers] = [0, 0, 0];
      for (const c of terminals[k]!.sources) {
        const v = current(c);
        if (v > 0) {
          out += v;
          givers++;
        }
      }
      for (const c of terminals[k]!.sinks) into -= Math.min(0, current(c));
      let gate = 0;
      if (out > 1e-12 && into > 1e-12) {
        const ratio = Math.min(out, into) / Math.max(out, into);
        const t = Math.min(1, Math.max(0, (ratio - 0.8) / 0.15));
        gate = t * t * (3 - 2 * t);
      }
      if (byCurrent) gate = 1;
      this.gates.push(gate);
      gates += gate;
      if (gate <= 0) continue;
      const scale = byCurrent ? 0.5 : (fp.i0 * Math.max(1, givers)) / (out + into);
      for (let i = 0; i < m; i++) {
        const c = cells[i]!;
        const [e, wv, s, nv] = [east[i]!, west[i]!, south[i]!, north[i]!];
        let q = 0;
        if (e >= 0) q += Math.abs(gE[c]! * (p[c]! - p[e]!));
        if (wv >= 0) q += Math.abs(gE[wv]! * (p[c]! - p[wv]!));
        if (s >= 0) q += Math.abs(gS[c]! * (p[c]! - p[s]!));
        if (nv >= 0) q += Math.abs(gS[nv]! * (p[c]! - p[nv]!));
        q *= scale;
        if (q <= 0) continue;
        const qg = Math.pow(q, fp.gamma);
        fSum[c]! += gate * Math.min(1, (fp.fScale * qg) / (1 + qg));
        this.Q[c]! += q / K;
      }
    }
    this.gate = gates / K;
    if (adapt) this.adapt(gates);
  }

  private adapt(gates: number) {
    const fp = this.fp;
    const { cells, fSum } = this;
    const speed = fp.rate * Math.min(1, gates);
    for (const c of cells) {
      if (this.tube(c) <= 0) {
        this.D[c] = Math.min(fp.dNew, Math.max(this.D[c]!, fp.dFloor) * (1 + fp.recover));
        continue;
      }
      if (gates > 0) this.D[c] = Math.max(fp.dFloor, this.D[c]! + speed * (fSum[c]! / gates - this.D[c]!));
    }
  }

  private rand(): number {
    this.rs = pcg(this.rs);
    return (this.rs >>> 8) / 16777216;
  }
  private poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean < 30) {
      const limit = Math.exp(-mean);
      let k = 0;
      let prod = this.rand();
      while (prod > limit) {
        k++;
        prod *= this.rand();
      }
      return k;
    }
    const u1 = Math.max(this.rand(), 1e-12);
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * this.rand());
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * z));
  }

  /**
   * Ma et al. 2013 for every lane: the walkers on a cell over its capacitance are the potential (Eq. 2.15, 2.16), the
   * net walkers over an edge in a step are sampled (Eq. 2.5) from the walkers at the start of the step (Eq. 2.6), a
   * source gets `walkers` per step and a sink loses as many. The flux of a cell is half the walkers over its edges,
   * in units in which `walkers` is i0.
   */
  private walk(K: number, adapt: boolean) {
    const fp = this.fp;
    const { cells, east, west, south, north, gE, gS, C, fE, fS, out, fSum } = this;
    const m = cells.length;
    this.rs = pcg(this.stepNo++ ^ pcg(fp.seed ^ 0x51ed));
    for (let i = 0; i < m; i++) {
      const c = cells[i]!;
      const [e, wv, s, nv] = [east[i]!, west[i]!, south[i]!, north[i]!];
      C[c] = (e >= 0 ? gE[c]! : 0) + (wv >= 0 ? gE[wv]! : 0) + (s >= 0 ? gS[c]! : 0) + (nv >= 0 ? gS[nv]! : 0);
    }
    fSum.fill(0);
    this.Q.fill(0);
    const unit = fp.i0 / fp.walkers;
    const q = new Float64Array(this.world.w * this.world.h);
    for (let k = 0; k < K; k++) {
      const N = this.N[k]!;
      for (const c of this.last[k]!.sources) N[c]! += fp.walkers;
      for (const c of this.last[k]!.sinks) N[c] = Math.max(0, N[c]! - fp.walkers);
      out.fill(0);
      const sample = (a: number, b: number, cond: number): number => {
        if (cond <= 0 || C[a]! <= 0 || C[b]! <= 0) return 0;
        const mean = (N[a]! / C[a]! - N[b]! / C[b]!) * cond * fp.dt;
        const n = this.poisson(Math.abs(mean));
        if (n === 0) return 0;
        out[mean > 0 ? a : b]! += n;
        return mean > 0 ? n : -n;
      };
      for (let i = 0; i < m; i++) {
        const c = cells[i]!;
        fE[c] = east[i]! >= 0 ? sample(c, east[i]!, gE[c]!) : 0;
        fS[c] = south[i]! >= 0 ? sample(c, south[i]!, gS[c]!) : 0;
      }
      q.fill(0);
      const start = N.slice();
      const move = (a: number, b: number, f: number) => {
        if (f === 0) return;
        const [from, to] = f > 0 ? [a, b] : [b, a];
        let n = Math.abs(f);
        if (out[from]! > start[from]!) n = Math.floor((n * start[from]!) / out[from]!);
        N[from]! -= n;
        N[to]! += n;
        q[a]! += 0.5 * n * unit;
        q[b]! += 0.5 * n * unit;
      };
      for (let i = 0; i < m; i++) {
        const c = cells[i]!;
        if (east[i]! >= 0) move(c, east[i]!, fE[c]!);
        if (south[i]! >= 0) move(c, south[i]!, fS[c]!);
      }
      for (let i = 0; i < m; i++) {
        const c = cells[i]!;
        if (q[c]! <= 0) continue;
        const qg = Math.pow(q[c]!, fp.gamma);
        fSum[c]! += Math.min(1, (fp.fScale * qg) / (1 + qg));
        this.Q[c]! += q[c]! / K;
      }
    }
    this.gates = Array.from({ length: K }, () => 1);
    this.gate = 1;
    if (adapt) this.adapt(K);
  }
}
