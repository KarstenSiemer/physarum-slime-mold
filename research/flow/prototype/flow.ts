// Flow in the tubes on the grid of the app: three ways to get the flux, one adaptation law. Prototype code.
//
// The network: every open cell is a node, with a conductivity g. Two cells that share a side are joined by an edge
// whose conductance is the harmonic mean of their conductivities (two half cells in series). The pressure p solves
// Kirchhoff's law with a source and a sink (Tero, Kobayashi, Nakagaki 2007, Eq. 1 to 3 and 6).
//
// - 'exact': the network Poisson equation solved to a tolerance with conjugate gradients, source +I0, sink −I0
//   (Tero 2007, Sec. 3.3 uses ICCG).
// - 'lag': pressure +1 at the source and −1 at the sink, a fixed number of damped local iterations per step from
//   the pressure of the step before, and the flux scaled to I0 with the current that leaves the source cell.
// - 'ma': walkers on the cells are the potential (Ma et al. 2013, Eq. 2.16, 2.5, 2.6): the source gets walkers at a
//   fixed rate, the sink loses them, and the net walkers over an edge per step are the current.
//
// The adaptation is Tero's (2007, Eq. 5; 2010): dD/dt = f(Q) − D, f(Q) = Q^gamma / (1 + Q^gamma), per cell, with
// Q the flux through the cell (half the sum of the absolute edge fluxes), gated by the plasmodium on the cell.
import { pcg } from './jones.ts';
import type { World } from './world.ts';

export type Solver = 'exact' | 'lag' | 'ma';

export interface FlowParams {
  solver: Solver;
  /** Total flux between the source and the sink, in units of the flux at which f is one half. */
  i0: number;
  gamma: number;
  /** f(Q): 'sigmoid' is Q^gamma / (1 + Q^gamma) (Tero 2010), 'power' is Q^gamma (Tero 2007, Type I). */
  law: 'sigmoid' | 'power';
  /** Adaptation rate per step: D moves this share of the way to f(Q) in a step. */
  rate: number;
  /** Conductivity of a cell with plasmodium and no flow memory. */
  base: number;
  /** Trail at which a cell counts as full plasmodium, and the trail below which it holds none. */
  trailRef: number;
  trailLow: number;
  /** The tube body follows the plasmodium at this rate per step, and counts as none below `bodyLow`. */
  bodyRate: number;
  bodyLow: number;
  /** Flow memory of ground that never held a tube, the least memory, and the recovery of empty ground per step. */
  dNew: number;
  dFloor: number;
  recover: number;
  /** Conductivity of a food cell (the food source is a reservoir). */
  foodG: number;
  /** 'lag': iterations per step, relaxation weight and the spectral radius the acceleration is tuned for. */
  iterations: number;
  weight: number;
  radius: number;
  /**
   * 'lag': a conductivity that every open cell has for the pressure iteration only, so that a cell beside the
   * network already holds the pressure of its neighbours when it joins. The flux counts only real conductances.
   */
  virtual: number;
  /** 'exact': relative residual, and solve every this many steps. */
  tolerance: number;
  every: number;
  /**
   * 'exact': the preconditioner of the conjugate gradients. 'mic': modified incomplete Cholesky, the default.
   * 'jacobi': the diagonal alone, which a GPU can run in parallel; added on 2026-11-13 to measure it again.
   */
  preconditioner: 'mic' | 'jacobi';
  /** 'ma': walkers that enter at the source per step, and the time step of the walk (at most 1). */
  walkers: number;
  dt: number;
  seed: number;
}

export const defaultFlow = (): FlowParams => ({
  solver: 'exact',
  i0: 8,
  gamma: 1.8,
  law: 'sigmoid',
  rate: 0.01,
  base: 0.02,
  trailRef: 5,
  trailLow: 1,
  bodyRate: 0.02,
  bodyLow: 0.05,
  dNew: 0.2,
  dFloor: 1e-4,
  recover: 0.00023,
  foodG: 4,
  iterations: 8,
  weight: 0.9,
  radius: 0.99999,
  virtual: 1e-5,
  tolerance: 1e-5,
  every: 1,
  preconditioner: 'mic',
  walkers: 200,
  dt: 0.8,
  seed: 1,
});

