// Full-screen pass: trail (or agent counts) → color. Standalone module (no common.wgsl).

// Food, light and walls are compiled in only while something is painted (Simulation.hasEnvironment,
// render.ts). Without them both entry points draw the same pixels and skip the work.
override ENV: bool = true;
// The scent view (ADR 0009, amendment 2026-11-11), compiled in only while it is on (render.ts).
override SCENT: bool = false;

struct View {
  canvas: vec2f,      // canvas size, pixels
  center: vec2f,      // grid position shown at the canvas center, cells
  scale: f32,         // cells per pixel
  exposure: f32,      // linear gain from trail units to radiance
  style: u32,         // 0 glow, 1 gel, 2 paper, 3 agents
  boundary: u32,      // 0 wrap, 1 box, 2 dish
  colors: array<vec4f, 4>, // strain colors, linear RGB
  background: vec4f,  // linear RGB
  frame: vec4u,       // frame counter, strain count, overlays on/off, occupancy on/off (collision mode)
  fx: vec4f,          // bloom strength, black level (summed trail), copies (packView), unused
  scentFx: vec4f,     // scent view: map level (0 to 3), repellent drawn (1) or not (0), unused, unused
  scentHalf: vec4f,   // scent view: half the spread of the sensors of up to 4 strains (0: none), cells
  scentHolds: vec4f,  // scent view: the hold of a strand of each, as a difference of food scent (scentSensors())
}

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var trail: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> shape: array<u32>; // outline distances and light (paint.wgsl `outline`)
@group(0) @binding(3) var<storage, read> counts: array<vec4u>;
@group(0) @binding(4) var bloom: texture_2d<f32>;
@group(0) @binding(5) var bloomSampler: sampler;
@group(0) @binding(6) var heights: texture_2d<f32>; // gel style: written by `heightField` each frame
@group(0) @binding(7) var heightSampler: sampler;   // bilinear, clamped
@group(0) @binding(8) var<storage, read> occ: array<u32>; // agents per cell, kept in collision mode only
@group(0) @binding(9) var scent: texture_2d<f32>; // food scent (r) and light repellent (g); read by the scent view only
@group(0) @binding(10) var scentLevels: texture_2d<f32>; // the scent on a coarser map (scentDown), zoomed out

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn size() -> vec2i { return vec2i(textureDimensions(trail)); }

// Cell index for the grid, wrapped (periodic) or −1 outside the arena.
fn cellAt(c: vec2i) -> i32 {
  let s = size();
  var q = c;
  if (V.boundary == 0u) {
    q = ((c % s) + s) % s;
  } else if (any(c < vec2i(0)) || any(c >= s)) {
    return -1;
  }
  return q.y * s.x + q.x;
}

fn trailAt(c: vec2i) -> vec4f {
  let i = cellAt(c);
  if (i < 0) { return vec4f(0.0); }
  return textureLoad(trail, vec2i(i % size().x, i / size().x), 0);
}

// Manual bilinear filter: rgba32float is not filterable without an optional feature.
fn bilinear(p: vec2f) -> vec4f {
  let q = p - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let a = mix(trailAt(i), trailAt(i + vec2i(1, 0)), f.x);
  let b = mix(trailAt(i + vec2i(0, 1)), trailAt(i + vec2i(1, 1)), f.x);
  return mix(a, b, f.y);
}

// Four taps spread over the pixel footprint when zoomed out, against aliasing.
fn trailFiltered(p: vec2f) -> vec4f {
  if (V.scale <= 1.0) { return bilinear(p); }
  let o = 0.25 * V.scale;
  return 0.25 * (bilinear(p + vec2f(-o, -o)) + bilinear(p + vec2f(o, -o)) +
                 bilinear(p + vec2f(-o, o)) + bilinear(p + vec2f(o, o)));
}

// Auto levels: subtract the black level from the summed trail, keep the strain ratios.
fn levels(v: vec4f) -> vec4f {
  let t = v.x + v.y + v.z + v.w;
  return v * (max(t - V.fx.y, 0.0) / max(t, 1e-20));
}

// The strain ratios of a trail value; strain A where there is no trail.
fn strainMix(v: vec4f) -> vec4f {
  let t = v.x + v.y + v.z + v.w;
  return select(vec4f(1.0, 0.0, 0.0, 0.0), v / t, t > 1e-6);
}

fn tint(v: vec4f) -> vec3f {
  var c = vec3f(0.0);
  for (var s = 0u; s < V.frame.y; s++) { c += v[s] * V.colors[s].rgb; }
  return c;
}

fn srgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

fn hash(p: vec2u) -> f32 {
  var x = p.x * 1664525u + p.y * 1013904223u + V.frame.x * 2654435761u;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return f32((x ^ (x >> 16u)) >> 8u) * (1.0 / 16777216.0);
}

// Coverage of a shape from its signed distance (cells, positive inside): a ramp one pixel wide.
fn cover(sd: f32) -> f32 {
  let w = 0.5 * V.scale;
  return smoothstep(-w, w, sd);
}

// Linear light per strain, then a per-channel exponential tone curve: dense overlaps turn white-hot.
// `base` is what lies below the trail: the background, or food on it.
fn glow(v: vec4f, halo: vec4f, base: vec3f) -> vec3f {
  // The bloom chain sums 5 blur levels (bloom.ts); divide to keep the strength scale intuitive.
  let l = 1.0 - exp(-(tint(v) * V.exposure + tint(halo) * V.fx.x * 0.2));
  return base + (1.0 - base) * l;
}

// Ink on paper: each strain absorbs the complement of its color (Beer–Lambert).
fn paper(v: vec4f, base: vec3f) -> vec3f {
  var absorb = vec3f(0.0);
  for (var s = 0u; s < V.frame.y; s++) {
    absorb += v[s] * (0.15 + 0.85 * (1.0 - V.colors[s].rgb));
  }
  return base * exp(-absorb * V.exposure);
}

