// The model of the app on the CPU, for one strain, as the scenes with growth and the flow run it (forager() in
// src/model/presets.ts): Jones' agent with one agent per cell (docs/model.md, section 7), growth and shrinkage
// (section 9), the trail and the food scent, sensing first (section 6), the slime field (6.9) and the flow in the
// tubes (section 8). Prototype code for stage 4 of the plan of 2026-11-16 (TODO.md): the rules are those of the app;
// the random streams, the order of the births and the float rounding are not. On top of the app it has the rules of
// stage 4 as options (`Front`), each off by default, so that `new Sim(layout, params())` runs the app's rules.
import { FLOW, FLOW_ITERATIONS, flowRoles, pcg } from '../../src/engine/flow';

const TAU = Math.PI * 2;
const BLOCKED = -1e30;
const CORNER = 1e-3;
const DEG = Math.PI / 180;
/** The flow memory from which a tube cell counts as a vein: where the flow starts to bring dead agents to life (8.5). */
export const VEIN = FLOW.birthFrom;

// Random streams, numbered as in the app where the app has them (docs/model.md, 7.7), and new ones above 10.
const [STEER, BLOCK, GROW, ORDER, RESPAWN, STARVE, HOLD_MOVE, HOLD_BIRTH, START] = [0, 3, 4, 6, 8, 9, 11, 12, 13];
/** The marks of the paid births of `paidBy` 'ahead'; START + 1 is the push of the territory. */
const MARK = 15;
/** The draw of a paid birth of `paidBy` 'chance', per agent. */
const PAID = 16;
/** A sum in the form of a GPU (`sums` 'fixed') counts a sink rate in steps of 1 / FIXED, as an integer. */
export const FIXED = 65536;
/** The cells around a start agent that join the territory of its strain (`start` 'agents'): a square of 7 × 7. */
export const START_REACH = 3;

let rs = 0;
const seedFor = (id: number, salt: number, step: number, seed: number) => {
  rs = pcg((id ^ pcg((step ^ pcg((seed ^ salt) >>> 0)) >>> 0)) >>> 0);
};
const rand = () => {
  rs = pcg(rs);
  return (rs >>> 8) / 16777216;
};

/** The grid of a run. */
export interface Layout {
  w: number;
  h: number;
  /** 1 for a cell inside the arena without a wall. */
  open: Uint8Array;
  /** 1 for a wall cell. A cell outside the arena is no wall. */
  wall: Uint8Array;
  /** 1 for an open cell with food. */
  food: Uint8Array;
  /** The cells of each food site, nearest its centre first: the first one that holds a tube is its port (8.2). */
  sites: Int32Array[];
  /** The middle of the disc on which the colony starts. */
  start: readonly [number, number];
  /** Cells that the Slime tool painted before step 0. */
  slime?: Uint8Array;
}

/**
 * The rules of stage 4, each off by default. `sink`: a birth onto fresh ground (no slime) takes flux at the cell of the
 * parent; `colony`: without a covered food every tube cell gives an equal share of what the sinks take; `hold`: the
 * chance that a move or a birth onto a cell without plasm succeeds.
 */
export interface Front {
  sink: boolean;
  /** The flux that one birth onto fresh ground per step takes, in the units of the flow. */
  unit: number;
  /** The sink of a cell follows the births of its parents with this time, in steps (an exponential mean). */
  tau: number;
  /** Above 0: every sink is scaled so that all of them take this many times the flow strength together. */
  norm: number;
  colony: boolean;
  hold: number;
  /** Plasm for the hold: the trail of the strain at or above its low level, or a tube body (B ≥ 0.05). */
  holdOn: 'trail' | 'body';
  /** The hold also stops births (else only moves). */
  holdBirths: boolean;
  /** Plasm for the hold of a birth, if it differs from `holdOn`. */
  holdBirthsOn: 'trail' | 'body' | 'same';
  /**
   * Above 0: a birth also counts as one onto fresh ground when the front reached the cell of the child less than this
   * many steps before (its front stamp, 6.9). 0: only a cell without slime counts.
   */
  young: number;
  /**
   * Above 0: the front grows by births that the flow pays (stage 4, the second form). The young ground of the colony
   * takes `norm` times the flow strength, an equal share at each agent on a cell of it that has room beside it, and
   * every `paid` of flux that it takes is one birth there, without the window of Jones' rule.
   */
  paid: number;
  /**
   * Where the paid births go: to the agents of the rim on fresh ground ('fresh', the reading of the owner's rule that
   * only a birth onto fresh ground counts), or to the agents of the rim at every sink in the share of the flux that it
   * takes ('sinks'), so that the flux that a rim on slime takes pays births there.
   */
  paidOn: 'fresh' | 'sinks';
  /**
   * Where a sink sits: within `reach` of ground without slime, or at the edge of the territory on slime ('fresh'), or
   * always at the edge of the territory, where the colony grows, with the weight 1 within `reach` of ground without
   * slime and `slimeWeight` elsewhere ('edge'): then slime sets only the weight of a sink, not its place.
   */
  sinkAt: 'fresh' | 'edge';
  /**
   * Above 0: the front is the agents of a tube cell with room beside it that lie at most this many cells from ground
   * without slime (a Chebyshev distance). 0: the young ground of `young` is the front.
   */
  reach: number;
  /** The front is only the agents at the rim of the colony (a neighbour without a tube body), and a paid child goes out. */
  rim: boolean;
  /** Above 0: a sensor also reads minus this weight times the pressure: the agents move with the flow. */
  drift: number;
  /** The pressure: the app's 16 iterations from the last step ('app'), or solved to a tolerance ('exact'). */
  solver: 'app' | 'exact';
  /**
   * Above 0: the colony has a territory, and an agent moves and a child is born only into it. An open cell joins it
   * with this chance per step while a neighbour of it (8) is territory and holds a tube body: the front advances at
   * most this many cells per step, on fresh ground and on slime alike. It replaces the hold.
   */
  speed: number;
  /**
   * The neighbour that lets a cell join the territory holds a tube body ('body') or plasm, the trail ('trail'), or
   * 'push': each agent on a neighbour of territory pushes the cell open with the chance `speed`, so the front moves
   * the faster the more plasm lies at it (Kuroda et al. 2015: the speed grows with the thickness).
   */
  speedOn: 'body' | 'trail' | 'push';
  /** The weight of a sink at a rim without fresh ground within `reach`: 0 is the owner's rule (only fresh ground). */
  slimeWeight: number;
  /**
   * How the births that the flux pays find their parents (ADR 0067). 'order': one random order over all agents of the
   * front, with odds in the weight of each (ADR 0065). 'chance', the form of a GPU: each agent of the front that could
   * claim a child claims one with the chance min(1, B · r / P), B the budget, r its sink rate and P the sum of the sink
   * rates of these agents (paidByChance()). 'ahead', the second try: after the step before a growth step the cells
   * whose agent could claim a child get a mark with that chance, and in the growth step the agent of the front on a
   * marked cell claims a child; the budget never exceeds the number of sinks. Each claim lowers the budget by 1.
   */
  paidBy: 'order' | 'chance' | 'ahead';
  /**
   * How a sink learns whether ground without slime lies within `reach` (ADR 0067). 'chamfer': the distance field of
   * two passes over the grid. 'box', the form of a GPU: the sink looks at the square of side 2 · reach + 1 around it.
   * Both give the same sinks.
   */
  fresh: 'chamfer' | 'box';
  /**
   * How the sums over the cells are taken (ADR 0067). 'float': in floats. 'fixed', the form of a GPU: each sink rate
   * in steps of 1 / FIXED as an integer, so that every order of the additions gives the same sum.
   */
  sums: 'float' | 'fixed';
  /**
   * The territory of the start (ADR 0067). 'disc': the disc of the start and a rim of 3 cells. 'agents', the form of a
   * GPU: every open cell within START_REACH cells of a start agent (the square of 7 × 7 around it).
   */
  start: 'disc' | 'agents';
}

export interface Params {
  seed: number;
  /** The flow strength I0 (the setting Flow strength). */
  flow: number;
  /** The setting Slime life time in hours. */
  slimeLife: number;
  sensorOffset: number;
  sensorAngle: number;
  rotationAngle: number;
  stepSize: number;
  deposit: number;
  decay: number;
  /** The weight of the food scent in a sensor (the strain's food weight). */
  foodWeight: number;
  /** The setting Food strength (wProj). */
  foodStrength: number;
  scentDecay: number;
  /** The setting Covered food (6.5): a food cell with an agent in its 3 × 3 block releases this share of its scent. */
  covered: number;
  /** Agents that the simulation holds, alive and dead (Capacity times the cells). */
  capacity: number;
  /** Agents of the start: the layout Food places about 50 on a disc of about 100 cells. */
  startAgents: number;
  /** The step at which the colony starts (the Y-maze starts it after the slime has aged). */
  startStep: number;
  front: Front;
}

