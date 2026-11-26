// The sinks of each strain, the second part of the rules of stage 4 (ADR 0069; ADR 0065, decisions 1, 5 and 8; ADR
// 0067, decisions 3, 6 to 8 and 10). Prepended with common.wgsl. sim.ts runs these passes only while the rules of
// stage 4 run (territory.ts territoryOn()), for each strain after the update of its flow (flow.wgsl `update`) and
// before its pressure, with the uniform block of the flow of that strain.
//
// - `sinks`: one invocation per cell. The cell is a sink of the strain s of the pass when it holds an agent of s (the
//   owners of the step), a tube of s (a conductivity above 0 after the update), and room: a free cell of the
//   territory of s that one step reaches. And it lies at the edge of the territory of s: a path of at most F.sinks.y
//   steps reaches open ground outside it. And its tube carries flux to it (ADR 0072): the tube cells of s that a path
//   between 4-neighbours over tube cells of s reaches from it, inside the square of 13 × 13 cells around it, include a
//   cell on the edge of the square or a port of s. Its weight is 1 if a path of at most F.sinks.x steps reaches an
//   open cell without slime, else F.sinks.w steps of the rate. A path goes over open cells from a cell to one of its 8
//   neighbours, and takes a diagonal step only where the two cells beside its corner are not both walls, as a move
//   and a birth do (ADR 0067, decision 10). The cell of the sink starts every path. The sink rate of each cell and
//   strain is the mean of its weight over F.sinks.z steps (0 for a cell that is no sink), an integer in steps of 2^-24
//   that moves a 1 / F.sinks.z of the way to the weight, rounded toward it, so every GPU computes the same. It is
//   written as a float, with a minus sign while the cell is a sink. Then the sums of the strain: R, the rates of its
//   tube cells in steps of 2^-16, rounded to the nearest, in two words; C, its tube cells; N, its sinks. Each
//   workgroup sums its cells first, then adds its sums with atomics: every order of the additions gives the same
//   integers, and an addition that wraps the low word of R adds 1 to the high one.
// - `state`: one invocation, after `sinks`. The state of the strain: R as a float, C, N, the covered ports (the sites
//   with a port in this step), and whether the front takes flux: it has a sink, R is above 0, and a covered port or
//   a tube cell pays. Then the budget B of the paid births (ADR 0100; paid.ts nextBudget()): a death that the model
//   made in the step gives one back and a birth costs one, those of the agent pass and those of growth, as the passes
//   counted them; then, while the front takes flux, the food credits F.take.y for each covered port, at least one, but
//   only up to the agents F of the front of the last growth step. Each operation rounds once, so every GPU gives the
//   same float. The last two lanes hold F of the last growth step and K of the step.
//
// A cell is open when it lies in the arena and is no wall; a cell outside a closed arena is no wall.

// The uniform block of the flow (flow.wgsl; flow.ts packFlow()): the constants of stage 4 come after the sites
// (territory.ts packTerritory(); ADR 0067, decision 9).
struct FlowRule {
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,
  e: vec4f,
  f: vec4f, // z: the strain of the pass
  g: vec4f,
  sites: array<vec4f, 64>,
  push: array<vec4f, 2>,
  // the steps of a path to ground without slime, of a path to the edge, of the mean, and the weight on slime in
  // steps of 2^-24 (sinks.ts packSinks())
  sinks: vec4f,
  // x: what the sinks take in units of the flow strength (ADR 0070); y: the growth of the budget in a step (paid.ts
  // packPaid())
  take: vec4f,
}
@group(0) @binding(1) var<uniform> F: FlowRule;
@group(0) @binding(2) var<storage, read> env: array<u32>;
@group(0) @binding(3) var<storage, read> owners: array<u32>; // 4 cells to a word, bit s for strain s (territory.wgsl)
@group(0) @binding(4) var territory: texture_2d<u32>; // the copy of the step, 4 cells to a texel (territory.wgsl)
@group(0) @binding(5) var<storage, read> stamps: array<u32>; // the slime field after the stamps of the step (slime.wgsl)
@group(0) @binding(6) var memory: texture_2d<f32>; // the memory of the flow of the strain after its update
@group(0) @binding(7) var<storage, read_write> rates: array<f32>; // per strain and cell: strain · W · H + cell
@group(0) @binding(8) var<storage, read_write> sums: array<atomic<u32>>; // per strain: R low, R high, C, N
// Per strain and site: x the port of this step (flow.wgsl). `sinks` reads it for the tube of a sink, `state` for the
// covered ports.
@group(0) @binding(9) var<storage, read> ports: array<vec2i>;
// The state of every strain, 2 vec4 each (sinks.ts SINK_STATE_LANES); then the counts of each strain, which the agent
// passes and growth add in the step (paid.ts PAID_COUNTS); the keys of the paid births follow them, and no pass here
// reads them.
struct States {
  lanes: array<vec4f, 8>,
  counts: array<atomic<u32>, 40>,
}
@group(0) @binding(10) var<storage, read_write> states: States;

