// Full-screen pass: trail (or agent counts) → color. Standalone module (no common.wgsl).

// Food, light and walls are compiled in only while something is painted (Simulation.hasEnvironment,
// render.ts). Without them both entry points draw the same pixels and skip the work.
override ENV: bool = true;
// The scent view (ADR 0009, amendment 2026-11-11), compiled in only while it is on (render.ts).
override SCENT: bool = false;
// The film of the slime (ADR 0055, decision 8; ADR 0057), compiled in only while a frame draws it (render.ts).
override SLIME: bool = false;
// The fan of the growth front (ADR 0060), compiled in only while a frame draws it, together with SLIME (render.ts).
override FRONT: bool = false;

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
  fx: vec4f,          // bloom strength, black level (summed trail), copies (packView), level of the trail's map (0 to 4)
  // The stream of the plasm: drawn (1) or not (0), the phases of its pattern and its swing. w is not of the stream:
  // 1 while an electrode may be painted (ADR 0047).
  streamFx: vec4f,
  gelFx: vec4f,       // gel style: the white in the colour of the thinnest gel, the ground that it hides, 2 unused
  scentFx: vec4f,     // scent view: map level (0 to 3), unused, unused, unused
  scentHalf: vec4f,   // scent view: half the spread of the sensors of up to 4 strains (0: none), cells
  scentHolds: vec4f,  // scent view: the hold of a strand of each, as a difference of food scent (scentSensors())
  // The slime: the steps that ran so far, the life time of the slime in steps, what the frame draws (1 the film of
  // the slime, 2 the fan of the growth front), unused.
  slime: vec4u,
  slimeFx: vec4f,     // the slime: the colour of its body, linear RGB, and how much of it full slime shows
  slimeLight: vec4f,  // the slime: its highlight, its wide light, the height of its relief, the height of its beads
}

// The dish's diameter as a share of the grid's short side (DISH_FILL in common.wgsl, ADR 0027).
const DISH_FILL = 0.945;

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var trail: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> shape: array<u32>; // outline distances and light (paint.wgsl `outline`)
@group(0) @binding(3) var<storage, read> counts: array<vec4u>;
@group(0) @binding(4) var bloom: texture_2d<f32>;
@group(0) @binding(5) var bloomSampler: sampler;
@group(0) @binding(6) var heights: texture_2d<f32>; // gel style: written by `heightField` each frame
@group(0) @binding(7) var heightSampler: sampler;   // bilinear, clamped
@group(0) @binding(8) var<storage, read> occ: array<u32>; // agents per cell, kept in collision mode only
@group(0) @binding(11) var trailLevels: texture_2d<f32>; // the trail on a coarser map (trailDown), zoomed out
@group(0) @binding(12) var stream: texture_2d<f32>; // the direction of the flow of the plasm times its speed
@group(0) @binding(14) var<storage, read> stamps: array<u32>; // the stamps of the slime field (slime.wgsl); read by `slimeFilm` only
@group(0) @binding(18) var<storage, read> amounts: array<u32>; // the amounts of slime (amount.wgsl); read by `slimeFilm` only
@group(0) @binding(15) var film: texture_2d<f32>; // the film of the slime, one texel per cell (written by `slimeFilm`)
@group(0) @binding(17) var filmLevels: texture_2d<f32>; // the film on a coarser map (slimeDown), zoomed out
@group(0) @binding(19) var<storage, read> fronts: array<u32>; // the front field (slime.wgsl); read by `frontMap` only
@group(0) @binding(20) var fanMap: texture_2d<f32>; // the map of the growth front (written by `frontMap`)
// The outline distances of the electrodes (paint.wgsl POLES, ADR 0058); read for the electrodes only.
@group(0) @binding(16) var<storage, read> poles: array<u32>;
@group(0) @binding(9) var scent: texture_2d<f32>; // food scent (r) and light repellent (g); read by the scent view only
@group(0) @binding(10) var scentLevels: texture_2d<f32>; // the scent on a coarser map (scentDown), zoomed out

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn size() -> vec2i { return vec2i(textureDimensions(trail)); }

// A cell coordinate wrapped into a periodic grid of n cells, in integers (wrapCell in common.wgsl).
// - Less than one period outside the grid, as every tap of a view that shows the grid about once is: comparisons, then
//   one addition or subtraction of n. That is the cell the remainders give, and an integer remainder is slow on Apple
//   GPUs (ADR 0028).
// - Farther out, in the copies of a view zoomed out or panned away: the remainders. % keeps the sign of c.
fn wrapCell(c: vec2i, n: vec2i) -> vec2i {
  if (all(c >= -n) && all(c < 2 * n)) {
    return c + select(vec2i(0), n, c < vec2i(0)) - select(vec2i(0), n, c >= n);
  }
  return ((c % n) + n) % n;
}

// The cell at c as coordinates inside the grid: wrapped (periodic), or (−1, −1) outside the arena. A lookup takes the
// coordinates from here: to get them back from the cell's index takes a division, which is slow (ADR 0028).
fn cellXY(c: vec2i) -> vec2i {
  let s = size();
  if (V.boundary == 0u) { return wrapCell(c, s); }
  if (any(c < vec2i(0)) || any(c >= s)) { return vec2i(-1); }
  return c;
}

// Cell index for the grid, wrapped (periodic) or −1 outside the arena.
fn cellAt(c: vec2i) -> i32 {
  let q = cellXY(c);
  return select(q.y * size().x + q.x, -1, q.x < 0);
}

fn trailAt(c: vec2i) -> vec4f {
  let q = cellXY(c);
  if (q.x < 0) { return vec4f(0.0); }
  return textureLoad(trail, q, 0);
}

// Manual bilinear filter: rgba32float is not filterable without an optional feature. On the periodic grid one wrap
// serves the 4 cells: the column after the last one is the first, and so the row.
fn bilinear(p: vec2f) -> vec4f {
  let q = p - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  if (V.boundary != 0u) {
    let a = mix(trailAt(i), trailAt(i + vec2i(1, 0)), f.x);
    let b = mix(trailAt(i + vec2i(0, 1)), trailAt(i + vec2i(1, 1)), f.x);
    return mix(a, b, f.y);
  }
  let s = size();
  let w = wrapCell(i, s);
  let x = vec2i(w.x, select(w.x + 1, 0, w.x == s.x - 1));
  let y = vec2i(w.y, select(w.y + 1, 0, w.y == s.y - 1));
  let a = mix(textureLoad(trail, vec2i(x.x, y.x), 0), textureLoad(trail, vec2i(x.y, y.x), 0), f.x);
  let b = mix(textureLoad(trail, vec2i(x.x, y.y), 0), textureLoad(trail, vec2i(x.y, y.y), 0), f.x);
  return mix(a, b, f.y);
}

// Texels per side of a coarse map of level k (1 and up), of the trail or of the scent: the grid side over 2^k, rounded
// up. Its texels tile the grid exactly, each s / n cells wide, so on the periodic grid the map wraps with the grid.
fn levelSize(k: u32) -> vec2i {
  return (size() + i32((1u << k) - 1u)) >> vec2u(k);
}

