// Growth and shrinkage of the population (Jones 2011, Nat. Comput. 10: 1345, Sec. 5.1; ADR 0025). Prepended with
// common.wgsl. sim.ts runs these passes after the moves of a step that tests growth or shrinkage, and only while
// growth is on: a step without them runs the passes of the code before.
//
// - `rowSums`, `windowSums`: the agents in the growth and the shrinkage window around every cell, a separable box sum
//   of the occupancy after the moves. Each count includes the cell's own agent (ADR 0024, decision 6).
// - `test`: shrinkage deletes an agent whose count lies outside [Smin, Smax]. A survivor that moved and whose growth
//   count lies in [Gmin, Gmax] picks a random empty cell of its 3 × 3 neighbourhood, but no diagonal one between two
//   walls that touch at a corner, and claims it with the unique key of the step, as a move claims its cell (ADR 0008).
// - `win`: the winner of each claimed cell writes a birth there; every agent writes whether it is dead, by its id.
// - `buildCells`, `buildDead`: two pyramids of sums with a fan-in of 4, over the births (one lane per strain) and over
//   the dead agents.
// - `birth`: the dead agent with rank r among the dead agents of strain s takes the birth with rank r of strain s:
//   one agent per birth, and no birth without a dead agent. Then every agent counts into the occupancy of the next
//   step and into the alive count of the stats.
// Every pass reads ids, never the slots that the sort changes (ADR 0005), so a run gives the same bits every time.

@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(2) var<storage, read> env: array<u32>;
@group(0) @binding(3) var<storage, read> occ: array<u32>; // agents per cell after this step's moves
@group(0) @binding(4) var<storage, read> counts: array<vec4u>; // moves into each cell in this step, per strain
@group(0) @binding(5) var<storage, read_write> rows: array<vec2u>; // row sums of `occ`: growth, shrinkage window
@group(0) @binding(6) var<storage, read_write> windows: array<vec2u>; // window counts: growth, shrinkage
@group(0) @binding(7) var<storage, read_write> claims: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> births: array<vec2u>; // by position (place()): strain + 1, cell
@group(0) @binding(9) var<storage, read_write> cellSums: array<vec4u>; // levels 1 and up over `births`
@group(0) @binding(10) var<storage, read_write> dead: array<u32>; // by id: 1 for a dead agent
@group(0) @binding(11) var<storage, read_write> deadSums: array<u32>; // levels 1 and up over `dead`
@group(0) @binding(12) var<storage, read_write> occNext: array<atomic<u32>>; // agents per cell after this step
@group(0) @binding(13) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(14) var<uniform> level: vec4u; // x: the pyramid level that a build pass writes
//#if FLOW

// Flow in the tubes (ADR 0029, flow.wgsl). The lines between `//#if FLOW` and `//#endif` are part of the source only
// while the flow is on (variant.ts); without them the source is the one of the code before, character for character.
// An agent on a cell that the flux of its strain passed by does not divide: the flow supplies no plasm for a child
// there. Every strain has a flow of its own (ADR 0031): a layer of `flowMemory`.
struct FlowRule {
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,
  e: vec4f, // y: half², the square of the flow memory below which an agent does not divide
}
@group(0) @binding(15) var flowMemory: texture_2d_array<f32>; // a layer per strain: x flow memory, of the step before
@group(0) @binding(16) var<uniform> F: FlowRule;
//#endif

// Random streams of their own (STEER 0 to BLOCK 3 in agents.wgsl), so growth never shifts the other draws.
const GROW = 4u; // the cell that a parent divides into
const BIRTH = 5u; // the position of a child in its cell, and its heading
const PLACE_ORDER = 6u; // the order of the births (place())

fn index(gid: vec3u, groups: vec3u) -> u32 { return gid.x + gid.y * groups.x * 256u; }

fn growthTest() -> bool { return P.growth.x > 0u && P.grid.w % P.growth.x == 0u; }
fn shrinkTest() -> bool { return P.shrinkage.x > 0u && P.grid.w % P.shrinkage.x == 0u; }

