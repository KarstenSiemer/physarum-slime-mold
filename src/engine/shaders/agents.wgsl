// Agent passes. Prepended with common.wgsl.
// `advance`: one pass, several agents per cell allowed (Jenson, Fogleman).
// `claim` + `settle`: Jones' one agent per cell, deterministic (ADR 0008).
// The buffer is sorted by position now and then (sort.wgsl): `i` is only the slot, `id` names the agent.

@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(2) var trail: texture_2d<f32>;
@group(0) @binding(3) var scent: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> env: array<u32>;
@group(0) @binding(5) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> occ: array<u32>; // agents per cell at the start of the step (the rule)
@group(0) @binding(8) var<storage, read_write> claims: array<atomic<u32>>;
@group(0) @binding(9) var<storage, read_write> occNext: array<atomic<u32>>;
@group(0) @binding(10) var<uniform> replacement: Agent;
@group(0) @binding(11) var<storage, read> clearance: array<u32>; // per clearance tile (walls.wgsl)

// Sensors check the cells between the agent and the sensor for walls (ADR 0020): sim.ts builds `advance` and `claim`
// with the check for an environment that may hold walls, and without it otherwise. The check alone, never run, changes
// how the compiler rounds the sensor positions, so a pass built with it would not give the agents and trail of the
// code before it, bit for bit, where no wall was painted (sim.gpu.test.ts).
override SENSE_WALLS: bool = false;

// Separate random streams, so a tool or shrinkage never shifts the steering draws.
const STEER = 0u;
const TOOL = 1u;
const SHRINK = 2u;
const BLOCK = 3u;

var<workgroup> tally: array<atomic<u32>, 4>;

fn index(gid: vec3u, groups: vec3u) -> u32 { return gid.x + gid.y * groups.x * 256u; }

fn habitable(c: i32) -> bool { return c >= 0 && !isWall(env[c]); }

// A wall at w, a cell that a walk enters, wrapped into the periodic grid. A cell outside a closed arena is never a
// wall: cellAt() gives it no index.
fn wallIn(w: vec2i) -> bool {
  let size = vec2i(i32(W()), i32(H()));
  if (any(w < vec2i(0)) || any(w >= size)) { return false; }
  if (!isWall(env[w.y * size.x + w.x])) { return false; }
  return P.cfg.z != 2u || distance(vec2f(w) + 0.5, 0.5 * vec2f(size)) <= dishRadius();
}

// The next cell along an axis of n cells: around the periodic grid, or past the edge of a closed arena.
fn stepAxis(v: i32, s: i32, n: i32) -> i32 {
  let u = v + s;
  if (P.cfg.z != 0u) { return u; }
  return select(select(u, u - n, u >= n), u + n, u < 0);
}

// Where a segment passes closer than this to a grid corner (in cells), it touches both cells beside the corner.
const CORNER = 1e-3;

// The most cells a walk enters. A segment with sides dx and dy enters fewer than |dx| + |dy| + 2 cells. A sensor of
// the longest sensor distance (64 cells, src/model/params.ts) enters up to floor(64 · √2) + 2 = 92, a move of the
// longest step (8 cells) up to 13. WALK in agents.frag is the same; pack.test.ts checks both against params.ts.
const WALK = 92;

// The clearance of the tile that holds the cell of p (walls.wgsl): no wall lies closer to that cell. 0 outside a
// closed arena. Read once per agent and pass, and only while the environment may hold walls.
fn clearanceAt(p: vec2f) -> i32 {
  if (P.extra.y == 0u) { return 0; }
  let c = cellOf(p);
  if (c < 0) { return 0; }
  let t = cellCoord(u32(c)) / CLEAR_TILE;
  return i32(clearance[t.y * ((i32(W()) + CLEAR_TILE - 1) / CLEAR_TILE) + t.x]);
}

