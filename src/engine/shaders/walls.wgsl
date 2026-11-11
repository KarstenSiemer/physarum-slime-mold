// Clearance of the walls (ADR 0020). Prepended with common.wgsl.
// The clearance of a tile of CLEAR_TILE × CLEAR_TILE cells is a lower bound of the Chebyshev distance from any of its
// cells to the nearest wall cell, at most FAR cells. A walk whose cells all lie closer to its start cell than the
// clearance of that cell's tile cannot meet a wall (agents.wgsl clearPath), so an agent far from every wall skips the
// walks of its sensors and its move. Distances count around the periodic grid in every arena: in a box or a dish
// they are then the true ones or less, and the skip stays exact. Sim.paint and Sim.writeEnv run both passes again.

@group(0) @binding(1) var<storage, read> env: array<u32>;
@group(0) @binding(2) var<storage, read_write> walled: array<u32>;    // 1 where a tile holds a wall cell
@group(0) @binding(3) var<storage, read_write> clearance: array<u32>;

// Tiles searched in each direction. Every tile at least SEARCH + 1 tiles away (around the periodic grid) lies at least
// (SEARCH − 1) · CLEAR_TILE + 2 cells away: of the tiles between, only the last one of the grid can hold fewer than
// CLEAR_TILE cells, and it holds one at least. That is FAR, so a clearance of FAR means FAR or more. FAR is above the
// longest walk that can skip: 65 cells, for a sensor 64 cells away. WALL_SEARCH and WALL_FAR in walls.frag are the
// same; pack.test.ts checks them.
const SEARCH = 10;
const FAR = 74;

fn tileCounts() -> vec2i { return (vec2i(i32(W()), i32(H())) + CLEAR_TILE - 1) / CLEAR_TILE; }

@compute @workgroup_size(8, 8)
fn markWalls(@builtin(global_invocation_id) gid: vec3u) {
  let n = tileCounts();
  let t = vec2i(gid.xy);
  if (any(t >= n)) { return; }
  let size = vec2i(i32(W()), i32(H()));
  let lo = t * CLEAR_TILE;
  let hi = min(lo + CLEAR_TILE, size);
  var found = 0u;
  for (var y = lo.y; y < hi.y; y++) {
    for (var x = lo.x; x < hi.x; x++) {
      if (isWall(env[y * size.x + x])) { found = 1u; }
    }
  }
  walled[t.y * n.x + t.x] = found;
}

// The least distance along one axis of `cells` cells between a cell of tile a and a cell of tile b, also with b one
// period to either side.
fn gap(a: i32, b: i32, cells: i32) -> i32 {
  let a0 = a * CLEAR_TILE;
  let a1 = min(a0 + CLEAR_TILE, cells) - 1;
  let b0 = b * CLEAR_TILE;
  let b1 = min(b0 + CLEAR_TILE, cells) - 1;
  let here = max(0, max(b0 - a1, a0 - b1));
  let after = max(0, max(b0 + cells - a1, a0 - b1 - cells));
  let before = max(0, max(b0 - cells - a1, a0 - b1 + cells));
  return min(here, min(after, before));
}

@compute @workgroup_size(8, 8)
fn measureClearance(@builtin(global_invocation_id) gid: vec3u) {
  let n = tileCounts();
  let t = vec2i(gid.xy);
  if (any(t >= n)) { return; }
  let size = vec2i(i32(W()), i32(H()));
  var d = FAR;
  for (var dy = -SEARCH; dy <= SEARCH; dy++) {
    let by = (((t.y + dy) % n.y) + n.y) % n.y;
    let gy = gap(t.y, by, size.y);
    if (gy >= d) { continue; }
    for (var dx = -SEARCH; dx <= SEARCH; dx++) {
      let bx = (((t.x + dx) % n.x) + n.x) % n.x;
      if (walled[by * n.x + bx] != 0u) { d = min(d, max(gap(t.x, bx, size.x), gy)); }
    }
  }
  clearance[t.y * n.x + t.x] = u32(d);
}