// A cell of the grid's rectangle for the box sums: wrapped on the periodic grid, −1 outside a box or a dish's grid.
// Cells outside the dish lie in the rectangle and hold no agent, so a window counts the agents of the dish.
fn gridCell(c: vec2i) -> i32 {
  let size = vec2i(i32(W()), i32(H()));
  var q = c;
  if (P.cfg.z == 0u) {
    q = wrapCell(c, size);
  } else if (any(c < vec2i(0)) || any(c >= size)) {
    return -1;
  }
  return q.y * size.x + q.x;
}

// The agents in the row of cell c within the half-width of each window. A window is at most 15 cells, a grid side
// at least 16 (sizing.ts gridSize()), so a periodic window never counts a cell twice.
@compute @workgroup_size(256)
fn rowSums(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let c = index(gid, groups);
  if (c >= W() * H()) { return; }
  let q = cellCoord(c);
  let rg = i32(P.growth.y / 2u);
  let rs = i32(P.shrinkage.y / 2u);
  var sum = vec2u(0u);
  for (var d = -max(rg, rs); d <= max(rg, rs); d++) {
    let n = gridCell(q + vec2i(d, 0));
    if (n < 0) { continue; }
    let v = occ[n];
    if (abs(d) <= rg) { sum.x += v; }
    if (abs(d) <= rs) { sum.y += v; }
  }
  rows[c] = sum;
}

// The agents in the growth and the shrinkage window around cell c: the row sums of the rows within the half-widths.
@compute @workgroup_size(256)
fn windowSums(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let c = index(gid, groups);
  if (c >= W() * H()) { return; }
  let q = cellCoord(c);
  let rg = i32(P.growth.y / 2u);
  let rs = i32(P.shrinkage.y / 2u);
  var sum = vec2u(0u);
  for (var d = -max(rg, rs); d <= max(rg, rs); d++) {
    let n = gridCell(q + vec2i(0, d));
    if (n < 0) { continue; }
    let v = rows[n];
    if (abs(d) <= rg) { sum.x += v.x; }
    if (abs(d) <= rs) { sum.y += v.y; }
  }
  windows[c] = sum;
}

// Unique per step, so claims never tie: the key of a move (agents.wgsl key()).
fn key(id: u32) -> u32 { return pcg(id ^ pcg(P.grid.w ^ 0x9e3779b9u ^ P.cfg.x)); }

// Neighbour k of 8 around a cell, in rows from the top left; the cell itself is skipped.
fn around(k: u32) -> vec2i {
  let j = i32(k + select(0u, 1u, k >= 4u));
  return vec2i(j % 3 - 1, j / 3 - 1);
}

// The number k of the neighbour at offset o ≠ (0, 0): around(k) is o.
fn aroundIndex(o: vec2i) -> u32 {
  let j = u32((o.y + 1) * 3 + o.x + 1);
  return j - select(0u, 1u, j > 4u);
}

// The cell that a living agent in cell c divides into in this step, or −1. It divides on a growth test step if it
// moved in this step and its growth count lies in [Gmin, Gmax], into a random cell of its 3 × 3 neighbourhood that
// is habitable and empty after the moves (Jones 2011, Sec. 5.1: "if there is an empty location in the immediate
// neighbourhood"). A pure function of the agent, the counts and the occupancy, so `test` and `win` agree.
// A diagonal neighbour counts only if the two cells beside the corner between it and cell c are not both walls
// (ADR 0025, amendment of 2026-11-13): then a move from cell c can reach it through the free one of them, and with
// two walls no move can (clearPath and CORNER in agents.wgsl). A cell outside a closed arena is no wall there, as for
// a move (wallIn in agents.wgsl).
fn divideInto(a: Agent, c: i32) -> i32 {
  let s = a.bits & 3u;
  let n = windows[c].x;
  if (!growthTest() || counts[c][s] == 0u || n < P.growth.z || n > P.growth.w) { return -1; }
  let q = cellCoord(u32(c));
//#if FLOW
  let memory = textureLoad(flowMemory, q, s, 0).x;
  if (memory * memory < F.e.y) { return -1; }
//#endif
  // Bit k of `open`: neighbour k is habitable and empty. Bit k of `walls`: neighbour k is a wall.
  var open = 0u;
  var walls = 0u;
  for (var k = 0u; k < 8u; k++) {
    let m = cellAt(q + around(k));
    if (m < 0) { continue; }
    if (isWall(env[m])) {
      walls |= 1u << k;
    } else if (occ[m] == 0u) {
      open |= 1u << k;
    }
  }
  for (var k = 0u; k < 8u; k++) {
    let o = around(k);
    if (o.x == 0 || o.y == 0) { continue; }
    let beside = (1u << aroundIndex(vec2i(o.x, 0))) | (1u << aroundIndex(vec2i(0, o.y)));
    if ((walls & beside) == beside) { open &= ~(1u << k); }
  }
  let free = countOneBits(open);
  if (free == 0u) { return -1; }
  var rng = rngSeed(agentId(a), GROW);
  var pick = min(u32(rand(&rng) * f32(free)), free - 1u);
  for (var k = 0u; k < 8u; k++) {
    if ((open & (1u << k)) != 0u) {
      if (pick == 0u) { return cellAt(q + around(k)); }
      pick--;
    }
  }
  return -1;
}