// The trail on the coarse map of level V.fx.w (1 and up), one texel per fragment: the mean over the cells that the
// texel covers, each by the share it covers. On a side that 2^k divides, a texel is the mean of 2^k × 2^k cells, the
// same as k times the mean of 2 × 2. Zoomed out, a pixel reads this map (trailArea): render.ts fills it only for the
// frames that do, and only when the trail changed.
@fragment
fn trailDown(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let s = size();
  let span = vec2f(s) / vec2f(levelSize(u32(V.fx.w))); // cells per texel
  let lo = floor(frag.xy) * span;
  let hi = lo + span;
  var sum = vec4f(0.0);
  for (var y = i32(floor(lo.y)); f32(y) < hi.y && y < s.y; y++) {
    let wy = min(hi.y, f32(y + 1)) - max(lo.y, f32(y));
    for (var x = i32(floor(lo.x)); f32(x) < hi.x && x < s.x; x++) {
      let w = (min(hi.x, f32(x + 1)) - max(lo.x, f32(x))) * wy;
      sum += w * textureLoad(trail, vec2i(x, y), 0);
    }
  }
  return sum / (span.x * span.y);
}

// Zoomed out (more than 1 cell per pixel): the mean of the trail over the square of the pixel, V.scale cells wide.
// The map of level V.fx.w = floor(log2(V.scale)) has texels of 1/2 to 1 pixel (level 0 is the trail itself), so the
// square covers at most 3 × 3 of them, each by the share that lies under the pixel. Up to 2 cells per pixel that is the
// exact mean of the cells under the pixel; above, a texel that the pixel covers in part counts with its mean. At 1 cell
// per pixel it is the bilinear filter. Outside a closed arena the trail is 0, as for trailAt(). Before, a pixel took
// four bilinear taps of the trail a quarter of the pixel apart: 16 cells far apart from those of the pixels beside it,
// which missed the cache (49 ms a frame at 8 cells per pixel, ADR 0028), and from 4 cells per pixel on they left cells
// out, which showed as moiré.
fn trailArea(p: vec2f) -> vec4f {
  let k = u32(V.fx.w);
  var n = size();
  if (k > 0u) { n = levelSize(k); }
  let ratio = vec2f(n) / vec2f(size()); // texels per cell
  let half = 0.5 * V.scale * ratio;
  let lo = p * ratio - half;
  let hi = p * ratio + half;
  let i = vec2i(floor(lo));
  var xs = vec3i(i.x, i.x + 1, i.x + 2);
  var ys = vec3i(i.y, i.y + 1, i.y + 2);
  if (V.boundary == 0u) {
    // One wrap for the 3 × 3 texels: the column after the last one is the first, and so the row.
    let w = wrapCell(i, n);
    let x1 = select(w.x + 1, 0, w.x == n.x - 1);
    let y1 = select(w.y + 1, 0, w.y == n.y - 1);
    xs = vec3i(w.x, x1, select(x1 + 1, 0, x1 == n.x - 1));
    ys = vec3i(w.y, y1, select(y1 + 1, 0, y1 == n.y - 1));
  }
  var sum = vec4f(0.0);
  var area = vec2f(0.0);
  for (var j = 0; j < 3; j++) {
    let wy = max(min(hi.y, f32(i.y + j + 1)) - max(lo.y, f32(i.y + j)), 0.0);
    area.y += wy;
    var row = vec4f(0.0);
    for (var c = 0; c < 3; c++) {
      let wx = max(min(hi.x, f32(i.x + c + 1)) - max(lo.x, f32(i.x + c)), 0.0);
      if (j == 0) { area.x += wx; }
      let q = vec2i(xs[c], ys[j]);
      if (any(q < vec2i(0)) || any(q >= n)) { continue; }
      if (k == 0u) {
        row += wx * textureLoad(trail, q, 0);
      } else {
        row += wx * textureLoad(trailLevels, q, 0);
      }
    }
    sum += wy * row;
  }
  return sum / (area.x * area.y);
}

