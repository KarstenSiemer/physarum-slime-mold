// Full-screen pass: trail (or agent counts) → color. Mirrors ../../shaders/render.wgsl.
// Prepended with view.glsl.

uniform sampler2D counts;
uniform sampler2D bloom;
uniform sampler2D heights; // gel style: written by height.frag each frame

vec4 bilinear(vec2 p) {
  vec2 q = p - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec4 a = mix(trailAt(i), trailAt(i + ivec2(1, 0)), f.x);
  vec4 b = mix(trailAt(i + ivec2(0, 1)), trailAt(i + ivec2(1, 1)), f.x);
  return mix(a, b, f.y);
}

vec4 trailFiltered(vec2 p) {
  if (V.scale <= 1.0) return bilinear(p);
  float o = 0.25 * V.scale;
  return 0.25 * (bilinear(p + vec2(-o, -o)) + bilinear(p + vec2(o, -o)) + bilinear(p + vec2(-o, o)) +
                 bilinear(p + vec2(o, o)));
}

vec4 levels(vec4 v) {
  float t = v.x + v.y + v.z + v.w;
  return v * (max(t - V.fx.y, 0.0) / max(t, 1e-20));
}

// The strain ratios of a trail value; strain A where there is no trail.
vec4 strainMix(vec4 v) {
  float t = v.x + v.y + v.z + v.w;
  return t > 1e-6 ? v / t : vec4(1.0, 0.0, 0.0, 0.0);
}

vec3 tint(vec4 v) {
  vec3 c = vec3(0.0);
  for (int s = 0; s < int(V.frame.y); s++) c += v[s] * V.colors[s].rgb;
  return c;
}

vec3 srgb(vec3 c) {
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, 12.92 * c, vec3(lessThanEqual(c, vec3(0.0031308))));
}

float hash(uvec2 p) {
  uint x = p.x * 1664525u + p.y * 1013904223u + V.frame.x * 2654435761u;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return float((x ^ (x >> 16u)) >> 8u) * (1.0 / 16777216.0);
}

// Coverage of a shape from its signed distance (cells, positive inside): a ramp one pixel wide.
float cover(float sd) {
  float w = 0.5 * V.scale;
  return smoothstep(-w, w, sd);
}

// `base` is what lies below the trail: the background, or food on it.
vec3 glow(vec4 v, vec4 halo, vec3 base) {
  vec3 l = 1.0 - exp(-(tint(v) * V.exposure + tint(halo) * V.fx.x * 0.2));
  return base + (1.0 - base) * l;
}

vec3 paper(vec4 v, vec3 base) {
  vec3 absorb = vec3(0.0);
  for (int s = 0; s < int(V.frame.y); s++) absorb += v[s] * (0.15 + 0.85 * (1.0 - V.colors[s].rgb));
  return base * exp(-absorb * V.exposure);
}

// The gel height field (height.frag) with hardware bilinear filtering at grid position q, wrapped
// for the periodic boundary; outside a closed arena the border holds the value of an empty cell.
float heightAt(vec2 q) {
  vec2 s = vec2(gridSize());
  vec2 p = V.boundary == 0u ? q - s * floor(q / s) : q;
  return textureLod(heights, (p + 1.0) / (s + 2.0), 0.0).r;
}

// Four taps spread over the pixel footprint when zoomed out, like trailFiltered().
float heightFiltered(vec2 p) {
  if (V.scale <= 1.0) return heightAt(p);
  float o = 0.25 * V.scale;
  return 0.25 * (heightAt(p + vec2(-o, -o)) + heightAt(p + vec2(o, -o)) + heightAt(p + vec2(-o, o)) +
                 heightAt(p + vec2(o, o)));
}

float height(vec2 p) { return 1.0 - exp(-max(heightFiltered(p), 0.0)); }

// A flake of food (see flakeAt in render.wgsl).
struct Flake {
  vec3 body;
  vec3 edge;
  float rim;
  float cover;
};

const float GEL_CLEAR = 0.6; // how much of a flake of food shows through the gel style's trail