// Gel height field, one texel per cell plus a one-cell border, rendered before the main pass
// (render.ts): the summed trail above the black level times the exposure. That is the sum of
// levels(v) · exposure (levels() keeps the strain ratios) before the max with 0, and an affine
// function of the trail, so filtering it equals filtering the trail first. Clamped to keep fp16
// finite. In collision mode occupied food cells raise it by up to PRESENCE (see `presence`), weighted as
// the spline of `envAt` weighs them at the cell centre, so the gel matches the glow and has no sharp dents.
@fragment
fn heightField(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let c = vec2i(floor(frag.xy)) - 1;
  let v = trailAt(c);
  var y = (v.x + v.y + v.z + v.w - V.fx.y) * V.exposure;
  if (ENV && V.frame.z != 0u) {
    let own = shape[shapeIndex(c)];
    if ((own & 0xffu) >= 128u && cellAt(c) >= 0) { y = besideWall(c, y); }
    // A food byte of 0 lies SHAPE_RANGE cells outside the food, so no cell of the 3 × 3 holds food.
    if (V.frame.w != 0u && ((own >> 8u) & 0xffu) != 0u) {
      let b = spline(0.0);
      var w = 0.0;
      for (var j = 0; j < 3; j++) {
        for (var i = 0; i < 3; i++) {
          let n = c + vec2i(i - 1, j - 1);
          w += b[i] * b[j] * presenceWeight(cellAt(n), foodDistance(shape[shapeIndex(n)]));
        }
      }
      y = mix(y, max(y, 0.0), w) + PRESENCE * w;
    }
  }
  return vec4f(clamp(y, -6e4, 6e4), 0.0, 0.0, 1.0);
}

// The height of a wall cell: the mean of its neighbours outside walls. Walls hold no trail, so their cells
// would pull the filtered height down in steps of whole cells along a slanted wall, and the gel would light
// that staircase where the smooth outline of the wall no longer covers it. The wall is drawn over this.
fn besideWall(c: vec2i, y: f32) -> f32 {
  var sum = 0.0;
  var n = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let k = c + vec2i(i, j);
      if (cellAt(k) < 0 || (shape[shapeIndex(k)] & 0xffu) >= 128u) { continue; }
      let t = trailAt(k);
      sum += (t.x + t.y + t.z + t.w - V.fx.y) * V.exposure;
      n += 1.0;
    }
  }
  return select(y, sum / n, n > 0.0);
}

// The height field with hardware bilinear filtering at grid position q (wrapped for the periodic
// boundary; outside a closed arena the border holds the value of an empty cell).
fn heightAt(q: vec2f) -> f32 {
  let s = vec2f(size());
  let p = select(q, q - s * floor(q / s), V.boundary == 0u);
  return textureSampleLevel(heights, heightSampler, (p + 1.0) / (s + 2.0), 0.0).r;
}

// Four taps spread over the pixel footprint when zoomed out, like trailFiltered().
fn heightFiltered(p: vec2f) -> f32 {
  if (V.scale <= 1.0) { return heightAt(p); }
  let o = 0.25 * V.scale;
  return 0.25 * (heightAt(p + vec2f(-o, -o)) + heightAt(p + vec2f(o, -o)) +
                 heightAt(p + vec2f(-o, o)) + heightAt(p + vec2f(o, o)));
}

fn height(p: vec2f) -> f32 { return 1.0 - exp(-max(heightFiltered(p), 0.0)); }

// Trail as a height field, lit like a wet gel, over `base`. The gel is clear enough to show a flake of
// food below it (`f`, see flakeAt): over food its colour takes in the flake's, grain and outline.
fn gel(p: vec2f, v: vec4f, base: vec3f, f: Flake) -> vec3f {
  let d = max(V.scale, 0.75);
  let h = height(p);
  let gx = height(p + vec2f(d, 0.0)) - height(p - vec2f(d, 0.0));
  let gy = height(p + vec2f(0.0, d)) - height(p - vec2f(0.0, d));
  let n = normalize(vec3f(-gx, -gy, 0.35 * d));
  let l = normalize(vec3f(-0.45, -0.6, 0.65));
  let diffuse = max(dot(n, l), 0.0);
  let spec = pow(max(dot(n, normalize(l + vec3f(0.0, 0.0, 1.0))), 0.0), 48.0);
  let total = v.x + v.y + v.z + v.w;
  var albedo = select(V.colors[0].rgb, tint(v) / max(total, 1e-6), total > 1e-6);
  if (ENV && f.cover > 0.0) { albedo = mix(albedo, mix(f.body, f.edge, f.rim * 0.85), GEL_CLEAR * f.cover); }
  let lit = albedo * (0.25 + 0.9 * diffuse) + 0.6 * spec * h;
  return mix(base, lit, smoothstep(0.02, 0.35, h));
}

// Agents in the cell under p, per strain. `counts` holds the agents that moved this step. In collision
// mode most agents are blocked and stay put, so the occupancy adds those that stayed, in the strain
// ratios of the cell's trail (strain A where there is none): the occupancy has no strains.
fn agentsAt(p: vec2f) -> vec4f {
  let i = cellAt(vec2i(floor(p)));
  if (i < 0) { return vec4f(0.0); }
  let moved = vec4f(counts[i]);
  if (V.frame.w == 0u) { return moved; }
  let stayed = max(f32(occ[i]) - (moved.x + moved.y + moved.z + moved.w), 0.0);
  return moved + strainMix(trailAt(vec2i(floor(p)))) * stayed;
}

// ---- Food, light and walls (ENV) -------------------------------------------------------------------

const SHAPE_RANGE = 4.0; // cells; outline distances in `shape` are clamped to ± this (paint.wgsl)
const PRESENCE = 0.9;      // tone-curve input of an occupied food cell: 1 − e^−0.9 ≈ 0.59 (see `presence`)
const PRESENCE_RAMP = 1.5; // cells inside the food outline over which presence fades in
const GEL_CLEAR = 0.6;     // how much of a flake of food shows through the gel style's trail (see gel)
const SUN = normalize(vec3f(-0.45, -0.6, 0.65)); // toward the light, as in gel(): top left (grid y points down)

