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

// Inoculate takes a dead agent of the tool's strain to a random point of the brush, never a living one; cut takes a
// living agent in the wound to the first of 8 random points outside it whose cell is open. A pure function of the
// agent after shrinkage, so the claim pass, the claim points and the settle pass find the same spot.
Spot placement(vec4 a, uint i) {
  if (P.tool.w == 0.0) return Spot(a.xy, a.z, -1); // no tool held: the usual step
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
  return Spot(a.xy, a.z, -1);
}