// The weight 1 in steps of the rate (sinks.ts RATE_ONE).
const RATE_ONE = 16777216u;
// The paths: rows of bits over the square of 13 × 13 cells around the cell of the invocation, bit dx + MID of row
// dy + MID for the cell at (dx, dy) from it (sinks.ts SINK_WINDOW). No path of at most MID steps leaves the square.
const MID = 6;
const SIDE = 13;
var<private> openRows: array<u32, 13>;
var<private> wallRows: array<u32, 13>;
var<private> reached: array<u32, 13>;

// The owners of cell c as bits.
fn ownersOf(c: i32) -> u32 {
  return (owners[u32(c) >> 2u] >> (8u * (u32(c) & 3u))) & 0xffu;
}

// Whether the cell at q (cellXY()) lies in the territory of strain s.
fn inTerritory(q: vec2i, s: u32) -> bool {
  let texel = textureLoad(territory, vec2i(q.x >> 2u, q.y), 0).x;
  return ((texel >> (8u * u32(q.x & 3))) & (1u << s)) != 0u;
}

// Whether the cell c has slime for a reader after the stamps of this step, so of the step after it (amount.wgsl
// hasSlime()): a stamp, and an age below the life time.
fn slimeAfter(c: i32) -> bool {
  let held = stamps[c];
  return held != 0u && P.grid.w + 2u - held < P.slime.x;
}

// Adds the cells of the square around q whose distance from it (the larger of |dx| and |dy|) lies above `inner` and
// at most `outer` to the rows of the open cells and of the walls.
fn load(q: vec2i, inner: i32, outer: i32) {
  for (var dy = -outer; dy <= outer; dy++) {
    for (var dx = -outer; dx <= outer; dx++) {
      if (max(abs(dx), abs(dy)) <= inner) { continue; }
      let m = cellAt(q + vec2i(dx, dy));
      if (m < 0) { continue; }
      let bit = 1u << u32(dx + MID);
      if (isWall(env[m])) { wallRows[dy + MID] |= bit; } else { openRows[dy + MID] |= bit; }
    }
  }
}

// One step more of every path: each open cell beside a reached one. A diagonal step from row r ± 1 to row r goes to
// bit t from bit t ∓ 1 (a shift); the two cells beside its corner are bit t of the row it leaves and bit t ∓ 1 of row r.
fn spread() {
  var next: array<u32, 13>;
  for (var r = 0; r < SIDE; r++) {
    let here = reached[r];
    var n = here | (here << 1u) | (here >> 1u);
    if (r > 0) {
      let a = reached[r - 1];
      let w = wallRows[r - 1];
      n |= a | ((a << 1u) & ~(w & (wallRows[r] << 1u))) | ((a >> 1u) & ~(w & (wallRows[r] >> 1u)));
    }
    if (r < SIDE - 1) {
      let a = reached[r + 1];
      let w = wallRows[r + 1];
      n |= a | ((a << 1u) & ~(w & (wallRows[r] << 1u))) | ((a >> 1u) & ~(w & (wallRows[r] >> 1u)));
    }
    next[r] = n & openRows[r];
  }
  reached = next;
}

// The cell of row r and bit b of the square around q.
fn cellOfBit(q: vec2i, r: i32, b: i32) -> vec2i {
  return cellXY(q + vec2i(b - MID, r - MID));
}

// The tube of a sink (ADR 0072): rows of bits over the same square, of the tube cells of the strain (a conductivity
// above 0 after the update), of its ports of this step, and of the tube cells that a path from the cell reaches.
var<private> tubeRows: array<u32, 13>;
var<private> portRows: array<u32, 13>;
var<private> tubeReached: array<u32, 13>;

// The offset d along an axis of `size` cells, on the periodic grid to the nearest copy.
fn offsetOf(d: i32, size: i32) -> i32 {
  if (P.cfg.z != 0u) { return d; }
  let m = ((d % size) + size) % size;
  return select(m, m - size, 2 * m >= size);
}