// The cell of `shape` for a grid cell: wrapped on the periodic grid, else clamped to the arena, so an
// outline that touches the edge of a closed arena stays whole up to it. Outside the dish `shape` holds what
// other boundaries left there (paint.wgsl leaves it alone): a cell there reads the cell inside the rim on
// the way to the centre.
fn shapeIndex(c: vec2i) -> i32 {
  let s = size();
  var q = clamp(c, vec2i(0), s - 1);
  if (V.boundary == 0u) {
    q = ((c % s) + s) % s;
  } else if (V.boundary == 2u) {
    let o = 0.5 * vec2f(s);
    let m = vec2f(c) + 0.5 - o;
    let rim = 0.5 * f32(min(s.x, s.y)) - 1.0; // dishRadius() in common.wgsl
    if (dot(m, m) > rim * rim) { q = vec2i(floor(o + m * ((rim - 0.75) * inverseSqrt(dot(m, m))))); }
  }
  return q.y * s.x + q.x;
}

// The 3 × 3 cells of `shape` around cell c, row by row: the cells the spline reads at a point in c. As
// shapeIndex(), but the columns and rows are wrapped or clamped once: integer remainders cost.
fn shapeCells(c: vec2i) -> array<u32, 9> {
  let s = size();
  var w: array<u32, 9>;
  if (V.boundary == 2u) {
    let m = vec2f(c) + 0.5 - 0.5 * vec2f(s);
    let rim = 0.5 * f32(min(s.x, s.y)) - 1.0;
    if (dot(m, m) > (rim - 1.5) * (rim - 1.5)) {
      // Near the rim: some of the 3 × 3 cells may lie outside the dish.
      for (var j = 0; j < 3; j++) {
        for (var i = 0; i < 3; i++) { w[j * 3 + i] = shape[shapeIndex(c + vec2i(i - 1, j - 1))]; }
      }
      return w;
    }
  }
  var xs = clamp(vec3i(c.x - 1, c.x, c.x + 1), vec3i(0), vec3i(s.x - 1));
  var ys = clamp(vec3i(c.y - 1, c.y, c.y + 1), vec3i(0), vec3i(s.y - 1));
  if (V.boundary == 0u) {
    let q = ((c % s) + s) % s;
    xs = vec3i(select(q.x - 1, s.x - 1, q.x == 0), q.x, select(q.x + 1, 0, q.x == s.x - 1));
    ys = vec3i(select(q.y - 1, s.y - 1, q.y == 0), q.y, select(q.y + 1, 0, q.y == s.y - 1));
  }
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 3; i++) { w[j * 3 + i] = shape[ys[j] * s.x + xs[i]]; }
  }
  return w;
}

// The food distance (cells) in a cell of `shape`.
fn foodDistance(s: u32) -> f32 {
  return (f32((s >> 8u) & 0xffu) / 255.0 - 0.5) * 2.0 * SHAPE_RANGE;
}

// How much the agent in cell i shows on food (see `presence`): 0 without an agent or outside the food,
// rising to 1 over the outer PRESENCE_RAMP cells inside the outline. A smooth function of the distance,
// so the presence follows the outline without cell steps and leaves the rim of the flake visible.
fn presenceWeight(i: i32, food: f32) -> f32 {
  if (i < 0 || occ[i] == 0u) { return 0.0; }
  return smoothstep(0.0, PRESENCE_RAMP, food);
}

struct Env {
  wall: f32,          // signed distance to the wall outline, cells, positive inside: the spline, for the light
  food: f32,          // the same for food
  wallCover: f32,     // `wall`, set right at the centre of the cell under p (see envAt), for the coverage
  foodCover: f32,
  light: f32,         // 0…1, as the simulation holds it
  shadow: f32,        // 0…1, the drop shadow of the walls (paint.wgsl `shadowByte`)
  wallGrad: vec2f,    // gradient of `wall`, about unit length near the outline
  foodGrad: vec2f,
  cell: vec2i,        // the cell under p, the middle one of the 3 × 3 the values come from
  weightX: vec3f,     // the spline weights of their columns and rows
  weightY: vec3f,
}

// Quadratic B-spline weights of the three cells around a point u (−0.5…0.5) from the nearest cell
// centre, and their derivatives. The weights sum to 1 and reproduce a linear function exactly.
fn spline(u: f32) -> vec3f {
  return vec3f(0.5 * (0.5 - u) * (0.5 - u), 0.75 - u * u, 0.5 * (0.5 + u) * (0.5 + u));
}

const CENTRE = vec3f(0.125, 0.75, 0.125); // spline(0.0): the weights at a cell centre

fn splineSlope(u: f32) -> vec3f {
  return vec3f(u - 0.5, -2.0 * u, u + 0.5);
}

