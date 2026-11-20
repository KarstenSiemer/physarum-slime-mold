// The sinks of each strain (ADR 0069); mirrors ../../shaders/sinks.wgsl. gl/programs.ts compiles the file once per
// PASS. gl/sim.ts runs the passes only while the rules of stage 4 run, for each strain after the update of its flow
// and before its pressure, with the uniform block of the flow of that strain.
//
// PASS 0, the sinks, into the next copy of the sink rates of the strain (R32F, one rate per cell): `sinks` in
// sinks.wgsl. A sink keeps its rate with a minus sign, so the pyramid counts the sinks without a target of its own.
//
// PASS 1, the first level of the pyramid of the sums of the strain (RGBA32UI): per texel the sums of a square of 4 × 4
// cells, from the sink rates and the memory of the flow. The lanes: R low, R high, C, N (sums in sinks.wgsl).
//
// PASS 2, a level above it: per texel the sums of a square of 4 × 4 texels of the level below. An addition that wraps
// the low word of R adds 1 to the high one, so every level holds the same integers in every order.
//
// PASS 3, the state of the strain (`state` in sinks.wgsl), into the next copy of the state (RGBA32F, 2 texels per
// strain, texel (k, strain)), from the top of the pyramid, the ports, and the counts of the paid births of the step
// (paid.vert, ADR 0071): the budget B in y of texel 1, then F and K of the step.

// The uniform block of the flow (flow.frag; flow.ts packFlow()): the constants of stage 4 come after the sites
// (territory.ts packTerritory(); ADR 0067, decision 9).
layout(std140) uniform Flow {
  vec4 a;
  vec4 b;
  vec4 c;
  vec4 d;
  vec4 e;
  vec4 f; // z: the strain of the pass
  vec4 g;
  vec4 sites[64];
  vec4 push[2];
  // the steps of a path to ground without slime, of a path to the edge, of the mean, and the weight on slime in steps
  // of 2^-24 (sinks.ts packSinks())
  vec4 sinks;
  // x: what the sinks take in units of the flow strength (ADR 0070); y: the growth of the budget in a step (paid.ts
  // packPaid())
  vec4 take;
} U;

// The weight 1 in steps of the rate (sinks.ts RATE_ONE).
const uint RATE_ONE = 16777216u;

#if PASS == 0
uniform sampler2D env;
uniform highp usampler2D owners; // bit s for strain s (territory.frag)
uniform highp usampler2D territory; // the copy of the step (territory.frag)
uniform highp usampler2D stamps; // the slime field after the stamps of the step (slime.frag)
uniform sampler2D memory; // the memory of the flow of the strain after its update
uniform sampler2D ratesIn; // the sink rates of the strain before the step
uniform sampler2D ports; // texel (site, strain): x the port of this step, −1 for none (flow.frag)

// The paths: rows of bits over the square of 13 × 13 cells around the cell of the fragment (`openRows` in
// sinks.wgsl).
const int MID = 6;
const int SIDE = 13;
uint openRows[13];
uint wallRows[13];
uint reached[13];

// Whether the cell at q (cellXY()) lies in the territory of strain s.
bool inTerritory(ivec2 q, uint s) { return (texelFetch(territory, q, 0).r & (1u << s)) != 0u; }

// Whether the cell at q (cellXY()) has slime for a reader after the stamps of this step (slimeAfter in sinks.wgsl).
bool slimeAfter(ivec2 q) {
  uint held = texelFetch(stamps, q, 0).r;
  return held != 0u && P.grid.w + 2u - held < P.slime.x;
}

// Adds the cells of the square around q whose distance from it lies above `inner` and at most `outer` (load in
// sinks.wgsl).
void load(ivec2 q, int inner, int outer) {
  for (int dy = -outer; dy <= outer; dy++) {
    for (int dx = -outer; dx <= outer; dx++) {
      if (max(abs(dx), abs(dy)) <= inner) continue;
      ivec2 p = cellXY(q + ivec2(dx, dy));
      if (p.x < 0) continue;
      uint bit = 1u << uint(dx + MID);
      if (isWall(texelFetch(env, p, 0))) {
        wallRows[dy + MID] |= bit;
      } else {
        openRows[dy + MID] |= bit;
      }
    }
  }
}

// One step more of every path (spread in sinks.wgsl).
void spread() {
  uint next[13];
  for (int r = 0; r < SIDE; r++) {
    uint here = reached[r];
    uint n = here | (here << 1u) | (here >> 1u);
    if (r > 0) {
      uint a = reached[r - 1];
      uint w = wallRows[r - 1];
      n |= a | ((a << 1u) & ~(w & (wallRows[r] << 1u))) | ((a >> 1u) & ~(w & (wallRows[r] >> 1u)));
    }
    if (r < SIDE - 1) {
      uint a = reached[r + 1];
      uint w = wallRows[r + 1];
      n |= a | ((a << 1u) & ~(w & (wallRows[r] << 1u))) | ((a >> 1u) & ~(w & (wallRows[r] >> 1u)));
    }
    next[r] = n & openRows[r];
  }
  for (int r = 0; r < SIDE; r++) reached[r] = next[r];
}

