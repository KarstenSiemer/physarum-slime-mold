// One fragment per agent (texel of the agent texture), after tools.glsl. Mirrors ../../shaders/agents.wgsl.
// mode 0 advance (several agents per cell), 1 claim and 2 settle (one agent per cell, ADR 0008).

uniform sampler2D agentsIn;
uniform sampler2D trail;
uniform sampler2D scent;
uniform sampler2D claims; // highest claim key per cell (collision mode)
uniform sampler2D clearance; // per clearance tile (walls.frag)
uniform int agentWidth;
uniform int mode;

out vec4 result;

// Sensors check the cells between the agent and the sensor for walls: programs.ts compiles the pass with and without
// the check, and gl/sim.ts uses the one with it while the environment may hold walls (SENSE_WALLS in agents.wgsl).
#ifndef SENSE_WALLS
#define SENSE_WALLS 0
#endif
// Saturating trail perception of the extended model (SATURATE in agents.wgsl, ADR 0022): programs.ts compiles the pass
// with it, and gl/sim.ts uses that one only while K = P.model.x is above 0.
#ifndef SATURATE
#define SATURATE 0
#endif

// A wall at w, a cell that a walk enters, wrapped into the periodic grid; never outside a closed arena (wallIn in
// agents.wgsl).
bool wallIn(ivec2 w) {
  ivec2 size = ivec2(W(), H());
  if (any(lessThan(w, ivec2(0))) || any(greaterThanEqual(w, size))) return false;
  if (!isWall(texelFetch(env, w, 0))) return false;
  return P.cfg.z != 2u || distance(vec2(w) + 0.5, 0.5 * vec2(size)) <= dishRadius();
}

// The next cell along an axis of n cells: around the periodic grid, or past the edge of a closed arena.
int stepAxis(int v, int s, int n) {
  int u = v + s;
  if (P.cfg.z != 0u) return u;
  return u < 0 ? u + n : (u >= n ? u - n : u);
}

const float CORNER = 1e-3;
// The most cells a walk enters, as WALK in agents.wgsl: 92 for a sensor 64 cells away, 13 for a move of 8 cells.
const int WALK = 92;

// The clearance of the tile that holds the cell of p (walls.frag); 0 outside a closed arena (clearanceAt in
// agents.wgsl).
int clearanceAt(vec2 p) {
  if (P.extra.y == 0u) return 0;
  int c = cellOf(p);
  if (c < 0) return 0;
  return int(texelFetch(clearance, cellCoord(c) / CLEAR_TILE, 0).r);
}

// False if the segment from p to q passes through a wall, for moves and sensors; below the clearance `clear` of the
// start cell no wall is near enough. Mirrors clearPath in agents.wgsl.
bool clearPath(vec2 p, vec2 q, int clear) {
  if (P.extra.y == 0u) return true;
  ivec2 c = ivec2(floor(p));
  ivec2 end = ivec2(floor(q));
  ivec2 span = abs(end - c);
  if (span.x + span.y < 2 || max(span.x, span.y) < clear) return true;
  vec2 d = q - p;
  ivec2 s = ivec2(sign(d));
  float len = length(d);
  vec2 t = vec2(2.0);
  vec2 dt = vec2(2.0);
  if (s.x != 0) {
    t.x = (float(c.x) + (d.x > 0.0 ? 1.0 : 0.0) - p.x) / d.x;
    dt.x = 1.0 / abs(d.x);
  }
  if (s.y != 0) {
    t.y = (float(c.y) + (d.y > 0.0 ? 1.0 : 0.0) - p.y) / d.y;
    dt.y = 1.0 / abs(d.y);
  }
  // w is c wrapped into the periodic grid, kept step by step (cellAt wraps the same way).
  ivec2 size = ivec2(W(), H());
  ivec2 w = P.cfg.z == 0u ? wrapCell(c, size) : c;
  for (int k = 0; k < WALK; k++) {
    bool needX = c.x != end.x;
    bool needY = c.y != end.y;
    if (!needX && !needY) break;
    if (needX && needY && abs(t.x - t.y) * len < CORNER) {
      int wx = stepAxis(w.x, s.x, size.x);
      int wy = stepAxis(w.y, s.y, size.y);
      if (wallIn(ivec2(wx, w.y)) || wallIn(ivec2(w.x, wy))) return false;
      c += s;
      w = ivec2(wx, wy);
      t += dt;
    } else if (needX && (!needY || t.x < t.y)) {
      c.x += s.x;
      w.x = stepAxis(w.x, s.x, size.x);
      t.x += dt.x;
    } else {
      c.y += s.y;
      w.y = stepAxis(w.y, s.y, size.y);
      t.y += dt.y;
    }
    if (c != end && wallIn(w)) return false;
  }
  return true;
}