// The distances at p from the 3 × 3 cells around it (`cells`, from shapeCells of the cell under p), as a
// quadratic B-spline. Along a straight outline the distance is linear, so the outline is exact there. The
// spline has a continuous gradient, so a curved outline stays curved (bilinear interpolation draws it as a
// polygon) and the lit rims have no seams at the cell edges. The gradient comes from the same cells.
//
// The spline weighs the cell under p only 0.5625 at its centre, so a wall or food thinner than about half a
// cell (or a hole as thin in it) would come out on the other side of its outline there, unlike `env`. Where
// it does, `wallCover` and `foodCover` add a bump that is the cell's own value at its centre and fades to
// nothing at the edges of the cell, so every cell centre is drawn on the side of the outline that `env` holds
// and neighbouring cells still meet. Elsewhere they are the spline.
fn envAt(p: vec2f, cells: array<u32, 9>) -> Env {
  let q = p - 0.5;
  let c = vec2i(floor(q + 0.5));
  let u = q - vec2f(c);
  let wx = spline(u.x);
  let wy = spline(u.y);
  let sx = splineSlope(u.x);
  let sy = splineSlope(u.y);
  var v = vec4f(0.0);
  var gx = vec4f(0.0);
  var gy = vec4f(0.0);
  var centre = vec2f(0.0); // the spline at the centre of the cell (weights 0.125, 0.75, 0.125 per axis)
  for (var j = 0; j < 3; j++) {
    var row = vec4f(0.0);
    var rowSlope = vec4f(0.0);
    for (var i = 0; i < 3; i++) {
      let s = unpack4x8unorm(cells[j * 3 + i]);
      row += wx[i] * s;
      rowSlope += sx[i] * s;
      centre += CENTRE[i] * CENTRE[j] * s.xy;
    }
    v += wy[j] * row;
    gx += wy[j] * rowSlope;
    gy += sy[j] * row;
  }
  let k = 2.0 * SHAPE_RANGE;
  var e: Env;
  e.wall = (v.x - 0.5) * k;
  e.food = (v.y - 0.5) * k;
  // The cell's own distances, against the spline's at its centre.
  let own = (unpack4x8unorm(cells[4]).xy - 0.5) * k;
  centre = (centre - 0.5) * k;
  let side = (1.0 - 4.0 * u.x * u.x) * (1.0 - 4.0 * u.y * u.y);
  let fix = select(vec2f(0.0), (own - centre) * side * side, (own > vec2f(0.0)) != (centre > vec2f(0.0)));
  e.wallCover = e.wall + fix.x;
  e.foodCover = e.food + fix.y;
  e.light = clamp(v.z, 0.0, 1.0);
  e.shadow = clamp(v.w, 0.0, 1.0);
  e.wallGrad = vec2f(gx.x, gy.x) * k;
  e.foodGrad = vec2f(gx.y, gy.y) * k;
  e.cell = c;
  e.weightX = wx;
  e.weightY = wy;
  return e;
}

// Per style: glow (and agents), gel, paper.
fn byStyle(glowStyle: vec3f, gelStyle: vec3f, paperStyle: vec3f) -> vec3f {
  switch V.style {
    case 1u: { return gelStyle; }
    case 2u: { return paperStyle; }
    default: { return glowStyle; }
  }
}

// The normal of a rim that rises over `width` cells inside an outline: a smoothstep of the distance.
fn rimNormal(sd: f32, grad: vec2f, width: f32, steep: f32) -> vec3f {
  let t = clamp(sd / width, 0.0, 1.0);
  let rise = 6.0 * t * (1.0 - t) / width;
  return normalize(vec3f(-grad * rise * steep, 1.0));
}

fn lattice(c: vec2i) -> f32 {
  var x = u32(c.x) * 1664525u + u32(c.y) * 1013904223u;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return f32((x ^ (x >> 16u)) >> 8u) * (1.0 / 16777216.0);
}

// Value noise that repeats every `period` lattice steps.
fn valueNoise(q: vec2f, period: vec2i) -> f32 {
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let u = f * f * (3.0 - 2.0 * f);
  let i0 = ((i % period) + period) % period;
  let i1 = ((i + 1) % period + period) % period;
  let a = mix(lattice(i0), lattice(vec2i(i1.x, i0.y)), u.x);
  let b = mix(lattice(vec2i(i0.x, i1.y)), lattice(i1), u.x);
  return mix(a, b, u.y);
}

// Grain fixed to the dish: about 320 lattice steps on the long side of any grid (4 px per step when
// fitted to a 1280 px canvas). A whole number of steps spans the grid, so the grain repeats with it
// and a flake across the wrap seam shows no seam.
fn grain(p: vec2f) -> f32 {
  let s = vec2f(size());
  let n = max(round(s * (320.0 / max(s.x, s.y))), vec2f(1.0));
  let q = p * n / s;
  let period = vec2i(n);
  return 0.65 * valueNoise(q, period) + 0.35 * valueNoise(q * 3.0 + vec2f(17.3, 5.1), 3 * period);
}

// A flake of food: an oat flake, with grain, a rim that rises over 2 cells lit like the gel, and an outline
// per style.
struct Flake {
  body: vec3f,  // the grain, lit by the rim
  edge: vec3f,  // the colour of the outline
  rim: f32,     // how much of the outline colour lies over the body, 0…1
  cover: f32,   // how much of the pixel the flake covers, 0…1
}

fn flakeAt(p: vec2f, e: Env) -> Flake {
  var f: Flake;
  f.cover = cover(e.foodCover);
  if (f.cover <= 0.0) { return f; }
  let n = rimNormal(e.food, e.foodGrad, 2.0, 1.2);
  let shade = 0.55 + 0.65 * max(dot(n, SUN), 0.0);
  f.body = byStyle(vec3f(0.15, 0.105, 0.045), vec3f(0.46, 0.33, 0.14), vec3f(0.80, 0.65, 0.40)) *
           ((0.72 + 0.56 * grain(p)) * shade);
  f.edge = byStyle(vec3f(0.32, 0.24, 0.12), vec3f(0.66, 0.52, 0.30), vec3f(0.46, 0.34, 0.18));
  f.rim = 1.0 - smoothstep(0.0, max(0.6, 1.5 * V.scale), e.food);
  return f;
}

// What lies below the trail: the background, or the flake on it. The trail and the agents lie on top.
fn substrate(f: Flake) -> vec3f {
  let bg = V.background.rgb;
  if (f.cover <= 0.0) { return bg; }
  return mix(mix(bg, f.body, f.cover * 0.95), f.edge, f.cover * f.rim * 0.85);
}

