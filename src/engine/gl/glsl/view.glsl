// Shared by the WebGL2 view passes (render.frag, height.frag): the View block and grid lookups.
// ENV is defined by programs.ts: 1 compiles in the food, light and walls (see render.wgsl).
precision highp float;
precision highp int;
precision highp sampler2D;

// std140 = the layout of `struct View` in render.wgsl, filled by packView() in render.ts.
layout(std140) uniform View {
  vec2 canvas;
  vec2 center;
  float scale;
  float exposure;
  uint style;
  uint boundary;
  vec4 colors[4];
  vec4 background;
  uvec4 frame; // frame counter, strain count, overlays on/off, occupancy on/off (collision mode)
  vec4 fx;     // bloom strength, black level, copies (packView), unused
  vec4 scentFx; // scent view: map level (0 to 3), repellent drawn (1) or not (0), unused, unused
  vec4 scentHalf;  // scent view: half the spread of the sensors of up to 4 strains (0: none), cells
  vec4 scentHolds; // scent view: the hold of a strand of each, as a difference of food scent (scentSensors())
} V;

// The dish's diameter as a share of the grid's short side (DISH_FILL in common.wgsl, ADR 0027).
const float DISH_FILL = 0.945;

uniform sampler2D trail;
uniform sampler2D shape; // outline distances and light (shape.frag)
uniform sampler2D occ;   // agents per cell, kept in collision mode only

out vec4 result;

ivec2 gridSize() { return textureSize(trail, 0); }

// v wrapped into [0, n), in integers, and a cell coordinate wrapped into a periodic grid of n cells: wrapAxis and
// wrapCell in common.glsl. A float floor(v / n) is not exact on every GPU (ADR 0023).
// - Less than one period outside the grid, as every tap of a view that shows the grid about once is: comparisons, then
//   one addition or subtraction of n. That is the cell the remainder gives, and an integer remainder is slow on Apple
//   GPUs (ADR 0028).
// - Farther out, in the copies of a view zoomed out or panned away: the remainder.
int wrapAxis(int v, int n) {
  if (v >= -n && v < 2 * n) return v < 0 ? v + n : (v >= n ? v - n : v);
  return v >= 0 ? v % n : n - 1 - (-1 - v) % n;
}
ivec2 wrapCell(ivec2 c, ivec2 n) { return ivec2(wrapAxis(c.x, n.x), wrapAxis(c.y, n.y)); }

// The cell at c as texel coordinates: wrapped (periodic), or (−1, −1) outside the arena (cellXY in render.wgsl). The
// lookups read their texel here, with no index of the cell and no division to get the coordinates back from it.
ivec2 cellXY(ivec2 c) {
  ivec2 s = gridSize();
  if (V.boundary == 0u) return wrapCell(c, s);
  if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, s))) return ivec2(-1);
  return c;
}

vec4 trailAt(ivec2 c) {
  ivec2 q = cellXY(c);
  return q.x < 0 ? vec4(0.0) : texelFetch(trail, q, 0);
}

const float SHAPE_RANGE = 4.0; // cells; outline distances in `shape` are clamped to ± this (shape.frag)
const float PRESENCE = 0.9;      // tone-curve input of an occupied food cell (render.frag presence())
const float PRESENCE_RAMP = 1.5; // cells inside the food outline over which presence fades in

// A cell of `shape`: wrapped on the periodic grid, else clamped to the arena; outside the dish, the cell inside
// the rim on the way to the centre (see shapeIndex in render.wgsl).
vec4 shapeAt(ivec2 c) {
  ivec2 s = gridSize();
  ivec2 q = clamp(c, ivec2(0), s - 1);
  if (V.boundary == 0u) {
    q = wrapCell(c, s);
  } else if (V.boundary == 2u) {
    vec2 o = 0.5 * vec2(s);
    vec2 m = vec2(c) + 0.5 - o;
    float rim = DISH_FILL * 0.5 * float(min(s.x, s.y));
    if (dot(m, m) > rim * rim) q = ivec2(floor(o + m * ((rim - 0.75) * inversesqrt(dot(m, m)))));
  }
  return texelFetch(shape, q, 0);
}

// How much the agent in cell q (cellXY) shows on food: 0 without an agent or outside the food, rising to 1 over
// the outer PRESENCE_RAMP cells inside the outline (see presenceWeight in render.wgsl).
float presenceWeight(ivec2 q, float food) {
  if (q.x < 0 || texelFetch(occ, q, 0).r < 0.5) return 0.0;
  return smoothstep(0.0, PRESENCE_RAMP, food);
}