export const noFront = (): Front => ({
  sink: false,
  unit: 0,
  tau: 100,
  norm: 0,
  colony: false,
  hold: 1,
  holdOn: 'trail',
  holdBirths: true,
  holdBirthsOn: 'same',
  young: 0,
  paid: 0,
  paidOn: 'fresh',
  sinkAt: 'fresh',
  reach: 0,
  rim: false,
  drift: 0,
  solver: 'app',
  speed: 0,
  speedOn: 'body',
  slimeWeight: 0,
  paidBy: 'order',
  fresh: 'chamfer',
  sums: 'float',
  start: 'disc',
});

/** The words that a text option of `Front` takes. */
const FRONT_TEXT: Record<string, readonly string[]> = {
  holdOn: ['trail', 'body'],
  holdBirthsOn: ['same', 'trail', 'body'],
  solver: ['app', 'exact'],
  speedOn: ['body', 'trail', 'push'],
  paidOn: ['fresh', 'sinks'],
  sinkAt: ['fresh', 'edge'],
  paidBy: ['order', 'chance', 'ahead'],
  fresh: ['chamfer', 'box'],
  sums: ['float', 'fixed'],
  start: ['disc', 'agents'],
};

/** The forms of a GPU for the rules of stage 4 (ADR 0067): the key=value words that turn all of them on. */
export const GPU_FORMS = { paidBy: 'chance', fresh: 'box', sums: 'fixed', start: 'agents' } as const;

/**
 * The rules of stage 4 from the key=value words of a command line: a flag is 1 or 0. `own` names the other keys of
 * the command. An unknown key, a number that does not parse or a word that an option does not take stops the run,
 * because a run with a default in its place looks right (zsh passes "a=1 b=2" as one word from a variable).
 */