// Blocked agents deposit nothing (Jones 2010, p. 133), so in collision mode food packed with agents
// holds little trail and would look empty. Occupied food cells are drawn as trail at the fixed level
// PRESENCE, in the strain ratios of the trail around them (the spline of `envAt` over the cells'
// `presenceWeight`). Display only: it feeds the glow, the paper and (in `heightField`) the gel relief.
fn presence(e: Env, cells: array<u32, 9>, raw: vec4f) -> vec4f {
  let a = cover(e.foodCover);
  if (a <= 0.0) { return vec4f(0.0); }
  // The cells as cellAt() numbers them, wrapped with comparisons: integer remainders cost.
  let s = size();
  var cx = vec3i(e.cell.x - 1, e.cell.x, e.cell.x + 1);
  var cy = vec3i(e.cell.y - 1, e.cell.y, e.cell.y + 1);
  if (V.boundary == 0u) {
    let q = ((e.cell % s) + s) % s;
    cx = vec3i(select(q.x - 1, s.x - 1, q.x == 0), q.x, select(q.x + 1, 0, q.x == s.x - 1));
    cy = vec3i(select(q.y - 1, s.y - 1, q.y == 0), q.y, select(q.y + 1, 0, q.y == s.y - 1));
  }
  var share = 0.0;
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 3; i++) {
      let inGrid = cx[i] >= 0 && cy[j] >= 0 && cx[i] < s.x && cy[j] < s.y;
      let index = select(-1, cy[j] * s.x + cx[i], inGrid);
      share += e.weightX[i] * e.weightY[j] * presenceWeight(index, foodDistance(cells[j * 3 + i]));
    }
  }
  return strainMix(raw) * (a * share * PRESENCE / V.exposure);
}

// A wall: a ridge whose outer 1.5 cells slope up, lit like the gel, with a soft drop shadow.
fn walls(c: vec3f, e: Env) -> vec3f {
  let aw = cover(e.wallCover);
  let shadow = e.shadow * (1.0 - aw);
  let o = c * (1.0 - byStyle(vec3f(0.75), vec3f(0.6), vec3f(0.3)).x * shadow);
  if (aw <= 0.0) { return o; }
  let n = rimNormal(e.wall, e.wallGrad, 1.5, 1.0);
  let diffuse = max(dot(n, SUN), 0.0);
  let spec = pow(max(dot(n, normalize(SUN + vec3f(0.0, 0.0, 1.0))), 0.0), 40.0);
  let albedo = byStyle(vec3f(0.05, 0.055, 0.065), vec3f(0.11, 0.10, 0.08), vec3f(0.68, 0.66, 0.62));
  let wall = albedo * (0.35 + 0.9 * diffuse) + byStyle(vec3f(0.06), vec3f(0.3), vec3f(0.04)).x * spec;
  return mix(o, wall, aw);
}

// The trail at p, bilinear over the 4 cells around it but without the cells of walls (`cells`: shapeCells of the
// cell under p, which holds those 4). Walls hold no trail, so the plain filter fell to nothing towards their
// cells, in steps along a slanted wall that its smooth outline no longer covers. The weights of the other cells
// are scaled up to 1, as if the trail went on up to the wall. Only for one bilinear lookup (zoomed in).
fn trailBesideWalls(p: vec2f, cells: array<u32, 9>) -> vec4f {
  let q = p - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let o = i - vec2i(floor(p)) + 1; // the first of the 4 cells in `cells`: column and row 0 or 1
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var dy = 0; dy < 2; dy++) {
    for (var dx = 0; dx < 2; dx++) {
      if ((cells[(o.y + dy) * 3 + o.x + dx] & 0xffu) >= 128u) { continue; }
      let w = select(1.0 - f.x, f.x, dx == 1) * select(1.0 - f.y, f.y, dy == 1);
      sum += w * trailAt(i + vec2i(dx, dy));
      total += w;
    }
  }
  return select(vec4f(0.0), sum / total, total > 0.0);
}

// Whether a wall holds one of the 4 cells around p that bilinear() reads.
fn wallBeside(p: vec2f, cells: array<u32, 9>) -> bool {
  let o = vec2i(floor(p - 0.5)) - vec2i(floor(p)) + 1;
  var wall = 0u;
  for (var dy = 0; dy < 2; dy++) {
    for (var dx = 0; dx < 2; dx++) { wall |= cells[(o.y + dy) * 3 + o.x + dx] & 0x80u; }
  }
  return wall != 0u;
}

// The arena at grid position p: the styled trail on its substrate, then light and walls on top.
fn scene(p: vec2f, s: vec2f) -> vec3f {
  var near = false;
  var cells: array<u32, 9>;
  if (ENV && V.frame.z != 0u) {
    // The cells the spline reads decide whether anything is painted near p; only then reconstruct. The
    // light of a cell reaches into its neighbours, which may hold nothing.
    cells = shapeCells(vec2i(floor(p)));
    var any = 0u;
    for (var k = 0; k < 9; k++) { any |= cells[k]; }
    near = any != 0u;
  }
  var raw: vec4f;
  if (ENV && near && V.scale <= 1.0 && wallBeside(p, cells)) {
    raw = trailBesideWalls(p, cells);
  } else {
    raw = trailFiltered(p);
  }
  var v = levels(raw);
  let halo = textureSampleLevel(bloom, bloomSampler, p / s, 0.0);
  var base = V.background.rgb;
  var e: Env;
  var f: Flake;
  if (ENV && near) {
    e = envAt(p, cells);
    f = flakeAt(p, e);
    base = substrate(f);
    if (V.frame.w != 0u) { v += presence(e, cells, raw); }
  }
  var c: vec3f;
  switch V.style {
    case 1u: { c = gel(p, v, base, f); }
    case 2u: { c = paper(v, base); }
    case 3u: { c = glow(agentsAt(p), vec4f(0.0), base); }
    default: { c = glow(v, halo, base); }
  }
  if (near) {
    c += e.light * select(vec3f(0.22, 0.2, 0.12), vec3f(-0.04, -0.03, -0.12), V.style == 2u);
  }
  // The view lies below the flake of food and the walls.
  if (SCENT) { c = mix(scentView(p, c, near, cells), c, f.cover); }
  if (near) {
    c = walls(c, e);
  }
  return c;
}

