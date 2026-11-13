// The picture of the tubes (ADR 0034), while the flow in the tubes is on and the setting shows it. Prepended with
// common.wgsl. Display only: no pass of the simulation reads what these passes write. tubes.ts states the rule and
// holds the numbers; sim.ts sets them as the constants of the pipelines.
//
// `roots` runs first and `picture` after it, once for each state that a frame draws:
// - `roots`: per cell and strain the fourth root of the strength across the tube, the factor of the radius and of the
//   brightness of the tube that the cell holds.
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
  if (cellXY(p).x < 0) {
    textureStore(rootsOut, p, vec4f(0.0));
    return;
  }
  // The state of the flow holds a layer per strain of the settings that it was made for (sim.ts ensureFlow()).
  let strains = min(textureNumLayers(memory), 4u);
  var sum = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = cellXY(p + vec2i(dx, dy));
      if (q.x < 0) { continue; }
      for (var s = 0u; s < strains; s++) {
        // x the flow memory, y the tube body (flow.wgsl).
        let m = textureLoad(memory, q, s, 0);
        if (m.y >= BODY_LOW) { sum[s] += m.x * m.y; }
      }
    }
  }
  let across = min(vec4f(sum[0], sum[1], sum[2], sum[3]) / SPAN, vec4f(1.0));
  textureStore(rootsOut, p, sqrt(sqrt(across)));
}

// The distance of the cell at q (cellXY) to the outline of the walls, cells: 0 in a wall, at most SHAPE_RANGE. The byte
// is never above the distance to the centre of the nearest wall cell (paint.wgsl floorByte()).
fn clearOf(q: vec2i) -> f32 {
  let b = shape[q.y * i32(W()) + q.x] & 0xffu;
  return max(0.0, (1.0 - 2.0 * f32(b) / 255.0) * SHAPE_RANGE);
}

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
  let here = clearOf(p);
  // Of the discs that reach the cell: the largest weight, the sum of the weights, and the sum of the trails by weight.
  var top = vec4f(0.0);
  var sum = vec4f(0.0);
  var lit = vec4f(0.0);
  for (var dy = -window; dy <= window; dy++) {
    for (var dx = -window; dx <= window; dx++) {
      let d = length(vec2f(f32(dx), f32(dy)));
      if (d >= reach) { continue; }
      let q = cellXY(p + vec2i(dx, dy));
      if (q.x < 0) { continue; }
      // A wall lies on the line between the cells, or one of them is a wall.
      if (here + clearOf(q) <= d) { continue; }
      let root = textureLoad(rootsIn, q, 0);
      let weight = root * clamp((RADIUS * root + 0.5 * EDGE - d) / EDGE, vec4f(0.0), vec4f(1.0));
      top = max(top, weight);
      sum += weight;
      lit += textureLoad(trail, q, 0) * weight;
    }
  }
  // The tube: the strongest disc, with the mean trail of the cells whose discs reach the cell. Without a disc all
  // three are 0.
  let tube = top * lit / max(sum, vec4f(1e-20));
  textureStore(pictureOut, p, max(SHEET * textureLoad(trail, p, 0), tube));
}
