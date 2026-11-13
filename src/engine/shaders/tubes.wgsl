// The picture of the tubes (ADR 0034), while the flow in the tubes is on and the setting shows it. Prepended with
// common.wgsl. Display only: no pass of the simulation reads what these passes write. tubes.ts states the rule and
// holds the numbers; sim.ts sets them as the constants of the pipelines.
//
// `roots` runs first and `picture` after it, once for each state that a frame draws:
// - `roots`: per cell and strain the fourth root of the strength across the tube, the factor of the radius and of the
//   brightness of the tube that the cell holds; 0 on a cell without a tube of the strain.
// - `picture`: per cell and strain the trail that the view draws.

override RADIUS: f32 = 3.5;    // TUBES.radius
override EDGE: f32 = 1.0;      // TUBES.edge
override SHEET: f32 = 0.25;    // TUBES.sheet
override SPAN: f32 = 3.0;      // TUBES.span
override BODY_LOW: f32 = 0.05; // FLOW.bodyLow: below it a cell holds no tube
const SHAPE_RANGE = 4.0;       // cells; SHAPE_RANGE in paint.wgsl

@group(0) @binding(1) var trail: texture_2d<f32>;                 // the trail that the view draws without the tubes
@group(0) @binding(2) var<storage, read> shape: array<u32>;       // outline distances (paint.wgsl `outline`)
@group(0) @binding(3) var memory: texture_2d_array<f32>;          // the memory of the flow, a layer per strain
@group(0) @binding(4) var rootsOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var rootsIn: texture_2d<f32>;
@group(0) @binding(6) var pictureOut: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8)
fn roots(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  var across = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  if (cellXY(p).x >= 0) {
    // The state of the flow holds a layer per strain of the settings that it was made for (sim.ts ensureFlow()).
    let strains = min(textureNumLayers(memory), 4u);
    for (var s = 0u; s < strains; s++) {
      // x the flow memory, y the tube body (flow.wgsl). A cell without a tube of the strain is no disc.
      if (textureLoad(memory, p, s, 0).y < BODY_LOW) { continue; }
      var sum = 0.0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let q = cellXY(p + vec2i(dx, dy));
          if (q.x < 0) { continue; }
          let m = textureLoad(memory, q, s, 0);
          if (m.y >= BODY_LOW) { sum += m.x * m.y; }
        }
      }
      across[s] = min(sum / SPAN, 1.0);
    }
  }
  textureStore(rootsOut, p, sqrt(sqrt(vec4f(across[0], across[1], across[2], across[3]))));
}

// The wall byte of the cell at q (cellXY): its signed distance to the outline of the walls, WALL_BYTE and up in a wall.
fn wallByte(q: vec2i) -> u32 { return shape[q.y * i32(W()) + q.x] & 0xffu; }

// The distance to the outline of the walls that a wall byte stands for, cells, at most SHAPE_RANGE, less half a step
// of the byte: the byte is rounded, and this distance must never be above the distance to the centre of the nearest
// wall cell (paint.wgsl floorByte()).
fn clearOf(b: u32) -> f32 { return max(0.0, (1.0 - (2.0 * f32(b) + 1.0) / 255.0) * SHAPE_RANGE); }

@compute @workgroup_size(8, 8)
fn picture(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  if (cellXY(p).x < 0) {
    textureStore(pictureOut, p, vec4f(0.0));
    return;
  }
  let reach = RADIUS + 0.5 * EDGE;
  let window = i32(ceil(reach)) - 1;
  let here = wallByte(p);
  // Of the discs that reach the cell: the largest weight, the sum of the weights, and the sum of the trails by weight.
  var top = vec4f(0.0);
  var sum = vec4f(0.0);
  var lit = vec4f(0.0);
  // No disc reaches a cell of a wall.
  if (here < WALL_BYTE) {
    for (var dy = -window; dy <= window; dy++) {
      for (var dx = -window; dx <= window; dx++) {
        let d = length(vec2f(f32(dx), f32(dy)));
        if (d >= reach) { continue; }
        let q = cellXY(p + vec2i(dx, dy));
        if (q.x < 0) { continue; }
        // The disc of the cell itself reaches it. Another cell: not a wall cell, and no wall on the line between.
        if (dx != 0 || dy != 0) {
          let there = wallByte(q);
          if (there >= WALL_BYTE || clearOf(here) + clearOf(there) <= d) { continue; }
        }
        let root = textureLoad(rootsIn, q, 0);
        let weight = root * clamp((RADIUS * root + 0.5 * EDGE - d) / EDGE, vec4f(0.0), vec4f(1.0));
        top = max(top, weight);
        sum += weight;
        lit += textureLoad(trail, q, 0) * weight;
      }
    }
  }
  // The tube: the strongest disc, with the mean trail of the cells whose discs reach the cell. Without a disc all
  // three are 0.
  let tube = top * lit / max(sum, vec4f(1e-20));
  textureStore(pictureOut, p, max(SHEET * textureLoad(trail, p, 0), tube));
}