fn trailFiltered(p: vec2f) -> vec4f {
  if (V.scale <= 1.0) { return bilinear(p); }
  return trailArea(p);
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

// The height of a wall cell: the mean of its neighbours outside walls. Walls hold no trail in the extended model and
// less than the cells beside them in the Jones model (diffuse.wgsl, ADR 0027), so their cells would pull the filtered
// height down in steps of whole cells along a slanted wall, and the gel would light that staircase where the smooth
// outline of the wall no longer covers it. The wall is drawn over this. The gel reads the height up to 2 cells from a
// pixel (see gel), so a cell with walls all around it takes the mean of the 5 × 5.
fn besideWall(c: vec2i, y: f32) -> f32 {
  for (var r = 1; r <= 2; r++) {
    var sum = 0.0;
    var n = 0.0;
    for (var j = -r; j <= r; j++) {
      for (var i = -r; i <= r; i++) {
        let k = c + vec2i(i, j);
        if (cellAt(k) < 0 || (shape[shapeIndex(k)] & 0xffu) >= 128u) { continue; }
        let t = trailAt(k);
        sum += (t.x + t.y + t.z + t.w - V.fx.y) * V.exposure;
        n += 1.0;
      }
    }
    if (n > 0.0) { return sum / n; }
  }
  return y;
}

// The height field with hardware bilinear filtering at grid position q (wrapped for the periodic
// boundary; outside a closed arena the border holds the value of an empty cell).
fn heightAt(q: vec2f) -> f32 {
  let s = vec2f(size());
  let p = select(q, q - s * floor(q / s), V.boundary == 0u);
  return textureSampleLevel(heights, heightSampler, (p + 1.0) / (s + 2.0), 0.0).r;
}

// The height field at q as a quadratic B-spline over the 3 × 3 cells around q, the spline of food and walls
// (envAt()), from four bilinear lookups: each reads two of the three cells along an axis, and the middle cell gives
// half of its weight to each. The spline has no crease at the edge of a cell. With one bilinear lookup the line at
// which the gel ends had a tooth for each cell.
fn heightSmooth(q: vec2f) -> f32 {
  let c = floor(q);
  let u = q - c - 0.5;
  let w0 = 0.5 * (0.5 - u) * (0.5 - u);
  let w1 = 0.75 - u * u;
  let w2 = 0.5 * (0.5 + u) * (0.5 + u);
  let a = w0 + 0.5 * w1; // the weight of the lookup between the cell before and the middle cell
  let b = 0.5 * w1 + w2; // and of the one between the middle cell and the cell after
  let lo = c - 0.5 + 0.5 * w1 / a;
  let hi = c + 0.5 + w2 / b;
  return a.x * a.y * heightAt(lo) + b.x * a.y * heightAt(vec2f(hi.x, lo.y)) +
         a.x * b.y * heightAt(vec2f(lo.x, hi.y)) + b.x * b.y * heightAt(hi);
}

// Zoomed in, the height as a smooth surface. Zoomed out, four taps spread over the pixel footprint, against aliasing.
fn heightFiltered(p: vec2f) -> f32 {
  if (V.scale <= 1.0) { return heightSmooth(p); }
  let o = 0.25 * V.scale;
  return 0.25 * (heightAt(p + vec2f(-o, -o)) + heightAt(p + vec2f(o, -o)) +
                 heightAt(p + vec2f(-o, o)) + heightAt(p + vec2f(o, o)));
}

// How thick the gel is where the height field holds y: it has no top, so a thick tube is higher than a thin one.
fn thick(y: f32) -> f32 {
  let h = max(y, 0.0);
  return h / (1.0 + 0.25 * h);
}

// How thick the gel is at p + d with the sheet of the growth front on it (ADR 0060). `lift`: the sheet at p in units
// of the trail and its gradient per cell (scene()); the sheet beside p follows its slope at p. Without a sheet this is
// thick() of the height.
fn raised(p: vec2f, d: vec2f, lift: vec3f) -> f32 {
  return thick(max(heightFiltered(p + d), 0.0) + max(lift.x + dot(lift.yz, d), 0.0) * V.exposure);
}

// Trail as a gel with a wet surface, over `base` (ADR 0009, amendment 2026-11-14). A thick tube is higher than a thin
// one, has the full colour of its strain and hides the ground. Thin gel is pale and clear, as much as the setting of
// the gel colour says (V.gelFx, GEL_FX in render.ts). The gel is clear enough to
// show a flake of food below it (`f`, see flakeAt): over food its colour takes in the flake's, grain and outline.
fn gel(p: vec2f, v: vec4f, base: vec3f, f: Flake, lift: vec3f) -> vec3f {
  // The slope of the thickness from 8 lookups around p, 2 on each side: their mean smooths the cells.
  let a = 1.25 * max(V.scale, 1.0);
  let b = 0.5 * max(V.scale, 1.0);
  let east = vec2f(raised(p, vec2f(a, b), lift), raised(p, vec2f(a, -b), lift));
  let west = vec2f(raised(p, vec2f(-a, b), lift), raised(p, vec2f(-a, -b), lift));
  let south = vec2f(raised(p, vec2f(b, a), lift), raised(p, vec2f(-b, a), lift));
  let north = vec2f(raised(p, vec2f(b, -a), lift), raised(p, vec2f(-b, -a), lift));
  let rise = vec2f(east.x + east.y - west.x - west.y, south.x + south.y - north.x - north.y) / (4.0 * a);
  let n = normalize(vec3f(-GEL_HIGH * rise, 1.0));
  let l = normalize(vec3f(-0.45, -0.6, 0.65));
  // Light goes a little way through the gel, so the side away from the light is not black.
  let diffuse = clamp((dot(n, l) + 0.35) / 1.35, 0.0, 1.0);
  // A wet surface: a small bright highlight and a wide weak one.
  let shine = max(dot(n, normalize(l + vec3f(0.0, 0.0, 1.0))), 0.0);
  let spec = 0.9 * pow(shine, 120.0) + 0.1 * pow(shine, 14.0);
  let total = v.x + v.y + v.z + v.w;
  var albedo = select(V.colors[0].rgb, tint(v) / max(total, 1e-6), total > 1e-6);
  if (ENV && f.cover > 0.0) { albedo = mix(albedo, mix(f.body, f.edge, f.rim * 0.85), GEL_CLEAR * f.cover); }
  let here = max(heightFiltered(p), 0.0) + lift.x * V.exposure;
  // The thickness of the tube that p is a part of: the largest around p, so a tube has one colour up to its rim.
  let around = max(max(east, west), max(south, north));
  let full = smoothstep(0.12, 0.85, max(thick(here), max(around.x, around.y)));
  let lit = mix(albedo, vec3f(1.0), V.gelFx.x * (1.0 - full)) * (0.3 + 0.8 * diffuse);
  // The gel ends at a line, as a drop does.
  let body = smoothstep(0.02, 0.14, here);
  return mix(base, lit, body * mix(V.gelFx.y, 1.0, full)) + spec * body;
}

// ---- The stream of the plasm (ADR 0034, amendments of 2026-11-14) -----------------------------------------------
// Grains that move along the flow in each tube, faster where the flow is faster. They go back and forth, as the plasm
// of the organism does, and go on with the flow a little in each swing. Display only.
const STREAM_GRAIN = 2.2;  // cells between two points of the pattern of the grains
const STREAM_REACH = 10.0; // cells that a grain goes on in one period of the pattern where the speed is 1
const STREAM_SWING = 12.0; // cells that a grain goes to each side in a swing where the speed is 1
const STREAM_GAIN = 1.5;   // how much more trail a grain shows where the speed is 1
const STREAM_DARK = 0.3;   // how much darker a grain makes the gel there

// The stream of the cell c, and nothing outside the arena.
fn streamCell(c: vec2i) -> vec2f {
  let q = cellXY(c);
  if (q.x < 0) { return vec2f(0.0); }
  return textureLoad(stream, q, 0).xy;
}

// A number from 0 to 1 for the point i of the pattern: the same in every frame.
fn grainAt(i: vec2i) -> f32 {
  var x = u32(i.x) * 1664525u + u32(i.y) * 1013904223u;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return f32((x ^ (x >> 16u)) >> 8u) * (1.0 / 16777216.0);
}

// The pattern at x, in units of STREAM_GRAIN: smooth between its points.
fn grains(x: vec2f) -> f32 {
  let i = vec2i(floor(x));
  let f = x - floor(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(grainAt(i), grainAt(i + vec2i(1, 0)), u.x),
             mix(grainAt(i + vec2i(0, 1)), grainAt(i + vec2i(1, 1)), u.x), u.y);
}

// How much of a grain lies at p, 0 to 1. The pattern is shifted along the stream by the phase, so a grain moves with
// the flow. A shift that grows without end would tear the pattern where the stream turns, so two copies of the
// pattern take turns: each starts again while the other one shows. Both copies swing back and forth together.
fn streaming(p: vec2f) -> f32 {
  let q = p - 0.5;
  let c = vec2i(floor(q));
  let f = q - floor(q);
  let v = mix(mix(streamCell(c), streamCell(c + vec2i(1, 0)), f.x),
              mix(streamCell(c + vec2i(0, 1)), streamCell(c + vec2i(1, 1)), f.x), f.y);
  let speed = length(v);
  if (speed <= 0.0) { return 0.0; }
  let t = V.streamFx.y;
  let swing = STREAM_SWING * sin(6.283185307 * V.streamFx.z);
  let first = grains((p - v * (STREAM_REACH * (t - 0.5) + swing)) / STREAM_GRAIN);
  let second = grains((p - v * (STREAM_REACH * (fract(t + 0.5) - 0.5) + swing)) / STREAM_GRAIN + vec2f(37.0, 17.0));
  let n = mix(second, first, 1.0 - abs(2.0 * t - 1.0));
  // A grain is smaller than a pixel from 1.5 cells per pixel on: it fades out before.
  return sqrt(speed) * smoothstep(0.45, 0.8, n) * clamp(3.0 - 2.0 * V.scale, 0.0, 1.0);
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
const GEL_HIGH = 4.0;      // cells of height for one unit of the gel's thickness (see gel)
const SUN = normalize(vec3f(-0.45, -0.6, 0.65)); // toward the light, as in gel(): top left (grid y points down)

// The cell of `shape` for a grid cell: wrapped on the periodic grid, else clamped to the arena, so an
// outline that touches the edge of a closed arena stays whole up to it. Outside the dish `shape` holds what
// other boundaries left there (paint.wgsl leaves it alone): a cell there reads the cell inside the rim on
// the way to the centre.
fn shapeIndex(c: vec2i) -> i32 {
  let s = size();
  var q = clamp(c, vec2i(0), s - 1);
  if (V.boundary == 0u) {
    q = wrapCell(c, s);
  } else if (V.boundary == 2u) {
    let o = 0.5 * vec2f(s);
    let m = vec2f(c) + 0.5 - o;
    let rim = DISH_FILL * 0.5 * f32(min(s.x, s.y)); // dishRadius() in common.wgsl
    if (dot(m, m) > rim * rim) { q = vec2i(floor(o + m * ((rim - 0.75) * inverseSqrt(dot(m, m))))); }
  }
  return q.y * s.x + q.x;
}

// The 3 × 3 cells around cell c, row by row, each as shapeIndex() gives it: the cells the spline reads at a point in
// c. The columns and rows are wrapped or clamped once.
fn cellsAround(c: vec2i) -> array<i32, 9> {
  let s = size();
  var k: array<i32, 9>;
  if (V.boundary == 2u) {
    let m = vec2f(c) + 0.5 - 0.5 * vec2f(s);
    let rim = DISH_FILL * 0.5 * f32(min(s.x, s.y));
    if (dot(m, m) > (rim - 1.5) * (rim - 1.5)) {
      // Near the rim: some of the 3 × 3 cells may lie outside the dish.
      for (var j = 0; j < 3; j++) {
        for (var i = 0; i < 3; i++) { k[j * 3 + i] = shapeIndex(c + vec2i(i - 1, j - 1)); }
      }
      return k;
    }
  }
  var xs = clamp(vec3i(c.x - 1, c.x, c.x + 1), vec3i(0), vec3i(s.x - 1));
  var ys = clamp(vec3i(c.y - 1, c.y, c.y + 1), vec3i(0), vec3i(s.y - 1));
  if (V.boundary == 0u) {
    let q = wrapCell(c, s);
    xs = vec3i(select(q.x - 1, s.x - 1, q.x == 0), q.x, select(q.x + 1, 0, q.x == s.x - 1));
    ys = vec3i(select(q.y - 1, s.y - 1, q.y == 0), q.y, select(q.y + 1, 0, q.y == s.y - 1));
  }
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 3; i++) { k[j * 3 + i] = ys[j] * s.x + xs[i]; }
  }
  return k;
}