// ---- Scent view (SCENT) -------------------------------------------------------------------------------
// The food scent and the light repellent over the picture, below the flake of food and the walls. Display only. A
// glow per layer that fades out as the scent gets weaker, on a fixed log scale from 0.01 to 10,000 and more, so two
// scenes or two models compare directly. One line marks where the food steers an agent across its sensors as hard as
// a strand holds it (V.scentHalf, V.scentHolds; scentSensors() in scent.ts). src/engine/scent.ts holds the same
// numbers.

const SCENT_LOW = -2.0;            // log10 of the lowest level drawn: 0.01
const SCENT_TOP = 6.0;             // powers of ten from 0.01 to the top of the glow, 10^4; the glow stays above it
const SCENT_GLOW = 0.45;           // opacity of the glow at the top
const SCENT_LINE = 0.8;            // opacity of the line
const SCENT_PAPER_FILL = 1.5;      // the glow over paper, times this: a light colour shows the same opacity less
const SCENT_FLAT = 1e-4;           // powers of ten per pixel below which the scent counts as flat
const LN10 = 2.302585093;

// The scent at p and its gradient (per cell) for both layers, and the weight of the cells that hold scent among those
// the lookup reads (0: none, in a wall).
struct Scent {
  v: vec2f,
  gx: vec2f,
  gy: vec2f,
  w: f32,
}

// The texel of the scent for grid cell c in a closed arena: clamped to the box, and outside the dish the cell inside
// the rim on the way to the centre (as shapeIndex). The arena has no flux across its edge, so the scent of its outer
// cells goes on up to the edge, with no drop beside it.
fn scentTexel(c: vec2i) -> vec2i {
  let s = size();
  var q = clamp(c, vec2i(0), s - 1);
  if (V.boundary == 2u) {
    let o = 0.5 * vec2f(s);
    let m = vec2f(c) + 0.5 - o;
    let rim = 0.5 * f32(min(s.x, s.y)) - 1.0;
    if (dot(m, m) > rim * rim) { q = vec2i(floor(o + m * ((rim - 0.75) * inverseSqrt(dot(m, m))))); }
  }
  return q;
}

// The 4 cells around p that a lookup reads: top left, top right, bottom left, bottom right. On the periodic grid the
// columns and rows are wrapped once, with one remainder each: remainders cost.
fn scentCells(p: vec2f) -> array<vec2i, 4> {
  let s = size();
  let i = vec2i(floor(p - 0.5));
  var x = vec2i(i.x, i.x + 1);
  var y = vec2i(i.y, i.y + 1);
  if (V.boundary == 0u) {
    let r = i % s;
    let w = select(r, r + s, r < vec2i(0));
    x = vec2i(w.x, select(w.x + 1, 0, w.x == s.x - 1));
    y = vec2i(w.y, select(w.y + 1, 0, w.y == s.y - 1));
  } else {
    x = clamp(x, vec2i(0), vec2i(s.x - 1));
    y = clamp(y, vec2i(0), vec2i(s.y - 1));
  }
  var t = array<vec2i, 4>(vec2i(x.x, y.x), vec2i(x.y, y.x), vec2i(x.x, y.y), vec2i(x.y, y.y));
  let m = p - 0.5 * vec2f(s);
  let rim = 0.5 * f32(min(s.x, s.y)) - 1.0;
  if (V.boundary == 2u && dot(m, m) > (rim - 1.5) * (rim - 1.5)) {
    // Near the rim: some of the 4 cells may lie outside the dish.
    t = array<vec2i, 4>(scentTexel(i), scentTexel(i + vec2i(1, 0)), scentTexel(i + vec2i(0, 1)),
                        scentTexel(i + vec2i(1, 1)));
  }
  return t;
}

// Bilinear over the 4 cells around p, without the cells that `open` marks 0 (walls, which hold no scent): the
// weights of the others are scaled up to 1, as trailBesideWalls() does for the trail. The gradient comes with it.
fn scentBilinear(p: vec2f, open: vec4f) -> Scent {
  let t = scentCells(p);
  let f = fract(p - 0.5);
  return scentMix(textureLoad(scent, t[0], 0).xy, textureLoad(scent, t[1], 0).xy, textureLoad(scent, t[2], 0).xy,
                  textureLoad(scent, t[3], 0).xy, f, open);
}

// Which of the 4 cells around p that scentBilinear() reads hold no wall: 1 open, 0 wall.
fn scentOpenAt(p: vec2f) -> vec4f {
  let t = scentCells(p);
  let x = size().x;
  let walls = vec4u(shape[t[0].y * x + t[0].x], shape[t[1].y * x + t[1].x], shape[t[2].y * x + t[2].x],
                    shape[t[3].y * x + t[3].x]) & vec4u(0x80u);
  return select(vec4f(1.0), vec4f(0.0), walls != vec4u(0u));
}

// The bilinear mix of a (top left), b (top right), c (bottom left) and d (bottom right) at fraction f, without the
// corners that `open` weighs 0, with its gradient per step between the samples.
fn scentMix(a: vec2f, b: vec2f, c: vec2f, d: vec2f, f: vec2f, open: vec4f) -> Scent {
  let w = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y) * open;
  let wx = vec4f(f.y - 1.0, 1.0 - f.y, -f.y, f.y) * open;
  let wy = vec4f(f.x - 1.0, -f.x, 1.0 - f.x, f.x) * open;
  let total = w.x + w.y + w.z + w.w;
  var r: Scent;
  if (total <= 0.0) { return r; }
  r.w = total;
  let sum = a * w.x + b * w.y + c * w.z + d * w.w;
  r.v = sum / total;
  r.gx = (a * wx.x + b * wx.y + c * wx.z + d * wx.w - r.v * (wx.x + wx.y + wx.z + wx.w)) / total;
  r.gy = (a * wy.x + b * wy.y + c * wy.z + d * wy.w - r.v * (wy.x + wy.y + wy.z + wy.w)) / total;
  return r;
}