// False if the segment from p to q passes through a wall: a supercover walk over every cell the segment enters
// between its start cell and its end cell. The caller checks the end cell. Moves and sensors use it (ADR 0019,
// ADR 0020): a step longer than a wall is thick would jump it, and a sensor would read the trail behind it. Every
// cell of the walk lies at most max(|Δx|, |Δy|) cells from the start cell (Chebyshev distance), so below `clear`, the
// start cell's clearance (clearanceAt()), the walk cannot meet a wall. Skipped while the environment holds no walls.
fn clearPath(p: vec2f, q: vec2f, clear: i32) -> bool {
  if (P.extra.y == 0u) { return true; }
  var c = vec2i(floor(p));
  let end = vec2i(floor(q));
  let span = abs(end - c);
  // The end cell is the start cell or beside it, so there is no cell in between, or no wall is near enough.
  if (span.x + span.y < 2 || max(span.x, span.y) < clear) { return true; }
  let d = q - p;
  let s = vec2i(sign(d));
  let len = length(d);
  // t (0 at p, 1 at q) of the next vertical and horizontal grid line, and t from one line to the next.
  let next = vec2f(c) + select(vec2f(0.0), vec2f(1.0), d > vec2f(0.0));
  var t = select(vec2f(2.0), (next - p) / d, s != vec2i(0));
  let dt = select(vec2f(2.0), 1.0 / abs(d), s != vec2i(0));
  // w is c wrapped into the periodic grid, kept step by step, so that the walk does not divide.
  let size = vec2i(i32(W()), i32(H()));
  var w = select(c, ((c % size) + size) % size, P.cfg.z == 0u);
  // Every iteration enters one cell toward the end, or at a corner checks the two cells beside it and enters the
  // cell past it.
  for (var k = 0; k < WALK; k++) {
    let needX = c.x != end.x;
    let needY = c.y != end.y;
    if (!needX && !needY) { break; }
    if (needX && needY && abs(t.x - t.y) * len < CORNER) {
      let wx = stepAxis(w.x, s.x, size.x);
      let wy = stepAxis(w.y, s.y, size.y);
      if (wallIn(vec2i(wx, w.y)) || wallIn(vec2i(w.x, wy))) { return false; }
      c += s;
      w = vec2i(wx, wy);
      t += dt;
    } else if (needX && (!needY || t.x < t.y)) {
      c.x += s.x;
      w.x = stepAxis(w.x, s.x, size.x);
      t.x += dt.x;
    } else {
      c.y += s.y;
      w.y = stepAxis(w.y, s.y, size.y);
      t.y += dt.y;
    }
    if (any(c != end) && wallIn(w)) { return false; }
  }
  return true;
}

// What the sensor at p of an agent at pos reads for strain s. A wall, a cell outside a closed arena and a wall
// between the agent and the sensor read BLOCKED (ADR 0020). `clear` is the agent's clearance (clearPath).
fn sense(pos: vec2f, p: vec2f, s: u32, clear: i32) -> f32 {
  let c = cellOf(p);
  if (!habitable(c) || (SENSE_WALLS && !clearPath(pos, p, clear))) { return BLOCKED; }
  let q = cellCoord(u32(c));
  let sc = textureLoad(scent, q, 0).xy;
  return dot(textureLoad(trail, q, 0), P.attraction[s]) + P.food[s] * sc.x - P.light[s] * sc.y;
}

// Sense and rotate (Jones 2010, Fig. 3), then the random turn pCD. Returns the new heading.
fn steer(a: Agent, s: u32, rng: ptr<function, u32>, clear: i32) -> f32 {
  let sa = P.sensorAngle[s];
  let so = P.sensorOffset[s];
  let ra = P.rotationAngle[s];
  let f = sense(a.pos, a.pos + so * dir(a.heading), s, clear);
  let l = sense(a.pos, a.pos + so * dir(a.heading - sa), s, clear);
  let r = sense(a.pos, a.pos + so * dir(a.heading + sa), s, clear);
  var h = a.heading;
  if (f > l && f > r) {
    // keep heading
  } else if (f < l && f < r) {
    h += select(-ra, ra, rand(rng) < 0.5);
  } else if (l < r) {
    h += ra;
  } else if (r < l) {
    h -= ra;
  }
  if (rand(rng) < P.randomTurn[s]) {
    h = rand(rng) * TAU;
  }
  return h - TAU * floor(h / TAU);
}