// The 3 × 3 cells of `shape` around cell c (cellsAround()).
fn shapeCells(c: vec2i) -> array<u32, 9> {
  let k = cellsAround(c);
  var w: array<u32, 9>;
  for (var i = 0; i < 9; i++) { w[i] = shape[k[i]]; }
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
  let i0 = wrapCell(i, period);
  let i1 = wrapCell(i + 1, period);
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

// What lies below the trail: the ground `bg`, or the flake on it. The trail and the agents lie on top.
fn substrate(f: Flake, bg: vec3f) -> vec3f {
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
  // The cells as cellAt() numbers them, wrapped once.
  let s = size();
  var cx = vec3i(e.cell.x - 1, e.cell.x, e.cell.x + 1);
  var cy = vec3i(e.cell.y - 1, e.cell.y, e.cell.y + 1);
  if (V.boundary == 0u) {
    let q = wrapCell(e.cell, s);
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
// cell under p, which holds those 4). Walls hold no trail in the extended model and less than the cells beside them
// in the Jones model (ADR 0027), so the plain filter fell towards their cells, in steps along a slanted wall that its smooth outline no longer covers. The weights of the other cells
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

// ---- The slime (SLIME) --------------------------------------------------------------------------------
// The slime of the model as a wet film on the ground (ADR 0055, decision 8; ADR 0057). The film is thick where a tube
// stayed and thin where the colony only passed, so it keeps the shape of the tube that made it. The flake of food,
// the trail, the light, the walls and the electrodes lie on it. Display only. src/engine/slime-reference.ts holds the
// same rules (filmCells(), filmAt(), slimeColour()), and SLIME_LOOK in render.ts the numbers of each style.
//
// Three steps. `slimeFilm` writes the thickness of the film of every cell into a map, once for each state of the
// simulation. `slimeDown` writes the mean of that map over 2^k cells per side for a view that is zoomed out. The
// render pass reads the 3 × 3 texels of its map around a pixel as a smooth surface, and lights it.

const SLIME_FULL = 4095.0;  // the full amount of slime of a cell (slime.ts SLIME_FULL)
const SLIME_WAVES = 12.0;   // cells per step of the lattice of the waves of the film
const SLIME_BEADS = 7.0;    // cells per step of the lattice of the beads
const SLIME_RIPPLE = 0.16;  // how much the waves change the thickness of the film, as a share of it
const FILM_HIDE = 3.0;      // how fast the plasm hides the film below it, per unit of its light (plasmCover)

// The strength of the slime of a cell that holds the stamp `held`, 0 to 1. The age of a stamp is the steps that ran so
// far plus 1 less the stamp, in unsigned integers as in the passes of the simulation (slime.wgsl). The strength is 1 at
// the age 0 and falls in a straight line to 0 at the life time. It is 0 without a stamp.
fn slimeOf(held: u32) -> f32 {
  let age = V.slime.x + 1u - held;
  if (held == 0u || age >= V.slime.y) { return 0.0; }
  return 1.0 - f32(age) / f32(V.slime.y);
}

// Whether grid cell c lies in the arena. A cell outside it never holds slime.
fn slimeArena(c: vec2i) -> bool {
  if (V.boundary == 0u) { return true; }
  let s = size();
  if (any(c < vec2i(0)) || any(c >= s)) { return false; }
  return V.boundary != 2u || distance(vec2f(c) + 0.5, 0.5 * vec2f(s)) <= DISH_FILL * 0.5 * f32(min(s.x, s.y));
}

// The thickness of the slime of the cell with the index i, 0 to 1: its amount as a share of the full amount, times the
// strength of the age of its stamp.
fn filmCell(i: i32) -> f32 {
  return slimeOf(stamps[i]) * f32(amounts[i]) / SLIME_FULL;
}

// The film of cell c, which may hold a wall or lie outside the arena: the mean of the thickness of the open cells among
// the 3 × 3 around it, with the weights 1, 2, 1 along each axis. A cell is open when it lies in the arena and holds no
// wall that the picture draws. So a wall and a cell outside the arena take the film of the open cells beside them, and
// the film goes on up to a wall and to the rim of the dish, which are drawn over it. Without the mean the film had a
// tooth for each cell along a slanted wall: the cells beside a wall hold less trail than their neighbours.
//
// A cell with no open cell among its 3 × 3 takes the mean over the 5 × 5 in the same way, with the weights 1, 2, 3, 2,
// 1: the smooth outline of a wall runs through the cells of the wall, and a pixel beside it reads the cells two deep
// (besideWall() does the same for the gel). 0 without an open cell among the 5 × 5.
fn filmOf(c: vec2i) -> f32 {
  let s = size();
  let walls = ENV && V.frame.z != 0u;
  for (var r = 1; r <= 2; r++) {
    var sum = 0.0;
    var total = 0.0;
    for (var j = -r; j <= r; j++) {
      for (var i = -r; i <= r; i++) {
        var k = c + vec2i(i, j);
        if (V.boundary == 0u) { k = wrapCell(k, s); }
        if (!slimeArena(k)) { continue; }
        let at = k.y * s.x + k.x;
        if (walls && (shape[at] & 0x80u) != 0u) { continue; }
        let w = f32((r + 1 - abs(i)) * (r + 1 - abs(j)));
        sum += w * filmCell(at);
        total += w;
      }
    }
    if (total > 0.0) { return sum / total; }
  }
  return 0.0;
}

// The map of the film, one texel per cell and one fragment per texel (render.ts fills it once for each state that a
// frame draws).
@fragment
fn slimeFilm(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  return vec4f(filmOf(vec2i(floor(frag.xy))), 0.0, 0.0, 1.0);
}

// The film on the coarse map of level V.fx.w (1 and up), one texel per fragment: the mean over the cells that the texel
// covers, each by the share it covers, as trailDown has it for the trail. A cell outside the arena that no open cell
// touches holds no film.
@fragment
fn slimeDown(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let s = size();
  let span = vec2f(s) / vec2f(levelSize(u32(V.fx.w))); // cells per texel
  let lo = floor(frag.xy) * span;
  let hi = lo + span;
  var sum = 0.0;
  for (var y = i32(floor(lo.y)); f32(y) < hi.y && y < s.y; y++) {
    let wy = min(hi.y, f32(y + 1)) - max(lo.y, f32(y));
    for (var x = i32(floor(lo.x)); f32(x) < hi.x && x < s.x; x++) {
      let w = (min(hi.x, f32(x + 1)) - max(lo.x, f32(x))) * wy;
      sum += w * textureLoad(film, vec2i(x, y), 0).r;
    }
  }
  return vec4f(sum / (span.x * span.y), 0.0, 0.0, 1.0);
}

struct Film {
  h: f32,   // the thickness of the film at a point, 0 to 1
  g: vec2f, // its gradient, per cell
}

// The film at p: a quadratic B-spline over the 3 × 3 texels around p of the map of level V.fx.w (0 the map of the
// cells, up to 2 cells per pixel; above, the coarse map whose texels are 1/2 to 1 pixel wide), with its gradient from
// the same texels (envAt() has the weights). The spline has no crease, so the light on the film has no seam at the
// edge of a cell. The texels are fixed in the grid, so the film does not shimmer when the view moves. On the periodic
// grid the map wraps; in a closed arena the texels at its edge go on beyond it.
fn filmAt(p: vec2f) -> Film {
  let k = u32(V.fx.w);
  let s = size();
  var n = s;
  if (k > 0u) { n = levelSize(k); }
  let ratio = vec2f(n) / vec2f(s); // texels per cell
  let q = p * ratio - 0.5;
  let c = vec2i(floor(q + 0.5));
  let u = q - vec2f(c);
  let wx = spline(u.x);
  let wy = spline(u.y);
  let sx = splineSlope(u.x);
  let sy = splineSlope(u.y);
  var xs = clamp(vec3i(c.x - 1, c.x, c.x + 1), vec3i(0), vec3i(n.x - 1));
  var ys = clamp(vec3i(c.y - 1, c.y, c.y + 1), vec3i(0), vec3i(n.y - 1));
  if (V.boundary == 0u) {
    // One wrap for the 3 × 3 texels, as in shapeCells().
    let w = wrapCell(c, n);
    xs = vec3i(select(w.x - 1, n.x - 1, w.x == 0), w.x, select(w.x + 1, 0, w.x == n.x - 1));
    ys = vec3i(select(w.y - 1, n.y - 1, w.y == 0), w.y, select(w.y + 1, 0, w.y == n.y - 1));
  }
  var f: Film;
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 3; i++) {
      var h: f32;
      if (k == 0u) {
        h = textureLoad(film, vec2i(xs[i], ys[j]), 0).r;
      } else {
        h = textureLoad(filmLevels, vec2i(xs[i], ys[j]), 0).r;
      }
      f.h += wx[i] * wy[j] * h;
      f.g += vec2f(sx[i] * wy[j], wx[i] * sy[j]) * h;
    }
  }
  f.g *= ratio;
  return f;
}

// The steps of the lattice of a pattern along each side of the grid, about one per `step` cells: whole numbers, so
// the pattern repeats with a periodic grid and shows no seam at its edge. The side over `step`, rounded to the nearest
// whole number, and up for a side half way between two. In whole numbers: `round` takes the even number at a half in
// WGSL and either one in GLSL, so the two backends drew other waves on a grid of 30 cells.
fn patternSteps(step: f32) -> vec2f {
  let n = i32(step);
  return vec2f(max((2 * size() + n) / (2 * n), vec2i(1)));
}

// Value noise that repeats every `period` lattice steps, with its gradient: (the value, 0 to 1; its change per
// lattice step along x and along y). The curve between two lattice points starts and ends flat in its slope and in
// its bend, so the gradient has no crease.
fn noiseSlope(x: vec2f, period: vec2i) -> vec3f {
  let i = vec2i(floor(x));
  let f = x - floor(x);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let i0 = wrapCell(i, period);
  let i1 = wrapCell(i + 1, period);
  let a = lattice(i0);
  let b = lattice(vec2i(i1.x, i0.y));
  let c = lattice(vec2i(i0.x, i1.y));
  let d = lattice(i1);
  let k1 = b - a;
  let k2 = c - a;
  let k3 = a - b - c + d;
  return vec3f(a + k1 * u.x + k2 * u.y + k3 * u.x * u.y, du.x * (k1 + k3 * u.y), du.y * (k2 + k3 * u.x));
}

// The waves of the film, a pattern that is fixed in the grid: wide soft noise, and a quarter of a noise of twice the
// frequency. (the value, 0 to 1; its gradient per cell).
fn slimeWaves(p: vec2f) -> vec3f {
  let n = patternSteps(SLIME_WAVES);
  let scale = n / vec2f(size()); // lattice steps per cell
  let x = p * scale;
  let a = noiseSlope(x, vec2i(n));
  let b = noiseSlope(2.0 * x + vec2f(19.7, 7.3), 2 * vec2i(n));
  return vec3f((a.x + 0.25 * b.x) / 1.25, (a.yz + 0.5 * b.yz) * scale / 1.25);
}

// The beads on the film: small round drops at places that are fixed in the grid, one for about four steps of their
// lattice. (the height of the bead at p, 0 to 1; its gradient per cell). 0 where no bead lies.
fn slimeBeads(p: vec2f) -> vec3f {
  let n = patternSteps(SLIME_BEADS);
  let scale = n / vec2f(size()); // lattice steps per cell
  let x = p * scale;
  let i = vec2i(floor(x));
  var best = vec3f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let k = i + vec2i(dx, dy);
      let w = wrapCell(k, vec2i(n));
      if (lattice(w + vec2i(7, 211)) > 0.25) { continue; }
      // The place of the bead in its step of the lattice, and its radius: 0.1 to 0.32 steps.
      let o = vec2f(lattice(w), lattice(w + vec2i(57, 113)));
      let r = 0.1 + 0.22 * lattice(w + vec2i(191, 31));
      let d = x - (vec2f(k) + o);
      let m = 1.0 - dot(d, d) / (r * r);
      if (m > best.x) { best = vec3f(m, -2.0 * d * scale / (r * r)); }
    }
  }
  if (best.x <= 0.0) { return vec3f(0.0); }
  return vec3f(best.x * best.x, 2.0 * best.x * best.yz);
}

