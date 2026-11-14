// The fragment passes of growth and shrinkage (ADR 0025), after growth.glsl. Mirrors ../../shaders/growth.wgsl.
// programs.ts compiles one program per PASS, so that each binds only its own samplers:
// 0 row sums of the occupancy over both windows, 1 window counts, 2 the tests of the agents (shrinkage deletes,
// a parent marks GROWS and its neighbour), 3 one level of a pyramid of sums, 4 the births.

out vec4 result;

#if PASS == 0 || PASS == 1
// The occupancy after the moves (PASS 0) or the row sums (PASS 1). A cell of the grid's rectangle, wrapped on the
// periodic grid: cells outside the dish lie in it and hold no agent (gridCell in growth.wgsl).
uniform sampler2D sums;

vec2 sumAt(ivec2 c, out bool inside) {
  ivec2 size = ivec2(W(), H());
  ivec2 q = c;
  inside = true;
  if (P.cfg.z == 0u) {
    q = wrapCell(c, size);
  } else if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, size))) {
    inside = false;
    return vec2(0.0);
  }
  return texelFetch(sums, q, 0).rg;
}

void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int rg = int(P.growth.y / 2u);
  int rs = int(P.shrinkage.y / 2u);
  int r = max(rg, rs);
  vec2 sum = vec2(0.0);
  for (int d = -r; d <= r; d++) {
#if PASS == 0
    bool inside;
    float v = sumAt(q + ivec2(d, 0), inside).r;
    if (abs(d) <= rg) sum.x += v;
    if (abs(d) <= rs) sum.y += v;
#else
    bool inside;
    vec2 v = sumAt(q + ivec2(0, d), inside);
    if (abs(d) <= rg) sum.x += v.x;
    if (abs(d) <= rs) sum.y += v.y;
#endif
  }
  result = vec4(sum, 0.0, 0.0);
}
#endif

#if PASS == 2
uniform sampler2D agentsIn;
uniform sampler2D windows;
uniform sampler2D occ; // agents per cell after this step's moves
uniform sampler2D env;
uniform int agentWidth;

// Flow in the tubes (ADR 0029; `//#if FLOW` in ../../shaders/growth.wgsl): programs.ts compiles this pass with it, and
// gl/sim.ts uses that program only while the flow is on. An agent on a cell that the flux of its strain passed by
// does not divide. Every strain has a flow of its own (ADR 0031): the memory of strain A, and of strains B, C and D (the
// memory of strain A in the place of a strain that the scene does not have).
#ifndef FLOW
#define FLOW 0
#endif
#if FLOW
uniform sampler2D flowMemory; // x flow memory (flow.frag), of the step before
uniform sampler2D flowMemory1;
uniform sampler2D flowMemory2;
uniform sampler2D flowMemory3;
layout(std140) uniform Flow {
  vec4 a;
  vec4 b;
  vec4 c;
  vec4 d;
  vec4 e; // y: half², the square of the flow memory below which an agent does not divide
} F;

// The memory of the flow of strain s at cell q (flowMemoryOf in tools.glsl).
vec4 flowMemoryOf(uint s, ivec2 q) {
  if (s == 1u) return texelFetch(flowMemory1, q, 0);
  if (s == 2u) return texelFetch(flowMemory2, q, 0);
  if (s == 3u) return texelFetch(flowMemory3, q, 0);
  return texelFetch(flowMemory, q, 0);
}
#endif

// The neighbour that a living agent in cell c divides into, or −1 (divideInto in growth.wgsl): a habitable cell
// that is empty after the moves, and a diagonal one only if the two cells beside the corner between it and cell c
// are not both walls (ADR 0025, amendment of 2026-11-13). It moved in this step if the settle pass marked it MOVED.
int target(uint bits, int c, uint i) {
  float n = texelFetch(windows, cellCoord(c), 0).r;
  bool moved = (bits & MOVED) != 0u;
  if (!growthTest() || !moved || n < float(P.growth.z) || n > float(P.growth.w)) return -1;
  ivec2 q = cellCoord(c);
#if FLOW
  float memory = flowMemoryOf(bits & 3u, q).x;
  if (memory * memory < F.e.y) return -1;
#endif
  // Bit k of `open`: neighbour k is habitable and empty. Bit k of `walls`: neighbour k is a wall.
  uint open = 0u;
  uint walls = 0u;
  for (uint k = 0u; k < 8u; k++) {
    int m = cellAt(q + around(k));
    if (m < 0) continue;
    if (isWall(texelFetch(env, cellCoord(m), 0))) {
      walls |= 1u << k;
    } else if (texelFetch(occ, cellCoord(m), 0).r < 0.5) {
      open |= 1u << k;
    }
  }
  uint free = 0u;
  for (uint k = 0u; k < 8u; k++) {
    ivec2 o = around(k);
    if (o.x != 0 && o.y != 0) {
      uint beside = (1u << aroundIndex(ivec2(o.x, 0))) | (1u << aroundIndex(ivec2(0, o.y)));
      if ((walls & beside) == beside) open &= ~(1u << k);
    }
    free += (open >> k) & 1u;
  }
  if (free == 0u) return -1;
  uint rng = rngSeed(i, GROW);
  uint pick = min(uint(rand(rng) * float(free)), free - 1u);
  for (uint k = 0u; k < 8u; k++) {
    if ((open & (1u << k)) != 0u) {
      if (pick == 0u) return int(k);
      pick--;
    }
  }
  return -1;
}

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  uint i = uint(t.y * agentWidth + t.x);
  vec4 a = texelFetch(agentsIn, t, 0);
  uint bits = bitsOf(a);
  int c = cellOf(a.xy);
  result = a;
  if (i >= P.grid.z || (bits & ALIVE) == 0u || c < 0) return;
  if (shrinkTest()) {
    float n = texelFetch(windows, cellCoord(c), 0).g;
    if (n < float(P.shrinkage.z) || n > float(P.shrinkage.w)) {
      result.w = float(bits & 3u);
      return;
    }
  }
  int k = target(bits, c, i);
  if (k >= 0) result.w = float(bits | GROWS | (uint(k) << DIR_SHIFT));
}
#endif