// Over a flake of food the gel takes in its colour (see gel in render.wgsl).
vec3 gel(vec2 p, vec4 v, vec3 base, Flake f) {
  float d = max(V.scale, 0.75);
  float h = height(p);
  float gx = height(p + vec2(d, 0.0)) - height(p - vec2(d, 0.0));
  float gy = height(p + vec2(0.0, d)) - height(p - vec2(0.0, d));
  vec3 n = normalize(vec3(-gx, -gy, 0.35 * d));
  vec3 l = normalize(vec3(-0.45, -0.6, 0.65));
  float diffuse = max(dot(n, l), 0.0);
  float spec = pow(max(dot(n, normalize(l + vec3(0.0, 0.0, 1.0))), 0.0), 48.0);
  float total = v.x + v.y + v.z + v.w;
  vec3 albedo = total > 1e-6 ? tint(v) / total : V.colors[0].rgb;
#if ENV
  if (f.cover > 0.0) albedo = mix(albedo, mix(f.body, f.edge, f.rim * 0.85), GEL_CLEAR * f.cover);
#endif
  vec3 lit = albedo * (0.25 + 0.9 * diffuse) + 0.6 * spec * h;
  return mix(base, lit, smoothstep(0.02, 0.35, h));
}

// Agents in the cell, per strain; in collision mode also those that stayed put (see render.wgsl).
vec4 agentsAt(vec2 p) {
  int i = cellAt(ivec2(floor(p)));
  if (i < 0) return vec4(0.0);
  vec4 moved = texelFetch(counts, coord(i), 0);
  if (V.frame.w == 0u) return moved;
  float stayed = max(texelFetch(occ, coord(i), 0).r - (moved.x + moved.y + moved.z + moved.w), 0.0);
  return moved + strainMix(trailAt(ivec2(floor(p)))) * stayed;
}

#if ENV
// ---- Food, light and walls (see render.wgsl) ----

const vec3 SUN = vec3(-0.45, -0.6, 0.65) / sqrt(0.985); // toward the light, as in gel()

struct Env {
  float wall;      // the spline, for the light
  float food;
  float wallCover; // set right at the centre of the cell under p, for the coverage (see envAt in render.wgsl)
  float foodCover;
  float light;
  float shadow;
  vec2 wallGrad;
  vec2 foodGrad;
  ivec2 cell; // the cell under p, the middle one of the 3 × 3 cells the values come from
  vec3 weightX;
  vec3 weightY;
};

// Quadratic B-spline weights and their derivatives (see render.wgsl).
vec3 spline(float u) { return vec3(0.5 * (0.5 - u) * (0.5 - u), 0.75 - u * u, 0.5 * (0.5 + u) * (0.5 + u)); }
vec3 splineSlope(float u) { return vec3(u - 0.5, -2.0 * u, u + 0.5); }

// The columns and rows of the 3 × 3 cells around c: wrapped on the periodic grid with comparisons, else as they
// are (see shapeCells in render.wgsl).
void around(ivec2 c, out ivec3 xs, out ivec3 ys) {
  ivec2 s = gridSize();
  xs = ivec3(c.x - 1, c.x, c.x + 1);
  ys = ivec3(c.y - 1, c.y, c.y + 1);
  if (V.boundary == 0u) {
    ivec2 q = wrapCell(c, s);
    xs = ivec3(q.x == 0 ? s.x - 1 : q.x - 1, q.x, q.x == s.x - 1 ? 0 : q.x + 1);
    ys = ivec3(q.y == 0 ? s.y - 1 : q.y - 1, q.y, q.y == s.y - 1 ? 0 : q.y + 1);
  }
}