// The light of the lamp on a wet surface with the normal n, less what a flat film shows: (a small bright highlight; a
// wide weak light, below 0 on a slope that faces away from the lamp).
fn wetShine(n: vec3f) -> vec2f {
  let half = normalize(SUN + vec3f(0.0, 0.0, 1.0));
  let shine = max(dot(n, half), 0.0);
  return vec2f(pow(shine, 110.0), pow(shine, 10.0) - pow(half.z, 10.0));
}

// The ground `bg` at p with the film of the slime on it. Thin slime is clear and thick slime is milky, so the body of
// the film shows where a tube stayed. The surface is the film with its waves: the lamp of the walls and the gel puts
// a small highlight and a wide weak light on it. Beads sit on thick slime and only catch the light. On paper the film
// is a wet stain: it mixes its colour into the paper, it is darker on the side away from the lamp, and its edge has a
// tide line. Detail that is smaller than a pixel fades out from 1 cell per pixel on, and is gone at 1.5.
fn slimed(bg: vec3f, p: vec2f) -> vec3f {
  let f = filmAt(p);
  if (f.h <= 0.0) { return bg; }
  let fine = clamp(3.0 - 2.0 * V.scale, 0.0, 1.0);
  let cov = smoothstep(0.0, 0.05, f.h);
  let waves = slimeWaves(p);
  let wave = 1.0 + SLIME_RIPPLE * (2.0 * waves.x - 1.0);
  let h = f.h * wave;
  let g = f.g * wave + f.h * SLIME_RIPPLE * 2.0 * waves.yz * fine;
  let shine = wetShine(normalize(vec3f(-V.slimeLight.z * g, 1.0)));
  var spark = shine.x;
  let bead = V.slimeLight.w * fine * smoothstep(0.15, 0.45, f.h);
  if (bead > 0.0) {
    let beads = slimeBeads(p);
    let glint = wetShine(normalize(vec3f(-V.slimeLight.z * (g + bead * beads.yz), 1.0)));
    spark = max(shine.x, glint.x) + 0.25 * max(glint.y - shine.y, 0.0);
  }
  let depth = pow(clamp(h, 0.0, 1.0), 1.6);
  if (V.style == 2u) {
    let edge = smoothstep(0.0, 0.04, f.h) * (1.0 - smoothstep(0.05, 0.2, f.h));
    let stain = mix(bg, V.slimeFx.rgb, V.slimeFx.a * depth) *
                (1.0 - 0.04 * edge + V.slimeLight.y * cov * clamp(shine.y, -0.4, 0.1));
    return mix(stain, vec3f(1.0), min(V.slimeLight.x * spark * cov, 1.0));
  }
  let wide = V.slimeLight.y * cov * clamp(shine.y, -0.15, 0.5);
  return max(bg + V.slimeFx.rgb * (V.slimeFx.a * depth + wide), vec3f(0.0)) +
         vec3f(min(V.slimeLight.x * spark * cov, 0.8));
}