export function frontFrom(args: Record<string, string>, own: readonly string[] = []): Front {
  const front = noFront();
  const record = front as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(args)) {
    if (own.includes(key)) continue;
    if (!(key in front)) throw new Error(`unknown key ${key}=${value}`);
    const now = record[key];
    const words = FRONT_TEXT[key];
    if (typeof now === 'boolean') record[key] = value === '1';
    else if (words) {
      if (!words.includes(value)) throw new Error(`${key}=${value}: the option takes ${words.join(', ')}`);
      record[key] = value;
    } else {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${key}=${value} is no number`);
      record[key] = n;
    }
  }
  return front;
}

/** The settings of forager() with Jones' foraging agent (ADR 0064, decision 1). */
export const params = (patch: Partial<Params> = {}): Params => ({
  seed: 1,
  flow: 8,
  slimeLife: 144,
  sensorOffset: 7,
  sensorAngle: 22.5,
  rotationAngle: 45,
  stepSize: 1,
  deposit: 5,
  decay: 0.1,
  foodWeight: 1,
  foodStrength: 0.03,
  scentDecay: 0.1,
  covered: 1,
  capacity: 0,
  startAgents: 50,
  startStep: 0,
  front: noFront(),
  ...patch,
});

const harmonic = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));

export class Sim {
  readonly w: number;
  readonly h: number;
  readonly cells: number;
  step: number;
  readonly cap: number;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly ah: Float64Array;
  readonly alive: Uint8Array;
  trail: Float32Array;
  scent: Float32Array;
  occ: Uint8Array;
  /** The occupancy after the moves of a growth step, while the growth pass runs. */
  occNext: Uint8Array;
  /** Moves into each cell in this step (the deposits). */
  readonly counts: Uint8Array;
  private readonly claims: Uint32Array;
  private readonly kind: Uint8Array;
  private readonly tx: Float64Array;
  private readonly ty: Float64Array;
  private readonly tc: Int32Array;
  private readonly claimed: Uint8Array;
  /** The cell that each agent claims for a child in a growth step, −1 for none. */
  readonly want: Int32Array;
  private readonly tmp: Float32Array;
  private readonly tmp2: Float32Array;
  private readonly sat: Int32Array;
  /** Chebyshev distance to the nearest wall, at most 255. */
  private readonly clear: Uint8Array;
  private readonly walls: boolean;
  /** The four neighbours of a cell (east, west, south, north) for the flow, −1 for none. */
  private readonly nb: Int32Array;
  // The flow (section 8): memory D, tube body B, conductivity G, the role code of a port, pressure per lane.
  readonly D: Float32Array;
  readonly B: Float32Array;
  G: Float32Array;
  private Gnext: Float32Array;
  readonly role: Float32Array;
  readonly P: Float32Array[];
  private readonly Pb: Float32Array[];
  private readonly Pnext: Float32Array[];
  /** The flux of the last step through each cell, the mean over the lanes that ran. */
  readonly Q: Float32Array;
  private readonly fmean: Float32Array;
  private readonly edgeE: Float32Array;
  private readonly edgeS: Float32Array;
  private ports: Int32Array;
  private portsPrev: Int32Array;
  private lanes = 1;
  // The slime field (6.9): the stamp and the front stamp.
  readonly S: Uint32Array;
  readonly F: Uint32Array;
  readonly life: number;
  // The rules of stage 4.
  /** The sink of each cell: the births onto fresh ground of the parents on it, per step, an exponential mean. */
  readonly sinkRate: Float32Array;
  private readonly sinkCount: Float32Array;
  /** What the front takes (below 0) and what the sources give (above 0) at each cell, in this step. */
  readonly extra: Float32Array;
  private frontActive = false;
  /** The total sink of the front in the last step. */
  frontTotal = 0;
  /** Births that the flow paid for and that are not born yet. */
  budget = 0;
  paidBirths = 0;
  /** The agents at the young front in the last flow pass. */
  demand = 0;
  /** The sum of the sink rates of the tube cells in the last flow pass. */
  sinkTotal = 0;
  /** The cells whose agent could claim a paid child after the last flow pass before a growth step (`paidBy` 'ahead'). */
  readonly payable: number[] = [];
  /**
   * P: the sum of the sink rates of the agents that could claim a child in the last growth step (`paidBy` 'chance'),
   * or of the cells of `payable` ('ahead').
   */
  sinkPayable = 0;
  /** For tests: called in a growth step before the paid births of `paidBy` 'chance'. */
  onPaid?: () => void;
  /** 1 for a cell that is marked for a paid birth in the next growth step (`paidBy` 'ahead'). */
  readonly marks: Uint8Array;
  /** The paid claims of the last growth step (`paidBy` 'chance' or 'ahead'). */
  paidClaims = 0;
  /** The agents of the front in the last growth step, the most that the budget may hold (`paidBy` 'chance'). */
  frontAgents = 0;
  /** The Chebyshev distance of each cell to ground without slime, at most 255 (with `reach`). */
  private readonly toFresh: Uint8Array;
  /** 1 for a cell of the territory of the colony (`speed`). */
  readonly territory: Uint8Array;
  /** The step, plus 1, at which a tube cell first reached the flow memory VEIN (0: never): for the delay of a vein. */
  readonly veinAt: Uint32Array;
  // Counts.
  births = 0;
  freshBirths = 0;
  starved = 0;
  shrunk = 0;
  respawned = 0;
  heldMoves = 0;
  heldBirths = 0;
  aliveCount = 0;
  private readonly low: number;
  private readonly scale: number;
  private readonly recover: number;

  constructor(
    readonly layout: Layout,
    readonly p: Params,
  ) {
    const { w, h } = layout;
    // The marks of `paidBy` 'chance' follow the sink rates: they are the form of `paidOn` 'sinks'.
    if (p.front.paidBy !== 'order' && p.front.paidOn !== 'sinks') throw new Error('paidBy needs paidOn=sinks');
    this.w = w;
    this.h = h;
    const n = w * h;
    this.cells = n;
    this.step = p.startStep;
    this.cap = p.capacity > 0 ? p.capacity : Math.round(0.25 * n);
    this.ax = new Float64Array(this.cap);
    this.ay = new Float64Array(this.cap);
    this.ah = new Float64Array(this.cap);
    this.alive = new Uint8Array(this.cap);
    this.kind = new Uint8Array(this.cap);
    this.tx = new Float64Array(this.cap);
    this.ty = new Float64Array(this.cap);
    this.tc = new Int32Array(this.cap);
    this.claimed = new Uint8Array(this.cap);
    this.want = new Int32Array(this.cap);
    this.trail = new Float32Array(n);
    this.scent = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.tmp2 = new Float32Array(n);
    this.sat = new Int32Array((w + 1) * (h + 1));
    this.occ = new Uint8Array(n);
    this.occNext = new Uint8Array(n);
    this.counts = new Uint8Array(n);
    this.claims = new Uint32Array(n);
    this.D = new Float32Array(n).fill(FLOW.fresh);
    this.B = new Float32Array(n);
    this.G = new Float32Array(n);
    this.Gnext = new Float32Array(n);
    this.role = new Float32Array(n);
    this.P = [0, 1, 2, 3].map(() => new Float32Array(n));
    this.Pb = [0, 1, 2, 3].map(() => new Float32Array(n));
    this.Pnext = [0, 1, 2, 3].map(() => new Float32Array(n));
    this.Q = new Float32Array(n);
    this.fmean = new Float32Array(n);
    this.edgeE = new Float32Array(n);
    this.edgeS = new Float32Array(n);
    this.ports = new Int32Array(layout.sites.length).fill(-1);
    this.portsPrev = new Int32Array(layout.sites.length).fill(-1);
    this.S = new Uint32Array(n);
    this.F = new Uint32Array(n);
    this.life = Math.round(p.slimeLife * 1800);
    this.sinkRate = new Float32Array(n);
    this.sinkCount = new Float32Array(n);
    this.extra = new Float32Array(n);
    this.toFresh = new Uint8Array(n);
    this.marks = new Uint8Array(n);
    this.territory = new Uint8Array(n);
    this.veinAt = new Uint32Array(n);
    this.low = 0.2 * p.deposit;
    this.scale = 1 / (p.deposit - this.low);
    this.recover = FLOW.recover * (144 / p.slimeLife);
    // The neighbours of the flow, and the distance to a wall for the walk of a move.
    this.nb = new Int32Array(n * 4).fill(-1);
    const { open, wall } = layout;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        if (!open[c]) continue;
        const at = (xx: number, yy: number) =>
          xx < 0 || yy < 0 || xx >= w || yy >= h || !open[yy * w + xx] ? -1 : yy * w + xx;
        this.nb.set([at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)], c * 4);
      }
    this.clear = new Uint8Array(n).fill(255);
    this.walls = wall.some((v) => v === 1);
    if (this.walls) {
      for (let c = 0; c < n; c++) if (wall[c]) this.clear[c] = 0;
      // Two passes of the chamfer transform with unit weights give the Chebyshev distance.
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const c = y * w + x;
          let v = this.clear[c]!;
          if (x > 0) v = Math.min(v, this.clear[c - 1]! + 1);
          if (y > 0) {
            v = Math.min(v, this.clear[c - w]! + 1);
            if (x > 0) v = Math.min(v, this.clear[c - w - 1]! + 1);
            if (x < w - 1) v = Math.min(v, this.clear[c - w + 1]! + 1);
          }
          this.clear[c] = v;
        }
      for (let y = h - 1; y >= 0; y--)
        for (let x = w - 1; x >= 0; x--) {
          const c = y * w + x;
          let v = this.clear[c]!;
          if (x < w - 1) v = Math.min(v, this.clear[c + 1]! + 1);
          if (y < h - 1) {
            v = Math.min(v, this.clear[c + w]! + 1);
            if (x < w - 1) v = Math.min(v, this.clear[c + w + 1]! + 1);
            if (x > 0) v = Math.min(v, this.clear[c + w - 1]! + 1);
          }
          this.clear[c] = v;
        }
    }
    if (layout.slime) for (let c = 0; c < n; c++) if (layout.slime[c] && open[c]) this.S[c] = 1;
    // The food scent reaches its steady state before the colony starts.
    for (let k = 0; k < 300; k++) this.diffuseScent();
    this.inoculate();
  }

  /** The start layout Food: about 50 agents on a disc of about 100 cells, each on a cell of its own (docs/model.md, 10). */
  private inoculate() {
    const { w, open } = this.layout;
    const [sx, sy] = this.layout.start;
    const r = Math.sqrt(100 / Math.PI);
    seedFor(0, START, 0, this.p.seed);
    let placed = 0;
    for (let tries = 0; placed < this.p.startAgents && tries < 100000; tries++) {
      const a = rand() * TAU;
      const d = r * Math.sqrt(rand());
      const [px, py] = [sx + d * Math.cos(a), sy + d * Math.sin(a)];
      const c = this.cellOf(px, py);
      if (c < 0 || !open[c] || this.occ[c]) continue;
      this.occ[c] = 1;
      this.territory[c] = 1;
      this.ax[placed] = px;
      this.ay[placed] = py;
      this.ah[placed] = rand() * TAU;
      this.alive[placed] = 1;
      placed++;
    }
    this.aliveCount = placed;
    const { h } = this.layout;
    if (this.p.front.start === 'agents') {
      // The form of a GPU: every open cell within START_REACH cells of a start agent (ADR 0067).
      for (let i = 0; i < placed; i++) {
        const c = this.cellOf(this.ax[i]!, this.ay[i]!);
        const [x, y] = [c % w, Math.floor(c / w)];
        for (let yy = Math.max(0, y - START_REACH); yy <= Math.min(h - 1, y + START_REACH); yy++)
          for (let xx = Math.max(0, x - START_REACH); xx <= Math.min(w - 1, x + START_REACH); xx++)
            if (open[yy * w + xx]) this.territory[yy * w + xx] = 1;
      }
      return;
    }
    // The territory of the start: the disc of the colony and a rim of 3 cells (`speed`).
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (open[y * w + x] && Math.hypot(x + 0.5 - sx, y + 0.5 - sy) <= r + 3) this.territory[y * w + x] = 1;
  }

  cellOf(px: number, py: number): number {
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1;
    return cy * this.w + cx;
  }

  private wallAt(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    return this.layout.wall[cy * this.w + cx] === 1;
  }

  /** False if the segment from p to q crosses a wall between its start cell and its end cell (ADR 0019, ADR 0020). */
  private clearPath(px: number, py: number, qx: number, qy: number): boolean {
    if (!this.walls) return true;
    let cx = Math.floor(px);
    let cy = Math.floor(py);
    const ex = Math.floor(qx);
    const ey = Math.floor(qy);
    const spanX = Math.abs(ex - cx);
    const spanY = Math.abs(ey - cy);
    if (spanX + spanY < 2) return true;
    const start = this.cellOf(px, py);
    if (start >= 0 && Math.max(spanX, spanY) < this.clear[start]!) return true;
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
    if (c < 0 || !this.layout.open[c]) return BLOCKED;
    if (!this.clearPath(px, py, qx, qy)) return BLOCKED;
    const drift = this.p.front.drift;
    let v = this.trail[c]! + this.p.foodWeight * this.scent[c]!;
    if (drift > 0) {
      let p = 0;
      for (let l = 0; l < this.lanes; l++) p += this.P[l]![c]!;
      v -= (drift * p) / this.lanes;
    }
    return v;
  }

  private steer(i: number): number {
    const { sensorAngle, rotationAngle, sensorOffset: so } = this.p;
    const sa = sensorAngle * DEG;
    const ra = rotationAngle * DEG;
    const [px, py, h0] = [this.ax[i]!, this.ay[i]!, this.ah[i]!];
    const f = this.sense(px, py, px + so * Math.cos(h0), py + so * Math.sin(h0));
    const l = this.sense(px, py, px + so * Math.cos(h0 - sa), py + so * Math.sin(h0 - sa));
    const r = this.sense(px, py, px + so * Math.cos(h0 + sa), py + so * Math.sin(h0 + sa));
    let hd = h0;
    if (f > l && f > r) {
      // keep
    } else if (f < l && f < r) hd += rand() < 0.5 ? ra : -ra;
    else if (l < r) hd += ra;
    else if (r < l) hd -= ra;
    return hd - TAU * Math.floor(hd / TAU);
  }

  private key(id: number): number {
    return pcg((id ^ pcg((this.step ^ 0x9e3779b9 ^ this.p.seed) >>> 0)) >>> 0);
  }

  /** Whether a cell holds plasm for the hold of stage 4, from the last step. */
  plasm(c: number, on: 'trail' | 'body' | 'same' = 'same'): boolean {
    const kind = on === 'same' ? this.p.front.holdOn : on;
    return kind === 'body' ? this.B[c]! >= FLOW.bodyLow : this.trail[c]! >= this.low;
  }

  /** One step of the model: the agents, growth and shrinkage, the diffusion, the slime, the flow. */
  advance() {
    this.agentPass();
    if (this.step % 3 === 0) this.growthPass();
    else [this.occ, this.occNext] = [this.occNext, this.occ];
    this.diffuseTrail();
    this.diffuseScent();
    this.slimePass();
    this.flowPass();
    if (this.p.front.speed > 0) this.grow();
    // The marks of the paid births come with the push of the territory, after the step before a growth step.
    if (this.p.front.paid > 0 && this.p.front.paidBy === 'ahead' && (this.step + 1) % 3 === 0) this.markPaid();
    this.step++;
  }

  /**
   * The marks of the births that the flux pays of `paidBy` 'ahead', the second try of ADR 0067: each cell whose agent
   * could claim a child at the end of this step (`payable`) gets a mark with the chance min(1, B · r / P), r its sink
   * rate, B the budget and P the sum of the sink rates of these cells. A draw of its own per cell, as a pass over the
   * cells makes it.
   */
  markPaid() {
    this.marks.fill(0);
    const [B, P] = [this.budget, this.sinkPayable];
    if (!(B > 0) || !(P > 0)) return;
    const k = this.step;
    for (const c of this.payable) {
      seedFor(c, MARK, k, this.p.seed);
      if (rand() < Math.min(1, (B * this.sinkRate[c]!) / P)) this.marks[c] = 1;
    }
  }

  /**
   * The territory grows: an open cell beside territory joins it with the chance `speed` per agent beside it ('push'),
   * or with the chance `speed` while a neighbour holds a tube body ('body') or plasm ('trail').
   */
  private grow() {
    const { w, h, cells, territory: t } = this;
    const { open } = this.layout;
    const v = this.p.front.speed;
    const k = this.step;
    const add: number[] = [];
    for (let c = 0; c < cells; c++) {
      if (!open[c] || t[c]) continue;
      const [x, y] = [c % w, Math.floor(c / w)];
      let next = false;
      let pushers = 0;
      const on = this.p.front.speedOn;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [xx, yy] = [x + dx, y + dy];
          if ((dx === 0 && dy === 0) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const m = yy * w + xx;
          if (!t[m]) continue;
          if (on === 'push') pushers += this.occ[m]!;
          else if (on === 'trail' ? this.trail[m]! >= this.low || this.occ[m] === 1 : this.B[m]! >= FLOW.bodyLow)
            next = true;
        }
      if (on === 'push' ? pushers === 0 : !next) continue;
      seedFor(c, START + 1, k, this.p.seed);
      const chance = on === 'push' ? 1 - Math.pow(1 - v, pushers) : v;
      if (rand() < chance) add.push(c);
    }
    for (const c of add) t[c] = 1;
  }

  private agentPass() {
    const { open } = this.layout;
    const { w, h, cap } = this;
    const { seed, stepSize, front } = this.p;
    const k = this.step;
    const half2 = FLOW.half * FLOW.half;
    this.claims.fill(0);
    for (let i = 0; i < cap; i++) {
      this.kind[i] = 0;
      this.claimed[i] = 0;
      if (this.alive[i]) {
        const c = this.cellOf(this.ax[i]!, this.ay[i]!);
        const d = this.D[c]!;
        seedFor(i, STARVE, k, seed);
        if (rand() < (FLOW.death * half2) / (d * d + half2)) {
          this.alive[i] = 0;
          this.aliveCount--;
          this.starved++;
        }
      }
      if (!this.alive[i]) {
        // Respawn (7.2): one uniform point of the grid; a tube with D > 0.5 gives life with a chance.
        seedFor(i, RESPAWN, k, seed);
        const px = rand() * w;
        const py = rand() * h;
        const c = this.cellOf(px, py);
        if (c < 0 || !open[c] || this.occ[c] || this.B[c]! < FLOW.bodyLow) continue;
        if (front.speed > 0 && !this.territory[c]) continue;
        const d = this.D[c]!;
        if (rand() >= (FLOW.birth * (d - FLOW.birthFrom)) / (1 - FLOW.birthFrom)) continue;
        this.kind[i] = 2;
        this.tx[i] = px;
        this.ty[i] = py;
        this.ah[i] = rand() * TAU;
        this.tc[i] = c;
        const key = this.key(i);
        if (key > this.claims[c]!) this.claims[c] = key;
        continue;
      }
      seedFor(i, STEER, k, seed);
      const hd = this.steer(i);
      this.ah[i] = hd;
      const [px, py] = [this.ax[i]!, this.ay[i]!];
      const qx = px + stepSize * Math.cos(hd);
      const qy = py + stepSize * Math.sin(hd);
      const c = this.cellOf(qx, qy);
      this.kind[i] = 1;
      this.tx[i] = qx;
      this.ty[i] = qy;
      this.tc[i] = c;
      const here = this.cellOf(px, py);
      if (c < 0 || !open[c] || c === here || this.occ[c] || !this.clearPath(px, py, qx, qy)) continue;
      if (front.speed > 0 && !this.territory[c]) {
        this.heldMoves++;
        continue;
      }
      if (front.speed <= 0 && front.hold < 1 && !this.plasm(c)) {
        seedFor(i, HOLD_MOVE, k, seed);
        if (rand() >= front.hold) {
          this.heldMoves++;
          continue;
        }
      }
      this.claimed[i] = 1;
      const key = this.key(i);
      if (key > this.claims[c]!) this.claims[c] = key;
    }
    this.occNext.fill(0);
    this.counts.fill(0);
    for (let i = 0; i < cap; i++) {
      const kind = this.kind[i]!;
      if (kind === 2) {
        const c = this.tc[i]!;
        if (this.claims[c] === this.key(i)) {
          this.ax[i] = this.tx[i]!;
          this.ay[i] = this.ty[i]!;
          this.alive[i] = 1;
          this.aliveCount++;
          this.respawned++;
          this.occNext[c]!++;
        }
      } else if (kind === 1) {
        const c = this.tc[i]!;
        const here = this.cellOf(this.ax[i]!, this.ay[i]!);
        let ok = c >= 0 && open[c] === 1 && c === here;
        if (!ok && this.claimed[i]) ok = this.claims[c] === this.key(i);
        if (ok) {
          this.ax[i] = this.tx[i]!;
          this.ay[i] = this.ty[i]!;
          this.counts[c]!++;
          this.occNext[c]!++;
        } else {
          seedFor(i, BLOCK, k, seed);
          this.ah[i] = rand() * TAU;
          if (here >= 0) this.occNext[here]!++;
        }
      }
    }
  }

  /** The agents in the square of side 2r + 1 around (x, y), from the table of sums of the occupancy after the moves. */
  private windowSum(x: number, y: number, r: number): number {
    const { w, h, sat } = this;
    const x0 = Math.max(0, x - r);
    const y0 = Math.max(0, y - r);
    const x1 = Math.min(w, x + r + 1);
    const y1 = Math.min(h, y + r + 1);
    const W = w + 1;
    return sat[y1 * W + x1]! - sat[y0 * W + x1]! - sat[y1 * W + x0]! + sat[y0 * W + x0]!;
  }

  private growthPass() {
    const { w, h, cap, sat } = this;
    const { seed, front } = this.p;
    const k = this.step;
    const occ = this.occNext;
    const W = w + 1;
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += occ[y * w + x]!;
        sat[(y + 1) * W + x + 1] = sat[y * W + x + 1]! + row;
      }
    }
    const after = this.occ;
    after.set(occ);
    this.claims.fill(0);
    const free: number[] = [];
    for (let i = 0; i < cap; i++) {
      this.want[i] = -1;
      if (!this.alive[i]) continue;
      const c = this.cellOf(this.ax[i]!, this.ay[i]!);
      const [x, y] = [c % w, Math.floor(c / w)];
      if (this.windowSum(x, y, 2) > 20) {
        this.alive[i] = 0;
        this.aliveCount--;
        this.shrunk++;
        after[c]!--;
        continue;
      }
      if (this.counts[c] === 0) continue;
      const nG = this.windowSum(x, y, 4);
      if (nG < 1 || nG > 10 || this.D[c]! < FLOW.half) continue;
      this.claimChild(i, c, free);
    }
    // The births that the flow paid for, in the form of a GPU (`paidBy` 'chance' or 'ahead', ADR 0067): every agent of
    // the front on a marked cell claims a child. The flow pass of this step takes the claims off the budget. With
    // 'chance' the sink rates of the agents of the front that could claim a child give P of the next marks.
    if (front.paid > 0 && front.paidBy === 'chance') this.paidByChance(free);
    if (front.paid > 0 && front.paidBy === 'ahead') {
      this.paidClaims = 0;
      for (let i = 0; i < cap; i++) {
        if (!this.alive[i] || this.want[i]! >= 0) continue;
        const c = this.cellOf(this.ax[i]!, this.ay[i]!);
        if (!this.marks[c] || this.D[c]! < FLOW.half) continue;
        if (front.rim && !this.atRim(c)) continue;
        if (this.claimChild(i, c, free, front.rim)) {
          this.paidClaims++;
          this.paidBirths++;
        }
      }
    }
    // The births that the flow paid for: agents at the front, in a random order (stage 4). With `paidOn` 'sinks' an
    // agent at a sink comes first with odds in the share of its flux (the weighted order of Efraimidis and Spirakis).
    if (front.paid > 0 && front.paidBy === 'order' && this.budget >= 1) {
      const atSinks = front.paidOn === 'sinks';
      const at: number[] = [];
      for (let i = 0; i < cap; i++) {
        if (!this.alive[i] || this.want[i]! >= 0) continue;
        const c = this.cellOf(this.ax[i]!, this.ay[i]!);
        if (this.D[c]! < FLOW.half) continue;
        if (atSinks ? this.sinkRate[c]! <= 0 : !this.isYoung(c, k)) continue;
        if (!front.rim || this.atRim(c)) at.push(i);
      }
      seedFor(1, ORDER, k, seed);
      if (atSinks) {
        const order = new Map<number, number>();
        for (const i of at) order.set(i, -Math.log(1 - rand()) / this.sinkRate[this.cellOf(this.ax[i]!, this.ay[i]!)]!);
        at.sort((a, b) => order.get(a)! - order.get(b)!);
      } else
        for (let a = at.length - 1; a > 0; a--) {
          const b = Math.floor(rand() * (a + 1));
          [at[a], at[b]] = [at[b]!, at[a]!];
        }
      for (const i of at) {
        if (this.budget < 1) break;
        if (this.claimChild(i, this.cellOf(this.ax[i]!, this.ay[i]!), free, front.rim)) {
          this.budget -= 1;
          this.paidBirths++;
        }
      }
      this.budget = Math.min(this.budget, at.length);
    }
    // The births in a random order, each to the next dead agent by id.
    const births: number[] = [];
    for (let i = 0; i < cap; i++) {
      const t = this.want[i]!;
      if (t >= 0 && this.claims[t] === this.key(i)) births.push(t, this.cellOf(this.ax[i]!, this.ay[i]!));
    }
    seedFor(0, ORDER, k, seed);
    const m = births.length / 2;
    for (let a = m - 1; a > 0; a--) {
      const b = Math.floor(rand() * (a + 1));
      const [t, pc] = [births[2 * a]!, births[2 * a + 1]!];
      births[2 * a] = births[2 * b]!;
      births[2 * a + 1] = births[2 * b + 1]!;
      births[2 * b] = t;
      births[2 * b + 1] = pc;
    }
    let id = 0;
    for (let r = 0; r < m; r++) {
      while (id < cap && this.alive[id]) id++;
      if (id >= cap) break;
      const t = births[2 * r]!;
      const parent = births[2 * r + 1]!;
      seedFor(id, 5, k, seed);
      this.ax[id] = (t % w) + rand();
      this.ay[id] = Math.floor(t / w) + rand();
      this.ah[id] = rand() * TAU;
      this.alive[id] = 1;
      this.aliveCount++;
      this.births++;
      after[t]!++;
      // A birth onto fresh ground: the cell of the child has no slime before this step (6.9).
      const s = this.S[t]!;
      const f = this.F[t]!;
      const young = this.p.front.young > 0 && f !== 0 && s !== 0 && k + 1 - f < this.p.front.young;
      if (s === 0 || k + 1 - s >= this.life || young) {
        this.freshBirths++;
        this.sinkCount[parent]! += 1;
      }
      id++;
    }
  }

  /**
   * The births that the flux pays, in the form of a GPU (`paidBy` 'chance', ADR 0067), after Jones' births of this
   * growth step. The agents of the front are those at the rim, on a cell with a sink rate above 0 and a flow memory of
   * at least `half`, that are no parent of Jones' rule in this step. Those of them with a free cell beside them could
   * claim a child: P is the sum of their sink rates, and each claims one with the chance min(1, B · r / P), a draw of
   * its own. A pass over the agents sums P, and a second one draws. The claims lower the budget B, and B never exceeds
   * the number of agents of the front, as in the order of ADR 0065.
   */
  private paidByChance(free: number[]) {
    const { cap } = this;
    const front = this.p.front;
    const k = this.step;
    this.onPaid?.();
    const able: number[] = [];
    let [mass, atFront] = [0, 0];
    for (let i = 0; i < cap; i++) {
      if (!this.alive[i] || this.want[i]! >= 0) continue;
      const c = this.cellOf(this.ax[i]!, this.ay[i]!);
      if (this.sinkRate[c]! <= 0 || this.D[c]! < FLOW.half) continue;
      if (front.rim && !this.atRim(c)) continue;
      atFront++;
      if (!this.roomFor(c, this.occNext)) continue;
      able.push(i);
      mass += front.sums === 'fixed' ? Math.round(this.sinkRate[c]! * FIXED) : this.sinkRate[c]!;
    }
    const [B, P] = [this.budget, front.sums === 'fixed' ? mass / FIXED : mass];
    this.sinkPayable = P;
    this.paidClaims = 0;
    if (B > 0 && P > 0)
      for (const i of able) {
        const c = this.cellOf(this.ax[i]!, this.ay[i]!);
        seedFor(i, PAID, k, this.p.seed);
        if (rand() >= Math.min(1, (B * this.sinkRate[c]!) / P)) continue;
        if (this.claimChild(i, c, free, front.rim)) this.paidClaims++;
      }
    this.paidBirths += this.paidClaims;
    this.frontAgents = atFront;
    this.budget = Math.min(B - this.paidClaims, atFront);
  }

  /**
   * Whether cell c is ground of the front: with `reach`, at most that far from ground without slime (the field of the
   * last flow pass); else the front reached it less than `young` steps before step k, and it still has that slime.
   */
  isYoung(c: number, k = this.step): boolean {
    const front = this.p.front;
    if (front.reach > 0) return front.fresh === 'box' ? this.freshNear(c, k) : this.toFresh[c]! <= front.reach;
    const f = this.F[c]!;
    return front.young > 0 && f !== 0 && this.hasSlime(c, k) && k + 1 - f < front.young;
  }

  /** Whether a cell lies within 2 cells of open ground outside the territory: the rim of the territory. */
  private territoryEdge(c: number): boolean {
    const { w, h } = this;
    const { open } = this.layout;
    const [x, y] = [c % w, Math.floor(c / w)];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const [xx, yy] = [x + dx, y + dy];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const t = yy * w + xx;
        if (open[t] && !this.territory[t]) return true;
      }
    return false;
  }

  /**
   * Whether a cell lies at the rim of the colony: an open, empty neighbour without a tube body. `occ`: the occupancy,
   * by default the one after the moves of a growth step.
   */
  atRim(c: number, occ = this.occNext): boolean {
    const { w, h } = this;
    const { open } = this.layout;
    const [x, y] = [c % w, Math.floor(c / w)];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [xx, yy] = [x + dx, y + dy];
        if ((dx === 0 && dy === 0) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const t = yy * w + xx;
        if (open[t] && !occ[t] && this.B[t]! < FLOW.bodyLow) return true;
      }
    return false;
  }

  /**
   * Whether an agent on cell c could claim a child at the end of this step (`paidBy` 'ahead'): a cell of the front (a
   * sink rate above 0, the flow memory at least `half`, at the rim with `rim`) with a free cell beside it.
   */
  canPay(c: number): boolean {
    const front = this.p.front;
    if (!this.occ[c] || this.sinkRate[c]! <= 0 || this.D[c]! < FLOW.half) return false;
    if (front.rim && !this.atRim(c, this.occ)) return false;
    return this.roomFor(c, this.occ);
  }

  /**
   * Whether a free cell for a child lies beside cell c, as claimChild() takes one: open, empty in `occ`, not starved,
   * of the territory, and not behind the corner of two walls.
   */
  roomFor(c: number, occ: Uint8Array): boolean {
    const { w, h } = this;
    const { open, wall } = this.layout;
    const front = this.p.front;
    const [x, y] = [c % w, Math.floor(c / w)];
    const isWall = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && wall[yy * w + xx] === 1;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [xx, yy] = [x + dx, y + dy];
        if ((dx === 0 && dy === 0) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const t = yy * w + xx;
        if (!open[t] || occ[t] || this.D[t]! < FLOW.half) continue;
        if (front.speed > 0 && !this.territory[t]) continue;
        if (dx !== 0 && dy !== 0 && isWall(x + dx, y) && isWall(x, y + dy)) continue;
        return true;
      }
    return false;
  }

  /**
   * Whether an open cell without slime before step k lies in the square of side 2 · reach + 1 around cell c: the form
   * of a GPU of `toFresh[c] <= reach` (`fresh` 'box', ADR 0067). The two passes of the chamfer transform give the
   * Chebyshev distance through every cell of the grid, so both give the same answer.
   */
  freshNear(c: number, k = this.step): boolean {
    const { w, h } = this;
    const { open } = this.layout;
    const r = this.p.front.reach;
    const [x, y] = [c % w, Math.floor(c / w)];
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        const t = yy * w + xx;
        if (open[t] && !this.hasSlime(t, k)) return true;
      }
    return false;
  }

  /** For tests: the distance of every cell to ground without slime before step k, from the chamfer transform. */
  freshField(k = this.step): Uint8Array {
    this.freshDistance(k);
    return this.toFresh.slice();
  }

  /** The distance of every cell to open ground without slime before step k (two passes of the chamfer transform). */
  private freshDistance(k = this.step + 1) {
    const { w, h, toFresh: d } = this;
    const { open } = this.layout;
    for (let c = 0; c < this.cells; c++) d[c] = open[c] && !this.hasSlime(c, k) ? 0 : 255;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        let v = d[c]!;
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, d[c - 1]! + 1);
        if (y > 0) {
          v = Math.min(v, d[c - w]! + 1);
          if (x > 0) v = Math.min(v, d[c - w - 1]! + 1);
          if (x < w - 1) v = Math.min(v, d[c - w + 1]! + 1);
        }
        d[c] = v;
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const c = y * w + x;
        let v = d[c]!;
        if (v === 0) continue;
        if (x < w - 1) v = Math.min(v, d[c + 1]! + 1);
        if (y < h - 1) {
          v = Math.min(v, d[c + w]! + 1);
          if (x < w - 1) v = Math.min(v, d[c + w + 1]! + 1);
          if (x > 0) v = Math.min(v, d[c + w - 1]! + 1);
        }
        d[c] = v;
      }
  }

  /**
   * Agent i on cell c picks a free neighbour for a child (section 9): open, empty after the moves, not starved, and
   * not behind the corner of two walls. The hold of stage 4 may stop it. Returns whether it claimed a cell.
   */
  private claimChild(i: number, c: number, free: number[], out = false): boolean {
    const { open, wall } = this.layout;
    const { w, h } = this;
    const occ = this.occNext;
    const front = this.p.front;
    const k = this.step;
    const [x, y] = [c % w, Math.floor(c / w)];
    const isWall = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && wall[yy * w + xx] === 1;
    free.length = 0;
    for (let j = 0; j < 9; j++) {
      if (j === 4) continue;
      const dx = (j % 3) - 1;
      const dy = Math.floor(j / 3) - 1;
      const [xx, yy] = [x + dx, y + dy];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const t = yy * w + xx;
      if (!open[t] || occ[t] || this.D[t]! < FLOW.half) continue;
      if (front.speed > 0 && !this.territory[t]) continue;
      if (dx !== 0 && dy !== 0 && isWall(x + dx, y) && isWall(x, y + dy)) continue;
      free.push(t);
    }
    if (out && free.some((t) => this.B[t]! < FLOW.bodyLow)) {
      const outside = free.filter((t) => this.B[t]! < FLOW.bodyLow);
      free.length = 0;
      free.push(...outside);
    }
    if (free.length === 0) return false;
    seedFor(i, GROW, k, this.p.seed);
    const t = free[Math.min(Math.floor(rand() * free.length), free.length - 1)]!;
    if (front.speed <= 0 && front.holdBirths && front.hold < 1 && !this.plasm(t, front.holdBirthsOn)) {
      seedFor(i, HOLD_BIRTH, k, this.p.seed);
      if (rand() >= front.hold) {
        this.heldBirths++;
        return false;
      }
    }
    this.want[i] = t;
    const key = this.key(i);
    if (key > this.claims[t]!) this.claims[t] = key;
    return true;
  }

  /** out = keep · (the 3 × 3 sum of src over open cells) / 9 on open cells, 0 elsewhere (6.1, 6.2). */
  private blur(src: Float32Array, out: Float32Array, keep: number) {
    const { w, h } = this;
    const { open } = this.layout;
    const row = this.tmp2;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++)
        row[o + x] = (x > 0 ? src[o + x - 1]! : 0) + src[o + x]! + (x < w - 1 ? src[o + x + 1]! : 0);
    }
    const f = keep / 9;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const c = o + x;
        out[c] = open[c] ? f * ((y > 0 ? row[c - w]! : 0) + row[c]! + (y < h - 1 ? row[c + w]! : 0)) : 0;
      }
    }
  }

  private diffuseTrail() {
    const { open } = this.layout;
    const src = this.tmp;
    const dep = this.p.deposit;
    for (let c = 0; c < this.cells; c++) src[c] = open[c] ? this.trail[c]! + dep * this.counts[c]! : 0;
    this.blur(src, this.trail, 1 - this.p.decay);
  }

  private diffuseScent() {
    const { open, food } = this.layout;
    const src = this.tmp;
    const d = this.p.scentDecay;
    const g = d / (1 - d) / (0.1 / 0.9);
    const f = 255 * this.p.foodStrength * g;
    const { w, h } = this;
    const phi = this.p.covered;
    for (let c = 0; c < this.cells; c++) {
      let emit = food[c] ? f : 0;
      if (emit > 0 && phi < 1) {
        const [x, y] = [c % w, Math.floor(c / w)];
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++)
          for (let dx = -1; dx <= 1 && !near; dx++) {
            const [xx, yy] = [x + dx, y + dy];
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && this.occ[yy * w + xx]) near = true;
          }
        if (near) emit *= phi;
      }
      src[c] = open[c] ? this.scent[c]! + emit : 0;
    }
    this.blur(src, this.scent, 1 - d);
  }

  /** The stamps of the slime and the front stamps (6.9). */
  private slimePass() {
    const { open } = this.layout;
    const k = this.step;
    const low = this.low;
    for (let c = 0; c < this.cells; c++) {
      if (!open[c] || this.trail[c]! < low) continue;
      const s = this.S[c]!;
      if (s === 0 || k + 1 - s >= this.life) this.F[c] = k + 1;
      this.S[c] = k + 1;
    }
  }

  /** Whether a cell has slime before step k (6.9). */
  hasSlime(c: number, k = this.step): boolean {
    const s = this.S[c]!;
    return s !== 0 && k + 1 - s < this.life;
  }

  private flowPass() {
    const { open, food, sites } = this.layout;
    const { cells, nb, D, B } = this;
    const k = this.step;
    const i0 = this.p.flow;
    // The ports of this step, from the tube body before it (8.2).
    [this.portsPrev, this.ports] = [this.ports, this.portsPrev];
    sites.forEach((list, s) => {
      let port = -1;
      for (const c of list)
        if (open[c] && food[c] && B[c]! >= FLOW.bodyLow) {
          port = c;
          break;
        }
      this.ports[s] = port;
    });
    let roled = 0;
    for (const c of this.portsPrev) if (c >= 0 && this.role[c] !== 0) roled++;
    const fed = roled >= 2 || this.frontActive;
    const covered = Array.from(this.ports, (c) => c >= 0);
    const roles = flowRoles(covered, k, this.p.seed);
    const coveredCount = covered.filter(Boolean).length;
    const lanes = coveredCount >= 3 ? 4 : 1;
    if (lanes > this.lanes)
      for (let l = 1; l < 4; l++) {
        this.P[l]!.set(this.P[0]!);
        this.Pb[l]!.set(this.Pb[0]!);
      }
    // The flux of the last step, from the conductivity and the pressure of the last step (8.4).
    const G = this.G;
    for (let c = 0; c < cells; c++) {
      if (!open[c]) continue;
      const e = nb[c * 4]!;
      const s = nb[c * 4 + 2]!;
      this.edgeE[c] = e >= 0 ? harmonic(G[c]!, G[e]!) : 0;
      this.edgeS[c] = s >= 0 ? harmonic(G[c]!, G[s]!) : 0;
    }
    this.fmean.fill(0);
    this.Q.fill(0);
    for (let l = 0; l < this.lanes; l++) {
      const P = this.P[l]!;
      for (let c = 0; c < cells; c++) {
        if (!open[c]) continue;
        const pc = P[c]!;
        let q = 0;
        const e = nb[c * 4]!;
        const wv = nb[c * 4 + 1]!;
        const s = nb[c * 4 + 2]!;
        const nn = nb[c * 4 + 3]!;
        if (e >= 0) q += this.edgeE[c]! * Math.abs(pc - P[e]!);
        if (wv >= 0) q += this.edgeE[wv]! * Math.abs(pc - P[wv]!);
        if (s >= 0) q += this.edgeS[c]! * Math.abs(pc - P[s]!);
        if (nn >= 0) q += this.edgeS[nn]! * Math.abs(pc - P[nn]!);
        q *= 0.5;
        const qg = q <= 0 ? 0 : Math.pow(q, FLOW.gamma);
        this.fmean[c]! += qg / (1 + qg) / this.lanes;
        this.Q[c]! += q / this.lanes;
      }
    }
    this.lanes = lanes;
    // The update of the memory, the body and the conductivity (8.1, 8.4).
    const Gn = this.Gnext;
    const half2 = FLOW.half * FLOW.half;
    for (let c = 0; c < cells; c++) {
      if (!open[c]) {
        Gn[c] = 0;
        continue;
      }
      let d = D[c]!;
      const bodyOld = B[c]!;
      if (bodyOld >= FLOW.bodyLow) d = fed ? Math.max(FLOW.floor, d + FLOW.rate * (this.fmean[c]! - d)) : d;
      else d = Math.min(FLOW.fresh, Math.max(d, FLOW.floor) * (1 + this.recover));
      const presence = Math.min(1, Math.max(0, (this.trail[c]! - this.low) * this.scale));
      const body = bodyOld + FLOW.bodyRate * (presence - bodyOld);
      if (bodyOld >= FLOW.bodyLow && body < FLOW.bodyLow && d * d < half2) d = FLOW.floor;
      D[c] = d;
      B[c] = body;
      if (body >= FLOW.bodyLow && d >= VEIN && this.veinAt[c] === 0) this.veinAt[c] = k + 1;
      Gn[c] = body >= FLOW.bodyLow ? body * (food[c] ? FLOW.food : FLOW.base + d) : 0;
      this.role[c] = 0;
    }
    sites.forEach((list, s) => {
      const c = this.ports[s]!;
      // The role code of a port: only a cell that held a tube before the step asks for it (flow-reference.ts).
      if (c >= 0 && list.length > 0) this.role[c] = roles[s] ?? 0;
    });
    [this.G, this.Gnext] = [this.Gnext, this.G];
    this.frontSinks();
    if (this.p.front.solver === 'exact') this.exactPressure(i0);
    else this.pressure(i0);
  }

  /** The sinks of the front and the sources that pay them, in `extra` (stage 4). */
  private frontSinks() {
    const front = this.p.front;
    const { cells, G } = this;
    this.extra.fill(0);
    this.frontActive = false;
    this.frontTotal = 0;
    if (front.paid > 0) {
      this.paidSinks();
      return;
    }
    const tau = Math.max(1, front.tau);
    let total = 0;
    for (let c = 0; c < cells; c++) {
      const r = this.sinkRate[c]! + (this.sinkCount[c]! - this.sinkRate[c]!) / tau;
      this.sinkRate[c] = r;
      this.sinkCount[c] = 0;
      if (G[c]! > 0) total += r;
    }
    if (!front.sink || total <= 0) return;
    const scale = front.norm > 0 ? (front.norm * this.p.flow) / total : front.unit;
    const S = total * scale;
    const portList = Array.from(this.ports).filter((c) => c >= 0);
    let sources = 0;
    if (portList.length > 0) sources = portList.length;
    else if (front.colony) for (let c = 0; c < cells; c++) if (G[c]! > 0) sources++;
    if (sources === 0) return;
    for (let c = 0; c < cells; c++) if (G[c]! > 0) this.extra[c] = -this.sinkRate[c]! * scale;
    if (portList.length > 0) for (const c of portList) this.extra[c]! += S / sources;
    else for (let c = 0; c < cells; c++) if (G[c]! > 0) this.extra[c]! += S / sources;
    this.frontActive = true;
    this.frontTotal = S;
  }

  /**
   * The sinks of the second form (`paid`): the young front takes `norm` times the flow strength, an equal share at each
   * agent on a young cell with room beside it, and the sources pay it. The flux it takes buys births (growthPass()).
   */
  private paidSinks() {
    const front = this.p.front;
    const { cells, G, w, h } = this;
    const { open } = this.layout;
    const k = this.step + 1;
    if (front.reach > 0 && front.fresh === 'chamfer') this.freshDistance();
    const at: number[] = [];
    const weight = new Map<number, number>();
    for (let c = 0; c < cells; c++) {
      if (!this.occ[c] || G[c]! <= 0) continue;
      const young = this.isYoung(c, k);
      if (!young && !(front.slimeWeight > 0 && front.speed > 0)) continue;
      const [x, y] = [c % w, Math.floor(c / w)];
      let room = false;
      for (let dy = -1; dy <= 1 && !room; dy++)
        for (let dx = -1; dx <= 1 && !room; dx++) {
          const [xx, yy] = [x + dx, y + dy];
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const t = yy * w + xx;
          if (!open[t] || this.occ[t]) continue;
          // With a territory, room is a free cell of it; else a free cell (without a tube body at the rim).
          if (front.speed > 0 ? this.territory[t] === 1 : !front.rim || this.B[t]! < FLOW.bodyLow) room = true;
        }
      if (!room) continue;
      // Without fresh ground near, a rim with room is a sink of the weight slimeWeight (a territory must hold it).
      // With `sinkAt` 'edge' every sink sits at the edge of the territory, and the fresh ground sets only its weight.
      const atEdge = front.sinkAt === 'edge' && front.speed > 0;
      if ((atEdge || !young) && !this.territoryEdge(c)) continue;
      at.push(c);
      weight.set(c, young ? 1 : front.slimeWeight);
    }
    this.demand = at.length;
    // 'ahead': the flow pass of a growth step takes the paid claims off the budget, and the budget never exceeds the
    // number of sinks (ADR 0067).
    if (front.paidBy === 'ahead' && this.step % 3 === 0)
      this.budget = Math.min(this.budget - this.paidClaims, at.length);
    // The sink of a cell follows its share of the demand with the time `tau`.
    const tau = Math.max(1, front.tau);
    let total = 0;
    for (const c of at) this.sinkCount[c] = weight.get(c) ?? 1;
    for (let c = 0; c < cells; c++) {
      const r = this.sinkRate[c]! + (this.sinkCount[c]! - this.sinkRate[c]!) / tau;
      this.sinkRate[c] = r;
      this.sinkCount[c] = 0;
      if (G[c]! > 0) total += front.sums === 'fixed' ? Math.round(this.sinkRate[c]! * FIXED) : r;
    }
    if (front.sums === 'fixed') total /= FIXED;
    this.sinkTotal = total;
    // 'ahead': before a growth step, the cells whose agent could claim a paid child, and the sum of their sink rates:
    // the marks of the births follow their shares (markPaid()).
    if (front.paidBy === 'ahead') {
      this.payable.length = 0;
      this.sinkPayable = 0;
    }
    if (front.paidBy === 'ahead' && (this.step + 1) % 3 === 0) {
      for (let c = 0; c < cells; c++) {
        if (!this.canPay(c)) continue;
        this.payable.push(c);
        this.sinkPayable += front.sums === 'fixed' ? Math.round(this.sinkRate[c]! * FIXED) : this.sinkRate[c]!;
      }
      if (front.sums === 'fixed') this.sinkPayable /= FIXED;
    }
    if (at.length === 0 || total <= 0) return;
    const portList = Array.from(this.ports).filter((c) => c >= 0);
    let sources = portList.length;
    if (sources === 0 && front.colony) for (let c = 0; c < cells; c++) if (G[c]! > 0) sources++;
    if (sources === 0) return;
    const S = front.norm * this.p.flow;
    for (let c = 0; c < cells; c++) if (G[c]! > 0) this.extra[c]! -= (S * this.sinkRate[c]!) / total;
    if (portList.length > 0) for (const c of portList) this.extra[c]! += S / sources;
    else for (let c = 0; c < cells; c++) if (G[c]! > 0) this.extra[c]! += S / sources;
    this.frontActive = true;
    this.frontTotal = S;
    this.budget += S / front.paid;
  }

  /** The pressure: 16 iterations of damped Jacobi with momentum per lane, from the pressure of the last step (8.3). */
  private pressure(i0: number) {
    const { open, sites } = this.layout;
    const { cells, nb, G } = this;
    const ghost = FLOW.ghost;
    const omega = 2 / (1 + Math.sqrt(1 - FLOW.radius * FLOW.radius));
    const weight = FLOW.weight;
    const limit = FLOW.head * i0;
    const limitScale = 1 / (FLOW.headSoft * limit);
    // Edges with the ghost conductance, of this step's conductivities.
    for (let c = 0; c < cells; c++) {
      if (!open[c]) continue;
      const e = nb[c * 4]!;
      const s = nb[c * 4 + 2]!;
      this.edgeE[c] = e >= 0 ? harmonic(G[c]! + ghost, G[e]! + ghost) : 0;
      this.edgeS[c] = s >= 0 ? harmonic(G[c]! + ghost, G[s]! + ghost) : 0;
    }
    const acting = Array.from(this.ports).filter((c) => c >= 0 && this.role[c] !== 0);
    const [sx, sy] = this.layout.start;
    const first = sites[0]?.[0] ?? this.cellOf(sx, sy);
    const ref = acting[0] ?? first;
    const signOf = (code: number, l: number) => {
      const digit = Math.floor(code / 3 ** l) % 3;
      return digit === 1 ? 1 : digit === 2 ? -1 : 0;
    };
    for (let l = 0; l < this.lanes; l++) {
      let P = this.P[l]!;
      let before = this.Pb[l]!;
      let out = this.Pnext[l]!;
      for (let it = 0; it < FLOW_ITERATIONS; it++) {
        const level = acting.length > 0 ? acting.reduce((a, c) => a + P[c]!, 0) / acting.length : 0;
        const recentre = it === 0 ? 1 : it === 1 ? 2 : 0;
        const pref = P[ref]!;
        const bref = before[ref]!;
        for (let c = 0; c < cells; c++) {
          if (!open[c]) continue;
          const e = nb[c * 4]!;
          const wv = nb[c * 4 + 1]!;
          const s = nb[c * 4 + 2]!;
          const nn = nb[c * 4 + 3]!;
          const ge = e >= 0 ? this.edgeE[c]! : 0;
          const gw = wv >= 0 ? this.edgeE[wv]! : 0;
          const gs = s >= 0 ? this.edgeS[c]! : 0;
          const gn = nn >= 0 ? this.edgeS[nn]! : 0;
          const sum = ge + gw + gs + gn;
          const pc = P[c]!;
          let next = pc;
          if (sum > 0) {
            let acc = 0;
            if (ge > 0) acc += ge * P[e]!;
            if (gw > 0) acc += gw * P[wv]!;
            if (gs > 0) acc += gs * P[s]!;
            if (gn > 0) acc += gn * P[nn]!;
            const code = this.role[c]!;
            let src = this.extra[c]!;
            if (code !== 0) {
              const sign = signOf(code, l);
              const room = Math.min(1, Math.max(0, (limit - sign * (pc - level)) * limitScale));
              src += sign * i0 * room;
            }
            const balanced = (acc + src) / sum;
            const jacobi = pc + weight * (balanced - pc);
            const past = before[c]! - (recentre === 2 ? bref : 0);
            const om = G[c]! > 0 ? omega : 1;
            next = om * jacobi + (1 - om) * past;
          }
          if (recentre === 1) next -= pref;
          out[c] = next;
        }
        [before, P, out] = [P, out, before];
      }
      this.P[l] = P;
      this.Pb[l] = before;
      this.Pnext[l] = out;
    }
  }

  /**
   * The pressure of every lane solved with conjugate gradients on the cells that conduct (Kirchhoff's law of 8.3 with
   * the roles at full flux, no pressure limit), and the ghost cells relaxed from their neighbours. For a check of the
   * app's solver only.
   */
  private exactPressure(i0: number) {
    const { open, sites } = this.layout;
    const { cells, nb, G } = this;
    const on: number[] = [];
    for (let c = 0; c < cells; c++) if (open[c] && G[c]! > 0) on.push(c);
    const n = on.length;
    if (n === 0) return;
    const index = new Int32Array(cells).fill(-1);
    on.forEach((c, i) => (index[c] = i));
    const links = new Int32Array(n * 4).fill(-1);
    const cond = new Float64Array(n * 4);
    const diag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = on[i]!;
      for (let e = 0; e < 4; e++) {
        const m = nb[c * 4 + e]!;
        if (m < 0 || index[m]! < 0) continue;
        const g = harmonic(G[c]!, G[m]!);
        links[i * 4 + e] = index[m]!;
        cond[i * 4 + e] = g;
        diag[i]! += g;
      }
    }
    const apply = (x: Float64Array, y: Float64Array) => {
      for (let i = 0; i < n; i++) {
        let v = diag[i]! * x[i]!;
        for (let e = 0; e < 4; e++) {
          const j = links[i * 4 + e]!;
          if (j >= 0) v -= cond[i * 4 + e]! * x[j]!;
        }
        y[i] = v;
      }
    };
    const signOf = (code: number, l: number) => {
      const digit = Math.floor(code / 3 ** l) % 3;
      return digit === 1 ? 1 : digit === 2 ? -1 : 0;
    };
    for (let l = 0; l < this.lanes; l++) {
      const b = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const c = on[i]!;
        b[i] = this.extra[c]!;
        const code = this.role[c]!;
        if (code !== 0) b[i]! += signOf(code, l) * i0;
      }
      // Each part of the network that is not joined to the others must balance: remove its mean.
      const part = new Int32Array(n).fill(-1);
      let parts = 0;
      const sum: number[] = [];
      const size: number[] = [];
      for (let i = 0; i < n; i++) {
        if (part[i]! >= 0) continue;
        const stack = [i];
        part[i] = parts;
        let [s, z] = [0, 0];
        while (stack.length > 0) {
          const a = stack.pop()!;
          s += b[a]!;
          z++;
          for (let e = 0; e < 4; e++) {
            const j = links[a * 4 + e]!;
            if (j >= 0 && part[j]! < 0) {
              part[j] = parts;
              stack.push(j);
            }
          }
        }
        sum.push(s);
        size.push(z);
        parts++;
      }
      for (let i = 0; i < n; i++) b[i]! -= sum[part[i]!]! / size[part[i]!]!;
      const P = this.P[l]!;
      const x = new Float64Array(n);
      for (let i = 0; i < n; i++) x[i] = P[on[i]!]!;
      const r = new Float64Array(n);
      const z = new Float64Array(n);
      const q = new Float64Array(n);
      const d = new Float64Array(n);
      apply(x, r);
      let bn = 0;
      for (let i = 0; i < n; i++) {
        r[i] = b[i]! - r[i]!;
        bn += b[i]! * b[i]!;
      }
      for (let i = 0; i < n; i++) z[i] = diag[i]! > 0 ? r[i]! / diag[i]! : 0;
      d.set(z);
      let rz = 0;
      for (let i = 0; i < n; i++) rz += r[i]! * z[i]!;
      for (let it = 0; it < 2000; it++) {
        let rn = 0;
        for (let i = 0; i < n; i++) rn += r[i]! * r[i]!;
        if (rn <= 1e-12 * Math.max(bn, 1e-30)) break;
        apply(d, q);
        let dq = 0;
        for (let i = 0; i < n; i++) dq += d[i]! * q[i]!;
        if (dq <= 0) break;
        const alpha = rz / dq;
        for (let i = 0; i < n; i++) {
          x[i]! += alpha * d[i]!;
          r[i]! -= alpha * q[i]!;
        }
        for (let i = 0; i < n; i++) z[i] = diag[i]! > 0 ? r[i]! / diag[i]! : 0;
        let rz2 = 0;
        for (let i = 0; i < n; i++) rz2 += r[i]! * z[i]!;
        const beta = rz2 / rz;
        rz = rz2;
        for (let i = 0; i < n; i++) d[i] = z[i]! + beta * d[i]!;
      }
      // The gauge: the first site's first cell, or the mean.
      const ref = index[sites[0]?.[0] ?? -1] ?? -1;
      let shift = 0;
      if (ref >= 0) shift = x[ref]!;
      else {
        for (let i = 0; i < n; i++) shift += x[i]!;
        shift /= n;
      }
      P.fill(0);
      for (let i = 0; i < n; i++) P[on[i]!] = x[i]! - shift;
      // The ghost cells: a few relaxations from their neighbours, so that a sensor beside the network reads a pressure.
      for (let pass = 0; pass < 4; pass++)
        for (let c = 0; c < cells; c++) {
          if (!open[c] || G[c]! > 0) continue;
          let [acc, k] = [0, 0];
          for (let e = 0; e < 4; e++) {
            const m = nb[c * 4 + e]!;
            if (m >= 0) [acc, k] = [acc + P[m]!, k + 1];
          }
          if (k > 0) P[c] = acc / k;
        }
      this.Pb[l]!.set(P);
    }
  }

  /** The cells that hold an agent now. */
  agentCells(): number {
    let n = 0;
    for (let c = 0; c < this.cells; c++) n += this.occ[c]!;
    return n;
  }
}