// The 3 × 3 cells of `shape` around c, row by row (see shapeCells in render.wgsl).
void shapeCells(ivec2 c, out vec4 cells[9]) {
  ivec2 s = gridSize();
  if (V.boundary == 2u) {
    vec2 m = vec2(c) + 0.5 - 0.5 * vec2(s);
    float rim = 0.5 * float(min(s.x, s.y)) - 1.0;
    if (dot(m, m) > (rim - 1.5) * (rim - 1.5)) {
      for (int j = 0; j < 3; j++) {
        for (int i = 0; i < 3; i++) cells[j * 3 + i] = shapeAt(c + ivec2(i - 1, j - 1));
      }
      return;
    }
  }
  ivec3 xs;
  ivec3 ys;
  around(c, xs, ys);
  xs = clamp(xs, ivec3(0), ivec3(s.x - 1));
  ys = clamp(ys, ivec3(0), ivec3(s.y - 1));
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) cells[j * 3 + i] = texelFetch(shape, ivec2(xs[i], ys[j]), 0);
  }
}

// `cells`: the 3 × 3 cells of `shape` around the cell under p, row by row (see envAt in render.wgsl).
Env envAt(vec2 p, vec4 cells[9]) {
  vec2 q = p - 0.5;
  ivec2 c = ivec2(floor(q + 0.5));
  vec2 u = q - vec2(c);
  vec3 wx = spline(u.x);
  vec3 wy = spline(u.y);
  vec3 sx = splineSlope(u.x);
  vec3 sy = splineSlope(u.y);
  vec4 v = vec4(0.0);
  vec4 gx = vec4(0.0);
  vec4 gy = vec4(0.0);
  const vec3 CENTRE = vec3(0.125, 0.75, 0.125); // the spline at the centre of the cell
  vec2 centre = vec2(0.0);
  for (int j = 0; j < 3; j++) {
    vec4 row = vec4(0.0);
    vec4 rowSlope = vec4(0.0);
    for (int i = 0; i < 3; i++) {
      vec4 s = cells[j * 3 + i];
      row += wx[i] * s;
      rowSlope += sx[i] * s;
      centre += CENTRE[i] * CENTRE[j] * s.xy;
    }
    v += wy[j] * row;
    gx += wy[j] * rowSlope;
    gy += sy[j] * row;
  }
  float k = 2.0 * SHAPE_RANGE;
  Env e;
  e.wall = (v.x - 0.5) * k;
  e.food = (v.y - 0.5) * k;
  // The cell's own distances, against the spline's at its centre (see envAt in render.wgsl).
  vec2 own = (cells[4].xy - 0.5) * k;
  centre = (centre - 0.5) * k;
  float side = (1.0 - 4.0 * u.x * u.x) * (1.0 - 4.0 * u.y * u.y);
  vec2 fix = (own - centre) * side * side;
  e.wallCover = e.wall + ((own.x > 0.0) != (centre.x > 0.0) ? fix.x : 0.0);
  e.foodCover = e.food + ((own.y > 0.0) != (centre.y > 0.0) ? fix.y : 0.0);
  e.light = clamp(v.z, 0.0, 1.0);
  e.shadow = clamp(v.w, 0.0, 1.0);
  e.wallGrad = vec2(gx.x, gy.x) * k;
  e.foodGrad = vec2(gx.y, gy.y) * k;
  e.cell = c;
  e.weightX = wx;
  e.weightY = wy;
  return e;
}

vec3 byStyle(vec3 glowStyle, vec3 gelStyle, vec3 paperStyle) {
  return V.style == 1u ? gelStyle : V.style == 2u ? paperStyle : glowStyle;
}

vec3 rimNormal(float sd, vec2 grad, float width, float steep) {
  float t = clamp(sd / width, 0.0, 1.0);
  float rise = 6.0 * t * (1.0 - t) / width;
  return normalize(vec3(-grad * rise * steep, 1.0));
}

float lattice(ivec2 c) {
  uint x = uint(c.x) * 1664525u + uint(c.y) * 1013904223u;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return float((x ^ (x >> 16u)) >> 8u) * (1.0 / 16777216.0);
}

float valueNoise(vec2 q, ivec2 period) {
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 i0 = wrapCell(i, period);
  ivec2 i1 = wrapCell(i + 1, period);
  float a = mix(lattice(i0), lattice(ivec2(i1.x, i0.y)), u.x);
  float b = mix(lattice(ivec2(i0.x, i1.y)), lattice(i1), u.x);
  return mix(a, b, u.y);
}

