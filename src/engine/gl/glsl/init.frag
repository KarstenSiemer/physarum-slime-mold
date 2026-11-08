// Initial agent placement, one fragment per agent texel. Mirrors ../../shaders/init.wgsl.

uniform sampler2D env;
uniform int agentWidth;

out vec4 result;

const uint MIXED = 0u;
const uint BANDS = 1u;
const uint SECTORS = 2u;
const uint COLONIES = 3u;
const uint RING = 4u;
const uint CENTER = 5u;
const uint EMPTY = 6u;

// Bijection on [0, 2^k): odd multiply-add and xorshift are both invertible modulo 2^k.
uint scramble(uint x0, uint k) {
  uint mask = (1u << k) - 1u;
  uint x = x0;
  for (uint r = 0u; r < 3u; r++) {
    x = (x * 0x2c1b3c6du + pcg(P.cfg.x + r)) & mask;
    x ^= x >> ((k + 1u) / 2u);
  }
  return x;
}

uint uniqueCell(uint i, uint n) {
  uint k = 1u;
  while ((1u << k) < n) k++;
  uint x = scramble(i, k);
  for (int guard = 0; guard < 64 && x >= n; guard++) x = scramble(x, k);
  return x % n;
}

vec2 anywhere(inout uint rng) { return vec2(rand(rng) * float(W()), rand(rng) * float(H())); }

vec2 disc(vec2 c, float r, inout uint rng) {
  float d = r * sqrt(rand(rng));
  return c + d * dir(rand(rng) * TAU);
}

bool habitable(int c) { return c >= 0 && texelFetch(env, cellCoord(c), 0).r < 0.5; }

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  uint i = uint(t.y * agentWidth + t.x);
  if (i >= P.grid.z) {
    result = vec4(0.0);
    return;
  }
  uint s = 0u;
  while (s < 3u && i >= P.strainEnd[s]) s++;
  float n = float(P.cfg.y);
  float fs = float(s);
  uint rng = rngSeed(i, 7u);
  vec2 size = vec2(W(), H());
  vec2 center = 0.5 * size;
  float m = min(size.x, size.y);
  float heading = rand(rng) * TAU;
  vec2 p = vec2(0.0);
  uint layout_ = P.extra.x;
  if (layout_ == BANDS) {
    p = vec2((fs + rand(rng)) / n * size.x, rand(rng) * size.y);
  } else if (layout_ == SECTORS) {
    float r = 0.45 * m * sqrt(rand(rng));
    p = center + r * dir((fs + rand(rng)) / n * TAU);
  } else if (layout_ == COLONIES) {
    vec2 c = P.cfg.y == 1u ? center : center + 0.28 * m * dir(fs / n * TAU - 0.5 * PI);
    p = disc(c, 0.1 * m, rng);
  } else if (layout_ == RING) {
    float a = rand(rng) * TAU;
    p = center + (0.3 * m + 2.0 * (rand(rng) - 0.5)) * dir(a);
    heading = a;
  } else if (layout_ == CENTER) {
    p = disc(center, 0.08 * m, rng);
  } else if (P.cfg.w != 0u && P.grid.z <= P.grid.x * P.grid.y) {
    uint c = uniqueCell(i, P.grid.x * P.grid.y);
    p = vec2(cellCoord(int(c))) + vec2(rand(rng), rand(rng));
  } else {
    p = anywhere(rng);
  }
  int c = cellOf(p);
  for (int k = 0; k < 8 && !habitable(c); k++) {
    p = anywhere(rng);
    c = cellOf(p);
  }
  bool alive = habitable(c) && layout_ != EMPTY;
  result = vec4(wrapPos(p), heading, float(s | (alive ? ALIVE : 0u)));
}