// Whether the tube of the cell at q carries flux to it, for the strain s: the tube cells of s that a path between
// 4-neighbours over tube cells of s reaches from q, inside the square, include a cell on the edge of the square or a
// port of s. A patch of tube inside the square without a port takes no flux: only the ghost conductance joins it to
// the network (flow.wgsl), and its sinks would pull its pressure down without end. Each round reaches one step
// further, and the rounds end when a round reaches no cell more: at most one round per cell of the square.
fn tubeOut(q: vec2i, s: u32) -> bool {
  for (var r = 0; r < SIDE; r++) {
    tubeRows[r] = 0u;
    portRows[r] = 0u;
    tubeReached[r] = 0u;
  }
  for (var dy = -MID; dy <= MID; dy++) {
    for (var dx = -MID; dx <= MID; dx++) {
      let p = cellXY(q + vec2i(dx, dy));
      if (p.x < 0) { continue; }
      if (textureLoad(memory, p, 0).z > 0.0) { tubeRows[dy + MID] |= 1u << u32(dx + MID); }
    }
  }
  let size = vec2i(i32(W()), i32(H()));
  for (var i = 0u; i < u32(F.d.w); i++) {
    let c = ports[s * 64u + i].x;
    if (c < 0) { continue; }
    let d = vec2i(offsetOf(c % size.x - q.x, size.x), offsetOf(c / size.x - q.y, size.y));
    if (abs(d.x) <= MID && abs(d.y) <= MID) { portRows[d.y + MID] |= 1u << u32(d.x + MID); }
  }
  tubeReached[MID] = 1u << u32(MID);
  let edgeBits = 1u | (1u << u32(SIDE - 1));
  for (var k = 0; k < SIDE * SIDE; k++) {
    var next: array<u32, 13>;
    var grew = false;
    for (var r = 0; r < SIDE; r++) {
      let here = tubeReached[r];
      if ((here & portRows[r]) != 0u) { return true; }
      if (here != 0u && (r == 0 || r == SIDE - 1 || (here & edgeBits) != 0u)) { return true; }
      var n = here | (here << 1u) | (here >> 1u);
      if (r > 0) { n |= tubeReached[r - 1]; }
      if (r < SIDE - 1) { n |= tubeReached[r + 1]; }
      next[r] = n & tubeRows[r];
      if (next[r] != here) { grew = true; }
    }
    if (!grew) { return false; }
    tubeReached = next;
  }
  return false;
}

// The weight of the open cell c at q for the strain s, in steps of the rate: 0 if it is no sink. The caller knows
// that the cell holds a tube of s.
fn sinkWeight(q: vec2i, c: i32, s: u32) -> u32 {
  let mine = 1u << s;
  if ((ownersOf(c) & mine) == 0u) { return 0u; }
  // Room: a free cell of the territory of s that one step reaches.
  load(q, -1, 1);
  reached[MID] = 1u << u32(MID);
  spread();
  var room = false;
  for (var r = MID - 1; r <= MID + 1; r++) {
    for (var b = MID - 1; b <= MID + 1; b++) {
      if ((reached[r] & (1u << u32(b))) == 0u) { continue; }
      let p = cellOfBit(q, r, b);
      if (ownersOf(indexOf(p)) == 0u && inTerritory(p, s)) { room = true; }
    }
  }
  if (!room) { return 0u; }
  // The edge: open ground outside the territory of s that a path of at most `edge` steps reaches.
  let edge = i32(F.sinks.y);
  load(q, 1, edge);
  for (var k = 1; k < edge; k++) { spread(); }
  var atEdge = false;
  for (var r = MID - edge; r <= MID + edge; r++) {
    for (var b = MID - edge; b <= MID + edge; b++) {
      if ((reached[r] & (1u << u32(b))) != 0u && !inTerritory(cellOfBit(q, r, b), s)) { atEdge = true; }
    }
  }
  if (!atEdge) { return 0u; }
  // A tube that carries flux to it (ADR 0072).
  if (!tubeOut(q, s)) { return 0u; }
  // Ground without slime that a path of at most `fresh` steps reaches.
  let fresh = i32(F.sinks.x);
  load(q, edge, fresh);
  for (var k = edge; k < fresh; k++) { spread(); }
  for (var r = MID - fresh; r <= MID + fresh; r++) {
    for (var b = MID - fresh; b <= MID + fresh; b++) {
      if ((reached[r] & (1u << u32(b))) != 0u && !slimeAfter(indexOf(cellOfBit(q, r, b)))) { return RATE_ONE; }
    }
  }
  return u32(F.sinks.w);
}