float grain(vec2 p) {
  vec2 s = vec2(gridSize());
  vec2 n = max(round(s * (320.0 / max(s.x, s.y))), vec2(1.0));
  vec2 q = p * n / s;
  ivec2 period = ivec2(n);
  return 0.65 * valueNoise(q, period) + 0.35 * valueNoise(q * 3.0 + vec2(17.3, 5.1), 3 * period);
}

Flake flakeAt(vec2 p, Env e) {
  Flake f = Flake(vec3(0.0), vec3(0.0), 0.0, cover(e.foodCover));
  if (f.cover <= 0.0) return f;
  vec3 n = rimNormal(e.food, e.foodGrad, 2.0, 1.2);
  float shade = 0.55 + 0.65 * max(dot(n, SUN), 0.0);
  f.body = byStyle(vec3(0.15, 0.105, 0.045), vec3(0.46, 0.33, 0.14), vec3(0.80, 0.65, 0.40)) *
           ((0.72 + 0.56 * grain(p)) * shade);
  f.edge = byStyle(vec3(0.32, 0.24, 0.12), vec3(0.66, 0.52, 0.30), vec3(0.46, 0.34, 0.18));
  f.rim = 1.0 - smoothstep(0.0, max(0.6, 1.5 * V.scale), e.food);
  return f;
}

vec3 substrate(Flake f) {
  vec3 bg = V.background.rgb;
  if (f.cover <= 0.0) return bg;
  return mix(mix(bg, f.body, f.cover * 0.95), f.edge, f.cover * f.rim * 0.85);
}

vec4 presence(Env e, vec4 cells[9], vec4 raw) {
  float a = cover(e.foodCover);
  if (a <= 0.0) return vec4(0.0);
  ivec2 s = gridSize();
  ivec3 xs;
  ivec3 ys;
  around(e.cell, xs, ys);
  float share = 0.0;
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      bool inGrid = xs[i] >= 0 && ys[j] >= 0 && xs[i] < s.x && ys[j] < s.y;
      int index = inGrid ? ys[j] * s.x + xs[i] : -1;
      share += e.weightX[i] * e.weightY[j] * presenceWeight(index, (cells[j * 3 + i].g - 0.5) * 2.0 * SHAPE_RANGE);
    }
  }
  return strainMix(raw) * (a * share * PRESENCE / V.exposure);
}

// The trail at p without the cells of walls, and whether a wall holds one of the 4 cells around p (see
// trailBesideWalls in render.wgsl).
vec4 trailBesideWalls(vec2 p, vec4 cells[9]) {
  vec2 q = p - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  ivec2 o = i - ivec2(floor(p)) + 1;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int dy = 0; dy < 2; dy++) {
    for (int dx = 0; dx < 2; dx++) {
      if (cells[(o.y + dy) * 3 + o.x + dx].r >= 0.5) continue;
      float w = (dx == 1 ? f.x : 1.0 - f.x) * (dy == 1 ? f.y : 1.0 - f.y);
      sum += w * trailAt(i + ivec2(dx, dy));
      total += w;
    }
  }
  return total > 0.0 ? sum / total : vec4(0.0);
}

bool wallBeside(vec2 p, vec4 cells[9]) {
  ivec2 o = ivec2(floor(p - 0.5)) - ivec2(floor(p)) + 1;
  bool wall = false;
  for (int dy = 0; dy < 2; dy++) {
    for (int dx = 0; dx < 2; dx++) wall = wall || cells[(o.y + dy) * 3 + o.x + dx].r >= 0.5;
  }
  return wall;
}

vec3 walls(vec3 c, Env e) {
  float aw = cover(e.wallCover);
  float shadow = e.shadow * (1.0 - aw);
  vec3 o = c * (1.0 - byStyle(vec3(0.75), vec3(0.6), vec3(0.3)).x * shadow);
  if (aw <= 0.0) return o;
  vec3 n = rimNormal(e.wall, e.wallGrad, 1.5, 1.0);
  float diffuse = max(dot(n, SUN), 0.0);
  float spec = pow(max(dot(n, normalize(SUN + vec3(0.0, 0.0, 1.0))), 0.0), 40.0);
  vec3 albedo = byStyle(vec3(0.05, 0.055, 0.065), vec3(0.11, 0.10, 0.08), vec3(0.68, 0.66, 0.62));
  vec3 wall = albedo * (0.35 + 0.9 * diffuse) + byStyle(vec3(0.06), vec3(0.3), vec3(0.04)).x * spec;
  return mix(o, wall, aw);
}
#endif