// ---- The growth front (ADR 0060) --------------------------------------------------------------------------------
// Display only. The front field holds the step at which plasm first came onto each cell (slime.wgsl `front`). The
// picture draws young ground as the fan of a plasmodium: a sheet at the front, then fine veins in a sheet that gets
// thinner, then the tubes of the model alone.
//
// Two steps. `frontMap` writes a coarse map, once for each state of the simulation: how much plasm a texel holds and
// how old its ground is. The render pass reads the 3 × 3 texels around a pixel as a smooth surface and adds the sheet
// to the trail there.

const FRONT_LEVEL = 3u;      // the map of the front has texels of 2^3 = 8 cells per side
const FRONT_STEPS = 1500.0;  // steps after the front in which the main vein appears: the fan ends there (50 min)
const FRONT_SHEET = 100.0;   // steps in which the sheet gives its mass to the veins (195 s)
const FRONT_CELLS = 6.5;     // cells per step of the lattice of the veins
const FRONT_VEIN = 0.16;     // half the width of a full vein, in steps of that lattice
const FRONT_FULL = 0.6;      // the plasm around a point, as light, from which a vein has its full width
const FRONT_RISE = 0.9;      // the plasm of a vein, as light
const FRONT_GAIN = 2.4;      // the sheet in units of the mean trail of its texels
const FRONT_FADE = 350.0;    // steps in which the fine veins get thinner by the factor e
const FRONT_REACH = 13;      // cells that the sheet reaches from its plasm, at most: 1.5 texels of the map and one more

// The map of the front, one fragment per texel: (the mean of the summed trail over the cells of the texel; that mean
// times the age of the ground, 0 at the front to 1 at FRONT_STEPS; the strain with the most trail; 1). The age of the
// ground of a texel is the age of its oldest front stamp among the cells with slime: the step at which the front first
// reached the texel. A cell with slime and no front stamp is old ground (painted slime), and so is a texel without
// slime: trail that no step of the slime field saw.
@fragment
fn frontMap(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let s = size();
  let span = vec2f(s) / vec2f(levelSize(FRONT_LEVEL)); // cells per texel
  let lo = floor(frag.xy) * span;
  let hi = lo + span;
  var sum = vec4f(0.0);
  var oldest = 0u;
  var stamped = false;
  for (var y = i32(floor(lo.y)); f32(y) < hi.y && y < s.y; y++) {
    let wy = min(hi.y, f32(y + 1)) - max(lo.y, f32(y));
    for (var x = i32(floor(lo.x)); f32(x) < hi.x && x < s.x; x++) {
      let w = (min(hi.x, f32(x + 1)) - max(lo.x, f32(x))) * wy;
      sum += w * textureLoad(trail, vec2i(x, y), 0);
      let i = y * s.x + x;
      let held = stamps[i];
      if (held != 0u && V.slime.x + 1u - held < V.slime.y) {
        let f = fronts[i];
        stamped = true;
        oldest = max(oldest, select(V.slime.x + 1u - f, 0xffffffffu, f == 0u));
      }
    }
  }
  let mean = sum / (span.x * span.y);
  var k = 0u;
  for (var j = 1u; j < V.frame.y; j++) {
    if (mean[j] > mean[k]) { k = j; }
  }
  let body = mean.x + mean.y + mean.z + mean.w;
  // A texel without slime holds no front stamp, and it shows no fan: its ground counts as old.
  let age = select(1.0, min(f32(oldest) / FRONT_STEPS, 1.0), stamped);
  return vec4f(body, body * age, f32(k), 1.0);
}

struct Fan {
  v: vec4f, // the sheet of each strain at a point, in units of the trail
  h: f32,   // their sum
  g: vec2f, // the gradient of the sum, per cell
  up: vec2f, // the slope of the plasm around the point, without the veins: the plasm of the sheet lies up this slope
}

// The veins of the fan, a pattern that is fixed in the grid: the walls between the cells of a lattice with one point
// in each step, bent by soft noise so that no wall is straight. (how far p is from a wall, 0 on it, in lattice steps;
// the gradient of that, per cell; the lattice steps per cell).
fn fanVeins(p: vec2f) -> vec4f {
  let n = patternSteps(FRONT_CELLS);
  let scale = n / vec2f(size()); // lattice steps per cell
  let x0 = p * scale;
  let bentX = noiseSlope(x0 + vec2f(3.1, 8.7), vec2i(n));
  let bentY = noiseSlope(x0 + vec2f(41.3, 17.9), vec2i(n));
  let x = x0 + 0.7 * (vec2f(bentX.x, bentY.x) - 0.5);
  let i = vec2i(floor(x));
  var d1 = 8.0;
  var d2 = 8.0;
  var o1 = vec2f(0.0);
  var o2 = vec2f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let k = i + vec2i(dx, dy);
      let w = wrapCell(k, vec2i(n));
      let o = 0.15 + 0.7 * vec2f(lattice(w + vec2i(23, 5)), lattice(w + vec2i(101, 67)));
      let d = x - (vec2f(k) + o);
      let l = length(d);
      if (l < d1) {
        d2 = d1;
        o2 = o1;
        d1 = l;
        o1 = d;
      } else if (l < d2) {
        d2 = l;
        o2 = d;
      }
    }
  }
  return vec4f(d2 - d1, (o2 / max(d2, 1e-6) - o1 / max(d1, 1e-6)) * scale, scale.x);
}

