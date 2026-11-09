// Agent passes. Prepended with common.wgsl.
// `advance`: one pass, several agents per cell allowed (Jenson, Fogleman).
// `claim` + `settle`: Jones' one agent per cell, deterministic (ADR 0008).

@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(2) var trail: texture_2d<f32>;
@group(0) @binding(3) var scent: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> env: array<u32>;
@group(0) @binding(5) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> occ: array<u32>;
@group(0) @binding(8) var<storage, read_write> claims: array<atomic<u32>>;
@group(0) @binding(9) var<storage, read_write> occNext: array<atomic<u32>>;

// Separate random streams, so a tool or shrinkage never shifts the steering draws.
const STEER = 0u;
const TOOL = 1u;
const SHRINK = 2u;
const BLOCK = 3u;

var<workgroup> tally: array<atomic<u32>, 4>;

fn index(gid: vec3u, groups: vec3u) -> u32 { return gid.x + gid.y * groups.x * 256u; }

fn habitable(c: i32) -> bool { return c >= 0 && !isWall(env[c]); }

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
fn lifecycle(a: ptr<function, Agent>, i: u32) -> bool {
  var rng = rngSeed(i, TOOL);
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
    var r = rngSeed(i, SHRINK);
    alive = rand(&r) >= P.scent.w;
  }
  (*a).bits = s | select(0u, ALIVE, alive);
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
    let alive = lifecycle(&a, i);
    if (alive) {
      var rng = rngSeed(i, STEER);
      let h = steer(a, s, &rng);
      let p = a.pos + P.stepSize[s] * dir(h);
      let c = cellOf(p);
      if (habitable(c)) {
        a.pos = wrapPos(p);
        a.heading = h;
        atomicAdd(&counts[u32(c) * 4u + s], 1u);
      } else {
        var b = rngSeed(i, BLOCK);
        a.heading = rand(&b) * TAU;
      }
    }
    agents[i] = a;
    count(alive, s);
  }
  flushTally(li);
}

// Unique per step, so claims never tie (pcg is a bijection on u32).
fn key(i: u32) -> u32 { return pcg(i ^ pcg(P.grid.w ^ 0x9e3779b9u ^ P.cfg.x)); }

fn destination(a: Agent) -> vec2f { return a.pos + P.stepSize[a.bits & 3u] * dir(a.heading); }

// A move needs a free target: habitable and empty at the start of the step.
fn canClaim(a: Agent, c: i32) -> bool {
  return habitable(c) && c != cellOf(a.pos) && occ[c] == 0u;
}

@compute @workgroup_size(256)
fn claim(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i >= P.grid.z) { return; }
  var a = agents[i];
  if (lifecycle(&a, i)) {
    var rng = rngSeed(i, STEER);
    a.heading = steer(a, a.bits & 3u, &rng);
    let c = cellOf(destination(a));
    if (canClaim(a, c)) { atomicMax(&claims[c], key(i)); }
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
    let alive = (a.bits & ALIVE) != 0u;
    if (alive) {
      let p = destination(a);
      let c = cellOf(p);
      // Moving inside the own cell is always allowed; otherwise the claim must have won.
      var ok = habitable(c) && c == cellOf(a.pos);
      if (!ok && canClaim(a, c)) { ok = atomicLoad(&claims[c]) == key(i); }
      if (ok) {
        a.pos = wrapPos(p);
        atomicAdd(&counts[u32(c) * 4u + s], 1u);
        atomicAdd(&occNext[c], 1u);
      } else {
        var b = rngSeed(i, BLOCK);
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