// The scent at p from the scent s at a point d cells away, with its logarithm going on in a straight line: the box
// edge takes the slope of the cells inside it, so a line keeps its course and width up to the edge.
fn scentFrom(s: Scent, d: vec2f) -> Scent {
  let k = exp(select(vec2f(0.0), (s.gx * d.x + s.gy * d.y) / s.v, s.v > vec2f(0.0)));
  return Scent(s.v * k, s.gx * k, s.gy * k, s.w);
}

// Texels per side of the coarse map of level k (1 to 3): the grid side over 2^k, rounded up. Its texels tile the
// grid exactly, each s / n cells wide, so on the periodic grid the map wraps with the grid.
fn scentLevelSize(k: u32) -> vec2i {
  return (size() + i32((1u << k) - 1u)) >> vec2u(k);
}

// 1 where a cell holds scent (in the arena, not a wall), else 0.
fn scentOpen(c: vec2i) -> f32 {
  let s = size();
  if ((shape[c.y * s.x + c.x] & 0x80u) != 0u) { return 0.0; }
  if (V.boundary == 2u && distance(vec2f(c) + 0.5, 0.5 * vec2f(s)) > 0.5 * f32(min(s.x, s.y)) - 1.0) { return 0.0; }
  return 1.0;
}

// After steps only, the coarse map's pass refreshes the scent of its texels (x, y) and keeps their share (z), which
// only the shape changes (render.ts): a step leaves no scent in walls or outside the dish (diffuse.wgsl `diffuse`), so
// the sum over every cell of a texel is the sum over its open cells, and the pass reads no shape.
override SUM_ONLY: bool = false;

// The scent on the coarse map of level V.scentFx.x, one texel per fragment: the mean over the cells of the arena
// that the texel covers, each by the share it covers (walls and cells outside the dish count 0), times the share that
// holds scent (z). Zoomed out, a pixel reads 4 texels of this map instead of 4 cells far apart from those of the
// pixels beside it, which missed the cache (8 cells per pixel at 2560 × 1600: 17 ms against 0.6 ms with the reads
// together).
@fragment
fn scentDown(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let s = size();
  let span = vec2f(s) / vec2f(scentLevelSize(u32(V.scentFx.x))); // cells per texel
  let lo = floor(frag.xy) * span;
  let hi = lo + span;
  var sum = vec3f(0.0);
  for (var y = i32(floor(lo.y)); f32(y) < hi.y && y < s.y; y++) {
    let wy = min(hi.y, f32(y + 1)) - max(lo.y, f32(y));
    for (var x = i32(floor(lo.x)); f32(x) < hi.x && x < s.x; x++) {
      let c = vec2i(x, y);
      var w = (min(hi.x, f32(x + 1)) - max(lo.x, f32(x))) * wy;
      if (!SUM_ONLY) { w *= scentOpen(c); }
      sum += w * vec3f(textureLoad(scent, c, 0).xy, 1.0);
    }
  }
  return vec4f(sum / (span.x * span.y), 0.0);
}

// The scent at p on the coarse map of level k: bilinear over its 4 texels around p, each weighed by the share of
// it that holds scent, and the gradient per cell.
fn scentCoarse(p: vec2f, k: u32) -> Scent {
  let s = size();
  let n = scentLevelSize(k);
  let ratio = vec2f(n) / vec2f(s); // texels per cell
  let q = p * ratio - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  var x = vec2i(i.x, i.x + 1);
  var y = vec2i(i.y, i.y + 1);
  if (V.boundary == 0u) {
    let r = i % n;
    let w = select(r, r + n, r < vec2i(0));
    x = vec2i(w.x, select(w.x + 1, 0, w.x == n.x - 1));
    y = vec2i(w.y, select(w.y + 1, 0, w.y == n.y - 1));
  } else {
    x = clamp(x, vec2i(0), vec2i(n.x - 1));
    y = clamp(y, vec2i(0), vec2i(n.y - 1));
  }
  let a = textureLoad(scentLevels, vec2i(x.x, y.x), 0).xyz;
  let b = textureLoad(scentLevels, vec2i(x.y, y.x), 0).xyz;
  let c = textureLoad(scentLevels, vec2i(x.x, y.y), 0).xyz;
  let d = textureLoad(scentLevels, vec2i(x.y, y.y), 0).xyz;
  let open = vec4f(a.z, b.z, c.z, d.z);
  let mean = 1.0 / max(open, vec4f(1e-30));
  var r = scentMix(a.xy * mean.x, b.xy * mean.y, c.xy * mean.z, d.xy * mean.w, f, open);
  r.gx *= ratio.x;
  r.gy *= ratio.y;
  return r;
}

// The opacity of the glow for a scent v: from 0 at 0.01 it rises in a straight line with log10(v) to SCENT_GLOW at
// 10^4, and stays there above it.
fn scentGlow(v: f32) -> f32 {
  if (!(v > 0.0)) { return 0.0; }
  return SCENT_GLOW * clamp((log2(v) / log2(10.0) - SCENT_LOW) / SCENT_TOP, 0.0, 1.0);
}

// The opacity of the line where the ratio r (gradient g per cell) is 1: about one pixel wide. scentSensorLine() gives
// it the food's difference across the sensors over the hold of a strand.
fn scentLine(r: f32, g: vec2f) -> f32 {
  if (!(r > 0.0)) { return 0.0; }
  let dt = max(length(g) * V.scale / (r * LN10), SCENT_FLAT); // powers of ten per pixel
  let d = abs(log2(r) / log2(10.0)) / dt;
  return (1.0 - smoothstep(0.25, 1.25, d)) * SCENT_LINE;
}

// Which of the 4 cells around p that bilinear() reads hold no wall: 1 open, 0 wall (`cells`: shapeCells of the cell
// under p).
fn openCells(p: vec2f, cells: array<u32, 9>) -> vec4f {
  let o = vec2i(floor(p - 0.5)) - vec2i(floor(p)) + 1;
  let open = vec4u(cells[o.y * 3 + o.x], cells[o.y * 3 + o.x + 1], cells[(o.y + 1) * 3 + o.x],
                   cells[(o.y + 1) * 3 + o.x + 1]) & vec4u(0x80u);
  return select(vec4f(1.0), vec4f(0.0), open != vec4u(0u));
}