fn randomIn(center: vec2f, radius: f32, rng: ptr<function, u32>) -> vec2f {
  return center + radius * sqrt(rand(rng)) * dir(rand(rng) * TAU);
}

// Shrinkage: an agent alive at the start of the step dies with the shrink probability. Returns false if it is dead.
fn shrinkage(a: ptr<function, Agent>, id: u32) -> bool {
  var alive = ((*a).bits & ALIVE) != 0u;
  if (alive) {
    var r = rngSeed(id, SHRINK);
    alive = rand(&r) >= P.scent.w;
  }
  (*a).bits = ((*a).bits & ~ALIVE) | select(0u, ALIVE, alive);
  return alive;
}

// Where a tool puts an agent in this step (ADR 0023): a position, its heading and its cell, or cell −1 for none.
struct Spot {
  pos: vec2f,
  heading: f32,
  cell: i32,
}

// A cell a tool may put an agent in: habitable, and with the rule empty at the start of the step (ADR 0008). Only
// the rule reads `occ`, which `advance` binds but never reads.
fn openCell(c: i32) -> bool { return habitable(c) && (P.cfg.w == 0u || occ[c] == 0u); }

// Inoculate takes a dead agent of the tool's strain, with the chance P.tool2.y, to a random point of the brush, and
// never a living one. Cut takes a living agent in the wound to the first of 8 random points outside it whose cell
// is open (Jones 2010, Sec. 4.3). After shrinkage, so a pure function of the agent as `claim` leaves it, the
// parameters, `env` and `occ`: `claim` and `settle` find the same spot. With the rule the agent claims the cell like
// a move (`claim`), and only the winner goes there (`settle`).
fn placement(a: Agent, id: u32) -> Spot {
  if (P.tool.w == 0.0) { return Spot(a.pos, a.heading, -1); } // no tool held: the usual step
  var rng = rngSeed(id, TOOL);
  let alive = (a.bits & ALIVE) != 0u;
  if (P.tool.w == 1.0 && !alive && f32(a.bits & 3u) == P.tool2.x && rand(&rng) < P.tool2.y) {
    let p = randomIn(P.tool.xy, P.tool.z, &rng);
    let c = cellOf(p);
    if (openCell(c)) { return Spot(landed(p, c), rand(&rng) * TAU, c); }
  } else if (P.tool.w == 2.0 && alive && distance(a.pos, P.tool.xy) < P.tool.z) {
    for (var k = 0u; k < 8u; k++) {
      let p = vec2f(rand(&rng) * f32(W()), rand(&rng) * f32(H()));
      let c = cellOf(p);
      if (openCell(c) && distance(p, P.tool.xy) >= P.tool.z) { return Spot(landed(p, c), a.heading, c); }
    }
  }
  return Spot(a.pos, a.heading, -1);
}

fn count(alive: bool, s: u32) {
  if (alive) { atomicAdd(&tally[s], 1u); }
}

fn flushTally(li: u32) {
  workgroupBarrier();
  if (li < 4u) { atomicAdd(&stats[li], atomicLoad(&tally[li])); }
}

@compute @workgroup_size(256)
fn advance(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u,
        @builtin(local_invocation_index) li: u32) {
  let i = index(gid, groups);
  if (i < P.grid.z) {
    var a = agents[i];
    let s = a.bits & 3u;
    let id = agentId(a);
    var alive = shrinkage(&a, id);
    let spot = placement(a, id);
    if (spot.cell >= 0) {
      // A tool puts the agent here instead of its move: it deposits nothing in this step.
      a.pos = spot.pos;
      a.heading = spot.heading;
      a.bits |= ALIVE;
      alive = true;
    } else if (alive) {
      var rng = rngSeed(id, STEER);
      let clear = clearanceAt(a.pos);
      let h = steer(a, s, &rng, clear);
      let p = a.pos + P.stepSize[s] * dir(h);
      let c = cellOf(p);
      if (habitable(c) && clearPath(a.pos, p, clear)) {
        a.pos = landed(p, c);
        a.heading = h;
        atomicAdd(&counts[u32(c) * 4u + s], 1u);
      } else {
        var b = rngSeed(id, BLOCK);
        a.heading = rand(&b) * TAU;
      }
    }
    agents[i] = a;
    count(alive, s);
  }
  flushTally(li);
}

