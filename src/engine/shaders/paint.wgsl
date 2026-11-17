// Brush strokes on the environment (walls, food, light, electrodes). Prepended with common.wgsl and brush.wgsl, which
// holds the slot of a segment (`B`), its distance to a cell (strokeDistance) and the cells of its box (boxCell).

@group(0) @binding(1) var<storage, read_write> env: array<u32>;

// The soft edge of light: 1 within 0.3 of the radius, 0 at the radius, Hermite between. Written out, because
// smoothstep with its first edge above its second is undefined in GLSL ES 3.00; the same steps as lightByte() in
// brush.ts and as paint.frag.
fn lightEdge(d: f32, r: f32) -> f32 {
  let t = clamp((d - r) / (0.3 * r - r), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

@compute @workgroup_size(16, 16)
fn paint(@builtin(global_invocation_id) gid: vec3u) {
  // The box spans at most one period: a cell comes twice only from workgroups past its end, with the same value.
  let cell = boxCell(B.origin + vec2i(gid.xy));
  let q = cell.xy;
  let c = cell.z;
  if (c < 0) { return; }
  let d = strokeDistance(q, B.radius);
  if (d > B.radius) { return; }
  var e = envOf(env[c]);
  // A stroke of the Slime tool (kind 6) never comes here: it changes only the slime field (slime-paint.wgsl).
  switch B.kind {
    case 0u: { e = vec4f(0.0); }
    case 1u: { e = vec4f(1.0, 0.0, 0.0, 0.0); }
    case 2u: { e.y = 1.0; }
    // The poles of the Electrode tool (ADR 0047) share the fourth byte: 128 the anode, 255 the cathode (POLE_BYTE in
    // types.ts). A pole replaces the other pole of the cell, and leaves its food and light.
    case 4u: { e.w = 128.0 / 255.0; }
    case 5u: { e.w = 1.0; }
    // Soft edge, so the repellent has a gradient from the start.
    default: { e.z = max(e.z, lightEdge(d, B.radius)); }
  }
  env[c] = pack4x8unorm(e);
}

// ---- Outlines for the renderer -------------------------------------------------------------------
// `shape` holds per cell, as bytes: the signed distance to the wall outline and to the food outline
// (cells, positive inside, clamped to ±SHAPE_RANGE: 0 is that far outside, 255 that far inside, 128
// and up inside), the light value of `env`, and the drop shadow of the walls. Only the renderer reads
// it (render.wgsl): it rebuilds smooth outlines from it at any zoom, while the simulation reads `env`
// as before. `outline` runs after `paint` with the same brush slot, over the outline box (`B.reach`,
// `B.extent`: the paint box grown by SHAPE_RANGE, brush.ts outlineBox). Unions take the maximum, a wall
// over food and the eraser the minimum with the complement. Every byte is then held to what `env` holds
// around its cell (`held`), and a stroke's distance to the cells it paints itself (`ownByte`), so a cell is inside
// exactly when `env` holds the wall or food there, and no byte lies nearer an outline than the cells of
// `env` allow. Cells outside the arena keep their bytes: `paint` leaves their `env` alone, and a later
// boundary may count them again.
//
// The electrodes have a buffer of their own in the same format (POLES): `shape` has no byte left for them. Its first
// byte holds the distance to the outline of the cathodes and its second byte the one to the outline of the anodes; the
// other two stay 0. A cell of `env` holds one pole, the one painted last (`paint`). So a cathode stroke is for the two
// poles what a wall stroke is for walls and food: a union with the cathodes and a subtraction from the anodes. An anode
// stroke is the mirror, and an erase and a wall subtract from both. The same code writes both buffers.

@group(0) @binding(3) var<storage, read_write> shape: array<u32>;

// True in the pipelines that write the outlines of the electrodes: binding 3 then holds their buffer, and the two
// layers of a cell of `env` are the cathode and the anode (layersOf()). A condition fixed for the pipeline: the
// pipelines of walls and food hold none of its code.
override POLES: bool = false;

const SHAPE_RANGE = 4.0; // cells; SHAPE_RANGE in sim.ts and render.wgsl
const HOLD_RINGS = 5;    // cells: how far `held` looks for a cell of the layer
const WALL_BEVEL = 1.5;  // cells: the lit slope of a wall in render.wgsl (`walls`)
const FOOD_RIM = 2.0;    // cells: the lit rim of food in render.wgsl (`flakeAt`)
const POLE_RIM = 1.5;    // cells: the lit slope of an electrode in render.wgsl (`studAt`)
const CATHODE_OVER = 191u; // a byte above it is the cathode, any other byte above 0 the anode (types.ts POLE_BYTE)

// Which of the two layers of the outline buffer a cell of `env` holds. Walls and food: a byte of WALL_BYTE (128) or
// more, the threshold of isWall() in common.wgsl, for food too. With POLES the cathode and the anode, by the fourth
// byte as the passes of the simulation read it (diffuse.wgsl `sources`).
fn layersOf(e: u32) -> vec2<bool> {
  if (POLES) {
    let pole = e >> 24u;
    return vec2<bool>(pole > CATHODE_OVER, pole > 0u && pole <= CATHODE_OVER);
  }
  return vec2<bool>((e & 0xffu) >= WALL_BYTE, ((e >> 8u) & 0xffu) >= WALL_BYTE);
}
const SHADOW = vec2f(1.08, 1.44); // cells away from the light (top left) that walls cast their shadow
const SHADOW_SOFT = 1.5;          // cells: radius of the cone that blurs the shadow

// A signed distance (cells) as a byte; the outline lies at 127.5.
fn distanceByte(sd: f32) -> u32 {
  return u32(round((clamp(sd / SHAPE_RANGE, -1.0, 1.0) * 0.5 + 0.5) * 255.0));
}

// The distance d from the middle line of a stroke of radius r, rounded off near the line where the crest
// of the stroke lies within `slope` cells of its outline, the part the renderer lights. The distance has a
// crease along the line, and the renderer's spline smooths a crease differently at every position against
// the grid: a thin wall showed beads with the period of the cells. Within rho of the line this is a parabola
// that meets d with the same value and slope, which the spline rebuilds alike everywhere; the outline
// (d = r) stays where it is.
fn rounded(d: f32, r: f32, slope: f32) -> f32 {
  let rho = min(r, max(2.0 * slope - r, 0.0));
  if (d >= rho) { return d; }
  return (d * d + rho * rho) / (2.0 * rho);
}

// The index of cell q + d of the grid, with q in the grid and d less than a grid: wrapped with comparisons on
// the periodic grid (integer remainders cost), −1 outside a closed one. The dish does not count.
fn gridIndex(q: vec2i, d: vec2i) -> i32 {
  let size = vec2i(i32(W()), i32(H()));
  var c = q + d;
  if (P.cfg.z == 0u) {
    c += select(vec2i(0), size, c < vec2i(0));
    c -= select(vec2i(0), size, c >= size);
  } else if (any(c < vec2i(0)) || any(c >= size)) {
    return -1;
  }
  return c.y * size.x + c.x;
}

// Whether `env` holds a layer (0 or 1, layersOf()) in cell q + d of the grid. The dish does not count here: what other
// boundaries left outside it stays `env`, and holding the bytes to less than it would remove outlines for good.
fn holds(q: vec2i, d: vec2i, layer: u32) -> bool {
  let i = gridIndex(q, d);
  return i >= 0 && layersOf(env[i])[layer];
}

// The largest byte that cell q may hold for a layer that `env` does not hold at q. The renderer's spline
// rebuilds an outline only within the 3 × 3 cells around a cell of the layer, so with the nearest such cell
// k cells away (Chebyshev), the outline lies at least k − 1.5 cells away. A subtraction keeps the distance to
// the old outline (painting and erasing one stroke leaves a crease along it), and this removes what it left.
fn holdByte(q: vec2i, layer: u32) -> u32 {
  for (var k = 1; k <= HOLD_RINGS; k++) {
    for (var t = -k; t <= k; t++) {
      if (holds(q, vec2i(t, -k), layer) || holds(q, vec2i(t, k), layer)) { return distanceByte(1.5 - f32(k)); }
    }
    for (var t = 1 - k; t < k; t++) {
      if (holds(q, vec2i(-k, t), layer) || holds(q, vec2i(k, t), layer)) { return distanceByte(1.5 - f32(k)); }
    }
  }
  return 0u;
}

// A byte after a subtraction, held to `env`: at least 128 where `env` holds the layer at the cell (`here`), else
// at most 127 and at most `hold` (holdByte()).
fn heldBy(b: u32, here: bool, hold: u32) -> u32 {
  if (here) { return max(b, 128u); }
  return min(min(b, 127u), hold);
}

// A byte after `refresh`, held to what `env` holds of its layer at and around q. A byte of 0 needs no search.
fn held(b: u32, q: vec2i, layer: u32) -> u32 {
  let here = holds(q, vec2i(0), layer);
  if (here || b == 0u) { return heldBy(b, here, 0u); }
  return heldBy(b, false, holdByte(q, layer));
}

// No cell of the layer within 3 rings: more than any squared distance (dx² + dy²) there, which is at most 18.
const NONE = 32u;

// The smallest byte that a cell may hold for a layer that `env` does not hold there, with n the squared distance
// (nearestCells()) to the nearest cell of the layer, d = √n cells away between the cell centres: the outline runs
// between the two cells, so it lies at most d cells away. Strokes keep every byte at least this high, because the
// distance to a segment changes by at most d between two cells d apart. A change of boundary does not: the cells that
// the old boundary did not count (across the edges of the periodic grid, outside the rim of the dish) can lie next to
// cells of a layer with the byte of 4 cells or more outside.
fn floorByte(n: u32) -> u32 {
  if (n == NONE) { return 0u; }
  return distanceByte(-sqrt(f32(n)));
}

// The squared distances from cell q to the nearest cell of each of the two layers that `env` holds in the arena (the
// dish counts), up to 3 rings away: the nearest cell lies in the first ring that has one (k √2 < k + 1 for k ≤ 2), and
// from 4 cells on floorByte() is 0.
fn nearestCells(q: vec2i) -> vec2u {
  let middle = 0.5 * vec2f(f32(W()), f32(H()));
  var n = vec2u(NONE);
  for (var k = 1; k <= 3; k++) {
    var m = vec2u(NONE);
    for (var dy = -k; dy <= k; dy++) {
      // The rows at ±k whole, the rows between only at ±k.
      let stride = select(2 * k, 1, abs(dy) == k);
      for (var dx = -k; dx <= k; dx += stride) {
        let i = gridIndex(q, vec2i(dx, dy));
        if (i < 0 || (P.cfg.z == 2u && distance(vec2f(q + vec2i(dx, dy)) + 0.5, middle) > dishRadius())) { continue; }
        let l = layersOf(env[i]);
        let r = u32(dx * dx + dy * dy);
        if (l.x) { m.x = min(m.x, r); }
        if (l.y) { m.y = min(m.y, r); }
      }
    }
    n = select(n, m, n == vec2u(NONE));
  }
  return n;
}

// Whether this segment paints cell q + d of the grid, by the rule of `paint`: the cell wrapped into the periodic
// grid, or a cell of a closed arena (the dish counts), whose centre lies within the radius. q + d less than a grid.
fn paints(q: vec2i, d: vec2i) -> bool {
  let size = vec2i(i32(W()), i32(H()));
  var c = q + d;
  if (P.cfg.z == 0u) {
    c += select(vec2i(0), size, c < vec2i(0));
    c -= select(vec2i(0), size, c >= size);
  } else if (cellAt(c) < 0) {
    return false;
  }
  return strokeDistance(c, B.radius) <= B.radius;
}

// The hold of holdByte() from the cells this segment paints itself, at cell q, which it does not paint: the largest
// byte that the segment's distance may give q. A byte up to `least` needs no search: it changes nothing then.
fn ownHold(q: vec2i, least: u32) -> u32 {
  for (var k = 1; k <= HOLD_RINGS; k++) {
    let b = distanceByte(1.5 - f32(k));
    if (b <= least) { return 0u; }
    for (var t = -k; t <= k; t++) {
      if (paints(q, vec2i(t, -k)) || paints(q, vec2i(t, k))) { return b; }
    }
    for (var t = 1 - k; t < k; t++) {
      if (paints(q, vec2i(-k, t)) || paints(q, vec2i(k, t))) { return b; }
    }
  }
  return 0u;
}

// Whether ownHold() at cell q is at least the segment's byte there, so that the search can be skipped. Let r be the
// radius, at least MIN_RADIUS (0.75 cells, environment.ts), d the distance of q's centre from the segment, x the point
// of the segment nearest to that centre, and y the point r − 0.72 cells from x toward it. Where a cell centre of the
// arena lies within √0.5 cells of y, the segment paints that cell (it lies within r − 0.01 of x), and the cell lies at
// most d − r + 1.43 cells from q. So ownHold() is at least distanceByte(r − d + 0.07), and the byte is at most
// distanceByte(r − d). Such a cell centre exists on the periodic grid always, in a box when x lies in the grid (y lies
// between x and q), and in the dish when the brush around x lies in the dish. Beside the edge of a box or the rim of
// the dish a segment can pass near cells and paint none of them (ADR 0009, item 2): there the search runs.
fn ownHeld(q: vec2i) -> bool {
  if (B.radius < 0.75) { return false; }
  if (P.cfg.z == 0u) { return true; }
  let x = nearestPoint(vec2f(q) + 0.5);
  if (P.cfg.z == 1u) { return all(x >= vec2f(0.0)) && all(x <= vec2f(f32(W()), f32(H()))); }
  return distance(x, 0.5 * vec2f(f32(W()), f32(H()))) <= dishRadius() - B.radius;
}

// True in the pipeline for the eraser and walls, false for food and light, and CORE for erasers wide enough to have a
// workgroup in their core (eraserCore(); sim.ts outlineVariant()): a condition fixed for the pipeline costs nothing.
// With POLES every stroke subtracts from a layer, so every pipeline loads the tile.
override TILED: bool = true;
override CORE: bool = true;

// False in the pipeline for segments where ownHeld() holds at every cell (brush.ts ownHeldEverywhere(), sim.ts
// paint()): it has no search of the segment's own cells, whose registers slow every dispatch down.
override OWN_SEARCH: bool = true;

// The segment's byte s at cell q, held to the cells it paints where it does not paint q (ownHold()). Only a byte
// above `least` can change anything: the old byte of a union, 255 less the old bytes of a subtraction.
fn ownByte(s: u32, q: vec2i, least: u32) -> u32 {
  if (!OWN_SEARCH || s <= least || ownHeld(q) || paints(q, vec2i(0))) { return s; }
  return min(s, ownHold(q, least));
}

// A union: the stroke's byte s over the old one, held to the side of the outline that `env` holds (`here`), and
// elsewhere to the cells the stroke paints (ownByte()). `env` only gains cells of the layer, so the old byte keeps
// its hold, and the hold from the stroke's own cells is at most the hold from `env`. The hold depends on the stroke
// alone, so a run of unions gives the same bytes in any order (ADR 0009, item 11).
fn united(old: u32, s: u32, here: bool, q: vec2i) -> u32 {
  if (here) { return max(max(old, s), 128u); }
  return max(old, ownByte(min(s, 127u), q, old));
}

// The drop shadow at cell q as a byte: the share of wall cells of `env` under a cone of radius SHADOW_SOFT around
// the point SHADOW toward the light. From `env`, so an erased wall casts none. `local` is q's place in the outline
// tile (`tileEnv`), or −1 to read `env` itself (`refresh`). The cone covers cells q − 3 … q + 1 on each axis.
fn shadowByte(q: vec2i, local: vec2i) -> u32 {
  let x = vec2f(q) + 0.5 - SHADOW;
  let k0 = vec2i(floor(x));
  let middle = 0.5 * vec2f(f32(W()), f32(H()));
  var sum = 0.0;
  var total = 0.0;
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      let k = k0 + vec2i(dx, dy);
      let w = max(1.0 - distance(vec2f(k) + 0.5, x) / SHADOW_SOFT, 0.0);
      total += w;
      // cellAt(k), wrapped with comparisons; 0 outside a closed grid.
      var e = 0u;
      var inGrid = true;
      if (local.x >= 0) {
        let t = local + k - q;
        e = tileEnv[t.y * TILE_SIDE + t.x];
        inGrid = P.cfg.z == 0u || (all(k >= vec2i(0)) && all(k < vec2i(i32(W()), i32(H()))));
      } else {
        let c = gridIndex(q, k - q);
        inGrid = c >= 0;
        if (inGrid) { e = env[c]; }
      }
      let arena = inGrid && (P.cfg.z != 2u || distance(vec2f(k) + 0.5, middle) <= dishRadius());
      if (arena && isWall(e)) { sum += w; }
    }
  }
  return u32(round(sum / total * 255.0));
}

