// The territory of each strain (ADR 0068); mirrors ../../shaders/territory.wgsl. gl/programs.ts compiles the file
// once per PASS. The territory is one byte per cell in a target of unsigned integers (R8UI), with bit s set while the
// cell lies in the territory of strain s, in two copies: a pass reads one and writes the other. The owners are one
// byte per cell in the same form: bit s while an alive agent of strain s holds the cell.
//
// PASS 0, the push, into the next copy of the territory, last in a step. A cell joins the territory of strain s when
// it holds an agent of s. An open cell outside the territory of s joins it with the chance 1 − (1 − v)^n, n the agents
// of s among its 8 neighbours, with a draw of its own for each cell and strain. A diagonal neighbour counts only if the
// two cells beside the corner between them are not both walls (ADR 0069). The territory never shrinks.
//
// PASS 1, a disc, into the next copy of the territory: the open cells whose centres lie within the disc join the
// territory of a strain (the start territory, ADR 0067, decision 4).
//
// PASS 2, the fragment of the owners (owners.vert): one point per alive agent, the bit of its strain.
//
// A cell is open when it lies in the arena and is no wall.

#if PASS == 0 || PASS == 1
uniform highp usampler2D territory; // the copy that the pass reads
uniform sampler2D env;
#endif
#if PASS == 0
uniform highp usampler2D owners; // the strains of the agent of each cell, as bits (PASS 2)
// The uniform block of the flow (flow.frag; flow.ts packFlow()): the constants of stage 4 come after the sites
// (territory.ts packTerritory(); ADR 0067, decision 9).
layout(std140) uniform Flow {
  vec4 a;
  vec4 b;
  vec4 c;
  vec4 d;
  vec4 e;
  vec4 f;
  vec4 g;
  vec4 sites[64];
  vec4 push[2]; // the chance that n agents push a cell in, for n = 1 to 8 (territory.ts PUSH_CHANCES)
} U;

// The random stream of the push of strain s: PUSH + 65536 · s (territory.ts PUSH, territory.wgsl).
const uint PUSH = 11u;

// The owners of the cell at q (cellXY()) as bits, 0 outside a closed arena.
uint ownersOf(ivec2 q) { return q.x < 0 ? 0u : texelFetch(owners, q, 0).r; }

// Whether the cell at p is a wall; a cell outside a closed arena is none (wallAt in territory.wgsl).
bool wallAt(ivec2 p) {
  ivec2 q = cellXY(p);
  return q.x >= 0 && isWall(texelFetch(env, q, 0));
}

// The strains that the push adds to the territory of the open cell at q (`pushed` in territory.wgsl): a diagonal
// neighbour between two walls does not count.
uint pushed(ivec2 q, uint held) {
  uvec4 n = uvec4(0u);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      if (dx != 0 && dy != 0 && wallAt(q + ivec2(dx, 0)) && wallAt(q + ivec2(0, dy))) continue;
      uint b = ownersOf(cellXY(q + ivec2(dx, dy)));
      n += uvec4(b & 1u, (b >> 1u) & 1u, (b >> 2u) & 1u, (b >> 3u) & 1u);
    }
  }
  uint joined = 0u;
  uint c = uint(q.y * W() + q.x);
  for (uint s = 0u; s < 4u; s++) {
    if ((held & (1u << s)) != 0u || n[s] == 0u) continue;
    uint rng = rngSeed(c, PUSH + 0x10000u * s);
    uint k = n[s] - 1u;
    if (rand(rng) < U.push[k >> 2u][k & 3u]) joined |= 1u << s;
  }
  return joined;
}
#endif
#if PASS == 1
uniform vec4 disc; // the centre x, y, the radius, and the strain
#endif
#if PASS == 2
flat in uint owner;
#endif

out uint result;

void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
#if PASS == 2
  result = owner;
#else
  uint bits = texelFetch(territory, q, 0).r;
  // A cell outside the dish keeps its byte: 0.
  if (cellXY(q).x >= 0) {
#if PASS == 0
    bits |= ownersOf(q);
    if (!isWall(texelFetch(env, q, 0))) bits |= pushed(q, bits);
#else
    if (!isWall(texelFetch(env, q, 0)) && toolDistance(vec2(q) + 0.5, disc.xy) <= disc.z) bits |= 1u << uint(disc.w);
#endif
  }
  result = bits;
#endif
}