#ifdef SCENT
// ---- Scent view (SCENT; see render.wgsl and src/engine/scent.ts) ----

uniform sampler2D scent;       // food scent (r) and light repellent (g)
uniform sampler2D scentLevels; // the scent on a coarser map (scent-down.frag), zoomed out

const float SCENT_LOW = -2.0;              // log10 of the lowest level drawn: 0.01
const float SCENT_TOP = 6.0;               // powers of ten from 0.01 to the top of the glow: 10^4
const float SCENT_GLOW = 0.45;             // opacity of the glow at the top
const float SCENT_LINE = 0.8;              // opacity of the line
const float SCENT_PAPER_FILL = 1.5;        // the glow over paper, times this (see render.wgsl)
const float SCENT_FLAT = 1e-4;             // powers of ten per pixel below which the scent counts as flat
const float LN10 = 2.302585093;

struct Scent {
  vec2 v;
  vec2 gx;
  vec2 gy;
  float w; // the weight of the cells that hold scent among those read (0: none, in a wall)
};

// Clamped to the box, and outside the dish the cell inside the rim on the way to the centre (see scentTexel in
// render.wgsl).
ivec2 scentTexel(ivec2 c) {
  ivec2 s = gridSize();
  ivec2 q = clamp(c, ivec2(0), s - 1);
  if (V.boundary == 2u) {
    vec2 o = 0.5 * vec2(s);
    vec2 m = vec2(c) + 0.5 - o;
    float rim = 0.5 * float(min(s.x, s.y)) - 1.0;
    if (dot(m, m) > rim * rim) q = ivec2(floor(o + m * ((rim - 0.75) * inversesqrt(dot(m, m)))));
  }
  return q;
}

// The bilinear mix of a (top left), b (top right), c (bottom left) and d (bottom right) at fraction f, without the
// corners that `open` weighs 0, with its gradient (see scentMix in render.wgsl).
Scent scentMix(vec2 a, vec2 b, vec2 c, vec2 d, vec2 f, vec4 open) {
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y) * open;
  vec4 wx = vec4(f.y - 1.0, 1.0 - f.y, -f.y, f.y) * open;
  vec4 wy = vec4(f.x - 1.0, -f.x, 1.0 - f.x, f.x) * open;
  float total = w.x + w.y + w.z + w.w;
  Scent r = Scent(vec2(0.0), vec2(0.0), vec2(0.0), 0.0);
  if (total <= 0.0) return r;
  r.w = total;
  vec2 sum = a * w.x + b * w.y + c * w.z + d * w.w;
  r.v = sum / total;
  r.gx = (a * wx.x + b * wx.y + c * wx.z + d * wx.w - r.v * (wx.x + wx.y + wx.z + wx.w)) / total;
  r.gy = (a * wy.x + b * wy.y + c * wy.z + d * wy.w - r.v * (wy.x + wy.y + wy.z + wy.w)) / total;
  return r;
}