// The sheet of the growth front at p: a quadratic B-spline over the 3 × 3 texels of the map of the front around p
// (filmAt() has the weights). At the front it is a whole sheet. Behind the front the sheet gets thinner with the
// time scale of the sheet, and fine veins stay in it: thick near the plasm of the model, thinner outward, and
// thinner with the age until the main vein has formed.
fn fanAt(p: vec2f, under: f32) -> Fan {
  var f: Fan;
  let s = size();
  let n = levelSize(FRONT_LEVEL);
  let ratio = vec2f(n) / vec2f(s); // texels per cell
  let q = p * ratio - 0.5;
  let c = vec2i(floor(q + 0.5));
  let u = q - vec2f(c);
  let wx = spline(u.x);
  let wy = spline(u.y);
  let sx = splineSlope(u.x);
  let sy = splineSlope(u.y);
  var xs = clamp(vec3i(c.x - 1, c.x, c.x + 1), vec3i(0), vec3i(n.x - 1));
  var ys = clamp(vec3i(c.y - 1, c.y, c.y + 1), vec3i(0), vec3i(n.y - 1));
  if (V.boundary == 0u) {
    let w = wrapCell(c, n);
    xs = vec3i(select(w.x - 1, n.x - 1, w.x == 0), w.x, select(w.x + 1, 0, w.x == n.x - 1));
    ys = vec3i(select(w.y - 1, n.y - 1, w.y == 0), w.y, select(w.y + 1, 0, w.y == n.y - 1));
  }
  var body = vec4f(0.0);
  var aged = 0.0;
  var slope = vec2f(0.0);
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 3; i++) {
      let m = textureLoad(fanMap, vec2i(xs[i], ys[j]), 0);
      body[u32(m.z)] += wx[i] * wy[j] * m.x;
      aged += wx[i] * wy[j] * m.y;
      slope += vec2f(sx[i] * wy[j], wx[i] * sy[j]) * m.x;
    }
  }
  let total = body.x + body.y + body.z + body.w;
  if (!(total > 1e-6)) { return f; }
  let t = clamp(aged / total, 0.0, 1.0);
  if (t >= 1.0) { return f; }
  // The sheet: all of it at the front, and less with the time scale of the sheet.
  let sheet = exp(-t * FRONT_STEPS / FRONT_SHEET);
  // The veins: thinner with the time scale of the veins, and gone when the main vein has formed.
  let stay = exp(-t * FRONT_STEPS / FRONT_FADE) * (1.0 - smoothstep(0.6, 1.0, t));
  let e = fanVeins(p);
  // Half the width of a vein, in lattice steps: full where the plasm around p is strong, and none far from it.
  let wide = FRONT_VEIN * stay * clamp(total * V.exposure / FRONT_FULL, 0.0, 1.0);
  let soft = max(0.75 * V.scale * e.w, 0.03); // the edge of a vein: a pixel wide, or wider
  let r = clamp((e.x - wide + soft) / (2.0 * soft), 0.0, 1.0);
  // The veins come as the sheet goes, and they end at the tube of the model (`under`: how much of the ground the
  // plasm of the model hides at p). A vein that is thinner than a pixel shows the share of the pixel that it covers.
  let seen = (1.0 - sheet) * (1.0 - under) * FRONT_RISE / V.exposure * min(1.0, wide / soft);
  let h = FRONT_GAIN * total * sheet + seen * (1.0 - r * r * (3.0 - 2.0 * r));
  let g = FRONT_GAIN * sheet * slope * ratio - seen * 6.0 * r * (1.0 - r) / (2.0 * soft) * e.yz;
  f.v = body * (h / total);
  f.h = h;
  f.g = g;
  f.up = slope;
  return f;
}

// How much of the sheet of the growth front shows at p, 0 to 1: nothing where a wall stands between p and the plasm
// that the sheet comes from. A wall is thinner than the sheet is wide, and no plasm lies behind it. The plasm lies up
// the slope `up` of the plasm around p (Fan.up), so the pass walks up the slope, one cell at a time, until it meets
// plasm that the picture shows or it has gone as far as the sheet reaches. The sheet ends within one cell before the
// outline of a wall on the way.
fn fanOpen(p: vec2f, up: vec2f) -> f32 {
  let l = length(up);
  if (l <= 1e-12) { return 1.0; }
  let dir = up / l;
  var open = 1.0;
  for (var k = 0; k < FRONT_REACH; k++) {
    let q = p + dir * f32(k) - 0.5;
    let c = vec2i(floor(q));
    let u = q - floor(q);
    // The distance to the outline of the walls at the point, between the centres of the four cells around it.
    let a = mix(wallAt(c), wallAt(c + vec2i(1, 0)), u.x);
    let b = mix(wallAt(c + vec2i(0, 1)), wallAt(c + vec2i(1, 1)), u.x);
    open = min(open, 1.0 - smoothstep(-1.0, 0.0, mix(a, b, u.y)));
    if (open <= 0.0) { break; }
    let t = trailAt(vec2i(floor(q + 0.5)));
    if (k > 0 && (t.x + t.y + t.z + t.w - V.fx.y) * V.exposure > 0.14) { break; }
  }
  return open;
}

// The distance from the centre of cell c to the outline of the walls, in cells, above 0 in a wall (paint.wgsl).
fn wallAt(c: vec2i) -> f32 {
  return (f32(shape[shapeIndex(c)] & 0xffu) / 255.0 - 0.5) * 2.0 * SHAPE_RANGE;
}

