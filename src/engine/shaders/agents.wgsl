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
@group(0) @binding(7) var<storage, read> occ: array<u32>;
@group(0) @binding(8) var<storage, read_write> claims: array<atomic<u32>>;
@group(0) @binding(9) var<storage, read_write> occNext: array<atomic<u32>>;
@group(0) @binding(10) var<uniform> replacement: Agent;

// Separate random streams, so a tool or shrinkage never shifts the steering draws.
const STEER = 0u;
const TOOL = 1u;
const SHRINK = 2u;
const BLOCK = 3u;

var<workgroup> tally: array<atomic<u32>, 4>;

fn index(gid: vec3u, groups: vec3u) -> u32 { return gid.x + gid.y * groups.x * 256u; }

fn habitable(c: i32) -> bool { return c >= 0 && !isWall(env[c]); }

fn wallAt(c: vec2i) -> bool {
  let i = cellAt(c);
  return i >= 0 && isWall(env[i]);
}

// Where a segment passes closer than this to a grid corner (in cells), it touches both cells beside the corner.
const CORNER = 1e-3;

// False if a move from p to q passes through a wall: a supercover walk over every cell the segment enters
// between its start cell and its end cell. The caller checks the end cell. A step longer than a wall is thick
// would otherwise jump it. Skipped while the environment holds no walls.
fn clearPath(p: vec2f, q: vec2f) -> bool {
  if (P.extra.y == 0u) { return true; }
  var c = vec2i(floor(p));
  let end = vec2i(floor(q));
  // The end cell is the start cell or beside it: there is no cell in between.
  if (abs(end.x - c.x) + abs(end.y - c.y) < 2) { return true; }
  let d = q - p;
  let s = vec2i(sign(d));
  let len = length(d);
  // t (0 at p, 1 at q) of the next vertical and horizontal grid line, and t from one line to the next.
  let next = vec2f(c) + select(vec2f(0.0), vec2f(1.0), d > vec2f(0.0));
  var t = select(vec2f(2.0), (next - p) / d, s != vec2i(0));
  let dt = select(vec2f(2.0), 1.0 / abs(d), s != vec2i(0));
  // Every iteration enters one cell toward the end: |Δx| + |Δy| of them, at most 18 for a step of 8.
  for (var k = 0; k < 24; k++) {
    let needX = c.x != end.x;
    let needY = c.y != end.y;
    if (!needX && !needY) { break; }
    if (needX && needY && abs(t.x - t.y) * len < CORNER) {
      if (wallAt(c + vec2i(s.x, 0)) || wallAt(c + vec2i(0, s.y))) { return false; }
      c += s;
      t += dt;
    } else if (needX && (!needY || t.x < t.y)) {
      c.x += s.x;
      t.x += dt.x;
    } else {
      c.y += s.y;
      t.y += dt.y;
    }
    if (any(c != end) && wallAt(c)) { return false; }
  }
  return true;
}

fn sense(p: vec2f, s: u32) -> f32 {
  let c = cellOf(p);
  if (!habitable(c)) { return BLOCKED; }
  let q = cellCoord(u32(c));
  let sc = textureLoad(scent, q, 0).xy;
  return dot(textureLoad(trail, q, 0), P.attraction[s]) + P.food[s] * sc.x - P.light[s] * sc.y;
}

// Sense and rotate (Jones 2010, Fig. 3), then the random turn pCD. Returns the new heading.
fn steer(a: Agent, s: u32, rng: ptr<function, u32>) -> f32 {
  let sa = P.sensorAngle[s];
  let so = P.sensorOffset[s];
  let ra = P.rotationAngle[s];
  let f = sense(a.pos + so * dir(a.heading), s);
  let l = sense(a.pos + so * dir(a.heading - sa), s);
  let r = sense(a.pos + so * dir(a.heading + sa), s);
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

// Tools and shrinkage. Returns false if the agent is dead after this step.
fn lifecycle(a: ptr<function, Agent>, id: u32) -> bool {
  var rng = rngSeed(id, TOOL);
  let s = (*a).bits & 3u;
  var alive = ((*a).bits & ALIVE) != 0u;
  if (P.tool.w == 1.0 && f32(s) == P.tool2.x) {
    // Inoculate: revive dead agents of this strain, or move living ones, into the brush.
    if (rand(&rng) < select(P.tool2.z, P.tool2.y, !alive)) {
      let p = randomIn(P.tool.xy, P.tool.z, &rng);
      if (habitable(cellOf(p))) {
        (*a).pos = wrapPos(p);
        (*a).heading = rand(&rng) * TAU;
        alive = true;
      }
    }
  } else if (P.tool.w == 2.0 && alive && distance((*a).pos, P.tool.xy) < P.tool.z) {
    // Cut: agents in the wound are re-seeded at random outside it (Jones 2010, Sec. 4.3).
    for (var k = 0u; k < 8u; k++) {
      let p = vec2f(rand(&rng) * f32(W()), rand(&rng) * f32(H()));
      if (habitable(cellOf(p)) && distance(p, P.tool.xy) >= P.tool.z) {
        (*a).pos = p;
        break;
      }
    }
  }
  if (alive) {
    var r = rngSeed(id, SHRINK);
    alive = rand(&r) >= P.scent.w;
  }
  (*a).bits = ((*a).bits & ID_BITS) | s | select(0u, ALIVE, alive);
  return alive;
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
    let alive = lifecycle(&a, id);
    if (alive) {
      var rng = rngSeed(id, STEER);
      let h = steer(a, s, &rng);
      let p = a.pos + P.stepSize[s] * dir(h);
      let c = cellOf(p);
      if (habitable(c) && clearPath(a.pos, p)) {
        a.pos = wrapPos(p);
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
fn canClaim(a: Agent, c: i32) -> bool {
  return habitable(c) && c != cellOf(a.pos) && occ[c] == 0u && clearPath(a.pos, destination(a));
}

@compute @workgroup_size(256)
fn claim(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i >= P.grid.z) { return; }
  var a = agents[i];
  let id = agentId(a);
  if (lifecycle(&a, id)) {
    var rng = rngSeed(id, STEER);
    a.heading = steer(a, a.bits & 3u, &rng);
    let c = cellOf(destination(a));
    if (canClaim(a, c)) { atomicMax(&claims[c], key(id)); }
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
    let alive = (a.bits & ALIVE) != 0u;
    if (alive) {
      let p = destination(a);
      let c = cellOf(p);
      // Moving inside the own cell is always allowed; otherwise the claim must have won.
      var ok = habitable(c) && c == cellOf(a.pos);
      if (!ok && canClaim(a, c)) { ok = atomicLoad(&claims[c]) == key(id); }
      if (ok) {
        a.pos = wrapPos(p);
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
