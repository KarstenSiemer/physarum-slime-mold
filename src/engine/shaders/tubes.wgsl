// The picture of the tubes (ADR 0034), while the flow in the tubes is on and the setting shows it, and the stream of
// the grains, while the flow is on, with the setting or without it (ADR 0095). Prepended with common.wgsl. Display
// only: no pass of the simulation reads what these passes write. tubes.ts states the rule and holds the numbers;
// sim.ts sets them as the constants of the pipelines.
//
// `roots` runs first, then `picture`, once for each state that a frame draws with the picture. `stream` runs once for
// each state that a frame draws with the grains, with the picture or without it:
// - `roots`: per cell and strain the fourth root of the strength across the tube, the factor of the radius and of the
//   brightness of the tube that the cell holds; 0 on a cell without a tube of the strain and on a cell of a wall.
// - `picture`: per cell and strain the trail that the view draws. A workgroup draws a tile of TILE × TILE cells: it
//   loads the window of the tile once into the memory of the workgroup, and it skips what the window shows to add
//   nothing (ADR 0034, amendment of 2026-11-15).
// - `stream`: per cell the direction of the flow of the plasm times its speed, for the grains of the view.

override RADIUS: f32 = 3.5;    // TUBES.radius
override EDGE: f32 = 1.0;      // TUBES.edge
override SHEET: f32 = 0.25;    // TUBES.sheet
override SPAN: f32 = 3.0;      // TUBES.span
override BODY_LOW: f32 = 0.05; // FLOW.bodyLow: below it a cell holds no tube
override FAST: f32 = 2.0;      // STREAM.fast
override TILE: i32 = 8;        // TUBE_TILE: the cells per side of a workgroup
override WINDOW: i32 = 3;      // TUBE_WINDOW: the whole cells nearer than RADIUS + EDGE / 2

@group(0) @binding(1) var trail: texture_2d<f32>;                 // the trail that the view draws without the tubes
@group(0) @binding(2) var<storage, read> shape: array<u32>;       // the wall byte of each cell (paint.wgsl `outline`)
@group(0) @binding(3) var memory: texture_2d_array<f32>;          // the memory of the flow, a layer per strain
@group(0) @binding(4) var rootsOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var rootsIn: texture_2d<f32>;
@group(0) @binding(6) var pictureOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(7) var pressure: texture_2d_array<f32>;        // the pressure of the 4 lanes, a layer per strain
@group(0) @binding(8) var streamOut: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(TILE, TILE)
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

// The window of the tile of a workgroup of `picture`: the tile and the WINDOW cells on each side of it, whose discs
// may reach a cell of the tile. Row by row from its corner, TILE times the workgroup id less WINDOW, wrapped as
// cellXY() wraps. Per cell: its factors (`roots`), its trail if it is a disc of a strain, else 0, and 1 if it is a
// cell of a wall. A cell outside the arena holds 0 in all three: it is no disc and no wall.
var<workgroup> tileRoots: array<vec4f, (TILE + 2 * WINDOW) * (TILE + 2 * WINDOW)>;
var<workgroup> tileTrails: array<vec4f, (TILE + 2 * WINDOW) * (TILE + 2 * WINDOW)>;
var<workgroup> tileWalls: array<u32, (TILE + 2 * WINDOW) * (TILE + 2 * WINDOW)>;
// Of the whole window: whether a cell holds a disc of a strain, and whether a cell is a cell of a wall.
var<workgroup> tileDiscs: atomic<u32>;
var<workgroup> tileWalled: atomic<u32>;

// Whether a cell of a wall lies on the line between the centres of the cell `cell` of the window of the tile
// (tileWalls) and of the cell `o` cells from it. The line touches the cell (i, j) cells from the first if that cell
// lies in the box of the two cells and 2 |i o.y - j o.x| <= |o.x| + |o.y|: its centre is then no farther from the
// line than a corner of a cell is from its centre. A line through a corner touches every cell at that corner, so no
// disc passes between two wall cells that touch at a corner. Both cells lie in the window, and so does the box.
fn wallOnLine(cell: i32, o: vec2i) -> bool {
  let side = TILE + 2 * WINDOW;
  let lo = min(o, vec2i(0));
  let hi = max(o, vec2i(0));
  let span = abs(o.x) + abs(o.y);
  for (var j = lo.y; j <= hi.y; j++) {
    for (var i = lo.x; i <= hi.x; i++) {
      let at = vec2i(i, j);
      if (all(at == vec2i(0)) || all(at == o) || 2 * abs(i * o.y - j * o.x) > span) { continue; }
      if (tileWalls[cell + j * side + i] != 0u) { return true; }
    }
  }
  return false;
}