// The outline pass keeps `env` of its workgroup's 16 × 16 cells and of HOLD_RINGS cells around them in workgroup
// memory: the holds, the hold bytes and the shadow of a cell read only these. Each workgroup loads them once,
// where each cell read up to 268 cells of `env` before: 120 in the 5 rings of each layer, 25 for the shadow, 3 more.
const TILE_SIDE = 26; // 16 + 2 · HOLD_RINGS
var<workgroup> tileEnv: array<u32, 676>; // TILE_SIDE²; 0 outside a closed grid, wrapped on the periodic one
// Per cell of the 16 columns and the TILE_SIDE rows: the distance along its row to the nearest cell of each layer,
// at most HOLD_RINGS + 1 (none within reach). The first layer in bits 0–7, the second in bits 8–15.
var<workgroup> rowNear: array<u32, 416>; // 16 · TILE_SIDE

// `env` of cell p of the box frame: wrapped on the periodic grid, 0 outside a closed grid (gridIndex()).
fn envInBox(p: vec2i) -> u32 {
  let size = vec2i(i32(W()), i32(H()));
  if (P.cfg.z == 0u) {
    let q = ((p % size) + size) % size;
    return env[q.y * size.x + q.x];
  }
  if (any(p < vec2i(0)) || any(p >= size)) { return 0u; }
  return env[p.y * size.x + p.x];
}