// Unique per step, so claims never tie (pcg is a bijection on u32 and ids are unique).
fn key(id: u32) -> u32 { return pcg(id ^ pcg(P.grid.w ^ 0x9e3779b9u ^ P.cfg.x)); }

fn destination(a: Agent) -> vec2f { return a.pos + P.stepSize[a.bits & 3u] * dir(a.heading); }

// A move needs a free target: habitable, empty at the start of the step, and no wall on the way.
fn canClaim(a: Agent, c: i32, clear: i32) -> bool {
  return habitable(c) && c != cellOf(a.pos) && occ[c] == 0u && clearPath(a.pos, destination(a), clear);
}

@compute @workgroup_size(256)
fn claim(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i >= P.grid.z) { return; }
  var a = agents[i];
  let id = agentId(a);
  let alive = shrinkage(&a, id);
  let spot = placement(a, id);
  if (spot.cell >= 0) {
    // A tool's spot is claimed like a move; the agent stays as it is until `settle`.
    atomicMax(&claims[spot.cell], key(id));
  } else if (alive) {
    var rng = rngSeed(id, STEER);
    let clear = clearanceAt(a.pos);
    a.heading = steer(a, a.bits & 3u, &rng, clear);
    let c = cellOf(destination(a));
    if (canClaim(a, c, clear)) { atomicMax(&claims[c], key(id)); }
  }
  agents[i] = a;
}

@compute @workgroup_size(256)
fn settle(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u,
          @builtin(local_invocation_index) li: u32) {
  let i = index(gid, groups);
  if (i < P.grid.z) {
    var a = agents[i];
    let s = a.bits & 3u;
    let id = agentId(a);
    var alive = (a.bits & ALIVE) != 0u;
    let spot = placement(a, id);
    if (spot.cell >= 0) {
      // The winner of the spot's cell goes there. A loser stays as it is: dead (inoculate), or where it was (cut).
      if (atomicLoad(&claims[spot.cell]) == key(id)) {
        a.pos = spot.pos;
        a.heading = spot.heading;
        a.bits |= ALIVE;
        alive = true;
        atomicAdd(&occNext[spot.cell], 1u);
      } else if (alive) {
        let here = cellOf(a.pos);
        if (here >= 0) { atomicAdd(&occNext[here], 1u); }
      }
      agents[i] = a;
    } else if (alive) {
      let p = destination(a);
      let c = cellOf(p);
      // Moving inside the own cell is always allowed; otherwise the claim must have won.
      var ok = habitable(c) && c == cellOf(a.pos);
      if (!ok && canClaim(a, c, clearanceAt(a.pos))) { ok = atomicLoad(&claims[c]) == key(id); }
      if (ok) {
        a.pos = landed(p, c);
        atomicAdd(&counts[u32(c) * 4u + s], 1u);
        atomicAdd(&occNext[c], 1u);
      } else {
        var b = rngSeed(id, BLOCK);
        a.heading = rand(&b) * TAU;
        let here = cellOf(a.pos);
        if (here >= 0) { atomicAdd(&occNext[here], 1u); }
      }
      agents[i] = a;
    }
    count(alive, s);
  }
  flushTally(li);
}

// Rebuilds occupancy from positions (after init or when collisions are switched on).
@compute @workgroup_size(256)
fn occupy(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i >= P.grid.z) { return; }
  let a = agents[i];
  let c = cellOf(a.pos);
  if ((a.bits & ALIVE) != 0u && c >= 0) { atomicAdd(&occNext[c], 1u); }
}

// Sim.writeAgent: replaces the agent whose id the replacement carries, wherever the sort has put it.
@compute @workgroup_size(256)
fn replace(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i < P.grid.z && agentId(agents[i]) == agentId(replacement)) { agents[i] = replacement; }
}
