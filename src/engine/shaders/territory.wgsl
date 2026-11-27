// The territory of each strain, the first rule of stage 4 (ADR 0068; ADR 0067, decisions 6 to 9). Prepended with
// common.wgsl. sim.ts runs these passes only while the rules of stage 4 run (territory.ts territoryOn()).
//
// The territory is one byte per cell, with bit s set while the cell lies in the territory of strain s, in a texture of
// 4 cells per texel: cell (x, y) is byte x mod 4 of texel (x / 4, y). It has two copies: a pass reads one and writes the
// other. The owners are one byte per cell in the same form, 4 cells to a word of a buffer: bit s while an alive agent
// of strain s holds the cell.
//
// - `fillOwners`: one invocation per agent, after the moves and the births of a step. The cell of each alive agent
//   gets the bit of its strain.
// - `push`: one invocation per texel, last in a step. A cell joins the territory of strain s when it holds an agent of
//   s. An open cell outside the territory of s joins it with the chance 1 − (1 − v)^n, n the agents of s among its 8
//   neighbours, with a draw of its own for each cell and strain. A diagonal neighbour counts only if the two cells
//   beside the corner between them are not both walls (ADR 0069), as for a move and a birth: the territory reaches no
//   cell that an agent cannot enter. The territory never shrinks.
// - `addDisc`: one invocation per texel. The open cells whose centres lie within a disc join the territory of a strain:
//   the start territory (ADR 0067, decision 4).
// A cell is open when it lies in the arena and is no wall.

@group(0) @binding(1) var<storage, read> agents: array<Agent>;
@group(0) @binding(2) var<storage, read> env: array<u32>;
@group(0) @binding(3) var<storage, read_write> owners: array<atomic<u32>>;
@group(0) @binding(4) var territory: texture_2d<u32>; // the copy that the pass reads
@group(0) @binding(5) var next: texture_storage_2d<r32uint, write>; // the copy that the pass writes

// The uniform block of the flow (flow.wgsl; flow.ts packFlow()): the constants of stage 4 come after the sites
// (territory.ts packTerritory(); ADR 0067, decision 9).
struct FlowRule {
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,
  e: vec4f,
  f: vec4f,
  g: vec4f,
  sites: array<vec4f, 64>,
  push: array<vec4f, 2>, // the chance that n agents push a cell in, for n = 1 to 8 (territory.ts PUSH_CHANCES)
}
@group(0) @binding(6) var<uniform> F: FlowRule;
@group(0) @binding(7) var<uniform> disc: vec4f; // `addDisc`: the centre x, y, the radius, and the strain

// The random stream of the push of strain s: PUSH + 65536 · s (territory.ts PUSH). Streams 0 to 10 belong to the agents,
// and 7 + 65536 · k to the start (init.wgsl).
const PUSH = 11u;

// The owners of cell c as bits, 0 for c = −1.
fn ownersOf(c: i32) -> u32 {
  if (c < 0) { return 0u; }
  return (atomicLoad(&owners[u32(c) >> 2u]) >> (8u * (u32(c) & 3u))) & 0xffu;
}

// Whether the cell at p is a wall; a cell outside a closed arena is none (divideInto in growth.wgsl).
fn wallAt(p: vec2i) -> bool {
  let m = cellAt(p);
  return m >= 0 && isWall(env[m]);
}

@compute @workgroup_size(256)
fn fillOwners(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = gid.x + gid.y * groups.x * 256u;
  if (i >= P.grid.z) { return; }
  let a = agents[i];
  let c = cellOf(a.pos);
  if ((a.bits & ALIVE) == 0u || c < 0) { return; }
  atomicOr(&owners[u32(c) >> 2u], (1u << (a.bits & 3u)) << (8u * (u32(c) & 3u)));
}

// The strains that the push adds to the territory of the open cell c at q: each strain s outside `held` with n > 0
// agents among the 8 neighbours of the cell joins it with the chance of n. A neighbour outside a closed arena holds
// no agent, and a diagonal one between two walls does not count.
fn pushed(q: vec2i, c: i32, held: u32) -> u32 {
  var n = vec4u(0u);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      if (dx != 0 && dy != 0 && wallAt(q + vec2i(dx, 0)) && wallAt(q + vec2i(0, dy))) { continue; }
      let b = ownersOf(cellAt(q + vec2i(dx, dy)));
      n += vec4u(b & 1u, (b >> 1u) & 1u, (b >> 2u) & 1u, (b >> 3u) & 1u);
    }
  }
  var joined = 0u;
  for (var s = 0u; s < 4u; s++) {
    if ((held & (1u << s)) != 0u || n[s] == 0u) { continue; }
    var rng = rngSeed(u32(c), PUSH + 0x10000u * s);
    let k = n[s] - 1u;
    if (rand(&rng) < F.push[k >> 2u][k & 3u]) { joined |= 1u << s; }
  }
  return joined;
}

@compute @workgroup_size(8, 8)
fn push(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= (W() + 3u) / 4u || gid.y >= H()) { return; }
  let held = textureLoad(territory, vec2i(gid.xy), 0).x;
  var out = 0u;
  for (var k = 0u; k < 4u; k++) {
    let x = gid.x * 4u + k;
    if (x >= W()) { break; }
    let q = vec2i(i32(x), i32(gid.y));
    // A cell outside the dish keeps its byte: 0.
    let c = indexOf(cellXY(q));
    var bits = (held >> (8u * k)) & 0xffu;
    if (c >= 0) {
      bits |= ownersOf(c);
      if (!isWall(env[c])) { bits |= pushed(q, c, bits); }
    }
    out |= bits << (8u * k);
  }
  textureStore(next, vec2i(gid.xy), vec4u(out, 0u, 0u, 0u));
}

@compute @workgroup_size(8, 8)
fn addDisc(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= (W() + 3u) / 4u || gid.y >= H()) { return; }
  var out = textureLoad(territory, vec2i(gid.xy), 0).x;
  for (var k = 0u; k < 4u; k++) {
    let x = gid.x * 4u + k;
    if (x >= W()) { break; }
    let q = vec2i(i32(x), i32(gid.y));
    let c = indexOf(cellXY(q));
    if (c >= 0 && !isWall(env[c]) && toolDistance(vec2f(q) + 0.5, disc.xy) <= disc.z) {
      out |= (1u << u32(disc.w)) << (8u * k);
    }
  }
  textureStore(next, vec2i(gid.xy), vec4u(out, 0u, 0u, 0u));
}