// Whether the 16 × 16 cells of workgroup `wid` all lie more than SHAPE_RANGE (4.05 cells) inside the brush. There an
// eraser's byte is 255 (distanceByte), so every outline byte becomes 0: the cell is erased, and so is every cell that
// its shadow weighs (within 1.8 + SHADOW_SOFT = 3.3 cells), so light and shadow are 0 too. Such a workgroup needs no
// tile. A cell's distance is at most its distance from one copy of the segment, which is convex: the 4 corner cell
// centres decide for that copy, on the periodic grid the copy whose middle lies nearest to the block's. Every point
// lies at least 15 / √2 = 10.61 cells from one of the corners, so a brush narrower than that has no such workgroup
// (CORE_RADIUS in sim.ts).
fn eraserCore(wid: vec2u) -> bool {
  let reach = B.radius - SHAPE_RANGE - 0.05;
  if (reach < 10.61) { return false; }
  let size = vec2f(f32(W()), f32(H()));
  var lo = vec2f(B.reach + vec2i(wid) * 16) + 0.5;
  if (P.cfg.z == 0u) { lo -= size * round((lo + 7.5 - 0.5 * (B.a + B.b)) / size); }
  let hi = lo + 15.0;
  let far = max(
    max(segmentDistance(lo), segmentDistance(vec2f(hi.x, lo.y))),
    max(segmentDistance(vec2f(lo.x, hi.y)), segmentDistance(hi)),
  );
  return far <= reach;
}

