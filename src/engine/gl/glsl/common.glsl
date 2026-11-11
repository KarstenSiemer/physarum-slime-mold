// Shared by the WebGL2 simulation shaders; mirrors ../../shaders/common.wgsl.
precision highp float;
precision highp int;
precision highp sampler2D;

// std140 gives the same layout as `struct Params` in common.wgsl, so pack.ts fills both.
layout(std140) uniform Params {
  uvec4 grid;          // W, H, agent count, step
  uvec4 cfg;           // seed, strain count, boundary (0 wrap, 1 box, 2 dish), collisions
  vec4 sensorAngle;
  vec4 sensorOffset;
  vec4 rotationAngle;
  vec4 stepSize;
  vec4 deposit;
  vec4 keep;
  vec4 randomTurn;
  vec4 food;
  vec4 light;
  vec4 attraction[4];
  vec4 scent;          // food source, light source, scent keep, shrink probability
  vec4 tool;           // x, y, radius, kind (0 none, 1 inoculate, 2 cut)
  vec4 tool2;          // strain, chance per step to place a dead agent (inoculate), 1 if a cut keeps the chemicals, unused
  uvec4 strainEnd;
  uvec4 extra;         // layout, walls (1 if the environment may hold walls), start claim round
  vec4 model;          // K (0 off), covered food factor (1 off), 1 if walls diffuse (Jones) (ADR 0022, 0027)
} P;

const float PI = 3.14159265358979;
const float TAU = 6.28318530717959;
const float BLOCKED = -1e30;
// Agent bits (stored as an exact float in texel .w): strain 0–1, alive 2; GL-only markers below.
const uint ALIVE = 4u;
const uint MOVED = 8u;  // deposited this step (read by the point pass)
const uint WANTS = 16u; // claimed a cell this step (collision mode); at init: waits for a start cell
const uint PLACE = 32u; // with WANTS: claimed the cell of a tool's spot (tools.glsl placement)

int W() { return int(P.grid.x); }
int H() { return int(P.grid.y); }

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

uint rngSeed(uint index, uint salt) {
  return pcg(index ^ pcg(P.grid.w ^ pcg(P.cfg.x ^ salt)));
}

float rand(inout uint s) {
  s = pcg(s);
  return float(s >> 8u) * (1.0 / 16777216.0);
}

vec2 dir(float a) {
  float w = a - TAU * floor((a + PI) / TAU);
  return vec2(cos(w), sin(w));
}

// v wrapped into [0, n), in integers. A float floor(v / n) is not exact on every GPU (GLSL ES allows 2.5 ULP for a
// division): on an Apple M3 Pro, floor(vec2(c) / vec2(size)) was 0 at c = size for 291 of the sides 16 to 4096, such
// as 33, 47 and 246. Then cell W wrapped to the first cell of the next row, and row H to no cell of the grid (ADR
// 0023). GLSL ES leaves % undefined for a negative operand, so both operands stay non-negative. view.glsl has the same
// function.
int wrapAxis(int v, int n) { return v >= 0 ? v % n : n - 1 - (-1 - v) % n; }

// A cell coordinate wrapped into a periodic grid of n cells (wrapCell in common.wgsl).
ivec2 wrapCell(ivec2 c, ivec2 n) { return ivec2(wrapAxis(c.x, n.x), wrapAxis(c.y, n.y)); }

// A position wrapped into the periodic grid, in the cell of its floor (wrapPos in common.wgsl). That cell is the one
// that cellOf(p) gives on the periodic grid, and for every p inside a closed arena.
vec2 wrapPos(vec2 p) {
  ivec2 c = ivec2(floor(p));
  ivec2 lo = wrapCell(c, ivec2(W(), H()));
  return min(p - vec2(c - lo), uintBitsToFloat(floatBitsToUint(vec2(lo) + 1.0) - 1u));
}

// The dish of Jones' closed arenas, 0.945 of the grid's short side (DISH_FILL in common.wgsl, ADR 0027).
const float DISH_FILL = 0.945;
float dishRadius() { return DISH_FILL * 0.5 * float(min(W(), H())); }

// The distance from p to the centre q of an agent tool: to the nearest copy of q on the periodic grid (toolDistance in
// common.wgsl, ADR 0026).
float toolDistance(vec2 p, vec2 q) {
  vec2 d = p - q;
  if (P.cfg.z == 0u) {
    vec2 s = vec2(W(), H());
    d -= s * round(d / s);
  }
  return length(d);
}

// Index of a cell, wrapped for the periodic boundary, or −1 outside a closed arena (cellAt in common.wgsl).
int cellAt(ivec2 c) {
  ivec2 size = ivec2(W(), H());
  ivec2 q = c;
  if (P.cfg.z == 0u) {
    q = wrapCell(c, size);
  } else {
    if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, size))) return -1;
    if (P.cfg.z == 2u && distance(vec2(c) + 0.5, 0.5 * vec2(size)) > dishRadius()) return -1;
  }
  return q.y * size.x + q.x;
}

int cellOf(vec2 p) { return cellAt(ivec2(floor(p))); }

ivec2 cellCoord(int i) { return ivec2(i % W(), i / W()); }

uint bitsOf(vec4 a) { return uint(a.w + 0.5); }

// A cell is a wall when its wall byte is at least 128 (0.5), as isWall in common.wgsl. `e` is a texel of the
// RGBA8 environment, so its red channel is the wall byte / 255.
bool isWall(vec4 e) { return e.r * 255.0 >= 127.5; }

// Cells per side of a clearance tile (walls.frag, ADR 0020), as CLEAR_TILE in common.wgsl.
const int CLEAR_TILE = 8;

vec2 destination(vec4 a) { return a.xy + P.stepSize[int(bitsOf(a) & 3u)] * dir(a.z); }

// Unique per step (a bijection on [0, 2^24)), so claims never tie; +1 keeps 0 as "no claim".
float claimKey(uint i) {
  uint k = (i * 0x9E3779B1u + pcg(P.grid.w ^ P.cfg.x)) & 0xFFFFFFu;
  k ^= k >> 12u;
  k = (k * 0x2C1B3C6Du) & 0xFFFFFFu;
  return float(k + 1u);
}

// The same for a claim round of the start placement (init.frag, points.vert kind 5): P.extra.z is the round.
float startKey(uint i) {
  uint k = (i * 0x9E3779B1u + pcg(P.extra.z ^ 0x51ED270Bu ^ P.cfg.x)) & 0xFFFFFFu;
  k ^= k >> 12u;
  k = (k * 0x2C1B3C6Du) & 0xFFFFFFu;
  return float(k + 1u);
}