// The 4 cells around p that a lookup reads; on the periodic grid the columns and rows are wrapped once (see
// scentCells in render.wgsl).
void scentCells(vec2 p, out ivec2 t[4]) {
  ivec2 s = gridSize();
  ivec2 i = ivec2(floor(p - 0.5));
  ivec2 x = ivec2(i.x, i.x + 1);
  ivec2 y = ivec2(i.y, i.y + 1);
  if (V.boundary == 0u) {
    ivec2 w = wrapCell(i, s);
    x = ivec2(w.x, w.x == s.x - 1 ? 0 : w.x + 1);
    y = ivec2(w.y, w.y == s.y - 1 ? 0 : w.y + 1);
  } else {
    x = clamp(x, ivec2(0), ivec2(s.x - 1));
    y = clamp(y, ivec2(0), ivec2(s.y - 1));
  }
  t[0] = ivec2(x.x, y.x);
  t[1] = ivec2(x.y, y.x);
  t[2] = ivec2(x.x, y.y);
  t[3] = ivec2(x.y, y.y);
  vec2 m = p - 0.5 * vec2(s);
  float rim = 0.5 * float(min(s.x, s.y)) - 1.0;
  if (V.boundary == 2u && dot(m, m) > (rim - 1.5) * (rim - 1.5)) {
    // Near the rim: some of the 4 cells may lie outside the dish.
    t[0] = scentTexel(i);
    t[1] = scentTexel(i + ivec2(1, 0));
    t[2] = scentTexel(i + ivec2(0, 1));
    t[3] = scentTexel(i + ivec2(1, 1));
  }
}

// Bilinear over the 4 cells around p without the cells that `open` marks 0, with the gradient (see scentBilinear in
// render.wgsl).
Scent scentBilinear(vec2 p, vec4 open) {
  ivec2 t[4];
  scentCells(p, t);
  vec2 f = fract(p - 0.5);
  return scentMix(texelFetch(scent, t[0], 0).xy, texelFetch(scent, t[1], 0).xy, texelFetch(scent, t[2], 0).xy,
                  texelFetch(scent, t[3], 0).xy, f, open);
}

// Which of the 4 cells around p that scentBilinear() reads hold no wall: 1 open, 0 wall (see scentOpenAt in
// render.wgsl).
vec4 scentOpenAt(vec2 p) {
  ivec2 t[4];
  scentCells(p, t);
  return vec4(lessThan(vec4(texelFetch(shape, t[0], 0).r, texelFetch(shape, t[1], 0).r, texelFetch(shape, t[2], 0).r,
                            texelFetch(shape, t[3], 0).r), vec4(0.5)));
}

// The scent at p from the scent s at a point d cells away, with its logarithm going on in a straight line (see
// scentFrom in render.wgsl).
Scent scentFrom(Scent s, vec2 d) {
  vec2 k = exp(mix(vec2(0.0), (s.gx * d.x + s.gy * d.y) / max(s.v, vec2(1e-30)), greaterThan(s.v, vec2(0.0))));
  return Scent(s.v * k, s.gx * k, s.gy * k, s.w);
}

// Texels per side of the coarse map of level k (see scentLevelSize in render.wgsl).
ivec2 scentLevelSize(int k) { return (gridSize() + ((1 << k) - 1)) >> k; }

// The scent at p on the coarse map of level k, with the gradient per cell (see scentCoarse in render.wgsl).
Scent scentCoarse(vec2 p, int k) {
  ivec2 s = gridSize();
  ivec2 n = scentLevelSize(k);
  vec2 ratio = vec2(n) / vec2(s);
  vec2 q = p * ratio - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  ivec2 x = ivec2(i.x, i.x + 1);
  ivec2 y = ivec2(i.y, i.y + 1);
  if (V.boundary == 0u) {
    ivec2 w = wrapCell(i, n);
    x = ivec2(w.x, w.x == n.x - 1 ? 0 : w.x + 1);
    y = ivec2(w.y, w.y == n.y - 1 ? 0 : w.y + 1);
  } else {
    x = clamp(x, ivec2(0), ivec2(n.x - 1));
    y = clamp(y, ivec2(0), ivec2(n.y - 1));
  }
  vec3 a = texelFetch(scentLevels, ivec2(x.x, y.x), 0).xyz;
  vec3 b = texelFetch(scentLevels, ivec2(x.y, y.x), 0).xyz;
  vec3 c = texelFetch(scentLevels, ivec2(x.x, y.y), 0).xyz;
  vec3 d = texelFetch(scentLevels, ivec2(x.y, y.y), 0).xyz;
  vec4 open = vec4(a.z, b.z, c.z, d.z);
  vec4 mean = 1.0 / max(open, vec4(1e-30));
  Scent r = scentMix(a.xy * mean.x, b.xy * mean.y, c.xy * mean.z, d.xy * mean.w, f, open);
  r.gx *= ratio.x;
  r.gy *= ratio.y;
  return r;
}