// The scent at a sensor point p: as the view reads it at a pixel, from the coarse map at level k > 0, else from the
// 4 cells around p without those of walls; in a box, within half a cell of the edge, going on with the slope of the
// outer cells' centres.
fn scentSensed(p: vec2f, k: u32) -> Scent {
  if (k > 0u) { return scentCoarse(p, k); }
  let q = select(p, clamp(p, vec2f(0.5), vec2f(size()) - 0.5), V.boundary == 1u);
  var open = vec4f(1.0);
  if (ENV) { open = scentOpenAt(q); }
  return scentFrom(scentBilinear(q, open), p - q);
}

// The line where the food steers an agent across its sensors as hard as a strand holds it (scentSensors() in
// scent.ts): for each pair of V.scentHalf and V.scentHolds, the food scent h cells up the gradient at p less that h
// cells down it, over the hold; the line where the largest of these is 1. `s`: the scent at p. A sensor point with no
// cell that holds scent (in a wall) senses no food. Where the gradient at p says that the ratio lies far from 1 (more
// than 20 times off: the sensors' difference across 2h differs from the gradient times 2h by less, as long as the
// scent falls off over more than 0.8 cells), the line is far: no lookup.
fn scentSensorLine(p: vec2f, s: Scent, k: u32) -> f32 {
  let g = vec2f(s.gx.x, s.gy.x);
  let slope = length(g);
  if (!(slope > 0.0)) { return 0.0; }
  let n = g / slope;
  var best = 0.0;
  var change = 0.0; // the change of the best ratio along n, per cell
  for (var j = 0u; j < 4u; j++) {
    let h = V.scentHalf[j];
    let hold = V.scentHolds[j];
    if (!(h > 0.0) || !(hold > 0.0)) { continue; }
    let guess = slope * 2.0 * h / hold;
    if (guess < 0.05 || guess > 20.0) { continue; }
    let up = scentSensed(p + h * n, k);
    let down = scentSensed(p - h * n, k);
    if (up.w <= 0.0 || down.w <= 0.0) { continue; }
    let r = (up.v.x - down.v.x) / hold;
    if (r > best) {
      best = r;
      change = dot(vec2f(up.gx.x, up.gy.x) - vec2f(down.gx.x, down.gy.x), n) / hold;
    }
  }
  return scentLine(best, change * n);
}

// The view over colour c: the glow of the food scent, its line, then the glow of the repellent over them. Up to 2
// cells per pixel it reads the 4 cells around p and, near walls, leaves out theirs (`near`, `cells`: as in scene());
// zoomed out to 2 cells per pixel or more it reads the coarse map, whose texels leave them out. The repellent shows
// only where the model reads it: the extended model.
fn scentView(p: vec2f, c: vec3f, near: bool, cells: array<u32, 9>) -> vec3f {
  let level = u32(V.scentFx.x);
  var s: Scent;
  if (level > 0u) {
    s = scentCoarse(p, level);
  } else {
    // In a box, within half a cell of the edge, the scent of the outer cells' centres goes on with their slope.
    let q = select(p, clamp(p, vec2f(0.5), vec2f(size()) - 0.5), V.boundary == 1u);
    var open = vec4f(1.0);
    if (ENV && near) { open = openCells(q, cells); }
    s = scentFrom(scentBilinear(q, open), p - q);
  }
  let paperStyle = V.style == 2u;
  let fill = select(1.0, SCENT_PAPER_FILL, paperStyle);
  let repellent = select(0.0, scentGlow(s.v.y), V.scentFx.y > 0.5);
  let food = scentGlow(s.v.x) * fill;
  var o = mix(c, select(vec3f(0.1383, 0.7091, 0.1623), vec3f(0.0207, 0.2429, 0.033), paperStyle), food);
  o = mix(o, select(vec3f(0.3553, 0.9273, 0.3684), vec3f(0.0063, 0.1096, 0.0124), paperStyle),
          scentSensorLine(p, s, level));
  return mix(o, select(vec3f(0.9216, 0.1742, 0.6301), vec3f(0.4023, 0.024, 0.2555), paperStyle), repellent * fill);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let p = (frag.xy - 0.5 * V.canvas) * V.scale + V.center;
  let s = vec2f(size());
  // How much of the pixel lies in the arena: a ramp one pixel wide across the box edge and the dish rim.
  var inside = 1.0;
  if (V.boundary == 1u) {
    inside = cover(min(min(p.x, p.y), min(s.x - p.x, s.y - p.y)));
  } else if (V.boundary == 2u) {
    inside = cover(0.5 * min(s.x, s.y) - 1.0 - distance(p, 0.5 * s));
  }
  let space = V.background.rgb * select(0.55, 0.92, V.style == 2u);
  var c = space;
  // One call: a GPU that runs both sides of a branch (SwiftShader in CI) would draw the scene twice.
  if (inside > 0.0) {
    let inner = scene(p, s);
    c = select(mix(c, inner, inside), inner, inside >= 1.0);
  }
  // A periodic lattice (ADR 0026): its copies show dimmed in the free space beside it, with a ramp one pixel wide
  // across its edge. A grid shaped like the screen shows them as they are (copies 1).
  if (V.fx.z < 1.0) {
    let edge = cover(min(min(p.x, p.y), min(s.x - p.x, s.y - p.y)));
    c = mix(mix(space, c, V.fx.z), c, edge);
  }
  // Triangular dither of ±1 LSB against banding in dark gradients.
  let n = hash(vec2u(frag.xy)) - hash(vec2u(frag.xy) + vec2u(7919u, 104729u));
  return vec4f(srgb(clamp(c, vec3f(0.0), vec3f(1.0))) + n / 255.0, 1.0);
}
