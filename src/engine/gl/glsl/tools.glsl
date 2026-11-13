// The agent tools, after common.glsl, for the agent pass (agents.frag) and the claim points (points.vert kind 1),
// which both need the cell of a tool's spot. Mirrors openCell and placement in ../../shaders/agents.wgsl.

uniform sampler2D env;
uniform sampler2D occ; // agents per cell at the start of the step (collision mode); kind 5: cells taken so far

// Separate random streams, so a tool or shrinkage never shifts the steering draws.
const uint STEER = 0u;
const uint TOOL = 1u;
const uint SHRINK = 2u;
const uint BLOCK = 3u;

bool habitable(int c) { return c >= 0 && !isWall(texelFetch(env, cellCoord(c), 0)); }

// The same for a cell as cellXY() gives it, without the division of cellCoord().
bool habitable(ivec2 q) { return q.x >= 0 && !isWall(texelFetch(env, q, 0)); }

bool vacant(int c) { return texelFetch(occ, cellCoord(c), 0).r < 0.5; }

// A cell a tool may put an agent in: habitable, and with the rule empty at the start of the step (ADR 0008). Only
// the rule reads `occ`.
bool openCell(int c) { return habitable(c) && (P.cfg.w == 0u || vacant(c)); }

vec2 randomIn(vec2 center, float radius, inout uint rng) {
  float r = radius * sqrt(rand(rng));
  return center + r * dir(rand(rng) * TAU);
}

// Where a tool puts an agent in this step (ADR 0023): a position, its heading and its cell, or cell −1 for none.
struct Spot {
  vec2 pos;
  float heading;
  int cell;
};

// Flow in the tubes (ADR 0029; `//#if FLOW` in ../../shaders/agents.wgsl): programs.ts compiles the agent pass and the
// claim points with it, and gl/sim.ts uses them only while the flow is on. Without it the source is the one of the
// code before.
#ifndef FLOW
#define FLOW 0
#endif
#if FLOW
// Every strain has a flow of its own (ADR 0031): the memory of the flow of strain A, and of strains B, C and D. A scene
// with fewer strains binds the memory of strain A in their place, and no agent reads it there.
uniform sampler2D flowMemory; // x flow memory, y tube body (flow.frag)
uniform sampler2D flowMemory1;
uniform sampler2D flowMemory2;
uniform sampler2D flowMemory3;
layout(std140) uniform Flow {
  vec4 a;
  vec4 b;
  vec4 c; // z: the tube body below which a cell holds no tube
  vec4 d;
  vec4 e; // death, half², birth, birth from
} F;
const uint STARVE = 9u; // streams 4 to 6: growth.glsl; 7 and every 7 + k * 65536: the start (init.frag)
const uint RESPAWN = 8u;

// The memory of the flow of strain s at cell q (a layer of `flowMemory` in agents.wgsl).
vec4 flowMemoryOf(uint s, ivec2 q) {
  if (s == 1u) return texelFetch(flowMemory1, q, 0);
  if (s == 2u) return texelFetch(flowMemory2, q, 0);
  if (s == 3u) return texelFetch(flowMemory3, q, 0);
  return texelFetch(flowMemory, q, 0);
}

// Where the flow brings a dead agent to life, or cell −1 (respawn in agents.wgsl): the agent draws one random point of
// the grid. If its cell is open and holds a tube of the agent's strain, the agent comes to life there with the chance
// birth · (D − from) / (1 − from), D the flow memory of the cell for that strain.
Spot respawn(vec4 a, uint i) {
  Spot none = Spot(a.xy, a.z, -1);
  if ((bitsOf(a) & ALIVE) != 0u) return none;
  uint rng = rngSeed(i, RESPAWN);
  float rx = rand(rng);
  float ry = rand(rng);
  vec2 p = vec2(rx * float(W()), ry * float(H()));
  ivec2 q = cellXY(ivec2(floor(p)));
  int c = indexOf(q);
  if (!openCell(c)) return none;
  vec4 m = flowMemoryOf(bitsOf(a) & 3u, q);
  if (m.y < F.c.z || rand(rng) >= F.e.z * (m.x - F.e.w) / (1.0 - F.e.w)) return none;
  return Spot(wrapPos(p), rand(rng) * TAU, c);
}
#endif

// Inoculate takes a dead agent of the tool's strain to a random point of the brush, never a living one; cut takes a
// living agent in the wound to the first of 8 random points outside it whose cell is open. A pure function of the
// agent after shrinkage, so the claim pass, the claim points and the settle pass find the same spot.
Spot placement(vec4 a, uint i) {
#if FLOW
  if (P.tool.w == 0.0) return respawn(a, i);
#else
  if (P.tool.w == 0.0) return Spot(a.xy, a.z, -1); // no tool held: the usual step
#endif
  uint rng = rngSeed(i, TOOL);
  uint bits = bitsOf(a);
  bool alive = (bits & ALIVE) != 0u;
  if (P.tool.w == 1.0 && !alive && float(bits & 3u) == P.tool2.x && rand(rng) < P.tool2.y) {
    vec2 p = randomIn(P.tool.xy, P.tool.z, rng);
    int c = cellOf(p);
    if (openCell(c)) return Spot(wrapPos(p), rand(rng) * TAU, c);
  } else if (P.tool.w == 2.0 && alive && toolDistance(a.xy, P.tool.xy) < P.tool.z) {
    for (int k = 0; k < 8; k++) {
      vec2 p = vec2(rand(rng) * float(W()), rand(rng) * float(H()));
      int c = cellOf(p);
      if (openCell(c) && toolDistance(p, P.tool.xy) >= P.tool.z) return Spot(wrapPos(p), a.z, c);
    }
  }
#if FLOW
  return respawn(a, i);
#else
  return Spot(a.xy, a.z, -1);
#endif
}