// The cell of row r and bit b of the square around q.
ivec2 cellOfBit(ivec2 q, int r, int b) { return cellXY(q + ivec2(b - MID, r - MID)); }

// The tube of a sink (tubeRows in sinks.wgsl, ADR 0072): rows of bits of the tube cells of the strain, of its ports of
// this step, and of the tube cells that a path from the cell reaches.
uint tubeRows[13];
uint portRows[13];
uint tubeReached[13];

// The offset d along an axis of `size` cells, on the periodic grid to the nearest copy (offsetOf in sinks.wgsl).
int offsetOf(int d, int size) {
  if (P.cfg.z != 0u) return d;
  int m = ((d % size) + size) % size;
  return 2 * m >= size ? m - size : m;
}

// Whether the tube of the cell at q carries flux to it, for the strain s (tubeOut in sinks.wgsl).
bool tubeOut(ivec2 q, uint s) {
  for (int r = 0; r < SIDE; r++) {
    tubeRows[r] = 0u;
    portRows[r] = 0u;
    tubeReached[r] = 0u;
  }
  for (int dy = -MID; dy <= MID; dy++) {
    for (int dx = -MID; dx <= MID; dx++) {
      ivec2 p = cellXY(q + ivec2(dx, dy));
      if (p.x < 0) continue;
      if (texelFetch(memory, p, 0).z > 0.0) tubeRows[dy + MID] |= 1u << uint(dx + MID);
    }
  }
  int n = int(U.d.w);
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    int c = int(texelFetch(ports, ivec2(i, int(s)), 0).x);
    if (c < 0) continue;
    ivec2 d = ivec2(offsetOf(c % W() - q.x, W()), offsetOf(c / W() - q.y, H()));
    if (abs(d.x) <= MID && abs(d.y) <= MID) portRows[d.y + MID] |= 1u << uint(d.x + MID);
  }
  tubeReached[MID] = 1u << uint(MID);
  uint edgeBits = 1u | (1u << uint(SIDE - 1));
  for (int k = 0; k < SIDE * SIDE; k++) {
    uint next[13];
    bool grew = false;
    for (int r = 0; r < SIDE; r++) {
      uint here = tubeReached[r];
      if ((here & portRows[r]) != 0u) return true;
      if (here != 0u && (r == 0 || r == SIDE - 1 || (here & edgeBits) != 0u)) return true;
      uint m = here | (here << 1u) | (here >> 1u);
      if (r > 0) m |= tubeReached[r - 1];
      if (r < SIDE - 1) m |= tubeReached[r + 1];
      next[r] = m & tubeRows[r];
      if (next[r] != here) grew = true;
    }
    if (!grew) return false;
    for (int r = 0; r < SIDE; r++) tubeReached[r] = next[r];
  }
  return false;
}

// The weight of the open cell at q for the strain s in steps of the rate, 0 if it is no sink (sinkWeight in
// sinks.wgsl). The caller knows that the cell holds a tube of s.
uint sinkWeight(ivec2 q, uint s) {
  uint mine = 1u << s;
  if ((texelFetch(owners, q, 0).r & mine) == 0u) return 0u;
  for (int r = 0; r < SIDE; r++) {
    openRows[r] = 0u;
    wallRows[r] = 0u;
    reached[r] = 0u;
  }
  // Room: a free cell of the territory of s that one step reaches.
  load(q, -1, 1);
  reached[MID] = 1u << uint(MID);
  spread();
  bool room = false;
  for (int r = MID - 1; r <= MID + 1; r++) {
    for (int b = MID - 1; b <= MID + 1; b++) {
      if ((reached[r] & (1u << uint(b))) == 0u) continue;
      ivec2 p = cellOfBit(q, r, b);
      if (texelFetch(owners, p, 0).r == 0u && inTerritory(p, s)) room = true;
    }
  }
  if (!room) return 0u;
  // The edge: open ground outside the territory of s that a path of at most `edge` steps reaches.
  int edge = int(U.sinks.y);
  load(q, 1, edge);
  for (int k = 1; k < edge; k++) spread();
  bool atEdge = false;
  for (int r = MID - edge; r <= MID + edge; r++) {
    for (int b = MID - edge; b <= MID + edge; b++) {
      if ((reached[r] & (1u << uint(b))) != 0u && !inTerritory(cellOfBit(q, r, b), s)) atEdge = true;
    }
  }
  if (!atEdge) return 0u;
  // A tube that carries flux to it (ADR 0072).
  if (!tubeOut(q, s)) return 0u;
  // Ground without slime that a path of at most `fresh` steps reaches.
  int fresh = int(U.sinks.x);
  load(q, edge, fresh);
  for (int k = edge; k < fresh; k++) spread();
  for (int r = MID - fresh; r <= MID + fresh; r++) {
    for (int b = MID - fresh; b <= MID + fresh; b++) {
      if ((reached[r] & (1u << uint(b))) != 0u && !slimeAfter(cellOfBit(q, r, b))) return RATE_ONE;
    }
  }
  return uint(U.sinks.w);
}