// The opacity of the glow for a scent v (see scentGlow in render.wgsl).
float scentGlow(float v) {
  if (!(v > 0.0)) return 0.0;
  return SCENT_GLOW * clamp((log2(v) / log2(10.0) - SCENT_LOW) / SCENT_TOP, 0.0, 1.0);
}

// The opacity of the line where the ratio r (gradient g per cell) is 1 (see scentLine in render.wgsl).
float scentLine(float r, vec2 g) {
  if (!(r > 0.0)) return 0.0;
  float dt = max(length(g) * V.scale / (r * LN10), SCENT_FLAT);
  float d = abs(log2(r) / log2(10.0)) / dt;
  return (1.0 - smoothstep(0.25, 1.25, d)) * SCENT_LINE;
}

#if ENV
// Which of the 4 cells around p that bilinear() reads hold no wall: 1 open, 0 wall (see openCells in render.wgsl).
vec4 openCells(vec2 p, vec4 cells[9]) {
  ivec2 o = ivec2(floor(p - 0.5)) - ivec2(floor(p)) + 1;
  return vec4(lessThan(vec4(cells[o.y * 3 + o.x].r, cells[o.y * 3 + o.x + 1].r, cells[(o.y + 1) * 3 + o.x].r,
                            cells[(o.y + 1) * 3 + o.x + 1].r), vec4(0.5)));
}
#endif

// The scent at a sensor point p, as the view reads it at a pixel: from the coarse map at level k > 0, else from the 4
// cells around p without those of walls (see scentSensed in render.wgsl).
Scent scentSensed(vec2 p, int k) {
  if (k > 0) return scentCoarse(p, k);
  vec2 q = V.boundary == 1u ? clamp(p, vec2(0.5), vec2(gridSize()) - 0.5) : p;
  vec4 open = vec4(1.0);
#if ENV
  open = scentOpenAt(q);
#endif
  return scentFrom(scentBilinear(q, open), p - q);
}

// The line where the food steers an agent across its sensors as hard as a strand holds it (see scentSensorLine in
// render.wgsl).
float scentSensorLine(vec2 p, Scent s, int k) {
  vec2 g = vec2(s.gx.x, s.gy.x);
  float slope = length(g);
  if (!(slope > 0.0)) return 0.0;
  vec2 n = g / slope;
  float best = 0.0;
  float change = 0.0;
  for (int j = 0; j < 4; j++) {
    float h = V.scentHalf[j];
    float hold = V.scentHolds[j];
    if (!(h > 0.0) || !(hold > 0.0)) continue;
    float guess = slope * 2.0 * h / hold;
    if (guess < 0.05 || guess > 20.0) continue;
    Scent up = scentSensed(p + h * n, k);
    Scent down = scentSensed(p - h * n, k);
    if (up.w <= 0.0 || down.w <= 0.0) continue;
    float r = (up.v.x - down.v.x) / hold;
    if (r > best) {
      best = r;
      change = dot(vec2(up.gx.x, up.gy.x) - vec2(down.gx.x, down.gy.x), n) / hold;
    }
  }
  return scentLine(best, change * n);
}

// The view of the scent s at p over colour c: the glow of the food scent, its line, then the glow of the repellent,
// only in the extended model (see scentView in render.wgsl).
vec3 scentView(vec2 p, Scent s, vec3 c, int k) {
  bool paperStyle = V.style == 2u;
  float fill = paperStyle ? SCENT_PAPER_FILL : 1.0;
  float repellent = V.scentFx.y > 0.5 ? scentGlow(s.v.y) : 0.0;
  vec3 o = mix(c, paperStyle ? vec3(0.0207, 0.2429, 0.033) : vec3(0.1383, 0.7091, 0.1623), scentGlow(s.v.x) * fill);
  o = mix(o, paperStyle ? vec3(0.0063, 0.1096, 0.0124) : vec3(0.3553, 0.9273, 0.3684),
          scentSensorLine(p, s, k));
  return mix(o, paperStyle ? vec3(0.4023, 0.024, 0.2555) : vec3(0.9216, 0.1742, 0.6301), repellent * fill);
}
#endif

