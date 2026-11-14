// The picture of the tubes (ADR 0034), while the flow in the tubes is on and the setting shows it. Prepended with
// common.wgsl. Display only: no pass of the simulation reads what these passes write. tubes.ts states the rule and
// holds the numbers; sim.ts sets them as the constants of the pipelines.
//
// `roots` runs first, then `picture` and `stream`, once for each state that a frame draws:
// - `roots`: per cell and strain the fourth root of the strength across the tube, the factor of the radius and of the
//   brightness of the tube that the cell holds; 0 on a cell without a tube of the strain and on a cell of a wall.
// - `picture`: per cell and strain the trail that the view draws.
// - `stream`: per cell the direction of the flow of the plasm times its speed, for the grains of the view.

override RADIUS: f32 = 3.5;    // TUBES.radius
override EDGE: f32 = 1.0;      // TUBES.edge
override SHEET: f32 = 0.25;    // TUBES.sheet
override SPAN: f32 = 3.0;      // TUBES.span
override BODY_LOW: f32 = 0.05; // FLOW.bodyLow: below it a cell holds no tube
override FAST: f32 = 2.0;      // STREAM.fast

@group(0) @binding(1) var trail: texture_2d<f32>;                 // the trail that the view draws without the tubes
@group(0) @binding(2) var<storage, read> shape: array<u32>;       // the wall byte of each cell (paint.wgsl `outline`)
@group(0) @binding(3) var memory: texture_2d_array<f32>;          // the memory of the flow, a layer per strain
@group(0) @binding(4) var rootsOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var rootsIn: texture_2d<f32>;
@group(0) @binding(6) var pictureOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(7) var pressure: texture_2d_array<f32>;        // the pressure of the 4 lanes, a layer per strain
@group(0) @binding(8) var streamOut: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8)
fn roots(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  var across = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  // A cell of a wall holds no tube.
  if (cellXY(p).x >= 0 && wallByte(p) < WALL_BYTE) {
    // The state of the flow holds a layer per strain of the settings that it was made for (sim.ts ensureFlow()).
    let strains = min(textureNumLayers(memory), 4u);
    // The cells that add to the sum are the same for every strain: found for the first strain with a tube here.
    var open = 0u;
    var found = false;
    for (var s = 0u; s < strains; s++) {
      // x the flow memory, y the tube body (flow.wgsl). A cell without a tube of the strain is no disc.
      if (textureLoad(memory, p, s, 0).y < BODY_LOW) { continue; }
      if (!found) {
        open = openCells(p);
        found = true;
      }
      var sum = 0.0;
      for (var k = 0; k < 9; k++) {
        if ((open & (1u << u32(k))) == 0u) { continue; }
        let m = textureLoad(memory, cellXY(p + vec2i(k % 3 - 1, k / 3 - 1)), s, 0);
        if (m.y >= BODY_LOW) { sum += m.x * m.y; }
      }
      across[s] = min(sum / SPAN, 1.0);
    }
  }
  textureStore(rootsOut, p, sqrt(sqrt(vec4f(across[0], across[1], across[2], across[3]))));
}

// Whether the cell at q (not wrapped) is a cell of a wall. A cell outside the arena is none.
fn wallAt(q: vec2i) -> bool {
  let c = cellXY(q);
  return c.x >= 0 && wallByte(c) >= WALL_BYTE;
}

// The cells of the 3 × 3 cells around p whose strength adds to the strength across a tube at p, as bits (bit
// 3 (dy + 1) + dx + 1): the cells of the arena that are no cell of a wall, and that no wall parts from p. A wall
// parts p from a cell at one of its corners if the two cells beside that corner are both cells of a wall: no
// plasmodium goes from one to the other, as growth puts no child there (divideInto in growth.wgsl).
fn openCells(p: vec2i) -> u32 {
  var open = 0u;
  for (var k = 0; k < 9; k++) {
    let o = vec2i(k % 3 - 1, k / 3 - 1);
    let q = cellXY(p + o);
    if (q.x < 0 || wallByte(q) >= WALL_BYTE) { continue; }
    if (o.x != 0 && o.y != 0 && wallAt(p + vec2i(o.x, 0)) && wallAt(p + vec2i(0, o.y))) { continue; }
    open |= 1u << u32(k);
  }
  return open;
}