@compute @workgroup_size(256)
fn test(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i >= P.grid.z) { return; }
  var a = agents[i];
  let c = cellOf(a.pos);
  if ((a.bits & ALIVE) == 0u || c < 0) { return; }
  if (shrinkTest()) {
    let n = windows[c].y;
    if (n < P.shrinkage.z || n > P.shrinkage.w) {
      a.bits &= ~ALIVE;
      agents[i] = a;
      return;
    }
  }
  let t = divideInto(a, c);
  if (t >= 0) { atomicMax(&claims[t], key(agentId(a))); }
}

// A bijection of the cells (a Feistel network on the rectangle, new for every step), the order in which births find
// their dead agents. When the dead agents run out, the births that get one are spread over the grid, and not the
// first ones in rows from the top.
fn place(c: u32) -> u32 {
  var x = c % W();
  var y = c / W();
  var k = pcg(P.grid.w ^ pcg(P.cfg.x ^ PLACE_ORDER));
  for (var r = 0u; r < 2u; r++) {
    x = (x + pcg(y ^ k) % W()) % W();
    k = pcg(k);
    y = (y + pcg(x ^ k) % H()) % H();
    k = pcg(k);
  }
  return y * W() + x;
}

@compute @workgroup_size(256)
fn win(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i >= P.grid.z) { return; }
  let a = agents[i];
  let id = agentId(a);
  let alive = (a.bits & ALIVE) != 0u;
  dead[id] = select(1u, 0u, alive);
  let c = cellOf(a.pos);
  if (!alive || c < 0) { return; }
  let t = divideInto(a, c);
  // Only the winner of cell t writes there.
  if (t >= 0 && atomicLoad(&claims[t]) == key(id)) { births[place(u32(t))] = vec2u((a.bits & 3u) + 1u, u32(t)); }
}

// Nodes in level k of a pyramid over n elements: each node sums 4 nodes of the level below.
fn levelSize(n: u32, k: u32) -> u32 {
  var m = n;
  for (var j = 0u; j < k; j++) { m = (m + 3u) / 4u; }
  return m;
}

// Where level k ≥ 1 starts in its buffer of sums: after levels 1 to k − 1.
fn levelStart(n: u32, k: u32) -> u32 {
  var m = n;
  var start = 0u;
  for (var j = 1u; j < k; j++) {
    m = (m + 3u) / 4u;
    start += m;
  }
  return start;
}

// The top level of a pyramid over n elements: its only node sums them all.
fn topLevel(n: u32) -> u32 {
  var k = 1u;
  while (levelSize(n, k) > 1u) { k++; }
  return k;
}

fn birthLanes(b: vec2u) -> vec4u { return vec4u(vec4u(b.x) == vec4u(1u, 2u, 3u, 4u)); }

// Node e of level k of the pyramid over the births: a count per strain.
fn cellNode(k: u32, e: u32) -> vec4u {
  if (k == 0u) { return birthLanes(births[e]); }
  return cellSums[levelStart(W() * H(), k) + e];
}