export class Flow {
  /** Tube conductivity memory (Tero's D), per cell. */
  readonly D: Float32Array;
  /** Tube body per cell, 0 to 1: the plasmodium (trail) smoothed over time, so that the conductivity is steady. */
  readonly body: Float32Array;
  /** Flux through each cell in the last step, scaled so that the total is i0. */
  readonly Q: Float32Array;
  /** Conductivity of each cell in the last step. */
  readonly g: Float32Array;
  p: Float64Array;
  private pPrev: Float64Array;
  private pNext: Float64Array;
  /** Edge conductances: east (cell c to c + 1) and south (c to c + w). */
  private readonly gE: Float32Array;
  private readonly gS: Float32Array;
  /** 'ma': walkers per cell. */
  N: Float64Array;
  /** Flux of the lane in work, the sum of gate · f over the lanes, and the mean gate of the last step. */
  private laneQ: Float32Array;
  private fSum: Float32Array;
  gate = 0;
  lanes: {
    p: Float64Array;
    pPrev: Float64Array;
    pNext: Float64Array;
    N: Float64Array;
    stats: Flow['stats'];
    gate: number;
  }[] = [];
  private lane = -1;
  /** Last solve: iterations (exact), the current at the source and at the sink before scaling (lag), joined. */
  stats = { iterations: 0, source: 0, sink: 0, joined: false, residual: 0 };
  private step = 0;
  // Work arrays of the exact solver.
  private readonly index: Int32Array;
  private pre = new Float64Array(0);
  private act = new Int32Array(0);
  /** Unknowns of the last exact solve. */
  unknowns = 0;
  private aE = new Float64Array(0);
  private aS = new Float64Array(0);
  private r = new Float64Array(0);
  private z = new Float64Array(0);
  private q = new Float64Array(0);
  private d = new Float64Array(0);
  private x = new Float64Array(0);
  private diag = new Float64Array(0);

  constructor(
    readonly world: World,
    readonly fp: FlowParams,
  ) {
    const n = world.w * world.h;
    this.D = new Float32Array(n);
    this.body = new Float32Array(n);
    this.Q = new Float32Array(n);
    this.g = new Float32Array(n);
    this.p = new Float64Array(n);
    this.pPrev = new Float64Array(n);
    this.pNext = new Float64Array(n);
    this.gE = new Float32Array(n);
    this.gS = new Float32Array(n);
    this.N = new Float64Array(n);
    this.index = new Int32Array(n);
    this.flowE = new Float64Array(n);
    this.flowS = new Float64Array(n);
    this.nStart = new Float64Array(n);
    this.D.fill(fp.dNew);
    this.laneQ = new Float32Array(n);
    this.fSum = new Float32Array(n);
  }

  /** The plasmodium on a cell now, 0 to 1, from its trail. */
  presence(trail: Float32Array, c: number): number {
    const { trailLow, trailRef } = this.fp;
    return Math.min(1, Math.max(0, (trail[c]! - trailLow) / (trailRef - trailLow)));
  }

  /** The tube body of a cell as the flow sees it: 0 below `bodyLow`. */
  tube(c: number): number {
    const b = this.body[c]!;
    return b < this.fp.bodyLow ? 0 : b;
  }

  /** The body follows the trail; then conductivities and edge conductances from the body and the flow memory. */
  private conduct(trail: Float32Array) {
    const { w, h, open, food } = this.world;
    const { base, foodG, bodyRate } = this.fp;
    const g = this.g;
    const first = this.step === 0;
    for (let c = 0; c < w * h; c++) {
      if (!open[c]) {
        g[c] = 0;
        continue;
      }
      const pres = this.presence(trail, c);
      this.body[c] = first ? pres : this.body[c]! + bodyRate * (pres - this.body[c]!);
      g[c] = food[c] ? foodG : this.tube(c) * (base + this.D[c]!);
    }
    this.edges();
  }

