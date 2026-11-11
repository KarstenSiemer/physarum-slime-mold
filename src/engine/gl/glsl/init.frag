// Initial agent placement, one fragment per agent texel. Mirrors ../../shaders/init.wgsl.
// mode 0: the first draw of every agent; without one agent per cell it draws again until its cell is free.
// mode 1 and 2: the result of a claim round (gl/sim.ts reset()): the winner of a cell takes it, the others draw
// again (mode 1) or, after the last round, start dead (mode 2). Claims come from points.vert kind 5.

uniform sampler2D env;
uniform sampler2D agentsIn; // modes 1 and 2: the agents before this round
uniform sampler2D occ;      // modes 1 and 2: cells taken in earlier rounds
uniform sampler2D claims;   // modes 1 and 2: the highest start key per cell
uniform int agentWidth;
uniform int mode;

out vec4 result;

const uint MIXED = 0u;
const uint BANDS = 1u;
const uint SECTORS = 2u;
const uint COLONIES = 3u;
const uint RING = 4u;
const uint CENTER = 5u;
const uint EMPTY = 6u;

// Draws after the first without the rule, as ROUNDS in init.wgsl.
const uint ROUNDS = 32u;

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

bool habitable(int c) { return c >= 0 && !isWall(texelFetch(env, cellCoord(c), 0)); }

// Draw `round` of agent i's start (strain s): position and heading, as start() in init.wgsl.
vec3 start(uint i, uint s, uint round) {
  uint rng = rngSeed(i, 7u + round * 0x10000u);
  float n = float(P.cfg.y);
  float fs = float(s);
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
  } else if (round == 0u && P.cfg.w != 0u && P.grid.z <= P.grid.x * P.grid.y) {
    uint c = uniqueCell(i, P.grid.x * P.grid.y);
    p = inCell(cellCoord(int(c)), vec2(rand(rng), rand(rng)));
  } else if (round > 0u && P.cfg.z == 2u) {
    p = disc(center, dishRadius(), rng);
  } else {
    p = anywhere(rng);
  }
  return vec3(p, heading);
}

// The position of an agent placed in cell c (an index of cellOf(p)), wrapped and inside c.
vec2 placed(vec2 p, int c) { return inCell(cellCoord(c), p - floor(p)); }

bool freeCell(int c) { return habitable(c) && texelFetch(occ, cellCoord(c), 0).r < 0.5; }

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  uint i = uint(t.y * agentWidth + t.x);
  if (i >= P.grid.z) {
    result = vec4(0.0);
    return;
  }
  if (mode == 0) {
    uint s = 0u;
    while (s < 3u && i >= P.strainEnd[s]) s++;
    vec3 st = start(i, s, 0u);
    int c = cellOf(st.xy);
    uint bits = s;
    if (P.extra.x == EMPTY) {
      // stays dead
    } else if (P.cfg.w != 0u) {
      bits |= WANTS; // waits for the claim rounds
    } else {
      for (uint r = 1u; r <= ROUNDS && !habitable(c); r++) {
        st = start(i, s, r);
        c = cellOf(st.xy);
      }
      if (habitable(c)) bits |= ALIVE;
    }
    result = vec4((bits & ALIVE) != 0u ? placed(st.xy, c) : wrapPos(st.xy), st.z, float(bits));
    return;
  }
  vec4 a = texelFetch(agentsIn, t, 0);
  uint bits = bitsOf(a);
  if ((bits & WANTS) == 0u) {
    result = a;
    return;
  }
  uint s = bits & 3u;
  int c = cellOf(a.xy);
  if (freeCell(c) && texelFetch(claims, cellCoord(c), 0).r == startKey(i)) {
    result = vec4(placed(a.xy, c), a.z, float(s | ALIVE));
  } else if (mode == 1) {
    vec3 st = start(i, s, P.extra.z + 1u);
    result = vec4(wrapPos(st.xy), st.z, float(s | WANTS));
  } else {
    result = vec4(a.xy, a.z, float(s)); // no free cell in any round: starts dead
  }
}