// The wall byte of the cell at q (cellXY): WALL_BYTE and up in a cell of a wall.
fn wallByte(q: vec2i) -> u32 { return shape[q.y * i32(W()) + q.x] & 0xffu; }

// Whether a cell of a wall lies on the line between the centres of the cell p and of the cell `o` cells from it. The
// line touches the cell (i, j) cells from p if that cell lies in the box of the two cells and
// 2 |i o.y - j o.x| <= |o.x| + |o.y|: its centre is then no farther from the line than a corner of a cell is from
// its centre. A line through a corner touches every cell at that corner, so no disc passes between two wall cells
// that touch at a corner.
fn wallOnLine(p: vec2i, o: vec2i) -> bool {
  let lo = min(o, vec2i(0));
  let hi = max(o, vec2i(0));
  let span = abs(o.x) + abs(o.y);
  for (var j = lo.y; j <= hi.y; j++) {
    for (var i = lo.x; i <= hi.x; i++) {
      let at = vec2i(i, j);
      if (all(at == vec2i(0)) || all(at == o) || 2 * abs(i * o.y - j * o.x) > span) { continue; }
      let c = cellXY(p + at);
      if (c.x >= 0 && wallByte(c) >= WALL_BYTE) { return true; }
    }
  }
  return false;
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
        let root = textureLoad(rootsIn, q, 0);
        let weight = root * clamp((RADIUS * root + 0.5 * EDGE - d) / EDGE, vec4f(0.0), vec4f(1.0));
        // Most cells hold no disc that reaches this far: they add nothing, and they need no look at the walls.
        if (all(weight == vec4f(0.0))) { continue; }
        // The disc of the cell itself reaches it. The disc of another cell: not across a cell of a wall. A cell
        // of a wall is no disc (`roots`).
        if (wallOnLine(p, vec2i(dx, dy))) { continue; }
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

// The stream of the plasm of strain s through the cell p (cellXY). xy: the direction of the flux of the lane with the
// largest flux. z: its speed, the flux over the root of the conductivity of the cell. The flux of a lane is that of
// `update` in flow.wgsl, from the pressure and the conductivities that the memory holds (z). A wall and a cell outside
// the arena conduct nothing.
fn streamOf(p: vec2i, s: u32) -> vec3f {
  let g = textureLoad(memory, p, s, 0).z;
  if (g <= 0.0) { return vec3f(0.0); }
  let own = textureLoad(pressure, p, s, 0);
  var flux = vec4f(0.0);
  var x = vec4f(0.0);
  var y = vec4f(0.0);
  for (var k = 0; k < 4; k++) {
    let o = vec2i((1 - k) * (1 - (k & 1)), (2 - k) * (k & 1)); // east, south, west, north
    let n = cellXY(p + o);
    if (n.x < 0) { continue; }
    let gn = textureLoad(memory, n, s, 0).z;
    if (gn <= 0.0) { continue; }
    // What leaves the cell over this edge, per lane: the conductance of the edge is the harmonic mean (flow.wgsl).
    let leaves = 2.0 * g * gn / (g + gn) * (own - textureLoad(pressure, n, s, 0));
    flux += abs(leaves);
    x += f32(o.x) * leaves;
    y += f32(o.y) * leaves;
  }
  var lane = 0;
  for (var k = 1; k < 4; k++) { if (flux[k] > flux[lane]) { lane = k; } }
  let along = vec2f(x[lane], y[lane]);
  let l = length(along);
  if (l <= 0.0) { return vec3f(0.0); }
  // Half the sum over the edges is the flux through the cell.
  return vec3f(along / l, 0.5 * flux[lane] / sqrt(g));
}

@compute @workgroup_size(8, 8)
fn stream(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  var fastest = vec3f(0.0);
  if (cellXY(p).x >= 0) {
    let strains = min(textureNumLayers(memory), 4u);
    for (var s = 0u; s < strains; s++) {
      if (textureLoad(memory, p, s, 0).y < BODY_LOW) { continue; }
      let v = streamOf(p, s);
      if (v.z > fastest.z) { fastest = v; }
    }
  }
  // The speed over FAST, at most 1.
  textureStore(streamOut, p, vec4f(fastest.xy * min(fastest.z / FAST, 1.0), 0.0, 0.0));
}