  /** Edge conductances from the conductivities: the harmonic mean of the two cells. */
  private edges() {
    const { w, h } = this.world;
    const g = this.g;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        const a = g[c]!;
        const e = x < w - 1 ? g[c + 1]! : 0;
        const s = y < h - 1 ? g[c + w]! : 0;
        this.gE[c] = a > 0 && e > 0 ? (2 * a * e) / (a + e) : 0;
        this.gS[c] = a > 0 && s > 0 ? (2 * a * s) / (a + s) : 0;
      }
  }

  /** A step without a flux: only the body follows the trail. */
  follow(trail: Float32Array) {
    this.conduct(trail);
    this.step++;
  }

  /**
   * One step: the flux of each pair [source cell, sink cell] on the conductivities of now, then the adaptation with
   * the mean of f over the pairs whose flux is valid. Tero et al. 2010 draw one random pair of food sources per time
   * step; several pairs at once are several of his time steps in one. `adapt` false computes the fluxes only.
   */
  advance(
    trail: Float32Array,
    pairs: number | [number, number][],
    sinkOrAdapt: number | boolean = true,
    adapt2 = true,
  ) {
    // The call of one pair: advance(trail, source, sink, adapt).
    const list: [number, number][] = typeof pairs === 'number' ? [[pairs, sinkOrAdapt as number]] : pairs;
    const adapt = typeof pairs === 'number' ? adapt2 : (sinkOrAdapt as boolean);
    this.conduct(trail);
    const n = this.world.w * this.world.h;
    const { gamma } = this.fp;
    const fSum = this.fSum;
    fSum.fill(0);
    this.Q.fill(0);
    let gates = 0;
    for (let k = 0; k < list.length; k++) {
      const [source, sink] = list[k]!;
      this.useLane(k);
      let gate = 1;
      if (this.fp.solver === 'exact') {
        // The edges that maskOut() cut for the lane before are needed again.
        if (k > 0) this.edges();
        if (this.step % this.fp.every === 0) this.solveExact(source, sink);
        this.fluxFromPressure(1);
        gate = this.stats.joined ? 1 : 0;
      } else if (this.fp.solver === 'lag') {
        gate = this.solveLag(source, sink);
      } else {
        this.walk(source, sink);
      }
      this.lanes[k]!.stats = this.stats;
      this.lanes[k]!.gate = gate;
      gates += gate;
      const q = this.laneQ;
      for (let c = 0; c < n; c++) {
        if (gate > 0 && q[c]! > 0) {
          const qg = Math.pow(q[c]!, gamma);
          fSum[c]! += gate * (this.fp.law === 'power' ? qg : qg / (1 + qg));
        }
        this.Q[c]! += q[c]! / list.length;
      }
    }
    this.gate = gates / list.length;
    if (adapt) {
      // Tero's adaptation (2007, Eq. 5) per cell that holds a tube, at the rate `rate` and only while a flux runs
      // (the gates). A cell without a tube keeps its memory, so starved ground stays marked; the mark fades by the
      // factor 1 + recover per step, up to dNew, the memory of ground that never held a tube.
      const { rate, dNew, recover, dFloor } = this.fp;
      const speed = rate * Math.min(1, gates);
      for (let c = 0; c < n; c++) {
        if (!this.world.open[c]) continue;
        if (this.tube(c) <= 0) {
          this.D[c] = Math.min(dNew, Math.max(this.D[c]!, dFloor) * (1 + recover));
          continue;
        }
        if (gates > 0) this.D[c] = Math.max(dFloor, this.D[c]! + speed * (fSum[c]! / gates - this.D[c]!));
      }
    }
    this.step++;
  }

  /** Per-pair state: the pressure fields (exact, lag) or the walkers (ma) of lane k, made at its first use. */
  private useLane(k: number) {
    const n = this.world.w * this.world.h;
    while (this.lanes.length <= k) {
      this.lanes.push({
        p: new Float64Array(n),
        pPrev: new Float64Array(n),
        pNext: new Float64Array(n),
        N: new Float64Array(n),
        stats: { iterations: 0, source: 0, sink: 0, joined: false, residual: 0 },
        gate: 0,
      });
    }
    // The solvers rotate p, pPrev and pNext: store the fields of the lane in use back first.
    if (this.lane >= 0) {
      const old = this.lanes[this.lane]!;
      [old.p, old.pPrev, old.pNext, old.N] = [this.p, this.pPrev, this.pNext, this.N];
    }
    const l = this.lanes[k]!;
    [this.p, this.pPrev, this.pNext, this.N] = [l.p, l.pPrev, l.pNext, l.N];
    this.stats = l.stats;
    this.lane = k;
  }

  /** Q of every cell from the pressure: half the sum of the absolute fluxes over its four edges, times `scale`. */
  private fluxFromPressure(scale: number) {
    const { w, h } = this.world;
    const { p, gE, gS } = this;
    const Q = this.laneQ;
    Q.fill(0);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        if (gE[c]! > 0) {
          const f = Math.abs(gE[c]! * (p[c]! - p[c + 1]!)) * 0.5 * scale;
          Q[c]! += f;
          Q[c + 1]! += f;
        }
        if (gS[c]! > 0) {
          const f = Math.abs(gS[c]! * (p[c]! - p[c + w]!)) * 0.5 * scale;
          Q[c]! += f;
          Q[c + w]! += f;
        }
      }
  }

  // --- exact: conjugate gradients with a modified incomplete Cholesky preconditioner ------------------------------

  /**
   * The network Poisson equation with the source +i0 and the sink pinned at p = 0, on the cells that edges with a
   * conductance join to the source. Conjugate gradients with MIC(0) (Tero 2007 uses ICCG), started from the pressure
   * of the last solve. Full-grid arrays: a cell outside the component is inactive.
   */
  private solveExact(source: number, sink: number) {
    const { w, h } = this.world;
    const n = w * h;
    const { gE, gS, index, p } = this;
    const none = () => {
      this.stats = { iterations: 0, source: 0, sink: 0, joined: false, residual: 0 };
      p.fill(0);
      for (let c = 0; c < n; c++) this.maskOut(c);
    };
    if (this.g[source]! <= 0 || this.g[sink]! <= 0) {
      none();
      return;
    }
    // Flood fill from the source: index 1 marks an unknown, 2 the pinned sink, 0 a cell outside.
    index.fill(0);
    const stack = [source];
    index[source] = 1;
    const found = { sink: false };
    while (stack.length > 0) {
      const c = stack.pop()!;
      const x = c % w;
      const visit = (nc: number, cond: number) => {
        if (cond <= 0 || index[nc]! !== 0) return;
        if (nc === sink) {
          found.sink = true;
          index[nc] = 2;
          return;
        }
        index[nc] = 1;
        stack.push(nc);
      };
      if (x < w - 1) visit(c + 1, gE[c]!);
      if (x > 0) visit(c - 1, gE[c - 1]!);
      if (c + w < n) visit(c + w, gS[c]!);
      if (c >= w) visit(c - w, gS[c - w]!);
    }
    if (!found.sink) {
      none();
      return;
    }
    if (this.r.length < n) {
      this.r = new Float64Array(n);
      this.z = new Float64Array(n);
      this.q = new Float64Array(n);
      this.d = new Float64Array(n);
      this.x = new Float64Array(n);
      this.diag = new Float64Array(n);
      this.pre = new Float64Array(n);
      this.aE = new Float64Array(n);
      this.aS = new Float64Array(n);
      this.act = new Int32Array(n);
    }
    const { r, z, q, d, x, diag, pre, aE, aS, act } = this;
    const pin = p[sink]!;
    // The unknowns in row order. aE, aS: the couplings between two unknowns. diag: all edges of an unknown, also the
    // one to the pinned sink. Cells that are no unknown hold 0 in every work array.
    let m = 0;
    for (let c = 0; c < n; c++) {
      const on = index[c] === 1;
      const cx = c % w;
      aE[c] = on && cx < w - 1 && index[c + 1] === 1 ? gE[c]! : 0;
      aS[c] = on && c + w < n && index[c + w] === 1 ? gS[c]! : 0;
      pre[c] = 0;
      z[c] = 0;
      d[c] = 0;
      q[c] = 0;
      r[c] = 0;
      x[c] = 0;
      if (!on) continue;
      act[m++] = c;
      const live = (nc: number, cond: number) => (index[nc]! !== 0 ? cond : 0);
      diag[c] =
        (cx < w - 1 ? live(c + 1, gE[c]!) : 0) +
        (cx > 0 ? live(c - 1, gE[c - 1]!) : 0) +
        (c + w < n ? live(c + w, gS[c]!) : 0) +
        (c >= w ? live(c - w, gS[c - w]!) : 0);
      x[c] = p[c]! - pin; // warm start
    }
    // MIC(0), the modified incomplete Cholesky factor without fill, as Bridson gives it for the pressure of a fluid
    // on a grid (Fluid Simulation for Computer Graphics): tau 0.97, safety 0.25. With 'jacobi' the factor is the
    // diagonal alone.
    const [TAU_M, SAFETY] = [0.97, 0.25];
    const mic = this.fp.preconditioner === 'mic';
    for (let k = 0; k < m; k++) {
      const c = act[k]!;
      const cw = c % w > 0 ? c - 1 : c;
      const cn = c >= w ? c - w : c;
      const preW = cw !== c ? pre[cw]! : 0;
      const preN = cn !== c ? pre[cn]! : 0;
      const ew = mic && cw !== c ? aE[cw]! : 0;
      const en = mic && cn !== c ? aS[cn]! : 0;
      let e =
        diag[c]! -
        (ew * preW) ** 2 -
        (en * preN) ** 2 -
        TAU_M * (ew * aS[cw]! * preW * preW + en * aE[cn]! * preN * preN);
      if (e < SAFETY * diag[c]!) e = diag[c]!;
      pre[c] = 1 / Math.sqrt(e);
    }
    const apply = (v: Float64Array, out: Float64Array) => {
      for (let k = 0; k < m; k++) {
        const c = act[k]!;
        let acc = diag[c]! * v[c]!;
        if (aE[c]! > 0) acc -= aE[c]! * v[c + 1]!;
        if (aS[c]! > 0) acc -= aS[c]! * v[c + w]!;
        if (c % w > 0) acc -= aE[c - 1]! * v[c - 1]!;
        if (c >= w) acc -= aS[c - w]! * v[c - w]!;
        out[c] = acc;
      }
    };
    const precondition = (rr: Float64Array, out: Float64Array) => {
      if (!mic) {
        // The diagonal alone: z = r / diag, each cell by itself.
        for (let k = 0; k < m; k++) out[act[k]!] = rr[act[k]!]! * pre[act[k]!]! * pre[act[k]!]!;
        return;
      }
      // Solve L t = r, then L^T z = t; t is held in `out`. Each cell needs the result of the cell before it in its
      // row and in its column: a chain through the whole grid.
      for (let k = 0; k < m; k++) {
        const c = act[k]!;
        let t = rr[c]!;
        if (c % w > 0) t += aE[c - 1]! * pre[c - 1]! * out[c - 1]!;
        if (c >= w) t += aS[c - w]! * pre[c - w]! * out[c - w]!;
        out[c] = t * pre[c]!;
      }
      for (let k = m - 1; k >= 0; k--) {
        const c = act[k]!;
        let t = out[c]!;
        if (aE[c]! > 0) t += aE[c]! * pre[c]! * out[c + 1]!;
        if (aS[c]! > 0) t += aS[c]! * pre[c]! * out[c + w]!;
        out[c] = t * pre[c]!;
      }
    };
    const i0 = this.fp.i0;
    apply(x, q);
    let rr = 0;
    for (let k = 0; k < m; k++) {
      const c = act[k]!;
      const rc = (c === source ? i0 : 0) - q[c]!;
      r[c] = rc;
      rr += rc * rc;
    }
    precondition(r, z);
    let rz = 0;
    for (let k = 0; k < m; k++) {
      const c = act[k]!;
      d[c] = z[c]!;
      rz += r[c]! * z[c]!;
    }
    const tol2 = (this.fp.tolerance * i0) ** 2;
    let it = 0;
    for (; it < 5000 && rr > tol2; it++) {
      apply(d, q);
      let dq = 0;
      for (let k = 0; k < m; k++) dq += d[act[k]!]! * q[act[k]!]!;
      const alpha = rz / dq;
      rr = 0;
      for (let k = 0; k < m; k++) {
        const c = act[k]!;
        x[c]! += alpha * d[c]!;
        r[c]! -= alpha * q[c]!;
        rr += r[c]! * r[c]!;
      }
      precondition(r, z);
      let rzNew = 0;
      for (let k = 0; k < m; k++) rzNew += r[act[k]!]! * z[act[k]!]!;
      const beta = rzNew / rz;
      rz = rzNew;
      for (let k = 0; k < m; k++) d[act[k]!] = z[act[k]!]! + beta * d[act[k]!]!;
    }
    this.unknowns = m;
    for (let c = 0; c < n; c++) p[c] = index[c] === 1 ? x[c]! : 0;
    this.stats = { iterations: it, source: i0, sink: i0, joined: true, residual: Math.sqrt(rr) / i0 };
    // Cells outside the component carry no flux.
    for (let c = 0; c < n; c++) if (index[c] === 0) this.maskOut(c);
  }

  /** A cell outside the component of the source: no edge of it carries flux. */
  private maskOut(c: number) {
    const { w } = this.world;
    this.gE[c] = 0;
    this.gS[c] = 0;
    if (c % w > 0) this.gE[c - 1] = 0;
    if (c >= w) this.gS[c - w] = 0;
  }

  // --- lag: damped local iterations with fixed pressures at the source and the sink --------------------------------

  private solveLag(source: number, sink: number): number {
    const { w, h, open } = this.world;
    const { gE, gS, g } = this;
    const { iterations, weight, radius, i0, virtual } = this.fp;
    const omega = 2 / (1 + Math.sqrt(1 - radius * radius));
    // Edge conductances for the iteration: the harmonic mean of the conductivities plus `virtual`.
    const eE = this.flowE;
    const eS = this.flowS;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        if (!open[c]) {
          eE[c] = 0;
          eS[c] = 0;
          continue;
        }
        const a = g[c]! + virtual;
        const e = x < w - 1 && open[c + 1] ? g[c + 1]! + virtual : 0;
        const s = y < h - 1 && open[c + w] ? g[c + w]! + virtual : 0;
        eE[c] = e > 0 ? (2 * a * e) / (a + e) : 0;
        eS[c] = s > 0 ? (2 * a * s) / (a + s) : 0;
      }
    for (let it = 0; it < iterations; it++) {
      const { p, pPrev, pNext } = this;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const c = y * w + x;
          if (!open[c]) continue;
          if (c === source) {
            pNext[c] = 1;
            continue;
          }
          if (c === sink) {
            pNext[c] = -1;
            continue;
          }
          const e = x < w - 1 ? eE[c]! : 0;
          const wst = x > 0 ? eE[c - 1]! : 0;
          const s = y < h - 1 ? eS[c]! : 0;
          const nth = y > 0 ? eS[c - w]! : 0;
          const sum = e + wst + s + nth;
          if (sum <= 0) {
            pNext[c] = p[c]!;
            continue;
          }
          const avg =
            (e * (e > 0 ? p[c + 1]! : 0) +
              wst * (wst > 0 ? p[c - 1]! : 0) +
              s * (s > 0 ? p[c + w]! : 0) +
              nth * (nth > 0 ? p[c - w]! : 0)) /
            sum;
          // Second-order Richardson on the weighted Jacobi iteration M = (1 − weight) I + weight J.
          const jac = p[c]! + weight * (avg - p[c]!);
          pNext[c] = omega * jac + (1 - omega) * pPrev[c]!;
        }
      this.pPrev = p;
      this.p = pNext;
      this.pNext = pPrev;
    }
    const p = this.p;
    const current = (c: number) => {
      const x = c % w;
      const y = (c - x) / w;
      let sum = 0;
      if (x < w - 1) sum += gE[c]! * (p[c]! - p[c + 1]!);
      if (x > 0) sum += gE[c - 1]! * (p[c]! - p[c - 1]!);
      if (y < h - 1) sum += gS[c]! * (p[c]! - p[c + w]!);
      if (y > 0) sum += gS[c - w]! * (p[c]! - p[c - w]!);
      return sum;
    };
    const out = current(source);
    const into = -current(sink);
    const joined = out > 1e-12 && into > 1e-12;
    this.stats = { iterations, source: out, sink: into, joined, residual: joined ? Math.abs(out - into) / out : 1 };
    if (!joined) {
      this.laneQ.fill(0);
      return 0;
    }
    // The flux of Tero's fixed total i0: scaled with the mean of the current that leaves the source and the current
    // that reaches the sink. The gate is their ratio: it is 1 only when the pressure has settled.
    const mean = 0.5 * (out + into);
    this.fluxFromPressure(i0 / mean);
    // 0 below a ratio of 0.8, 1 above 0.95: a pressure that still fills the network gives a lower ratio.
    const ratio = Math.min(out, into) / Math.max(out, into);
    const t = Math.min(1, Math.max(0, (ratio - 0.8) / 0.15));
    return t * t * (3 - 2 * t);
  }

  // --- ma: walkers ------------------------------------------------------------------------------------------------

  private flowE = new Float64Array(0);
  private flowS = new Float64Array(0);
  private nStart = new Float64Array(0);
  private rs = 0;
  private rand(): number {
    this.rs = pcg(this.rs);
    return (this.rs >>> 8) / 16777216;
  }
  /** A Poisson sample: Knuth's product for a small mean, a rounded normal sample for a large one. */
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
    const u2 = this.rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * z));
  }

  private walk(source: number, sink: number) {
    const { w, h, open } = this.world;
    const { gE, gS, N } = this;
    const Q = this.laneQ;
    const { walkers, dt, i0 } = this.fp;
    this.rs = pcg(this.step ^ pcg(this.fp.seed ^ 0x51ed));
    // Capacitance of each cell: the sum of its edge conductances (Ma 2013, Eq. 2.15).
    const C = this.pNext;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        C[c] =
          (x < w - 1 ? gE[c]! : 0) + (x > 0 ? gE[c - 1]! : 0) + (y < h - 1 ? gS[c]! : 0) + (y > 0 ? gS[c - w]! : 0);
      }
    N[source]! += walkers;
    const taken = Math.min(N[sink]!, walkers);
    N[sink]! -= taken;
    Q.fill(0);
    const unit = i0 / walkers;
    // All flows of a step come from the walkers at its start (Ma 2013, Eq. 2.6): first the sampled net flow of
    // every edge (Eq. 2.16, 2.5), then the moves. A cell that would give more walkers than it holds gives all it
    // holds, shared among its edges in proportion.
    const fE = this.flowE;
    const fS = this.flowS;
    const out = this.pPrev; // walkers that leave each cell
    out.fill(0);
    const sample = (a: number, b: number, cond: number): number => {
      if (cond <= 0 || C[a]! <= 0 || C[b]! <= 0) return 0;
      const mean = (N[a]! / C[a]! - N[b]! / C[b]!) * cond * dt;
      const n = this.poisson(Math.abs(mean));
      if (n === 0) return 0;
      out[mean > 0 ? a : b]! += n;
      return mean > 0 ? n : -n;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        fE[c] = open[c] && x < w - 1 ? sample(c, c + 1, gE[c]!) : 0;
        fS[c] = open[c] && y < h - 1 ? sample(c, c + w, gS[c]!) : 0;
      }
    const apply = (a: number, b: number, f: number) => {
      if (f === 0) return;
      const [from, to] = f > 0 ? [a, b] : [b, a];
      let n = Math.abs(f);
      if (out[from]! > Nstart[from]!) n = Math.floor((n * Nstart[from]!) / out[from]!);
      N[from]! -= n;
      N[to]! += n;
      Q[a]! += 0.5 * n * unit;
      Q[b]! += 0.5 * n * unit;
    };
    const Nstart = this.nStart;
    Nstart.set(N);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        apply(c, c + 1, fE[c]!);
        apply(c, c + w, fS[c]!);
      }
    this.stats = { iterations: 1, source: walkers, sink: taken, joined: true, residual: 1 - taken / walkers };
  }
}
