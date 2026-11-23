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
/**
 * The level of the flow memory D, in units of the base conductance, above which the rule of the tubes makes a vein grow
 * (ADR 0076, finding 4; ADR 0084): a cell of a sheet gets flux in proportion to its conductance base + D, and D follows
 * the flux to the power gamma, so D grows at about rate · (gamma · D / (D + base) − 1), above 0 from D = base / (gamma − 1)
 * on: 1.25 times the base.
 */
export const FED_D = 1 / (FLOW.gamma - 1);

// Random streams, numbered as in the app where the app has them (docs/model.md, 7.7), and new ones above 10.
const [STEER, BLOCK, GROW, ORDER, RESPAWN, STARVE, HOLD_MOVE, HOLD_BIRTH, START] = [0, 3, 4, 6, 8, 9, 11, 12, 13];
/** The marks of the paid births of `paidBy` 'ahead'; START + 1 is the push of the territory. */
const MARK = 15;
/** The draw of a paid birth of `paidBy` 'chance' and 'fill', per agent. */
const PAID = 16;
/** The most rounds that `paidBy` 'fill' takes to find its scale (fillScale()). */
const FILL_ROUNDS = 8;
/** A sum in the form of a GPU (`sums` 'fixed') counts a sink rate in steps of 1 / FIXED, as an integer. */
export const FIXED = 65536;
/** The cells around a start agent that join the territory of its strain (`start` 'agents'): a square of 7 × 7. */
export const START_REACH = 3;
/** The square around a sink in which its tube must reach the edge or a port (`sinkTube`, ADR 0072): 13 × 13 cells. */
export const SINK_TUBE_REACH = 6;

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
  /**
   * The pressure that the drift reads (ADR 0072, ADR 0074). 'all': the pressure at the cell of the sensor, on every
   * open cell (ADR 0065). 'net': the pressure at the cell of the sensor less the pressure at the cell of the agent, and
   * only where both cells hold a tube: a constant added to the pressure of a network then changes no turn. The forms
   * of part E2d (ADR 0074) read the pressure of a sensor's cell on a tube as 'all' does, and off the tubes a value that
   * the network sets, so that a constant added to the pressure of a network changes no turn either:
   * - 'mirror': the pressure of the agent's cell continued along the line from the cell as far behind the agent
   *   (2 · p(agent) − p(behind)), the flux that reaches the agent continued past it; p(agent) without a tube behind.
   * - 'take': p(agent) less the sensor offset times the flux that a sink at the agent's cell takes over the
   *   conductivity of that cell, the drop of that flux continued into fresh ground; p(agent) at an agent without sink.
   * - 'sinks': the mean pressure of the sinks of the strain, weighted by what each takes: the front meets the fresh
   *   ground at one level.
   * - 'rim': the mean pressure of the tube cells beside a cell without a tube.
   * - 'leak': the pressure of the cell, the ground shifted after the solve so that no flux leaks between the network
   *   and the ground through the ghost conductance.
   * - 'extend': the pressure of the cell, the ground solved to its steady state from the network after each solve
   *   (conjugate gradients; a check, no form of a GPU).
   * With every form but 'all', 'leak' and 'extend' an agent off the tubes reads no drift, as 'net'.
   */
  driftOn: 'all' | 'net' | 'mirror' | 'take' | 'sinks' | 'rim' | 'leak' | 'extend';
  /**
   * A sink lies on a tube that carries flux to it (ADR 0072): the tube cells that a path between 4-neighbours over tube
   * cells reaches from it, within the square of 13 × 13 cells around it, include a cell on the edge of the square or a
   * port. A patch of tube inside that square without a port takes no flux.
   */
  sinkTube: boolean;
  /**
   * The cell that the pressure recentres by (ADR 0072). 'roles': the port of the first site with a role, else the first
   * cell of the first site (ADR 0029). 'ports': the port of the first site with a role, else the port of the first
   * covered site, else the first cell of the first site.
   */
  refOn: 'roles' | 'ports';
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
   * front, with odds in the weight of each (ADR 0065). 'rank', the form of a GPU: the same order with a key of its own
   * for each agent that could claim a child (paidByRank()). 'chance', a try: each of these agents claims one with the
   * chance min(1, B · r / P), B the budget, r its sink rate and P the sum of the sink rates of these agents
   * (paidByChance()). 'fill', a try: the chance min(1, λ · r), λ such that the chances add up to the smaller of B and
   * the number of these agents (fillScale()). 'ahead', a try: after the step before a growth step the cells whose agent
   * could claim a child get a mark with the chance of 'chance', and in the growth step the agent of the front on a
   * marked cell claims a child; the budget never exceeds the number of sinks. Each claim lowers the budget by 1.
   */
  paidBy: 'order' | 'rank' | 'chance' | 'fill' | 'ahead';
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
   * The territory of the start (ADR 0067). 'disc': the disc of the start and a rim of 3 cells. 'agents', a try for a
   * GPU: every open cell within START_REACH cells of a start agent (the square of 7 × 7 around it). It keeps every start
   * agent 4 cells from the edge of the territory, so no agent is a sink until one walks out.
   */
  start: 'disc' | 'agents';
  /**
   * What sets the tube body of a cell (ADR 0076, a try): its trail, as the app does ('trail'), or the share of the
   * open cells of its 3 × 3 block that hold an agent, full from `bodyFull` on ('agents'). With 'agents' a thin sheet
   * conducts less than a thick one; with the trail a sheet with an agent on one cell of ten holds a full body.
   * 'cube' (ADR 0078, a try): the cube s³ of that share s, full at s = 1, as a sheet of thickness s conducts as s³
   * (Poiseuille). A thin sheet then conducts far less than a thick one, and the flow gathers in the thick parts.
   */
  bodyOn: 'trail' | 'agents' | 'cube';
  bodyFull: number;
  /**
   * Where Jones' births come (ADR 0076): wherever an agent has few others near it, as the app ('all'), only within
   * `reach` cells of ground without slime ('fresh', a try), or only within `reach` cells of open ground outside the
   * territory ('edge', the proposal): the plasm then grows at the front, and behind it only moves. 'edge' does not read
   * the slime, as the sinks of `sinkAt` 'edge' (ADR 0065, decision 8): a colony on slime grows at its edge too.
   * 'young' (ADR 0084, a try): only on ground that the front reached less than `jonesAge` steps before (its front
   * stamp, 6.9; a cell without a stamp is the youngest ground), so the thin sheet behind the front thins away after a
   * time (Le Verge-Serandour and Alim 2023, Sec. 4.1).
   */
  jones: 'all' | 'fresh' | 'edge' | 'young';
  /**
   * The age of the ground in steps up to which `jones` 'young' gives births (ADR 0084): 1,500, the delay after which
   * the main vein of the organism shows at a spot that the front passed (about 50 min, Schenz 2019, Sec. 3.1.3; a step
   * is about 2 s, `docs/fidelity.md` row 6).
   */
  jonesAge: number;
  /**
   * Which rim cells are sinks (ADR 0084, a try): every rim cell that the rules of `sinkAt` take, as before ('all'), or
   * only those whose flow memory D is at least FED_D times the base conductance ('fed'), the level above which the
   * rule of the tubes makes a vein grow. The fed sinks share the total as all sinks do. A rim without one
   * fed sink takes all its sinks, as 'all' does (fedFallback counts those flow passes).
   */
  sinkOn: 'all' | 'fed';
  /**
   * The share of a sink (ADR 0077, a try): its weight alone, so that every sink of one weight takes an equal share, as
   * before ('equal'), or its weight times the supply that reaches it ('supply'): the flux that its cell would pass at
   * the pressure of the last solve into one common level of all sinks, over the conductivity of its own cell
   * (supplyLevel()). A sink at the end of a good path from the food stands higher and takes more; one that the network
   * reaches badly stands low and takes less. The sink rate follows that demand with `tau`, as it follows the weight.
   */
  shareOn: 'equal' | 'supply';
  /**
   * The flux Q of a cell from the fluxes over its four edges (ADR 0080, a try; cellFlux()): half the sum of their
   * sizes, as the app ('sum'), or the length of the vector of the mean sizes in x and in y ('norm'). A uniform flow of
   * strength F at the angle θ to the grid reads F · (|cos θ| + |sin θ|) with 'sum', up to 1.41 · F on a diagonal, and F
   * at every angle with 'norm'.
   */
  fluxOn: 'sum' | 'norm';
  /**
   * What pays the births of the front (study 1c, ADR 0093): 'fixed', the budget grows by S / `paid` in a step while
   * the front takes flux, as the engine (docs/model.md 9.1); 'foods', the same times max(1, P), P the covered sites of
   * the step, so that each covered food pays as many births as one does today; 'flux', the sinks take S times max(1,
   * P), so that each covered food gives the front the flux of one, and the budget follows that flux.
   */
  feed: 'fixed' | 'foods' | 'flux';
  /**
   * The edges of the flow (ADR 0081, a try): 4, the axis neighbours, as the app; or 8, also the diagonal neighbours,
   * in the solve of the pressure, in the fluxes and in the flux of a cell. With 8 an axis edge has the weight
   * STENCIL8.axis and a diagonal edge STENCIL8.diag, and Q is half the sum of the sizes of the fluxes over the 8
   * edges (fluxOn must be 'sum'). A diagonal edge passes no corner of a wall: both cells beside it must be open.
   */
  stencil: number;
  /**
   * The credit of fresh ground (study 1a of the plan of 2026-11-22, ADR 0091): the flow memory D that ground without a
   * tube holds, FLOW.fresh (0.2) as the app. It has three jobs, and `creditJobs` says which of them take `credit`; the
   * others keep FLOW.fresh. 'start': ground that never held a tube starts at `credit` and keeps it. 'cap': ground that
   * held a tube and starved comes back up to `credit`. 'fall': ground without a tube holds at most `credit`, so a tube
   * that vanishes with more falls to it. 'all': the three at once, as the probes of the plan patched FLOW.fresh.
   */
  credit: number;
  creditJobs: 'all' | 'start' | 'cap' | 'fall';
  /**
   * The forms without a constant (ADR 0091): 'const', the credit above. 'feeder', form (i): a cell that joins the
   * territory takes the D of the tube cell that feeds it, its neighbour with a tube and the highest pressure (or, if no
   * neighbour holds a tube, the highest D of its neighbours in the territory). 'births', form (ii): the agents read a
   * level of their own (E), which follows the rule of D with the credit, and D, which only the flow reads, starts at
   * the floor, so a new tube cell conducts at the base conductance.
   */
  creditOn: 'const' | 'feeder' | 'births';
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
  /** The steps of the food scent before the colony starts: 300 bring it to its steady state; the app starts at 0. */
  scentSteps: number;
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
  driftOn: 'all',
  sinkTube: false,
  refOn: 'roles',
  solver: 'app',
  speed: 0,
  speedOn: 'body',
  slimeWeight: 0,
  paidBy: 'order',
  fresh: 'chamfer',
  sums: 'float',
  start: 'disc',
  bodyOn: 'trail',
  bodyFull: 0.4,
  jones: 'all',
  jonesAge: 1500,
  sinkOn: 'all',
  shareOn: 'equal',
  fluxOn: 'sum',
  feed: 'fixed',
  stencil: 4,
  credit: FLOW.fresh,
  creditJobs: 'all',
  creditOn: 'const',
});