#if PASS == 3
// One level of a pyramid of sums with a fan-in of 4 (buildCells and buildDead in growth.wgsl), into the rows of its
// level in one of two textures. `below` is the level under it, in the other texture, or for the first level the
// births (kind 0: one lane per strain) or the agents (kind 1: 1 for a dead agent).
uniform sampler2D below;
uniform int kind;
uniform int first;
uniform int row;
uniform int width;
uniform int size;
uniform int belowRow;
uniform int belowWidth;
uniform int belowSize;

vec4 node(int e) {
  vec4 v = texelFetch(below, ivec2(e % belowWidth, belowRow + e / belowWidth), 0);
  if (first == 0) return v;
  if (kind == 1) return vec4((bitsOf(v) & ALIVE) == 0u ? 1.0 : 0.0, 0.0, 0.0, 0.0);
  return vec4(equal(vec4(v.r), vec4(1.0, 2.0, 3.0, 4.0)));
}

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  int j = (t.y - row) * width + t.x;
  vec4 sum = vec4(0.0);
  if (j < size) {
    for (int e = 4 * j; e < min(4 * j + 4, belowSize); e++) sum += node(e);
  }
  result = sum;
}
#endif

#if PASS == 4
// The births (birth in growth.wgsl): the dead agent with rank r among the dead agents of its strain takes the birth
// with rank r of that strain. The pyramids keep level k in texture k mod 2, from row cellRow[k] and deadRow[k].
uniform sampler2D agentsIn;
uniform sampler2D births;
uniform sampler2D cells0;
uniform sampler2D cells1;
uniform sampler2D dead0;
uniform sampler2D dead1;
uniform int agentWidth;
uniform int cellTop;
uniform int cellRow[13];
uniform int cellSize[13];
uniform int deadTop;
uniform int deadRow[13];

vec4 cellNode(int k, int e) {
  if (k == 0) {
    float s = texelFetch(births, ivec2(e % W(), e / W()), 0).r;
    return vec4(equal(vec4(s), vec4(1.0, 2.0, 3.0, 4.0)));
  }
  ivec2 q = ivec2(e % W(), cellRow[k] + e / W());
  return k % 2 == 1 ? texelFetch(cells1, q, 0) : texelFetch(cells0, q, 0);
}

float deadNode(int k, int e) {
  if (k == 0) {
    vec4 a = texelFetch(agentsIn, ivec2(e % agentWidth, e / agentWidth), 0);
    return (bitsOf(a) & ALIVE) == 0u ? 1.0 : 0.0;
  }
  ivec2 q = ivec2(e % agentWidth, deadRow[k] + e / agentWidth);
  return k % 2 == 1 ? texelFetch(dead1, q, 0).r : texelFetch(dead0, q, 0).r;
}

// The dead agents with an id below x (deadBefore in growth.wgsl).
float deadBefore(int x) {
  if (x >= int(P.grid.z)) return deadNode(deadTop, 0);
  float sum = 0.0;
  int j = x;
  for (int k = 0; k < deadTop; k++) {
    for (int e = j - j % 4; e < j; e++) sum += deadNode(k, e);
    j /= 4;
  }
  return sum;
}

// The position of the birth with rank r of strain s (findBirth in growth.wgsl).
int findBirth(int s, float r0) {
  float r = r0;
  int j = 0;
  for (int k = cellTop; k > 0; k--) {
    int last = min(4 * j + 4, cellSize[k - 1]) - 1;
    int e = 4 * j;
    for (; e < last; e++) {
      float v = cellNode(k - 1, e)[s];
      if (r < v) break;
      r -= v;
    }
    j = e;
  }
  return j;
}

vec2 inCell(ivec2 c, vec2 f) {
  vec2 lo = vec2(c);
  vec2 hi = uintBitsToFloat(floatBitsToUint(lo + 1.0) - 1u);
  return clamp(lo + f, lo, hi);
}

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  uint i = uint(t.y * agentWidth + t.x);
  vec4 a = texelFetch(agentsIn, t, 0);
  uint bits = bitsOf(a);
  uint s = bits & 3u;
  // The markers of this step go: only the strain and the alive bit stay.
  result = vec4(a.xyz, float(bits & (3u | ALIVE)));
  if (i >= P.grid.z || (bits & ALIVE) != 0u || !growthTest()) return;
  uint first = s > 0u ? P.strainEnd[s - 1u] : 0u;
  float r = deadBefore(int(i)) - deadBefore(int(first));
  if (r >= cellNode(cellTop, 0)[s]) return;
  int p = findBirth(int(s), r);
  int c = int(texelFetch(births, ivec2(p % W(), p / W()), 0).g);
  // A child: a random position in its cell and a random heading, drawn one after another as in growth.wgsl.
  uint rng = rngSeed(i, BIRTH);
  float fx = rand(rng);
  float fy = rand(rng);
  float heading = rand(rng) * TAU;
  result = vec4(inCell(cellCoord(c), vec2(fx, fy)), heading, float(s | ALIVE));
}
#endif