@compute @workgroup_size(TILE, TILE)
fn picture(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
           @builtin(workgroup_id) group: vec3u) {
  // Every invocation loads a part of the window, also one beyond the edge of the grid: the barrier waits for all.
  let side = TILE + 2 * WINDOW;
  let corner = vec2i(group.xy) * TILE - WINDOW;
  var discs = 0u;
  var walled = 0u;
  for (var i = i32(lid.y) * TILE + i32(lid.x); i < side * side; i += TILE * TILE) {
    let q = cellXY(corner + vec2i(i % side, i / side));
    var root = vec4f(0.0);
    var lit = vec4f(0.0);
    var wall = 0u;
    if (q.x >= 0) {
      root = textureLoad(rootsIn, q, 0);
      wall = select(0u, 1u, wallByte(q) >= WALL_BYTE);
    }
    // Only the trail of a disc adds to a tube.
    let disc = any(root != vec4f(0.0));
    if (disc) { lit = textureLoad(trail, q, 0); }
    tileRoots[i] = root;
    tileTrails[i] = lit;
    tileWalls[i] = wall;
    discs |= select(0u, 1u, disc);
    walled |= wall;
  }
  atomicOr(&tileDiscs, discs);
  atomicOr(&tileWalled, walled);
  workgroupBarrier();
  let p = vec2i(gid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  if (cellXY(p).x < 0) {
    textureStore(pictureOut, p, vec4f(0.0));
    return;
  }
  let reach = RADIUS + 0.5 * EDGE;
  // The cell in the window of the tile.
  let cell = (i32(lid.y) + WINDOW) * side + i32(lid.x) + WINDOW;
  // Without a cell of a wall in the window no line between two of its cells meets one.
  let walls = atomicLoad(&tileWalled) != 0u;
  // Of the discs that reach the cell: the largest weight, the sum of the weights, and the sum of the trails by weight.
  var top = vec4f(0.0);
  var sum = vec4f(0.0);
  var lit = vec4f(0.0);
  // No disc reaches a cell of a wall. A window without a disc adds nothing: the tiles away from the tubes.
  if (tileWalls[cell] == 0u && atomicLoad(&tileDiscs) != 0u) {
    for (var dy = -WINDOW; dy <= WINDOW; dy++) {
      for (var dx = -WINDOW; dx <= WINDOW; dx++) {
        let d = length(vec2f(f32(dx), f32(dy)));
        if (d >= reach) { continue; }
        let k = cell + dy * side + dx;
        let root = tileRoots[k];
        let weight = root * clamp((RADIUS * root + 0.5 * EDGE - d) / EDGE, vec4f(0.0), vec4f(1.0));
        // Most cells hold no disc that reaches this far: they add nothing, and they need no look at the walls. A
        // cell outside the arena holds no disc.
        if (all(weight == vec4f(0.0))) { continue; }
        // The disc of the cell itself reaches it. The disc of another cell: not across a cell of a wall. A cell
        // of a wall is no disc (`roots`).
        if (walls && wallOnLine(cell, vec2i(dx, dy))) { continue; }
        top = max(top, weight);
        sum += weight;
        lit += tileTrails[k] * weight;
      }
    }
  }
  // The tube: the strongest disc, with the mean trail of the cells whose discs reach the cell. Without a disc all
  // three are 0.
  let tube = top * lit / max(sum, vec4f(1e-20));
  textureStore(pictureOut, p, max(SHEET * textureLoad(trail, p, 0), tube));
}

//#if EIGHT

// The stream over 8 neighbours (ADR 0086), as the flow of `update` in flow.wgsl runs then: the lines between `//#if
// EIGHT` and `//#endif` are part of the source only with it (variant.ts). An axis edge conducts AXIS times the harmonic
// mean of its two cells, a diagonal edge DIAG times (flow.ts FLOW_EIGHT).
const AXIS = 0.414213568; // √2 − 1
const DIAG = 0.292893231; // 1 − 1/√2

// Whether the cell at q (not wrapped) is open for the flow: in the arena and no cell of a wall (openXY in flow.wgsl).
fn flowOpen(q: vec2i) -> bool {
  let c = cellXY(q);
  return c.x >= 0 && wallByte(c) < WALL_BYTE;
}
//#endif

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
//#if EIGHT
  // Over 8 neighbours: the axis edges with the weight AXIS, and the 4 diagonal edges with DIAG where both cells beside
  // the edge are open. A diagonal edge points along (±1, ±1), the step between the centres of its cells.
  flux *= AXIS;
  x *= AXIS;
  y *= AXIS;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(1 - 2 * (k & 1), 1 - 2 * (k >> 1u)); // south-east, south-west, north-east, north-west
    if (!flowOpen(p + vec2i(o.x, 0)) || !flowOpen(p + vec2i(0, o.y))) { continue; }
    let n = cellXY(p + o);
    if (n.x < 0) { continue; }
    let gn = textureLoad(memory, n, s, 0).z;
    if (gn <= 0.0) { continue; }
    let leaves = DIAG * (2.0 * g * gn / (g + gn)) * (own - textureLoad(pressure, n, s, 0));
    flux += abs(leaves);
    x += f32(o.x) * leaves;
    y += f32(o.y) * leaves;
  }
//#endif
  var lane = 0;
  for (var k = 1; k < 4; k++) { if (flux[k] > flux[lane]) { lane = k; } }
  let along = vec2f(x[lane], y[lane]);
  let l = length(along);
  if (l <= 0.0) { return vec3f(0.0); }
  // Half the sum over the edges is the flux through the cell.
  return vec3f(along / l, 0.5 * flux[lane] / sqrt(g));
}

@compute @workgroup_size(TILE, TILE)
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