// The sensor at p of an agent at pos; a wall between them reads BLOCKED too (sense in agents.wgsl, ADR 0020).
float sense(vec2 pos, vec2 p, int s, int clear) {
  int c = cellOf(p);
#if SENSE_WALLS
  if (!habitable(c) || !clearPath(pos, p, clear)) return BLOCKED;
#else
  if (!habitable(c)) return BLOCKED;
#endif
  ivec2 q = cellCoord(c);
  vec2 sc = texelFetch(scent, q, 0).xy;
#if SATURATE
  vec4 t = texelFetch(trail, q, 0);
  t = t / (1.0 + t / P.model.x);
  return dot(t, P.attraction[s]) + P.food[s] * sc.x - P.light[s] * sc.y;
#else
  return dot(texelFetch(trail, q, 0), P.attraction[s]) + P.food[s] * sc.x - P.light[s] * sc.y;
#endif
}

// Jones 2010, Fig. 3, then the random turn pCD.
float steer(vec4 a, int s, inout uint rng, int clear) {
  float sa = P.sensorAngle[s];
  float so = P.sensorOffset[s];
  float ra = P.rotationAngle[s];
  float f = sense(a.xy, a.xy + so * dir(a.z), s, clear);
  float l = sense(a.xy, a.xy + so * dir(a.z - sa), s, clear);
  float r = sense(a.xy, a.xy + so * dir(a.z + sa), s, clear);
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

// Shrinkage: an agent alive at the start of the step dies with the shrink probability. Returns false if it is dead.
// Clears the markers of the last step.
bool shrinkage(inout vec4 a, uint i) {
  uint s = bitsOf(a) & 3u;
  bool alive = (bitsOf(a) & ALIVE) != 0u;
  if (alive) {
    uint r = rngSeed(i, SHRINK);
    alive = rand(r) >= P.scent.w;
  }
  a.w = float(s | (alive ? ALIVE : 0u));
  return alive;
}

bool canClaim(vec4 a, int c, int clear) {
  return habitable(c) && c != cellOf(a.xy) && vacant(c) && clearPath(a.xy, destination(a), clear);
}

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
    bool alive = shrinkage(a, i);
    Spot spot = placement(a, i);
    if (spot.cell >= 0) {
      // A tool puts the agent here instead of its move: it deposits nothing in this step.
      a = vec4(spot.pos, spot.heading, float(uint(s) | ALIVE));
    } else if (alive) {
      uint rng = rngSeed(i, STEER);
      int clear = clearanceAt(a.xy);
      float h = steer(a, s, rng, clear);
      vec2 p = a.xy + P.stepSize[s] * dir(h);
      if (habitable(cellOf(p)) && clearPath(a.xy, p, clear)) {
        a.xy = wrapPos(p);
        a.z = h;
        a.w += float(MOVED);
      } else {
        uint b = rngSeed(i, BLOCK);
        a.z = rand(b) * TAU;
      }
    }
  } else if (mode == 1) {
    bool alive = shrinkage(a, i);
    if (placement(a, i).cell >= 0) {
      // A tool's spot is claimed like a move (points.vert kind 1); the agent stays as it is until mode 2.
      a.w += float(WANTS | PLACE);
    } else if (alive) {
      uint rng = rngSeed(i, STEER);
      int clear = clearanceAt(a.xy);
      a.z = steer(a, s, rng, clear);
      if (canClaim(a, cellOf(destination(a)), clear)) a.w += float(WANTS);
    }
  } else {
    uint bits = bitsOf(a) & (ALIVE | 3u);
    if ((bitsOf(a) & PLACE) != 0u) {
      // The winner of the spot's cell goes there. A loser stays as it is: dead (inoculate), or where it was (cut).
      Spot spot = placement(vec4(a.xyz, float(bits)), i);
      if (spot.cell >= 0 && texelFetch(claims, cellCoord(spot.cell), 0).r == claimKey(i)) {
        a.xyz = vec3(spot.pos, spot.heading);
        bits |= ALIVE;
      }
    } else if ((bits & ALIVE) != 0u) {
      vec2 p = destination(a);
      int c = cellOf(p);
      // Moving inside the own cell is always allowed; otherwise the claim must have won.
      bool ok = habitable(c) && c == cellOf(a.xy);
      if (!ok && canClaim(a, c, clearanceAt(a.xy))) ok = texelFetch(claims, cellCoord(c), 0).r == claimKey(i);
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