@compute @workgroup_size(16, 16)
fn outline(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  // The eraser and walls read `env` around a cell (the holds, the shadow) from the tile and its rings, loaded by every
  // invocation of the workgroup (TILED); food and light only at the cell itself, and an eraser's core not at all. Each
  // condition is the same for the whole workgroup.
  let core = CORE && TILED && B.kind == 0u && eraserCore(wid.xy);
  let tiled = TILED && !core;
  if (tiled) {
    let corner = B.reach + vec2i(wid.xy) * 16 - vec2i(HOLD_RINGS);
    for (var e = lid.y * 16u + lid.x; e < 676u; e += 256u) {
      tileEnv[e] = envInBox(corner + vec2i(i32(e % 26u), i32(e / 26u)));
    }
    workgroupBarrier();
    for (var e = lid.y * 16u + lid.x; e < 416u; e += 256u) {
      let row = i32(e / 16u) * TILE_SIDE + i32(e % 16u) + HOLD_RINGS;
      var near = vec2u(u32(HOLD_RINGS) + 1u);
      for (var i = -HOLD_RINGS; i <= HOLD_RINGS; i++) {
        let l = layersOf(tileEnv[row + i]);
        let a = u32(abs(i));
        if (l.x) { near.x = min(near.x, a); }
        if (l.y) { near.y = min(near.y, a); }
      }
      rowNear[e] = near.x | (near.y << 8u);
    }
    workgroupBarrier();
  }
  // The dispatch rounds the box up to whole workgroups: on the periodic grid the cells past it would wrap onto
  // cells of the box and update them twice.
  if (any(gid.xy >= B.extent)) { return; }
  // Outside the arena `paint` changed nothing, so neither does this.
  let cell = boxCell(B.reach + vec2i(gid.xy));
  let q = cell.xy;
  let c = cell.z;
  if (c < 0) { return; }
  if (core) {
    shape[c] = 0u;
    return;
  }
  let local = vec2i(lid.xy) + vec2i(HOLD_RINGS);
  var e = 0u;
  var here = vec2<bool>(false);
  var hold = vec2u(0u);
  if (tiled) {
    // The nearest cell of each layer (Chebyshev, up to HOLD_RINGS; 0 where `env` holds it at q), as holdByte()
    // finds it ring by ring.
    var k = vec2u(u32(HOLD_RINGS) + 1u);
    for (var j = -HOLD_RINGS; j <= HOLD_RINGS; j++) {
      let r = rowNear[u32(i32(lid.y) + HOLD_RINGS + j) * 16u + lid.x];
      k = min(k, max(vec2u(r & 0xffu, r >> 8u), vec2u(u32(abs(j)))));
    }
    here = k == vec2u(0u);
    if (k.x <= u32(HOLD_RINGS)) { hold.x = distanceByte(1.5 - f32(k.x)); }
    if (k.y <= u32(HOLD_RINGS)) { hold.y = distanceByte(1.5 - f32(k.y)); }
    e = tileEnv[local.y * TILE_SIDE + local.x];
  } else {
    e = env[c];
    here = layersOf(e);
  }
  let d = strokeDistance(q, B.radius + SHAPE_RANGE);
  // A union adds the stroke rounded off near its middle line; a subtraction needs only its outline.
  let s = distanceByte(B.radius - d);
  let old = shape[c];
  var wall = old & 0xffu;
  var food = (old >> 8u) & 0xffu;
  var light = (old >> 16u) & 0xffu;
  var shadow = old >> 24u;
  if (POLES) {
    // The outlines of the electrodes: `wall` is the cathode here and `food` the anode. A pole unites with its own
    // layer as a wall does with the walls, rounded for the slope that the renderer lights, and it subtracts from the
    // other pole as a wall does from food. An erase and a wall subtract from both, as an erase does below. Food and
    // light leave the poles, and their strokes run no pass here. The other two bytes stay 0.
    let own = distanceByte(B.radius - rounded(d, B.radius, POLE_RIM));
    switch B.kind {
      case 5u: {
        wall = united(wall, own, here.x, q);
        food = heldBy(min(food, 255u - ownByte(s, q, 255u - food)), here.y, hold.y);
      }
      case 4u: {
        food = united(food, own, here.y, q);
        wall = heldBy(min(wall, 255u - ownByte(s, q, 255u - wall)), here.x, hold.x);
      }
      case 0u, 1u: {
        let t = ownByte(s, q, 255u - max(wall, food));
        wall = heldBy(min(wall, 255u - t), here.x, hold.x);
        food = heldBy(min(food, 255u - t), here.y, hold.y);
      }
      default: {}
    }
    shape[c] = wall | (food << 8u);
    return;
  }
  // A subtraction takes the complement of its byte, held to the cells it paints as a union's (ownByte()): where it
  // erases no cell near q it carves no outline there. It holds every byte of the box: the box holds every cell within
  // HOLD_RINGS of a cell it painted, so every byte whose hold it can change, and the bytes beyond it keep theirs.
  switch B.kind {
    case 0u: {
      let t = ownByte(s, q, 255u - max(wall, food));
      wall = heldBy(min(wall, 255u - t), here.x, hold.x);
      food = heldBy(min(food, 255u - t), here.y, hold.y);
    }
    case 1u: {
      wall = united(wall, distanceByte(B.radius - rounded(d, B.radius, WALL_BEVEL)), here.x, q);
      food = heldBy(min(food, 255u - ownByte(s, q, 255u - food)), here.y, hold.y);
    }
    case 2u: { food = united(food, distanceByte(B.radius - rounded(d, B.radius, FOOD_RIM)), here.y, q); }
    default: {}
  }
  // Light changes with the light, the walls and the eraser; the shadow with the walls and the eraser, which
  // only removes walls: a shadow of 0 stays 0. Both kinds load the tile.
  if (B.kind != 2u) { light = (e >> 16u) & 0xffu; }
  if (B.kind == 1u || (B.kind == 0u && shadow != 0u)) { shadow = shadowByte(q, local); }
  shape[c] = wall | (food << 8u) | (light << 16u) | (shadow << 24u);
}

// Holds every byte of the arena to `env` under the current boundary, after the boundary changed: the
// distances, the light and the shadow follow `env` again where the old boundary counted other cells. A byte lies
// no nearer an outline than the cells of `env` allow (held()), and no farther (floorByte()).
@compute @workgroup_size(16, 16)
fn refresh(@builtin(global_invocation_id) gid: vec3u) {
  let q = vec2i(gid.xy);
  if (any(gid.xy >= vec2u(W(), H())) || cellAt(q) < 0) { return; }
  let c = q.y * i32(W()) + q.x;
  let old = shape[c];
  // floorByte() is at most 96 (one cell) and at most the hold, so the maximum keeps the bytes held.
  let n = nearestCells(q);
  let wall = max(held(old & 0xffu, q, 0u), floorByte(n.x));
  let food = max(held((old >> 8u) & 0xffu, q, 1u), floorByte(n.y));
  // The outlines of the electrodes are the two distances alone.
  if (POLES) {
    shape[c] = wall | (food << 8u);
    return;
  }
  shape[c] = wall | (food << 8u) | (env[c] & 0xff0000u) | (shadowByte(q, vec2i(-1)) << 24u);
}