/**
 * Study 1c (ADR 0093): a ledger of the births and deaths, by the kind of birth (1 Jones' rule, 2 paid by the flux, 3 a
 * respawn; 0 the start), and of the budget of the paid births. Only feed.ts sets one; without it nothing is counted.
 */
export interface Ledger {
  born(id: number, kind: 1 | 2 | 3, step: number): void;
  died(id: number, cause: 'starve' | 'crowd', closed: boolean, step: number): void;
  /** What the budget gained in a step, and what the cap of the agents of the front took off it. */
  budget(credited: number, truncated: number): void;
}

/** The words that a text option of `Front` takes. */
const FRONT_TEXT: Record<string, readonly string[]> = {
  holdOn: ['trail', 'body'],
  holdBirthsOn: ['same', 'trail', 'body'],
  solver: ['app', 'exact'],
  driftOn: ['all', 'net', 'mirror', 'take', 'sinks', 'rim', 'leak', 'extend'],
  refOn: ['roles', 'ports'],
  speedOn: ['body', 'trail', 'push'],
  paidOn: ['fresh', 'sinks'],
  sinkAt: ['fresh', 'edge'],
  paidBy: ['order', 'rank', 'chance', 'fill', 'ahead'],
  fresh: ['chamfer', 'box'],
  sums: ['float', 'fixed'],
  start: ['disc', 'agents'],
  bodyOn: ['trail', 'agents', 'cube'],
  jones: ['all', 'fresh', 'edge', 'young'],
  sinkOn: ['all', 'fed'],
  shareOn: ['equal', 'supply'],
  fluxOn: ['sum', 'norm'],
  creditJobs: ['all', 'start', 'cap', 'fall'],
  creditOn: ['const', 'feeder', 'births'],
  feed: ['fixed', 'foods', 'flux'],
};

/**
 * The forms of a GPU for the rules of stage 4 (ADR 0067): the key=value words that turn all of them on. The start
 * stays the disc: a square around each start agent (`start` 'agents') keeps every agent away from the edge of the
 * territory, where the sinks lie.
 */
export const GPU_FORMS = { paidBy: 'rank', fresh: 'box', sums: 'fixed' } as const;

/**
 * The key of an agent with the sink rate r and the uniform draw u in the order of the paid births (`paidBy` 'order'
 * and 'rank'): the least keys first, so that an agent comes early with odds in its rate (Efraimidis and Spirakis).
 */
export const rankKey = (u: number, r: number): number => -Math.log(1 - u) / r;

/**
 * The scale λ of `paidBy` 'fill' (ADR 0067): the chances min(1, λ · r) of the sink rates `rates` add up to `target`.
 * From λ = target / P, P the sum of the rates, each round counts the rates whose chance is 1 and sums them to S, and
 * takes λ = (target − their count) / (P − S): a GPU runs a round as a pass over the agents. λ only grows, and the
 * rounds end when the count stays, at most FILL_ROUNDS of them. With every chance at 1, λ is infinite. `fixed`: the
 * sums in steps of 1 / FIXED, as `sums` 'fixed' takes them.
 */
export function fillScale(rates: readonly number[], target: number, fixed = false): number {
  const sum = (v: readonly number[]) => {
    let s = 0;
    for (const r of v) s += fixed ? Math.round(r * FIXED) : r;
    return fixed ? s / FIXED : s;
  };
  const P = sum(rates);
  if (!(P > 0) || !(target > 0)) return 0;
  let lambda = target / P;
  let clipped = 0;
  for (let round = 0; round < FILL_ROUNDS; round++) {
    const full = rates.filter((r) => lambda * r >= 1);
    if (full.length === clipped && round > 0) break;
    clipped = full.length;
    const rest = P - sum(full);
    if (rest <= 0) return Infinity;
    lambda = (target - full.length) / rest;
  }
  return lambda;
}

