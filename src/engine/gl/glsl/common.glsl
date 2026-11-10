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
  vec4 tool2;          // strain, revive probability, teleport probability, unused
  uvec4 strainEnd;
  uvec4 extra;         // layout
} P;

const float PI = 3.14159265358979;
const float TAU = 6.28318530717959;
const float BLOCKED = -1e30;
// Agent bits (stored as an exact float in texel .w): strain 0–1, alive 2; GL-only markers below.
const uint ALIVE = 4u;
const uint MOVED = 8u;  // deposited this step (read by the point pass)
const uint WANTS = 16u; // claimed a cell this step (collision mode)

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

vec2 wrapPos(vec2 p) {
  vec2 size = vec2(W(), H());
  return p - size * floor(p / size);
}

float dishRadius() { return 0.5 * float(min(W(), H())) - 1.0; }

// GLSL ES leaves % undefined for negative operands, so wrap with floor.
int cellAt(ivec2 c) {
  ivec2 size = ivec2(W(), H());
  ivec2 q = c;
  if (P.cfg.z == 0u) {
    q = c - size * ivec2(floor(vec2(c) / vec2(size)));
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

vec2 destination(vec4 a) { return a.xy + P.stepSize[int(bitsOf(a) & 3u)] * dir(a.z); }

// Unique per step (a bijection on [0, 2^24)), so claims never tie; +1 keeps 0 as "no claim".
float claimKey(uint i) {
  uint k = (i * 0x9E3779B1u + pcg(P.grid.w ^ P.cfg.x)) & 0xFFFFFFu;
  k ^= k >> 12u;
  k = (k * 0x2C1B3C6Du) & 0xFFFFFFu;
  return float(k + 1u);
}
