// One fragment per agent (texel of the agent texture). Mirrors ../../shaders/agents.wgsl.
// mode 0 advance (several agents per cell), 1 claim and 2 settle (one agent per cell, ADR 0008).

uniform sampler2D agentsIn;
uniform sampler2D trail;
uniform sampler2D scent;
uniform sampler2D env;
uniform sampler2D occ;    // occupancy at step start (collision mode)
uniform sampler2D claims; // highest claim key per cell (collision mode)
uniform int agentWidth;
uniform int mode;

out vec4 result;

const uint STEER = 0u;
const uint TOOL = 1u;
const uint SHRINK = 2u;
const uint BLOCK = 3u;

bool habitable(int c) { return c >= 0 && !isWall(texelFetch(env, cellCoord(c), 0)); }

float sense(vec2 p, int s) {
  int c = cellOf(p);
  if (!habitable(c)) return BLOCKED;
  ivec2 q = cellCoord(c);
  vec2 sc = texelFetch(scent, q, 0).xy;
  return dot(texelFetch(trail, q, 0), P.attraction[s]) + P.food[s] * sc.x - P.light[s] * sc.y;
}

// Jones 2010, Fig. 3, then the random turn pCD.
float steer(vec4 a, int s, inout uint rng) {
  float sa = P.sensorAngle[s];
  float so = P.sensorOffset[s];
  float ra = P.rotationAngle[s];
  float f = sense(a.xy + so * dir(a.z), s);
  float l = sense(a.xy + so * dir(a.z - sa), s);
  float r = sense(a.xy + so * dir(a.z + sa), s);
  float h = a.z;
  if (f > l && f > r) {
    // keep heading
  } else if (f < l && f < r) {
    h += rand(rng) < 0.5 ? ra : -ra;
  } else if (l < r) {
    h += ra;
  } else if (r < l) {
    h -= ra;
  }
  if (rand(rng) < P.randomTurn[s]) h = rand(rng) * TAU;
  return h - TAU * floor(h / TAU);
}

vec2 randomIn(vec2 center, float radius, inout uint rng) {
  float r = radius * sqrt(rand(rng));
  return center + r * dir(rand(rng) * TAU);
}

// Tools and shrinkage; returns false if the agent is dead after this step.
bool lifecycle(inout vec4 a, uint i) {
  uint rng = rngSeed(i, TOOL);
  uint s = bitsOf(a) & 3u;
  bool alive = (bitsOf(a) & ALIVE) != 0u;
  if (P.tool.w == 1.0 && float(s) == P.tool2.x) {
    if (rand(rng) < (alive ? P.tool2.z : P.tool2.y)) {
      vec2 p = randomIn(P.tool.xy, P.tool.z, rng);
      if (habitable(cellOf(p))) {
        a.xy = wrapPos(p);
        a.z = rand(rng) * TAU;
        alive = true;
      }
    }
  } else if (P.tool.w == 2.0 && alive && distance(a.xy, P.tool.xy) < P.tool.z) {
    for (int k = 0; k < 8; k++) {
      vec2 p = vec2(rand(rng) * float(W()), rand(rng) * float(H()));
      if (habitable(cellOf(p)) && distance(p, P.tool.xy) >= P.tool.z) {
        a.xy = p;
        break;
      }
    }
  }
  if (alive) {
    uint r = rngSeed(i, SHRINK);
    alive = rand(r) >= P.scent.w;
  }
  a.w = float(s | (alive ? ALIVE : 0u));
  return alive;
}

bool vacant(int c) { return texelFetch(occ, cellCoord(c), 0).r < 0.5; }

bool canClaim(vec4 a, int c) { return habitable(c) && c != cellOf(a.xy) && vacant(c); }

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  uint i = uint(t.y * agentWidth + t.x);
  vec4 a = texelFetch(agentsIn, t, 0);
  if (i >= P.grid.z) {
    result = a;
    return;
  }
  int s = int(bitsOf(a) & 3u);
  if (mode == 0) {
    if (lifecycle(a, i)) {
      uint rng = rngSeed(i, STEER);
      float h = steer(a, s, rng);
      vec2 p = a.xy + P.stepSize[s] * dir(h);
      if (habitable(cellOf(p))) {
        a.xy = wrapPos(p);
        a.z = h;
        a.w += float(MOVED);
      } else {
        uint b = rngSeed(i, BLOCK);
        a.z = rand(b) * TAU;
      }
    }
  } else if (mode == 1) {
    if (lifecycle(a, i)) {
      uint rng = rngSeed(i, STEER);
      a.z = steer(a, s, rng);
      if (canClaim(a, cellOf(destination(a)))) a.w += float(WANTS);
    }
  } else {
    uint bits = bitsOf(a) & (ALIVE | 3u);
    if ((bits & ALIVE) != 0u) {
      vec2 p = destination(a);
      int c = cellOf(p);
      // Moving inside the own cell is always allowed; otherwise the claim must have won.
      bool ok = habitable(c) && c == cellOf(a.xy);
      if (!ok && canClaim(a, c)) ok = texelFetch(claims, cellCoord(c), 0).r == claimKey(i);
      if (ok) {
        a.xy = wrapPos(p);
        bits |= MOVED;
      } else {
        uint b = rngSeed(i, BLOCK);
        a.z = rand(b) * TAU;
      }
    }
    a.w = float(bits);
  }
  result = a;
}