vec3 scene(vec2 p, vec2 s) {
#if ENV
  bool near = false;
  vec4 cells[9];
  if (V.frame.z != 0u) {
    // The cells the spline reads decide whether anything is painted near p (see scene in render.wgsl).
    shapeCells(ivec2(floor(p)), cells);
    for (int k = 0; k < 9; k++) near = near || cells[k] != vec4(0.0);
  }
  vec4 raw = near && V.scale <= 1.0 && wallBeside(p, cells) ? trailBesideWalls(p, cells) : trailFiltered(p);
#else
  vec4 raw = trailFiltered(p);
#endif
  vec4 v = levels(raw);
  vec4 halo = texture(bloom, p / s);
  vec3 base = V.background.rgb;
  Flake f = Flake(vec3(0.0), vec3(0.0), 0.0, 0.0);
#if ENV
  Env e;
  if (near) {
    e = envAt(p, cells);
    f = flakeAt(p, e);
    base = substrate(f);
    if (V.frame.w != 0u) v += presence(e, cells, raw);
  }
#endif
  vec3 c;
  if (V.style == 1u) c = gel(p, v, base, f);
  else if (V.style == 2u) c = paper(v, base);
  else if (V.style == 3u) c = glow(agentsAt(p), vec4(0.0), base);
  else c = glow(v, halo, base);
#if ENV
  if (near) {
    c += e.light * (V.style == 2u ? vec3(-0.04, -0.03, -0.12) : vec3(0.22, 0.2, 0.12));
  }
#endif
#ifdef SCENT
  // The view lies below the flake of food and the walls (see scene in render.wgsl).
  Scent sc;
  int level = int(V.scentFx.x);
  if (level > 0) {
    sc = scentCoarse(p, level);
  } else {
    vec2 q = V.boundary == 1u ? clamp(p, vec2(0.5), vec2(gridSize()) - 0.5) : p;
    vec4 open = vec4(1.0);
#if ENV
    if (near) open = openCells(q, cells);
#endif
    sc = scentFrom(scentBilinear(q, open), p - q);
  }
  c = mix(scentView(p, sc, c, level), c, f.cover);
#endif
#if ENV
  if (near) {
    c = walls(c, e);
  }
#endif
  return c;
}

void main() {
  // GL has its origin bottom-left; the view maps a top-left pixel grid (as in WebGPU).
  vec2 frag = vec2(gl_FragCoord.x, V.canvas.y - gl_FragCoord.y);
  vec2 p = (frag - 0.5 * V.canvas) * V.scale + V.center;
  vec2 s = vec2(gridSize());
  // How much of the pixel lies in the arena: a ramp one pixel wide across the box edge and the dish rim.
  float inside = 1.0;
  if (V.boundary == 1u) inside = cover(min(min(p.x, p.y), min(s.x - p.x, s.y - p.y)));
  else if (V.boundary == 2u) inside = cover(0.5 * min(s.x, s.y) - 1.0 - distance(p, 0.5 * s));
  vec3 space = V.background.rgb * (V.style == 2u ? 0.92 : 0.55);
  vec3 c = space;
  // One call: a GPU that runs both sides of a branch (SwiftShader in CI) would draw the scene twice.
  if (inside > 0.0) {
    vec3 inner = scene(p, s);
    c = inside >= 1.0 ? inner : mix(c, inner, inside);
  }
  // A periodic lattice (ADR 0026): its copies show dimmed in the free space beside it (see render.wgsl).
  if (V.fx.z < 1.0) {
    float edge = cover(min(min(p.x, p.y), min(s.x - p.x, s.y - p.y)));
    c = mix(mix(space, c, V.fx.z), c, edge);
  }
  uvec2 px = uvec2(gl_FragCoord.xy);
  float n = hash(px) - hash(px + uvec2(7919u, 104729u));
  result = vec4(srgb(clamp(c, vec3(0.0), vec3(1.0))) + n / 255.0, 1.0);
}