/**
 * The level that the tube body of a cell follows when the agents set it: s the share of the open cells of its 3 × 3
 * block that hold an agent. 'agents' (ADR 0076): s / full, at most 1. 'cube' (ADR 0078): s³, full at s = 1.
 */
export function bodyLevel(on: 'agents' | 'cube', s: number, full: number): number {
  return on === 'cube' ? s * s * s : Math.min(1, s / full);
}

/**
 * The spread of the pressure over the sinks (ADR 0078): the 10th to the 90th percentile of the pressures `sinks`, over
 * the drop from the pressure `food` of the source to their mean. A constant added to every pressure, or a factor on
 * every pressure, changes nothing. NaN without sinks or without a drop.
 */
export function sinkSpread(food: number, sinks: readonly number[]): number {
  if (sinks.length === 0) return NaN;
  const sorted = [...sinks].sort((a, b) => a - b);
  const at = (q: number) => {
    const x = q * (sorted.length - 1);
    const i = Math.floor(x);
    const j = Math.min(sorted.length - 1, i + 1);
    return sorted[i]! + (x - i) * (sorted[j]! - sorted[i]!);
  };
  const mean = sinks.reduce((a, b) => a + b, 0) / sinks.length;
  const drop = food - mean;
  return drop > 0 ? (at(0.9) - at(0.1)) / drop : NaN;
}

/**
 * The common level of the sinks of `shareOn` 'supply' (ADR 0077): the level L at which sinks with the conductances `a`
 * at the pressures `p` take S together, the sum of a · max(0, p − L) equal to S. From the sink of the highest pressure
 * down, each sink joins while its pressure lies above the level of those before it. A constant added to every pressure
 * moves L by that constant, so the takes p − L read only differences of the pressure. NaN without S or a conductance.
 */
export function supplyLevel(a: readonly number[], p: readonly number[], S: number): number {
  if (!(S > 0)) return NaN;
  const order = p.map((_, i) => i).sort((i, j) => p[j]! - p[i]!);
  let [sum, weighted, level] = [0, 0, NaN];
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    if (!(a[i]! > 0)) continue;
    sum += a[i]!;
    weighted += a[i]! * p[i]!;
    level = (weighted - S) / sum;
    const next = order[k + 1];
    if (next === undefined || level >= p[next]!) break;
  }
  return level;
}

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
  scentSteps: 300,
  front: noFront(),
  ...patch,
});

const harmonic = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));

/**
 * The flux Q of a cell (`fluxOn`, ADR 0080) from the sizes of the fluxes over its east, west, south and north edges (0
 * for an edge that is missing). 'sum': half their sum, the throughput of the cell, as the app (flow-reference.ts).
 * 'norm': √(ax² + ay²), with ax and ay the means of the sizes in x and in y. The sizes, not the signed fluxes: a cell
 * into which the flow comes from both sides, as a sink, still reads its throughput. Both read the same for a flow along
 * an axis.
 */
export function cellFlux(on: Front['fluxOn'], e: number, w: number, s: number, n: number): number {
  if (on === 'sum') return (e + w + s + n) * 0.5;
  const [ax, ay] = [0.5 * (e + w), 0.5 * (s + n)];
  return Math.sqrt(ax * ax + ay * ay);
}

/**
 * The weights of the edges of `stencil` 8 (ADR 0081): an axis edge conducts STENCIL8.axis times the harmonic mean of
 * its two cells, a diagonal edge STENCIL8.diag times. Their ratio is 1/√2. Then a broad uniform flow reads the same
 * flux at 0° and at 45° (and at most 1.08 times more between, at 22.5°: the width of a regular octagon), and a vein of
 * one cell conducts the same along an axis and along a diagonal (one diagonal edge per √2 cells of length). The sum
 * axis + 2 · diag is 1: a uniform sheet conducts as with 4 edges, in every direction. The weights of the isotropic
 * 9-point Laplacian (2/3 and 1/6) read a broad flow 1.18 times higher off the axes and let a thin diagonal vein
 * conduct 0.35 times as well as a thin vein along an axis.
 */