// One step of the mean of a sink rate toward the weight `goal` (toward in sinks.wgsl).
uint toward(uint old, uint goal, uint tau) {
  if (goal > old) return old + (goal - old + tau - 1u) / tau;
  if (old > goal) return old - (old - goal + tau - 1u) / tau;
  return old;
}

out float result;
#endif

#if PASS == 1
uniform sampler2D rates; // the sink rates of the strain after PASS 0
uniform sampler2D memory; // the memory of the flow of the strain after its update
out uvec4 result;
#endif

#if PASS == 2
uniform highp usampler2D below; // the level below
uniform ivec2 belowSize;
out uvec4 result;
#endif

#if PASS == 3
uniform highp usampler2D sums; // the top of the pyramid of the strain: one texel
uniform sampler2D ports; // texel (site, strain): x the port of this step, −1 for none (flow.frag)
uniform sampler2D stateIn; // the state before the step
// The counts of the paid births of a growth step (paid.vert): texel 0 F, texel 1 K, lane s for strain s.
uniform sampler2D paidCounts;
out vec4 result;
#endif

void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
#if PASS == 0
  uint s = uint(U.f.z);
  // Only an open cell holds a tube: the update writes no conductivity elsewhere (flow.frag).
  uint weight = texelFetch(memory, q, 0).z > 0.0 ? sinkWeight(q, s) : 0u;
  uint next = toward(uint(abs(texelFetch(ratesIn, q, 0).r) * float(RATE_ONE)), weight, uint(U.sinks.z));
  result = (weight > 0u ? -1.0 : 1.0) * float(next) * (1.0 / float(RATE_ONE));
#elif PASS == 1
  uvec4 sum = uvec4(0u);
  for (int dy = 0; dy < 4; dy++) {
    for (int dx = 0; dx < 4; dx++) {
      ivec2 p = q * 4 + ivec2(dx, dy);
      if (p.x >= W() || p.y >= H()) continue;
      float r = texelFetch(rates, p, 0).r;
      // At most 16 cells of 65,536 each: no sum of this level wraps.
      if (texelFetch(memory, p, 0).z > 0.0) {
        sum.x += (uint(abs(r) * float(RATE_ONE)) + 128u) >> 8u;
        sum.z += 1u;
      }
      if (r < 0.0) sum.w += 1u;
    }
  }
  result = sum;
#elif PASS == 2
  uvec4 sum = uvec4(0u);
  for (int dy = 0; dy < 4; dy++) {
    for (int dx = 0; dx < 4; dx++) {
      ivec2 p = q * 4 + ivec2(dx, dy);
      if (p.x >= belowSize.x || p.y >= belowSize.y) continue;
      uvec4 v = texelFetch(below, p, 0);
      uint low = sum.x + v.x;
      sum.y += v.y + (low < v.x ? 1u : 0u);
      sum.x = low;
      sum.z += v.z;
      sum.w += v.w;
    }
  }
  result = sum;
#else
  uint s = uint(U.f.z);
  uvec4 v = texelFetch(sums, ivec2(0), 0);
  uint covered = 0u;
  for (int i = 0; i < 64; i++) {
    if (texelFetch(ports, ivec2(i, int(s)), 0).x >= 0.0) covered++;
  }
  if (q.x == 0) {
    // R in the unit of the rate, as `state` in sinks.wgsl computes it.
    float r = (float(v.y) * 65536.0 + float(v.x >> 16u)) + float(v.x & 0xffffu) * (1.0 / 65536.0);
    result = vec4(r, float(v.z), float(v.w), float(covered));
  } else {
    bool takes = v.w > 0u && (v.x | v.y) != 0u && (covered > 0u || v.z > 0u);
    // The budget of the paid births (ADR 0071), as `state` in sinks.wgsl computes it. The counts hold those of the last
    // growth step: a step without the growth test counts no agent.
    bool grew = P.growth.x > 0u && P.grid.w % P.growth.x == 0u;
    float front = grew ? texelFetch(paidCounts, ivec2(0, 0), 0)[int(s)] : 0.0;
    float claims = grew ? texelFetch(paidCounts, ivec2(1, 0), 0)[int(s)] : 0.0;
    float budget = texelFetch(stateIn, q, 0).y;
    if (grew && budget >= 1.0) budget = min(budget - claims, front);
    if (takes) budget += U.take.y;
    result = vec4(takes ? 1.0 : 0.0, budget, front, claims);
  }
#endif
}