// One step of the mean of a sink rate toward the weight `goal`, in steps of the rate: a 1 / tau of the way, rounded
// toward it, so the rate reaches it and stays there.
fn toward(old: u32, goal: u32, tau: u32) -> u32 {
  if (goal > old) { return old + (goal - old + tau - 1u) / tau; }
  if (old > goal) { return old - (old - goal + tau - 1u) / tau; }
  return old;
}

// The sums of the workgroup: R, C and N of its cells.
var<workgroup> groupRates: atomic<u32>;
var<workgroup> groupTubes: atomic<u32>;
var<workgroup> groupSinks: atomic<u32>;

@compute @workgroup_size(8, 8)
fn sinks(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32) {
  let s = u32(F.f.z);
  if (gid.x < W() && gid.y < H()) {
    let q = vec2i(gid.xy);
    let c = i32(gid.y * W() + gid.x);
    let i = s * W() * H() + u32(c);
    // Only an open cell holds a tube: the update writes no conductivity elsewhere (flow.wgsl).
    let tube = textureLoad(memory, q, 0).z > 0.0;
    var weight = 0u;
    if (tube) { weight = sinkWeight(q, c, s); }
    let next = toward(u32(abs(rates[i]) * f32(RATE_ONE)), weight, u32(F.sinks.z));
    rates[i] = select(1.0, -1.0, weight > 0u) * f32(next) * (1.0 / f32(RATE_ONE));
    if (tube) {
      atomicAdd(&groupRates, (next + 128u) >> 8u);
      atomicAdd(&groupTubes, 1u);
    }
    if (weight > 0u) { atomicAdd(&groupSinks, 1u); }
  }
  workgroupBarrier();
  if (lane == 0u) {
    // At most 64 cells of 65,536 each: no sum of a workgroup wraps.
    let r = atomicLoad(&groupRates);
    let low = atomicAdd(&sums[s * 4u], r);
    if (low + r < low) { atomicAdd(&sums[s * 4u + 1u], 1u); }
    atomicAdd(&sums[s * 4u + 2u], atomicLoad(&groupTubes));
    atomicAdd(&sums[s * 4u + 3u], atomicLoad(&groupSinks));
  }
}

@compute @workgroup_size(1)
fn state() {
  let s = u32(F.f.z);
  let low = atomicLoad(&sums[s * 4u]);
  let high = atomicLoad(&sums[s * 4u + 1u]);
  let tubes = atomicLoad(&sums[s * 4u + 2u]);
  let count = atomicLoad(&sums[s * 4u + 3u]);
  var covered = 0u;
  for (var i = 0u; i < 64u; i++) {
    if (ports[s * 64u + i].x >= 0) { covered++; }
  }
  // R in the unit of the rate, high · 2^16 + low / 2^16: each part is exact in a float, and each addition rounds once,
  // so every GPU gives the same float.
  let r = (f32(high) * 65536.0 + f32(low >> 16u)) + f32(low & 0xffffu) * (1.0 / 65536.0);
  let takes = count > 0u && (low | high) != 0u && (covered > 0u || tubes > 0u);
  states.lanes[s * 2u] = vec4f(r, f32(tubes), f32(count), f32(covered));
  // The counts of the step (paid.ts PAID_COUNTS): F, K, the respawns that waited and came to life, the deaths of the
  // agent pass, the parents of Jones' rule, the births and the deaths of growth.
  let n = s * 10u;
  let before = states.lanes[s * 2u + 1u];
  var front = before.z;
  if (P.growth.x > 0u && P.grid.w % P.growth.x == 0u) { front = f32(atomicLoad(&states.counts[n])); }
  let claims = atomicLoad(&states.counts[n + 1u]);
  var budget = before.y + f32(i32(atomicLoad(&states.counts[n + 4u])) - i32(atomicLoad(&states.counts[n + 3u])));
  budget += f32(i32(atomicLoad(&states.counts[n + 7u])) - i32(atomicLoad(&states.counts[n + 6u])));
  if (takes) { budget += min(F.take.y * f32(max(1u, covered)), max(0.0, front - budget)); }
  states.lanes[s * 2u + 1u] = vec4f(select(0.0, 1.0, takes), budget, front, f32(claims));
}
