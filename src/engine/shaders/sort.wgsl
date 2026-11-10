// Spatial sort of the agent buffer by 8 × 8 tiles of their cell (ADR 0005). Prepended with common.wgsl.
// Agents are processed in buffer order. Once the network spreads over the grid, unsorted agents read
// trail, scent and environment from all over it, and nearly every read misses the cache. A counting
// sort every few steps keeps buffer neighbours near each other on the grid. It writes into the other
// agent buffer (ping-pong, sim.ts). The model does not see the order: random streams and collision keys
// follow the agent id (common.wgsl), and deposits are integer sums.

@group(0) @binding(1) var<storage, read> agentsIn: array<Agent>;
@group(0) @binding(2) var<storage, read_write> agentsOut: array<Agent>;
@group(0) @binding(3) var<storage, read_write> tiles: array<atomic<u32>>; // counts, then offsets, then cursors

const SHIFT = 3u; // 8 × 8 cells per tile

fn slot(gid: vec3u, groups: vec3u) -> u32 { return gid.x + gid.y * groups.x * 256u; }

fn tilesX() -> u32 { return (W() + 7u) >> SHIFT; }
fn tileCount() -> u32 { return tilesX() * ((H() + 7u) >> SHIFT); }

// Clamped, so any position (also of a dead agent) has a tile.
fn tileOf(p: vec2f) -> u32 {
  let x = min(u32(max(p.x, 0.0)), W() - 1u);
  let y = min(u32(max(p.y, 0.0)), H() - 1u);
  return (y >> SHIFT) * tilesX() + (x >> SHIFT);
}

@compute @workgroup_size(256)
fn countTiles(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = slot(gid, groups);
  if (i >= P.grid.z) { return; }
  atomicAdd(&tiles[tileOf(agentsIn[i].pos)], 1u);
}

var<workgroup> partial: array<u32, 256>;

// Exclusive prefix sum over all tiles in one workgroup: each invocation scans a contiguous chunk.
@compute @workgroup_size(256)
fn scanTiles(@builtin(local_invocation_index) li: u32) {
  let n = tileCount();
  let chunk = (n + 255u) / 256u;
  let begin = min(li * chunk, n);
  let end = min(begin + chunk, n);
  var sum = 0u;
  for (var k = begin; k < end; k++) { sum += atomicLoad(&tiles[k]); }
  partial[li] = sum;
  workgroupBarrier();
  for (var off = 1u; off < 256u; off <<= 1u) {
    var v = 0u;
    if (li >= off) { v = partial[li - off]; }
    workgroupBarrier();
    partial[li] += v;
    workgroupBarrier();
  }
  var run = partial[li] - sum;
  for (var k = begin; k < end; k++) {
    let c = atomicLoad(&tiles[k]);
    atomicStore(&tiles[k], run);
    run += c;
  }
}

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = slot(gid, groups);
  if (i >= P.grid.z) { return; }
  let a = agentsIn[i];
  agentsOut[atomicAdd(&tiles[tileOf(a.pos)], 1u)] = a;
}