// How much of the ground the plasm `v` hides, 0 to 1: the film of the slime does not show through a tube. In the gel
// style this is the body of the gel (see gel): the gel ends at a line, and the film ends there too. In the other
// styles the plasm hides the ground as its light or its ink gets strong.
fn plasmCover(v: vec4f) -> f32 {
  let x = (v.x + v.y + v.z + v.w) * V.exposure;
  if (V.style == 1u) { return smoothstep(0.02, 0.14, x); }
  return 1.0 - exp(-FILM_HIDE * max(x, 0.0));
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
  var grain = 0.0;
  if (V.streamFx.x != 0.0) { grain = streaming(p); }
  // A grain is more plasm: more trail in the glow and on paper, a darker gel.
  v *= 1.0 + STREAM_GAIN * grain;
  let halo = textureSampleLevel(bloom, bloomSampler, p / s, 0.0);
  var e: Env;
  var f: Flake;
  if (ENV && near) {
    e = envAt(p, cells);
    f = flakeAt(p, e);
    if (V.frame.w != 0u) { v += presence(e, cells, raw); }
  }
  // The sheet of the growth front at p in units of the trail, and its gradient per cell: none without the front.
  var lift = vec3f(0.0);
  // The sheet of the growth front is more plasm on young ground (ADR 0060). It stays on the side of a wall on which
  // its plasm lies (fanOpen()).
  if (FRONT && (V.slime.z & 2u) != 0u && V.style != 3u) {
    let under = plasmCover(v);
    var fan = fanAt(p, under);
    if (ENV && V.frame.z != 0u && fan.h > 0.0 && under < 1.0) {
      let open = fanOpen(p, fan.up);
      fan.v *= open;
      fan.h *= open;
      fan.g *= open;
    }
    v += fan.v;
    lift = vec3f(fan.h, fan.g);
  }
  var dots = vec4f(0.0);
  if (V.style == 3u) { dots = agentsAt(p); }
  var base = V.background.rgb;
  // The film of the slime lies on the ground, and the plasm lies on the film: where the plasm covers the ground, the
  // picture shows no film. The flake of food, the trail and all else lie on it.
  if (SLIME && (V.slime.z & 1u) != 0u) {
    let hidden = plasmCover(select(v, dots, V.style == 3u));
    if (hidden < 1.0) { base = mix(slimed(base, p), base, hidden); }
  }
  if (ENV && near) { base = substrate(f, base); }
  var c: vec3f;
  switch V.style {
    case 1u: { c = gel(p, v, base, f, lift) * (1.0 - STREAM_DARK * grain); }
    case 2u: { c = paper(v, base); }
    case 3u: { c = glow(dots, vec4f(0.0), base); }
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
  if (ENV && V.streamFx.w != 0.0 && V.frame.z != 0u) { c = electrodes(c, p); }
  return c;
}

// ---- Electrodes (ADR 0047, ADR 0058) ------------------------------------------------------------------
// The poles of the Electrode tool, on top of the picture. Display only. `poles` holds their outlines as `shape` holds
// those of walls and food (paint.wgsl POLES): the distance to the outline of the cathodes in the first byte of a cell
// and to the outline of the anodes in the second. So a pole has the outline of its strokes at every zoom, as food and
// walls have, and a surface: a stud whose rim slopes up from the outline, lit by the light of the picture, with a
// highlight, a thin dark line along its outline and a shadow on the side away from the light.

const CATHODE = vec3f(0.05, 0.32, 1.0);  // linear RGB: blue, the pole that attracts
const ANODE = vec3f(1.0, 0.08, 0.04);    // red, the pole that repels
const POLE_RIM = 1.5;      // cells: the slope of a pole, from its outline to its flat top (POLE_RIM in paint.wgsl)
const POLE_SHADOW = 2.0;   // cells that the shadow of a pole reaches beside its outline

// The 3 × 3 cells of `poles` around cell c (cellsAround()).
fn poleCells(c: vec2i) -> array<u32, 9> {
  let k = cellsAround(c);
  var w: array<u32, 9>;
  for (var i = 0; i < 9; i++) { w[i] = poles[k[i]]; }
  return w;
}

// A pole at a point: its lit surface, how much of the pixel it covers, and its shadow on what lies beside it.
struct Stud {
  color: vec3f,
  cover: f32,
  shadow: f32,
}

// The stud of the colour `base` where the distance to its outline is `sd` cells (positive inside), `coverSd` for the
// coverage (envAt()) and `grad` the gradient of the distance.
// - The surface is a dome over the outer POLE_RIM cells: its height rises as t (2 − t) with t the share of the rim
//   that lies behind, so it is steepest at the outline and flat from the rim on. The light is the one of the walls.
// - The line: the colour gets darker toward the outline, over a pixel and a half: a third of a cell at least, and
//   three quarters of a cell at most, so that a small pole keeps its colour in a view zoomed out.
// - The shadow lies outside the outline, where the pole stands between the point and the light: the gradient points
//   to the pole there, and so toward the light. It fades over POLE_SHADOW cells. The gradient is about 1 long beside
//   an outline and shorter where two outlines are as near (the middle of a gap): the shadow fades there with it.
fn studAt(base: vec3f, sd: f32, coverSd: f32, grad: vec2f) -> Stud {
  var s: Stud;
  s.cover = cover(coverSd);
  let toLight = clamp(dot(grad, normalize(SUN.xy)), 0.0, 1.0);
  s.shadow = smoothstep(-POLE_SHADOW, 0.0, sd) * toLight * (1.0 - s.cover);
  if (s.cover <= 0.0) { return s; }
  let t = clamp(sd / POLE_RIM, 0.0, 1.0);
  let n = normalize(vec3f(-grad * (2.0 * (1.0 - t) / POLE_RIM), 1.0));
  let diffuse = max(dot(n, SUN), 0.0);
  let spec = pow(max(dot(n, normalize(SUN + vec3f(0.0, 0.0, 1.0))), 0.0), 60.0);
  let lit = base * (0.5 + 0.7 * diffuse) + 0.6 * spec;
  let line = 1.0 - smoothstep(0.0, clamp(1.5 * V.scale, 0.35, 0.75), sd);
  s.color = mix(lit, 0.25 * base, 0.6 * line);
  return s;
}

// The picture c with the electrodes at p over it. A cell holds one pole, so the two outlines never cross: where they
// meet, each pole covers its share of the pixel.
fn electrodes(c: vec3f, p: vec2f) -> vec3f {
  let cells = poleCells(vec2i(floor(p)));
  var any = 0u;
  for (var k = 0; k < 9; k++) { any |= cells[k]; }
  // No pole within the reach of the outline distances.
  if (any == 0u) { return c; }
  let e = envAt(p, cells);
  let cathode = studAt(CATHODE, e.wall, e.wallCover, e.wallGrad);
  let anode = studAt(ANODE, e.food, e.foodCover, e.foodGrad);
  // The shadow is as dark as the one of a wall in each style (walls()).
  let ground = c * (1.0 - byStyle(vec3f(0.75), vec3f(0.6), vec3f(0.3)).x * max(cathode.shadow, anode.shadow));
  let both = cathode.cover + anode.cover;
  if (both <= 0.0) { return ground; }
  let surface = (cathode.cover * cathode.color + anode.cover * anode.color) / both;
  return mix(ground, surface, min(both, 1.0));
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
    let rim = DISH_FILL * 0.5 * f32(min(s.x, s.y));
    if (dot(m, m) > rim * rim) { q = vec2i(floor(o + m * ((rim - 0.75) * inverseSqrt(dot(m, m))))); }
  }
  return q;
}

// The 4 cells around p that a lookup reads: top left, top right, bottom left, bottom right. On the periodic grid the
// columns and rows are wrapped once.
fn scentCells(p: vec2f) -> array<vec2i, 4> {
  let s = size();
  let i = vec2i(floor(p - 0.5));
  var x = vec2i(i.x, i.x + 1);
  var y = vec2i(i.y, i.y + 1);
  if (V.boundary == 0u) {
    let w = wrapCell(i, s);
    x = vec2i(w.x, select(w.x + 1, 0, w.x == s.x - 1));
    y = vec2i(w.y, select(w.y + 1, 0, w.y == s.y - 1));
  } else {
    x = clamp(x, vec2i(0), vec2i(s.x - 1));
    y = clamp(y, vec2i(0), vec2i(s.y - 1));
  }
  var t = array<vec2i, 4>(vec2i(x.x, y.x), vec2i(x.y, y.x), vec2i(x.x, y.y), vec2i(x.y, y.y));
  let m = p - 0.5 * vec2f(s);
  let rim = DISH_FILL * 0.5 * f32(min(s.x, s.y));
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

// 1 where a cell holds scent (in the arena, not a wall), else 0.
fn scentOpen(c: vec2i) -> f32 {
  let s = size();
  if ((shape[c.y * s.x + c.x] & 0x80u) != 0u) { return 0.0; }
  if (V.boundary == 2u && distance(vec2f(c) + 0.5, 0.5 * vec2f(s)) > DISH_FILL * 0.5 * f32(min(s.x, s.y))) { return 0.0; }
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
  let span = vec2f(s) / vec2f(levelSize(u32(V.scentFx.x))); // cells per texel
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
  let n = levelSize(k);
  let ratio = vec2f(n) / vec2f(s); // texels per cell
  let q = p * ratio - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  var x = vec2i(i.x, i.x + 1);
  var y = vec2i(i.y, i.y + 1);
  if (V.boundary == 0u) {
    let w = wrapCell(i, n);
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
// in both models: both read it (ADR 0044).
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
  let repellent = scentGlow(s.v.y);
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
    inside = cover(DISH_FILL * 0.5 * min(s.x, s.y) - distance(p, 0.5 * s));
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