fn deadNode(k: u32, e: u32) -> u32 {
  if (k == 0u) { return dead[e]; }
  return deadSums[levelStart(P.grid.z, k) + e];
}

@compute @workgroup_size(256)
fn buildCells(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let j = index(gid, groups);
  let n = W() * H();
  let k = level.x;
  if (j >= levelSize(n, k)) { return; }
  let below = levelSize(n, k - 1u);
  var sum = vec4u(0u);
  for (var e = 4u * j; e < min(4u * j + 4u, below); e++) { sum += cellNode(k - 1u, e); }
  cellSums[levelStart(n, k) + j] = sum;
}

@compute @workgroup_size(256)
fn buildDead(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let j = index(gid, groups);
  let n = P.grid.z;
  let k = level.x;
  if (j >= levelSize(n, k)) { return; }
  let below = levelSize(n, k - 1u);
  var sum = 0u;
  for (var e = 4u * j; e < min(4u * j + 4u, below); e++) { sum += deadNode(k - 1u, e); }
  deadSums[levelStart(n, k) + j] = sum;
}

// The dead agents with an id below x: at every level, the nodes before x's own node in their parent.
fn deadBefore(x: u32) -> u32 {
  let n = P.grid.z;
  let top = topLevel(n);
  if (x >= n) { return deadNode(top, 0u); }
  var sum = 0u;
  var j = x;
  for (var k = 0u; k < top; k++) {
    for (var e = j & ~3u; e < j; e++) { sum += deadNode(k, e); }
    j = j >> 2u;
  }
  return sum;
}

// The position of the birth with rank r of strain s (r below the strain's births): down from the top, into the
// child whose count holds r.
fn findBirth(s: u32, r0: u32) -> u32 {
  let n = W() * H();
  var r = r0;
  var j = 0u;
  for (var k = topLevel(n); k > 0u; k--) {
    let below = levelSize(n, k - 1u);
    var e = 4u * j;
    loop {
      let v = cellNode(k - 1u, e)[s];
      if (r < v || e + 1u >= min(4u * j + 4u, below)) { break; }
      r -= v;
      e++;
    }
    j = e;
  }
  return j;
}

// Inside cell c at offset f in [0, 1]², below c + 1 (inCell in init.wgsl).
fn inCell(c: vec2i, f: vec2f) -> vec2f {
  let lo = vec2f(c);
  let hi = bitcast<vec2f>(bitcast<vec2u>(lo + 1.0) - 1u);
  return clamp(lo + f, lo, hi);
}

var<workgroup> tally: array<atomic<u32>, 4>;

@compute @workgroup_size(256)
fn birth(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u,
         @builtin(local_invocation_index) li: u32) {
  let i = index(gid, groups);
  if (i < P.grid.z) {
    var a = agents[i];
    let s = a.bits & 3u;
    var alive = (a.bits & ALIVE) != 0u;
    if (!alive && growthTest()) {
      let id = agentId(a);
      let first = select(0u, P.strainEnd[max(s, 1u) - 1u], s > 0u);
      let r = deadBefore(id) - deadBefore(first);
      if (r < cellNode(topLevel(W() * H()), 0u)[s]) {
        // A child of strain s: a random position in its cell and a random heading, which Jones does not state. It
        // spends this step on its birth and deposits nothing.
        let t = births[findBirth(s, r)].y;
        var rng = rngSeed(id, BIRTH);
        let fx = rand(&rng);
        let fy = rand(&rng);
        a.pos = inCell(cellCoord(t), vec2f(fx, fy));
        a.heading = rand(&rng) * TAU;
        a.bits |= ALIVE;
        alive = true;
        agents[i] = a;
      }
    }
    let c = cellOf(a.pos);
    if (alive && c >= 0) { atomicAdd(&occNext[c], 1u); }
    if (alive) { atomicAdd(&tally[s], 1u); }
  }
  workgroupBarrier();
  if (li < 4u) { atomicAdd(&stats[li], atomicLoad(&tally[li])); }
}