export const STENCIL8 = { axis: Math.SQRT2 - 1, diag: 1 - Math.SQRT1_2 } as const;

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
  /**
   * With `stencil` 8 (ADR 0081): the four diagonal neighbours of a cell (south-east, north-west, south-west,
   * north-east), −1 for none and where the edge would pass the corner of a wall. Empty with 4.
   */
  private readonly nbd: Int32Array;
  private readonly eight: boolean;
  // The flow (section 8): memory D, tube body B, conductivity G, the role code of a port, pressure per lane.
  readonly D: Float32Array;
  /** The level that the agents read (ADR 0091): D itself, but its own field with `creditOn` 'births'. */
  readonly E: Float32Array;
  /** The credit options (ADR 0091): whether any acts, the three levels, and whether a cell ever held a tube. */
  private readonly credited: boolean;
  private readonly creditLevels: { start: number; cap: number; fall: number };
  private readonly held: Uint8Array;
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
  /** The diagonal edges of `stencil` 8: to the south-east and to the south-west neighbour. */
  private readonly edgeSE: Float32Array;
  private readonly edgeSW: Float32Array;
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
  /** What the sink of each cell takes in this step (`paid`), 0 elsewhere: the drift of `driftOn` 'take' and 'sinks'. */
  readonly take: Float32Array;
  /** The levels of `driftOn` 'sinks' and 'rim' after the last solve, the mean of the lanes; NaN without one. */
  sinkLevel = NaN;
  rimLevel = NaN;
  /** The iterations of the last solve of the ground of `driftOn` 'extend', the most of the lanes. */
  extendIterations = 0;
  private frontActive = false;
  /** The total sink of the front in the last step. */
  frontTotal = 0;
  /** Births that the flow paid for and that are not born yet. */
  budget = 0;
  paidBirths = 0;
  /** The agents at the young front in the last flow pass. */
  demand = 0;
  /** The cells of those sinks (`paid`), for sinkPressures(). */
  private sinkCells: readonly number[] = [];
  /** `sinkOn` 'fed' (ADR 0084): the rim cells that the rules of `sinkAt` take in the last flow pass, fed or not. */
  rimCandidates = 0;
  /** `sinkOn` 'fed': the flow passes in which no rim cell was fed, so that all of them were sinks. */
  fedFallback = 0;
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
  /** The scale λ of the chances of the last growth step (`paidBy` 'chance' or 'fill'). */
  paidScale = 0;
  /** The keys and ids of the agents that could claim a child in the last growth step (`paidBy` 'rank'). */
  readonly paidKeys: [number, number][] = [];
  /** The Chebyshev distance of each cell to ground without slime, at most 255 (with `reach`). */
  private readonly toFresh: Uint8Array;
  /** 1 for a cell of the territory of the colony (`speed`). */
  readonly territory: Uint8Array;
  /** The step, plus 1, at which a tube cell first reached the flow memory VEIN (0: never): for the delay of a vein. */
  readonly veinAt: Uint32Array;
  /**
   * A still sheet (ADR 0079): the cells of fixed sinks of weight 1, which paidSinks() takes with the agents of the
   * front (a still sheet has none), and the base conductance of a tube cell (8.4), FLOW.base but in a diagnostic.
   */
  stillSinks: readonly number[] = [];
  base: number = FLOW.base;
  /** Study 1c (ADR 0093): the ledger of feed.ts, and the agents whose claim of this growth step the flux paid. */
  ledger?: Ledger;
  private paidWant?: Uint8Array;
  private winner?: Int32Array;
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
    const stencil = p.front.stencil;
    if (stencil !== 4 && stencil !== 8) throw new Error(`stencil=${String(stencil)}: 4 or 8`);
    // The 8 edges cover the solve, the fluxes and the flux of a cell; the ground of the drift keeps its 4 edges.
    if (stencil === 8 && p.front.fluxOn !== 'sum') throw new Error('stencil=8 needs fluxOn=sum');
    if (stencil === 8 && (p.front.driftOn === 'leak' || p.front.driftOn === 'extend'))
      throw new Error(`stencil=8 does not solve the ground of driftOn=${p.front.driftOn}`);
    this.eight = stencil === 8;
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
    const cr = p.front;
    const job = (j: 'start' | 'cap' | 'fall') =>
      cr.creditJobs === 'all' || cr.creditJobs === j ? cr.credit : FLOW.fresh;
    this.creditLevels = { start: job('start'), cap: job('cap'), fall: job('fall') };
    this.credited = cr.credit !== FLOW.fresh || cr.creditOn !== 'const';
    this.held = new Uint8Array(this.credited ? n : 0);
    const births = cr.creditOn === 'births';
    this.D = new Float32Array(n).fill(births ? FLOW.floor : this.creditLevels.start);
    this.E = births ? new Float32Array(n).fill(this.creditLevels.start) : this.D;
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
    this.edgeSE = new Float32Array(this.eight ? n : 0);
    this.edgeSW = new Float32Array(this.eight ? n : 0);
    this.ports = new Int32Array(layout.sites.length).fill(-1);
    this.portsPrev = new Int32Array(layout.sites.length).fill(-1);
    this.S = new Uint32Array(n);
    this.F = new Uint32Array(n);
    this.life = Math.round(p.slimeLife * 1800);
    this.sinkRate = new Float32Array(n);
    this.sinkCount = new Float32Array(n);
    this.extra = new Float32Array(n);
    this.take = new Float32Array(n);
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
    // The diagonal neighbours of `stencil` 8: the edge to (x + dx, y + dy) needs (x + dx, y) and (x, y + dy) open.
    this.nbd = new Int32Array(this.eight ? n * 4 : 0).fill(-1);
    if (this.eight)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const c = y * w + x;
          if (!open[c]) continue;
          const ok = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && !!open[yy * w + xx];
          const diag = (dx: number, dy: number) =>
            ok(x + dx, y + dy) && ok(x + dx, y) && ok(x, y + dy) ? (y + dy) * w + x + dx : -1;
          this.nbd.set([diag(1, 1), diag(-1, -1), diag(-1, 1), diag(1, -1)], c * 4);
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
    for (let k = 0; k < this.p.scentSteps; k++) this.diffuseScent();
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
      // A try for a GPU: every open cell within START_REACH cells of a start agent (ADR 0067).
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
    if (drift > 0) v -= drift * this.driftPressure(px, py, qx, qy, c);
    return v;
  }

  /**
   * The pressures of the last solve at the sources and at the sinks of the last flow pass (`paid`), as the drift reads
   * them (pm()): `food` the mean over the ports of the sites, NaN without a port; `sinks` one per sink. For
   * sinkSpread() (ADR 0078).
   */
  sinkPressures(): { food: number; sinks: number[]; ports: number } {
    const ports = Array.from(this.ports).filter((c) => c >= 0);
    const food = ports.length > 0 ? ports.reduce((s, c) => s + this.pm(c), 0) / ports.length : NaN;
    return { food, sinks: this.sinkCells.map((c) => this.pm(c)), ports: ports.length };
  }

  /** The mean pressure of the lanes that ran at cell c, as the drift reads it. */
  private pm(c: number): number {
    let p = 0;
    for (let l = 0; l < this.lanes; l++) p += this.P[l]![c]!;
    return p / this.lanes;
  }

  /** The mean over the lanes that ran of the pressure at cell c less that at cell a, in the order of 'net'. */
  private pd(c: number, a: number): number {
    let p = 0;
    for (let l = 0; l < this.lanes; l++) p += this.P[l]![c]! - this.P[l]![a]!;
    return p / this.lanes;
  }

  /**
   * The pressure that the sensor at (qx, qy) of the agent at (px, py) reads, on cell c (`driftOn`). The forms other
   * than 'all', 'leak' and 'extend' give the pressure less that of the agent's cell, so an agent off the tubes reads 0
   * at every sensor.
   */
  private driftPressure(px: number, py: number, qx: number, qy: number, c: number): number {
    const form = this.p.front.driftOn;
    if (form === 'all' || form === 'leak' || form === 'extend') return this.pm(c);
    const { G } = this;
    const a = this.cellOf(px, py);
    if (a < 0 || !(G[a]! > 0)) return 0;
    if (G[c]! > 0) return this.pd(c, a);
    switch (form) {
      case 'net':
        return 0;
      case 'mirror': {
        // The cell as far behind the agent as the sensor lies ahead of it, on a tube and without a wall between.
        const [mx, my] = [2 * px - qx, 2 * py - qy];
        const m = this.cellOf(mx, my);
        if (m < 0 || !this.layout.open[m] || !(G[m]! > 0) || !this.clearPath(px, py, mx, my)) return 0;
        return this.pd(a, m);
      }
      case 'take':
        return -(this.p.sensorOffset * this.take[a]!) / G[a]!;
      case 'sinks':
        return Number.isFinite(this.sinkLevel) ? this.sinkLevel - this.pm(a) : 0;
      case 'rim':
        return Number.isFinite(this.rimLevel) ? this.rimLevel - this.pm(a) : 0;
    }
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
   * One step of the flow alone, for a still sheet (ADR 0079): no agent moves or is born, and the trail and the slime
   * stay, so the tube body stays where the trail holds it.
   */
  flowStep() {
    this.flowPass();
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
    if (this.p.front.creditOn !== 'feeder') {
      for (const c of add) t[c] = 1;
      return;
    }
    // Form (i) of ADR 0091: a new cell of the territory starts at the D of the tube cell that feeds it.
    const given = add.map((c) => this.feederD(c));
    add.forEach((c, i) => {
      t[c] = 1;
      this.D[c] = given[i]!;
    });
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
        const d = this.E[c]!;
        seedFor(i, STARVE, k, seed);
        if (rand() < (FLOW.death * half2) / (d * d + half2)) {
          this.alive[i] = 0;
          this.aliveCount--;
          this.starved++;
          this.ledger?.died(i, 'starve', d < FLOW.half, k);
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
        const d = this.E[c]!;
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
          this.ledger?.born(i, 3, k);
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
        this.ledger?.died(i, 'crowd', this.E[c]! < FLOW.half, k);
        after[c]!--;
        continue;
      }
      if (this.counts[c] === 0) continue;
      const nG = this.windowSum(x, y, 4);
      if (nG < 1 || nG > 10 || this.E[c]! < FLOW.half) continue;
      // `jones` (ADR 0076): Jones' births only within `reach` of ground without slime ('fresh') or of open ground
      // outside the territory ('edge'), at the front.
      if (front.jones === 'fresh' && !this.freshNear(c)) continue;
      if (front.jones === 'edge' && !this.edgeNear(c)) continue;
      // 'young' (ADR 0084): only on ground that the front reached less than `jonesAge` steps before.
      if (front.jones === 'young' && this.F[c] !== 0 && this.step + 1 - this.F[c]! >= front.jonesAge) continue;
      this.claimChild(i, c, free);
    }
    // The births that the flow paid for, in the forms of a GPU (ADR 0067): a chance per agent of the front ('chance',
    // 'fill'), or the agent of the front on a marked cell claims a child ('ahead'; the flow pass of this step takes the
    // claims off the budget).
    if (front.paid > 0 && (front.paidBy === 'chance' || front.paidBy === 'fill')) this.paidByChance(free);
    if (front.paid > 0 && front.paidBy === 'rank') this.paidByRank(free);
    if (front.paid > 0 && front.paidBy === 'ahead') {
      this.paidClaims = 0;
      for (let i = 0; i < cap; i++) {
        if (!this.alive[i] || this.want[i]! >= 0) continue;
        const c = this.cellOf(this.ax[i]!, this.ay[i]!);
        if (!this.marks[c] || this.E[c]! < FLOW.half) continue;
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
        if (this.E[c]! < FLOW.half) continue;
        if (atSinks ? this.sinkRate[c]! <= 0 : !this.isYoung(c, k)) continue;
        if (!front.rim || this.atRim(c)) at.push(i);
      }
      seedFor(1, ORDER, k, seed);
      if (atSinks) {
        const order = new Map<number, number>();
        for (const i of at) order.set(i, rankKey(rand(), this.sinkRate[this.cellOf(this.ax[i]!, this.ay[i]!)]!));
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
    if (this.ledger) this.winner ??= new Int32Array(this.cells);
    for (let i = 0; i < cap; i++) {
      const t = this.want[i]!;
      if (t >= 0 && this.claims[t] === this.key(i)) {
        births.push(t, this.cellOf(this.ax[i]!, this.ay[i]!));
        if (this.winner) this.winner[t] = i;
      }
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
      if (this.ledger && this.winner) this.ledger.born(id, this.paidWant?.[this.winner[t]!] ? 2 : 1, k);
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
      if (this.sinkRate[c]! <= 0 || this.E[c]! < FLOW.half) continue;
      if (front.rim && !this.atRim(c)) continue;
      atFront++;
      if (!this.roomFor(c, this.occNext)) continue;
      able.push(i);
      mass += front.sums === 'fixed' ? Math.round(this.sinkRate[c]! * FIXED) : this.sinkRate[c]!;
    }
    const [B, P] = [this.budget, front.sums === 'fixed' ? mass / FIXED : mass];
    this.sinkPayable = P;
    this.paidClaims = 0;
    // The chance of a sink rate r: λ · r, at most 1. 'chance': λ = B / P. 'fill': λ such that the chances add up to
    // min(B, the agents that could claim), as the order gives min(B, them) births; a GPU finds it in a few passes that
    // count the agents whose chance is 1 and sum their sink rates (fillScale()).
    const rates = () => able.map((i) => this.sinkRate[this.cellOf(this.ax[i]!, this.ay[i]!)]!);
    const lambda =
      front.paidBy === 'fill' ? fillScale(rates(), Math.min(B, able.length), front.sums === 'fixed') : B / P;
    if (B > 0 && P > 0)
      for (const i of able) {
        const c = this.cellOf(this.ax[i]!, this.ay[i]!);
        seedFor(i, PAID, k, this.p.seed);
        if (rand() >= Math.min(1, lambda * this.sinkRate[c]!)) continue;
        if (this.claimChild(i, c, free, front.rim)) this.paidClaims++;
      }
    this.paidBirths += this.paidClaims;
    this.frontAgents = atFront;
    this.paidScale = lambda;
    this.budget = Math.min(B - this.paidClaims, atFront);
  }

  /**
   * The births that the flux pays as the order of ADR 0065 gives them, in the form of a GPU (`paidBy` 'rank', ADR
   * 0067). Each agent of the front that could claim a child draws a key of its own (rankKey()), and the whole part of B
   * of them with the least keys claim a child: the order of Efraimidis and Spirakis, as in growthPass(). A GPU writes
   * the keys in one pass over the agents, and in the next each of these agents counts the agents of its strain with a
   * smaller key, and stops at the whole part of B. As with the order, a budget below 1 pays nothing, and after the
   * claims the budget never exceeds the number of agents of the front.
   */
  private paidByRank(free: number[]) {
    const { cap } = this;
    const front = this.p.front;
    const k = this.step;
    this.onPaid?.();
    this.paidKeys.length = 0;
    let atFront = 0;
    for (let i = 0; i < cap; i++) {
      if (!this.alive[i] || this.want[i]! >= 0) continue;
      const c = this.cellOf(this.ax[i]!, this.ay[i]!);
      if (this.sinkRate[c]! <= 0 || this.E[c]! < FLOW.half) continue;
      if (front.rim && !this.atRim(c)) continue;
      atFront++;
      if (!this.roomFor(c, this.occNext)) continue;
      seedFor(i, PAID, k, this.p.seed);
      this.paidKeys.push([rankKey(rand(), this.sinkRate[c]!), i]);
    }
    this.frontAgents = atFront;
    this.paidClaims = 0;
    if (this.ledger) (this.paidWant ??= new Uint8Array(cap)).fill(0);
    if (this.budget < 1) return;
    // The rank of an agent: the agents with a smaller key, or with the same key and a smaller id.
    const ranked = [...this.paidKeys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, i] of ranked.slice(0, Math.floor(this.budget))) {
      if (this.claimChild(i, this.cellOf(this.ax[i]!, this.ay[i]!), free, front.rim)) {
        this.paidClaims++;
        if (this.paidWant) this.paidWant[i] = 1;
      }
    }
    this.paidBirths += this.paidClaims;
    this.ledger?.budget(0, Math.max(0, this.budget - this.paidClaims - atFront));
    this.budget = Math.min(this.budget - this.paidClaims, atFront);
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

  /**
   * Whether the tube of cell c carries flux to it (`sinkTube`, ADR 0072): the tube cells that a path between
   * 4-neighbours over tube cells (G > 0) reaches from c, inside the square of side 2 · SINK_TUBE_REACH + 1 around it,
   * include a cell on the edge of the square or a port of a site.
   */
  tubeOut(c: number): boolean {
    const { w, h, G } = this;
    const [x0, y0] = [c % w, Math.floor(c / w)];
    const ports = new Set(Array.from(this.ports).filter((p) => p >= 0));
    let ring = [c];
    const seen = new Set([c]);
    while (ring.length > 0) {
      const next: number[] = [];
      for (const t of ring) {
        const [x, y] = [t % w, Math.floor(t / w)];
        if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) === SINK_TUBE_REACH || ports.has(t)) return true;
        for (const [xx, yy] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (Math.abs(xx - x0) > SINK_TUBE_REACH || Math.abs(yy - y0) > SINK_TUBE_REACH) continue;
          const n = yy * w + xx;
          if (G[n]! > 0 && !seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      ring = next;
    }
    return false;
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
    if (!this.occ[c] || this.sinkRate[c]! <= 0 || this.E[c]! < FLOW.half) return false;
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
        if (!open[t] || occ[t] || this.E[t]! < FLOW.half) continue;
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

  /** Whether an open cell outside the territory lies within `reach` cells of cell c (a Chebyshev distance). */
  edgeNear(c: number): boolean {
    const { w, h } = this;
    const { open } = this.layout;
    const r = this.p.front.reach;
    const [x, y] = [c % w, Math.floor(c / w)];
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        const t = yy * w + xx;
        if (open[t] && !this.territory[t]) return true;
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
      if (!open[t] || occ[t] || this.E[t]! < FLOW.half) continue;
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
  /**
   * The flow memory of ground without a tube with the credit options (ADR 0091). Ground that never held a tube keeps
   * its start (or the D that its feeder gave it). Ground that held one holds at most the level `fall`, and below the
   * level `cap` it comes back as the app's ground does. With the three levels at FLOW.fresh this is the rule of the app.
   */
  private bareMemory(c: number, d: number): number {
    if (!this.held[c]) return d;
    const { cap, fall } = this.creditLevels;
    if (d > fall) return fall;
    return d < cap ? Math.min(cap, Math.max(d, FLOW.floor) * (1 + this.recover)) : d;
  }

  /**
   * Form (i) of ADR 0091: the D of the tube cell that feeds cell c as it joins the territory, its neighbour in the
   * territory with a tube and the highest pressure; without one, the highest D of its neighbours in the territory.
   */
  private feederD(c: number): number {
    const { w, h, territory: t, G, D } = this;
    const [x, y] = [c % w, Math.floor(c / w)];
    let [feeder, high, top] = [-1, -Infinity, -1];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [xx, yy] = [x + dx, y + dy];
        if ((dx === 0 && dy === 0) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const m = yy * w + xx;
        if (!t[m]) continue;
        top = Math.max(top, D[m]!);
        if (G[m]! > 0 && this.pm(m) > high) [feeder, high] = [m, this.pm(m)];
      }
    return feeder >= 0 ? D[feeder]! : top >= 0 ? top : D[c]!;
  }

  hasSlime(c: number, k = this.step): boolean {
    const s = this.S[c]!;
    return s !== 0 && k + 1 - s < this.life;
  }

  private flowPass() {
    const { open, food, sites } = this.layout;
    const { cells, D, B } = this;
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
    this.fluxOfCells();
    this.lanes = lanes;
    // The update of the memory, the body and the conductivity (8.1, 8.4).
    const Gn = this.Gnext;
    const half2 = FLOW.half * FLOW.half;
    const bodyOn = this.p.front.bodyOn;
    const { w, h } = this;
    for (let c = 0; c < cells; c++) {
      if (!open[c]) {
        Gn[c] = 0;
        continue;
      }
      let d = D[c]!;
      const bodyOld = B[c]!;
      if (bodyOld >= FLOW.bodyLow) d = fed ? Math.max(FLOW.floor, d + FLOW.rate * (this.fmean[c]! - d)) : d;
      else if (this.credited) d = this.bareMemory(c, d);
      else d = Math.min(FLOW.fresh, Math.max(d, FLOW.floor) * (1 + this.recover));
      let presence = Math.min(1, Math.max(0, (this.trail[c]! - this.low) * this.scale));
      if (bodyOn !== 'trail') {
        // The share of the open cells of the 3 × 3 block with an agent (bodyOn 'agents', ADR 0076; 'cube', ADR 0078).
        const [x, y] = [c % w, Math.floor(c / w)];
        let [a, n] = [0, 0];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const [xx, yy] = [x + dx, y + dy];
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !open[yy * w + xx]) continue;
            a += this.occ[yy * w + xx]!;
            n++;
          }
        presence = bodyLevel(bodyOn, a / n, this.p.front.bodyFull);
      }
      const body = bodyOld + FLOW.bodyRate * (presence - bodyOld);
      if (bodyOld >= FLOW.bodyLow && body < FLOW.bodyLow && d * d < half2) d = FLOW.floor;
      D[c] = d;
      if (this.E !== D) {
        // `creditOn` 'births' (ADR 0091): the level of the agents follows the rule of D from its own start.
        let e = this.E[c]!;
        if (bodyOld >= FLOW.bodyLow) e = fed ? Math.max(FLOW.floor, e + FLOW.rate * (this.fmean[c]! - e)) : e;
        else e = this.bareMemory(c, e);
        if (bodyOld >= FLOW.bodyLow && body < FLOW.bodyLow && e * e < half2) e = FLOW.floor;
        this.E[c] = e;
      }
      if (this.credited && body >= FLOW.bodyLow) this.held[c] = 1;
      B[c] = body;
      if (body >= FLOW.bodyLow && d >= VEIN && this.veinAt[c] === 0) this.veinAt[c] = k + 1;
      Gn[c] = body >= FLOW.bodyLow ? body * (food[c] ? FLOW.food : this.base + d) : 0;
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
    this.afterSolve();
  }

  /**
   * The flux Q of every cell and the mean of f(Q) over the lanes, from the conductivity G and the pressure P of the last
   * step (8.4), by `fluxOn` (cellFlux()). Public for the test of ADR 0080, which sets G and P by hand.
   */
  fluxOfCells() {
    const { open } = this.layout;
    const { cells, nb, G } = this;
    const on = this.p.front.fluxOn;
    if (this.eight) {
      this.fluxOfCells8();
      return;
    }
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
        const e = nb[c * 4]!;
        const wv = nb[c * 4 + 1]!;
        const s = nb[c * 4 + 2]!;
        const nn = nb[c * 4 + 3]!;
        const q = cellFlux(
          on,
          e >= 0 ? this.edgeE[c]! * Math.abs(pc - P[e]!) : 0,
          wv >= 0 ? this.edgeE[wv]! * Math.abs(pc - P[wv]!) : 0,
          s >= 0 ? this.edgeS[c]! * Math.abs(pc - P[s]!) : 0,
          nn >= 0 ? this.edgeS[nn]! * Math.abs(pc - P[nn]!) : 0,
        );
        const qg = q <= 0 ? 0 : Math.pow(q, FLOW.gamma);
        this.fmean[c]! += qg / (1 + qg) / this.lanes;
        this.Q[c]! += q / this.lanes;
      }
    }
  }

  /**
   * The conductances of the edges of `stencil` 8 (ADR 0081) from G plus `ghost` on both cells: the east and the south
   * edge of a cell times STENCIL8.axis, its south-east and south-west edge times STENCIL8.diag.
   */
  private edges8(ghost: number) {
    const { open } = this.layout;
    const { cells, nb, nbd, G } = this;
    const { axis, diag } = STENCIL8;
    for (let c = 0; c < cells; c++) {
      if (!open[c]) continue;
      const gc = G[c]! + ghost;
      const e = nb[c * 4]!;
      const s = nb[c * 4 + 2]!;
      const se = nbd[c * 4]!;
      const sw = nbd[c * 4 + 2]!;
      this.edgeE[c] = e >= 0 ? axis * harmonic(gc, G[e]! + ghost) : 0;
      this.edgeS[c] = s >= 0 ? axis * harmonic(gc, G[s]! + ghost) : 0;
      this.edgeSE[c] = se >= 0 ? diag * harmonic(gc, G[se]! + ghost) : 0;
      this.edgeSW[c] = sw >= 0 ? diag * harmonic(gc, G[sw]! + ghost) : 0;
    }
  }

  /**
   * The pressure of lane 0 solved exactly from G and `extra` as they stand (no roles), then fluxOfCells(): for the
   * measures of a flux by hand (ADR 0081, flux-angle.ts), which set G and the sources themselves.
   */
  solveExact() {
    this.exactPressure(0);
    this.fluxOfCells();
  }

  /** fluxOfCells() with `stencil` 8: Q is half the sum of the sizes of the fluxes over the 8 edges of a cell. */
  private fluxOfCells8() {
    const { open } = this.layout;
    const { cells, nb, nbd } = this;
    const { edgeE, edgeS, edgeSE, edgeSW } = this;
    this.edges8(0);
    this.fmean.fill(0);
    this.Q.fill(0);
    for (let l = 0; l < this.lanes; l++) {
      const P = this.P[l]!;
      for (let c = 0; c < cells; c++) {
        if (!open[c]) continue;
        const pc = P[c]!;
        const e = nb[c * 4]!;
        const wv = nb[c * 4 + 1]!;
        const s = nb[c * 4 + 2]!;
        const nn = nb[c * 4 + 3]!;
        const se = nbd[c * 4]!;
        const nw = nbd[c * 4 + 1]!;
        const sw = nbd[c * 4 + 2]!;
        const ne = nbd[c * 4 + 3]!;
        let sum = 0;
        if (e >= 0) sum += edgeE[c]! * Math.abs(pc - P[e]!);
        if (wv >= 0) sum += edgeE[wv]! * Math.abs(pc - P[wv]!);
        if (s >= 0) sum += edgeS[c]! * Math.abs(pc - P[s]!);
        if (nn >= 0) sum += edgeS[nn]! * Math.abs(pc - P[nn]!);
        if (se >= 0) sum += edgeSE[c]! * Math.abs(pc - P[se]!);
        if (nw >= 0) sum += edgeSE[nw]! * Math.abs(pc - P[nw]!);
        if (sw >= 0) sum += edgeSW[c]! * Math.abs(pc - P[sw]!);
        if (ne >= 0) sum += edgeSW[ne]! * Math.abs(pc - P[ne]!);
        const q = 0.5 * sum;
        const qg = q <= 0 ? 0 : Math.pow(q, FLOW.gamma);
        this.fmean[c]! += qg / (1 + qg) / this.lanes;
        this.Q[c]! += q / this.lanes;
      }
    }
  }

  /** The levels and the ground of the forms of the drift of part E2d (`driftOn`, ADR 0074), after the solve. */
  private afterSolve() {
    const form = this.p.front.driftOn;
    const { cells, G, nb } = this;
    const { open } = this.layout;
    if (form === 'sinks') {
      let [sum, weight] = [0, 0];
      for (let c = 0; c < cells; c++)
        if (this.take[c]! > 0 && G[c]! > 0) {
          sum += this.take[c]! * this.pm(c);
          weight += this.take[c]!;
        }
      this.sinkLevel = weight > 0 ? sum / weight : NaN;
    } else if (form === 'rim') {
      let [sum, count] = [0, 0];
      for (let c = 0; c < cells; c++) {
        if (!open[c] || !(G[c]! > 0)) continue;
        let edge = false;
        for (let e = 0; e < 4 && !edge; e++) {
          const m = nb[c * 4 + e]!;
          if (m >= 0 && !(G[m]! > 0)) edge = true;
        }
        if (!edge) continue;
        sum += this.pm(c);
        count++;
      }
      this.rimLevel = count > 0 ? sum / count : NaN;
    } else if (form === 'leak') for (let l = 0; l < this.lanes; l++) this.leakGround(l);
    else if (form === 'extend') {
      this.extendIterations = 0;
      for (let l = 0; l < this.lanes; l++) this.extendGround(l);
    }
  }

  /**
   * `driftOn` 'leak': shifts the ground (the open cells without a tube) of lane l so that the flux through the ghost
   * conductance between the network and the ground sums to 0. A constant added to the network then moves the ground
   * with it in the next solve.
   */
  private leakGround(l: number) {
    const P = this.P[l]!;
    const { cells, G, nb } = this;
    const { open } = this.layout;
    const ghost = FLOW.ghost;
    let [leak, sum] = [0, 0];
    for (let c = 0; c < cells; c++) {
      if (!open[c] || !(G[c]! > 0)) continue;
      for (let e = 0; e < 4; e++) {
        const m = nb[c * 4 + e]!;
        if (m < 0 || G[m]! > 0) continue;
        const g = harmonic(G[c]! + ghost, G[m]! + ghost);
        leak += g * (P[m]! - P[c]!);
        sum += g;
      }
    }
    if (!(sum > 0)) return;
    const shift = -leak / sum;
    for (let c = 0; c < cells; c++) if (open[c] && !(G[c]! > 0)) P[c]! += shift;
  }

  private extIndex?: Int32Array;

  /**
   * `driftOn` 'extend': the ground of lane l solved to its steady state from the pressure of the network: on each open
   * cell without a tube the edges of the solve (with the ghost conductance) balance, the tube cells fixed. Conjugate
   * gradients from the ground of the last step, to a residual of 10⁻⁹ of the right side. A check of what the drift of
   * ADR 0065 reads when the ground has settled, no form of a GPU.
   */
  private extendGround(l: number) {
    const P = this.P[l]!;
    const { cells, G, nb } = this;
    const { open } = this.layout;
    const ghost = FLOW.ghost;
    const index = (this.extIndex ??= new Int32Array(cells));
    index.fill(-1);
    const list: number[] = [];
    let tubes = 0;
    for (let c = 0; c < cells; c++) {
      if (!open[c]) continue;
      if (G[c]! > 0) tubes++;
      else {
        index[c] = list.length;
        list.push(c);
      }
    }
    const n = list.length;
    if (n === 0 || tubes === 0) return;
    const links = new Int32Array(n * 4).fill(-1);
    const cond = new Float64Array(n * 4);
    const diag = new Float64Array(n);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = list[i]!;
      for (let e = 0; e < 4; e++) {
        const m = nb[c * 4 + e]!;
        if (m < 0) continue;
        const g = harmonic(G[c]! + ghost, G[m]! + ghost) / ghost;
        diag[i]! += g;
        if (index[m]! >= 0) {
          links[i * 4 + e] = index[m]!;
          cond[i * 4 + e] = g;
        } else b[i]! += g * P[m]!;
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
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = P[list[i]!]!;
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
    for (let i = 0; i < n; i++) z[i] = r[i]! / diag[i]!;
    d.set(z);
    let rz = 0;
    for (let i = 0; i < n; i++) rz += r[i]! * z[i]!;
    let it = 0;
    for (; it < 5000; it++) {
      let rn = 0;
      for (let i = 0; i < n; i++) rn += r[i]! * r[i]!;
      if (rn <= 1e-18 * Math.max(bn, 1e-30)) break;
      apply(d, q);
      let dq = 0;
      for (let i = 0; i < n; i++) dq += d[i]! * q[i]!;
      if (!(dq > 0)) break;
      const alpha = rz / dq;
      for (let i = 0; i < n; i++) {
        x[i]! += alpha * d[i]!;
        r[i]! -= alpha * q[i]!;
      }
      for (let i = 0; i < n; i++) z[i] = r[i]! / diag[i]!;
      let rz2 = 0;
      for (let i = 0; i < n; i++) rz2 += r[i]! * z[i]!;
      const beta = rz2 / rz;
      rz = rz2;
      for (let i = 0; i < n; i++) d[i] = z[i]! + beta * d[i]!;
    }
    this.extendIterations = Math.max(this.extendIterations, it);
    for (let i = 0; i < n; i++) P[list[i]!] = x[i]!;
  }

  /** The sinks of the front and the sources that pay them, in `extra` (stage 4). */
  private frontSinks() {
    const front = this.p.front;
    const { cells, G } = this;
    this.extra.fill(0);
    this.take.fill(0);
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
    const unfed: number[] = [];
    const weight = new Map<number, number>();
    for (const c of this.stillSinks)
      if (G[c]! > 0) {
        at.push(c);
        weight.set(c, 1);
      }
    const still = at.length;
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
      // A patch of tube that no tube joins to the network takes no flux (`sinkTube`, ADR 0072).
      if (front.sinkTube && !this.tubeOut(c)) continue;
      weight.set(c, young ? 1 : front.slimeWeight);
      // `sinkOn` 'fed' (ADR 0084): only a rim cell with D of at least FED_D times the base conductance is a sink.
      if (front.sinkOn === 'fed' && this.D[c]! < FED_D * this.base) {
        unfed.push(c);
        continue;
      }
      at.push(c);
    }
    if (front.sinkOn === 'fed') {
      this.rimCandidates = at.length + unfed.length;
      // A rim without one fed sink takes all its sinks, as 'all' does: the food feeds the colony as a whole, so the
      // flux must go to its rim, and a colony whose whole rim fell below the level would else never start again.
      if (at.length === still && unfed.length > 0) {
        at.push(...unfed);
        this.fedFallback++;
      }
    }
    this.demand = at.length;
    this.sinkCells = at;
    // 'ahead': the flow pass of a growth step takes the paid claims off the budget, and the budget never exceeds the
    // number of sinks (ADR 0067).
    if (front.paidBy === 'ahead' && this.step % 3 === 0)
      this.budget = Math.min(this.budget - this.paidClaims, at.length);
    // The sink of a cell follows its share of the demand with the time `tau`.
    const tau = Math.max(1, front.tau);
    let total = 0;
    if (front.shareOn === 'supply') this.supplyCounts(at, weight);
    else for (const c of at) this.sinkCount[c] = weight.get(c) ?? 1;
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
    // `feed` (study 1c, ADR 0093): 'flux' gives the front the flux of one food for each covered food.
    const fed = Math.max(1, portList.length);
    const S = front.norm * this.p.flow * (front.feed === 'flux' ? fed : 1);
    // With `sums` 'fixed' a sink takes its share with the rate that the sum counted, in steps of 1 / FIXED: so the sinks
    // take exactly the S that the sources give. With its own rate they would miss S by the rounding of the sum, and the
    // pressure of a network with a sink more than its sources drifts from the ground beside it (ADR 0067).
    const fixed = front.sums === 'fixed';
    for (let c = 0; c < cells; c++) {
      if (G[c]! <= 0) continue;
      const r = fixed ? Math.round(this.sinkRate[c]! * FIXED) / FIXED : this.sinkRate[c]!;
      this.extra[c]! -= (S * r) / total;
      this.take[c] = (S * r) / total;
    }
    if (portList.length > 0) for (const c of portList) this.extra[c]! += S / sources;
    else for (let c = 0; c < cells; c++) if (G[c]! > 0) this.extra[c]! += S / sources;
    this.frontActive = true;
    this.frontTotal = S;
    const credit = (S / front.paid) * (front.feed === 'foods' ? fed : 1);
    this.budget += credit;
    this.ledger?.budget(credit, 0);
  }

  /**
   * The demands of `shareOn` 'supply' (ADR 0077): each sink c of the list `at` drains over the conductivity G of its
   * own cell, times its weight, into the common level of supplyLevel(), at the pressure of the last solve; its demand
   * is the flux that this gives, in units of the equal share of a weight 1, so the demands add up to the sum of the
   * weights, as those of 'equal' do. Once the rates have followed, a sink takes that flux.
   */
  private supplyCounts(at: readonly number[], weight: ReadonlyMap<number, number>) {
    const S = this.p.front.norm * this.p.flow;
    const a = at.map((c) => (weight.get(c) ?? 1) * this.G[c]!);
    const p = at.map((c) => this.pm(c));
    const level = supplyLevel(a, p, S);
    const sum = at.reduce((s, c) => s + (weight.get(c) ?? 1), 0);
    if (!Number.isFinite(level) || !(sum > 0)) {
      for (const c of at) this.sinkCount[c] = weight.get(c) ?? 1;
      return;
    }
    at.forEach((c, i) => {
      this.sinkCount[c] = (a[i]! * Math.max(0, p[i]! - level) * sum) / S;
    });
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
    const { eight, nbd, edgeSE, edgeSW } = this;
    if (eight) this.edges8(ghost);
    else
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
    // `refOn` 'ports' (ADR 0072): without a role the port of the first covered site, a cell of the network.
    const covered = this.p.front.refOn === 'ports' ? Array.from(this.ports).find((c) => c >= 0) : undefined;
    const ref = acting[0] ?? covered ?? first;
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
          let sum = ge + gw + gs + gn;
          let se = -1;
          let nw = -1;
          let sw = -1;
          let ne = -1;
          let gse = 0;
          let gnw = 0;
          let gsw = 0;
          let gne = 0;
          if (eight) {
            se = nbd[c * 4]!;
            nw = nbd[c * 4 + 1]!;
            sw = nbd[c * 4 + 2]!;
            ne = nbd[c * 4 + 3]!;
            gse = se >= 0 ? edgeSE[c]! : 0;
            gnw = nw >= 0 ? edgeSE[nw]! : 0;
            gsw = sw >= 0 ? edgeSW[c]! : 0;
            gne = ne >= 0 ? edgeSW[ne]! : 0;
            sum += gse + gnw + gsw + gne;
          }
          const pc = P[c]!;
          let next = pc;
          if (sum > 0) {
            let acc = 0;
            if (ge > 0) acc += ge * P[e]!;
            if (gw > 0) acc += gw * P[wv]!;
            if (gs > 0) acc += gs * P[s]!;
            if (gn > 0) acc += gn * P[nn]!;
            if (gse > 0) acc += gse * P[se]!;
            if (gnw > 0) acc += gnw * P[nw]!;
            if (gsw > 0) acc += gsw * P[sw]!;
            if (gne > 0) acc += gne * P[ne]!;
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
    // The links of a cell: its 4 axis edges, and with `stencil` 8 its 4 diagonal edges (ADR 0081).
    const K = this.eight ? 8 : 4;
    const { axis, diag: diagonal } = STENCIL8;
    const links = new Int32Array(n * K).fill(-1);
    const cond = new Float64Array(n * K);
    const diag = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = on[i]!;
      for (let e = 0; e < K; e++) {
        const m = e < 4 ? nb[c * 4 + e]! : this.nbd[c * 4 + e - 4]!;
        if (m < 0 || index[m]! < 0) continue;
        const mean = harmonic(G[c]!, G[m]!);
        const g = !this.eight ? mean : (e < 4 ? axis : diagonal) * mean;
        links[i * K + e] = index[m]!;
        cond[i * K + e] = g;
        diag[i]! += g;
      }
    }
    const apply = (x: Float64Array, y: Float64Array) => {
      for (let i = 0; i < n; i++) {
        let v = diag[i]! * x[i]!;
        for (let e = 0; e < K; e++) {
          const j = links[i * K + e]!;
          if (j >= 0) v -= cond[i * K + e]! * x[j]!;
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
          for (let e = 0; e < K; e++) {
            const j = links[a * K + e]!;
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
