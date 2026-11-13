// CPU copy of the app's agent model for one strain, as the extended model runs a scene that senses first with the
// rule of one agent per cell in a closed arena (agents.wgsl claim/settle, diffuse.wgsl). Prototype code: the rules
// are the app's, the float rounding and the random streams are not bit-equal to the GPU.
import type { World } from './world.ts';

export interface JonesParams {
  sensorAngle: number; // degrees
  rotationAngle: number; // degrees
  sensorOffset: number;
  stepSize: number;
  deposit: number;
  decay: number;
  /** Weight of the food scent in a sensor reading. */
  foodWeight: number;
  /** Scent that a food cell releases per step: 255 · Food strength · emission scale. */
  foodSource: number;
  scentDecay: number;
  /** Chance per step that an agent dies (the setting Random shrinkage). */
  shrink: number;
  seed: number;
  /** Sensors read BLOCKED behind a wall (the extended model, ADR 0020). */
  senseWalls: boolean;
}

const TAU = Math.PI * 2;
const BLOCKED = -1e30;
const CORNER = 1e-3;

export function pcg(v: number): number {
  const state = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

const [STEER, SHRINK, BLOCK, INIT] = [0, 2, 3, 77];

export class Jones {
  readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly heading: Float32Array;
  readonly alive: Uint8Array;
  trail: Float32Array;
  scent: Float32Array;
  private tmp: Float32Array;
  private tmp2: Float32Array;
  /** Agents that moved into each cell in the last step. */
  readonly counts: Uint8Array;
  occ: Uint8Array;
  private occNext: Uint8Array;
  private readonly claims: Uint32Array;
  step = 0;
  aliveCount = 0;
  /** Flow coupling: factor on the deposit of a cell (null: 1 everywhere). */
  depositScale: Float32Array | null = null;
  /** Flow coupling: added to what a sensor reads at a cell (null: nothing). */
  lure: Float32Array | null = null;
  /** Flow coupling: extra chance per step that an agent in a cell dies (null: none). */
  deathChance: Float32Array | null = null;
  /** Flow coupling: chance per step that an agent that moved into a cell divides (null: none). */
  birthChance: Float32Array | null = null;
  births = 0;
  deaths = 0;
  private freeSlot = 0;
  private rs = 0;
  private readonly startCount: number;

  constructor(
    readonly world: World,
    readonly p: JonesParams,
    density: number,
    /** Cells where agents start (and the cells that the density counts); all cells of the grid without it. */
    private readonly allowed?: Uint8Array,
    /** Agents that the simulation holds, alive and dead; the start population without it. */
    capacity?: number,
  ) {
    const cells = world.w * world.h;
    let count = cells;
    if (allowed) {
      count = 0;
      for (let c = 0; c < cells; c++) count += allowed[c]!;
    }
    this.startCount = Math.round(density * count);
    this.n = Math.max(this.startCount, capacity ?? 0);
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.heading = new Float32Array(this.n);
    this.alive = new Uint8Array(this.n);
    this.trail = new Float32Array(cells);
    this.scent = new Float32Array(cells);
    this.tmp = new Float32Array(cells);
    this.tmp2 = new Float32Array(cells);
    this.counts = new Uint8Array(cells);
    this.occ = new Uint8Array(cells);
    this.occNext = new Uint8Array(cells);
    this.claims = new Uint32Array(cells);
    this.init();
  }

  private seedFor(id: number, salt: number): number {
    return pcg(id ^ pcg(this.step ^ pcg(this.p.seed ^ salt)));
  }
  private rand(): number {
    this.rs = pcg(this.rs);
    return (this.rs >>> 8) / 16777216;
  }

  /** The start layout 'mixed' with the rule: every agent on an open cell of its own, at a random point of it. */
  private init() {
    const { w, h, open } = this.world;
    this.rs = pcg(this.p.seed ^ INIT);
    for (let i = 0; i < this.startCount; i++) {
      for (let tries = 0; tries < 100000; tries++) {
        const cx = Math.floor(this.rand() * w);
        const cy = Math.floor(this.rand() * h);
        const c = cy * w + cx;
        if (!open[c] || this.occ[c] || (this.allowed && !this.allowed[c])) continue;
        this.occ[c] = 1;
        this.x[i] = cx + this.rand();
        this.y[i] = cy + this.rand();
        this.heading[i] = this.rand() * TAU;
        this.alive[i] = 1;
        this.aliveCount++;
        break;
      }
    }
  }

  private cellOf(px: number, py: number): number {
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (cx < 0 || cy < 0 || cx >= this.world.w || cy >= this.world.h) return -1;
    return cy * this.world.w + cx;
  }

  private wallAt(cx: number, cy: number): boolean {
    const { w, h, wall } = this.world;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    return wall[cy * w + cx] === 1;
  }

  /** False if the segment from p to q passes through a wall cell between its start cell and its end cell. */
  private clearPath(px: number, py: number, qx: number, qy: number): boolean {
    let cx = Math.floor(px);
    let cy = Math.floor(py);
    const ex = Math.floor(qx);
    const ey = Math.floor(qy);
    const spanX = Math.abs(ex - cx);
    const spanY = Math.abs(ey - cy);
    if (spanX + spanY < 2) return true;
    const start = this.cellOf(px, py);
    if (start >= 0 && Math.max(spanX, spanY) < this.world.clear[start]!) return true;
    const dx = qx - px;
    const dy = qy - py;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const len = Math.hypot(dx, dy);
    let tx = sx !== 0 ? (cx + (dx > 0 ? 1 : 0) - px) / dx : 2;
    let ty = sy !== 0 ? (cy + (dy > 0 ? 1 : 0) - py) / dy : 2;
    const dtx = sx !== 0 ? 1 / Math.abs(dx) : 2;
    const dty = sy !== 0 ? 1 / Math.abs(dy) : 2;
    for (let k = 0; k < 200; k++) {
      const needX = cx !== ex;
      const needY = cy !== ey;
      if (!needX && !needY) break;
      if (needX && needY && Math.abs(tx - ty) * len < CORNER) {
        if (this.wallAt(cx + sx, cy) || this.wallAt(cx, cy + sy)) return false;
        cx += sx;
        cy += sy;
        tx += dtx;
        ty += dty;
      } else if (needX && (!needY || tx < ty)) {
        cx += sx;
        tx += dtx;
      } else {
        cy += sy;
        ty += dty;
      }
      if ((cx !== ex || cy !== ey) && this.wallAt(cx, cy)) return false;
    }
    return true;
  }

  private sense(px: number, py: number, qx: number, qy: number): number {
    const c = this.cellOf(qx, qy);
    if (c < 0 || !this.world.open[c]) return BLOCKED;
    if (this.p.senseWalls && !this.clearPath(px, py, qx, qy)) return BLOCKED;
    const lure = this.lure ? this.lure[c]! : 0;
    return this.trail[c]! + this.p.foodWeight * this.scent[c]! + lure;
  }

  private steer(i: number): number {
    const { sensorAngle, rotationAngle, sensorOffset: so } = this.p;
    const sa = (sensorAngle * Math.PI) / 180;
    const ra = (rotationAngle * Math.PI) / 180;
    const [px, py, h0] = [this.x[i]!, this.y[i]!, this.heading[i]!];
    const f = this.sense(px, py, px + so * Math.cos(h0), py + so * Math.sin(h0));
    const l = this.sense(px, py, px + so * Math.cos(h0 - sa), py + so * Math.sin(h0 - sa));
    const r = this.sense(px, py, px + so * Math.cos(h0 + sa), py + so * Math.sin(h0 + sa));
    let h = h0;
    if (f > l && f > r) {
      // keep
    } else if (f < l && f < r) {
      h += this.rand() < 0.5 ? ra : -ra;
    } else if (l < r) {
      h += ra;
    } else if (r < l) {
      h -= ra;
    }
    return h - TAU * Math.floor(h / TAU);
  }

  private key(id: number): number {
    return pcg(id ^ pcg((this.step ^ 0x9e3779b9 ^ this.p.seed) >>> 0));
  }

  private canClaim(i: number, c: number, dx: number, dy: number): boolean {
    if (c < 0 || !this.world.open[c]) return false;
    if (c === this.cellOf(this.x[i]!, this.y[i]!)) return false;
    if (this.occ[c]) return false;
    return this.clearPath(this.x[i]!, this.y[i]!, dx, dy);
  }

  /** One step: shrinkage, sense and turn, claim, move and count, then the diffusion with the deposits. */
  advance() {
    const { w, h, open, food } = this.world;
    const p = this.p;
    const cells = w * h;
    this.claims.fill(0);
    // Claim pass.
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      this.rs = this.seedFor(i, SHRINK);
      const here = this.cellOf(this.x[i]!, this.y[i]!);
      const extra = this.deathChance && here >= 0 ? this.deathChance[here]! : 0;
      if (this.rand() < p.shrink + extra) {
        this.alive[i] = 0;
        this.aliveCount--;
        this.deaths++;
        continue;
      }
      this.rs = this.seedFor(i, STEER);
      const hd = this.steer(i);
      this.heading[i] = hd;
      const dx = this.x[i]! + p.stepSize * Math.cos(hd);
      const dy = this.y[i]! + p.stepSize * Math.sin(hd);
      const c = this.cellOf(dx, dy);
      if (this.canClaim(i, c, dx, dy)) {
        const k = this.key(i);
        if (k > this.claims[c]!) this.claims[c] = k;
      }
    }
    // Settle pass.
    this.occNext.fill(0);
    this.counts.fill(0);
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const hd = this.heading[i]!;
      const dx = this.x[i]! + p.stepSize * Math.cos(hd);
      const dy = this.y[i]! + p.stepSize * Math.sin(hd);
      const c = this.cellOf(dx, dy);
      const here = this.cellOf(this.x[i]!, this.y[i]!);
      let ok = c >= 0 && open[c] === 1 && c === here;
      if (!ok && this.canClaim(i, c, dx, dy)) ok = this.claims[c] === this.key(i);
      if (ok) {
        this.x[i] = dx;
        this.y[i] = dy;
        this.counts[c]!++;
        this.occNext[c]!++;
      } else {
        this.rs = this.seedFor(i, BLOCK);
        this.heading[i] = this.rand() * TAU;
        if (here >= 0) this.occNext[here]!++;
      }
    }
    [this.occ, this.occNext] = [this.occNext, this.occ];
    if (this.birthChance) this.divide();
    // Diffusion, sensing first: deposits and sources, the 3 × 3 mean with sinks outside and in walls, the decay.
    const src = this.tmp;
    const scale = this.depositScale;
    for (let c = 0; c < cells; c++) {
      src[c] = open[c] ? this.trail[c]! + this.counts[c]! * p.deposit * (scale ? scale[c]! : 1) : 0;
    }
    this.blur(src, this.trail, 1 - p.decay);
    for (let c = 0; c < cells; c++) src[c] = open[c] ? this.scent[c]! + (food[c] ? p.foodSource : 0) : 0;
    this.blur(src, this.scent, 1 - p.scentDecay);
    this.step++;
  }

  /**
   * Flow coupling: every dead agent draws one random cell of the grid per step. If the cell is open and empty, the
   * agent comes to life there with the chance of that cell, at a random point of it and with a random heading. It
   * deposits nothing in this step. (The agent pass of the app places a dead agent the same way for the inoculate
   * tool, ADR 0023.)
   */
  private divide() {
    const { w, h, open } = this.world;
    const chance = this.birthChance!;
    const BIRTH = 5;
    for (let i = 0; i < this.n; i++) {
      if (this.alive[i]) continue;
      this.rs = this.seedFor(i, BIRTH);
      const cx = Math.floor(this.rand() * w);
      const cy = Math.floor(this.rand() * h);
      const c = cy * w + cx;
      if (!open[c] || this.occ[c] || chance[c]! <= 0) continue;
      if (this.rand() >= chance[c]!) continue;
      this.alive[i] = 1;
      this.x[i] = cx + this.rand();
      this.y[i] = cy + this.rand();
      this.heading[i] = this.rand() * TAU;
      this.occ[c] = 1;
      this.aliveCount++;
      this.births++;
    }
  }

  /** out = keep · (3 × 3 sum of src, cells outside as 0) / 9 at open cells, 0 elsewhere. Separable. */
  private blur(src: Float32Array, out: Float32Array, keep: number) {
    const { w, h, open } = this.world;
    const row = this.tmp2;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        row[o + x] = (x > 0 ? src[o + x - 1]! : 0) + src[o + x]! + (x < w - 1 ? src[o + x + 1]! : 0);
      }
    }
    const k = keep / 9;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const c = o + x;
        out[c] = open[c] ? k * ((y > 0 ? row[c - w]! : 0) + row[c]! + (y < h - 1 ? row[c + w]! : 0)) : 0;
      }
    }
  }
}

/** The Maze of the app (src/model/presets.ts `maze`): Jones' contracting agent with the app's values. */
export function mazeParams(seed: number): JonesParams {
  return {
    sensorAngle: 45,
    rotationAngle: 45,
    sensorOffset: 7,
    stepSize: 1,
    deposit: 5,
    decay: 0.1,
    foodWeight: 1,
    foodSource: 255 * 0.03,
    scentDecay: 0.1,
    shrink: 0.0001,
    seed,
    senseWalls: true,
  };
}
