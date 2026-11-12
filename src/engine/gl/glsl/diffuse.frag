// 3 × 3 mean diffusion + decay, and this step's deposits and sources, in either order of a step (ADR 0027). Mirrors
// ../../shaders/diffuse.wgsl (no tiling: one fragment reads its 3 × 3 neighbourhood).

uniform sampler2D trailIn;
uniform sampler2D scentIn;
uniform sampler2D counts;
uniform sampler2D env;
uniform sampler2D occ; // agents per cell after this step's moves (COVERED)
uniform bool first;
uniform bool last;
uniform bool blur;

layout(location = 0) out vec4 outTrail;
layout(location = 1) out vec4 outScent;

// Covered food (COVERED in diffuse.wgsl, ADR 0022): programs.ts compiles the pass with it, and gl/sim.ts uses that one
// only while the option is on.
#ifndef COVERED
#define COVERED 0
#endif

// The view of a step that moves first (VIEW in diffuse.wgsl, gl/sim.ts viewTarget(), ADR 0027): the step's diffusion
// and decay without its sources and its cut, into targets that the simulation does not read. A program of its own.
#ifndef VIEW
#define VIEW 0
#endif

#if COVERED
// True if the 3 × 3 window around cell q holds an agent; cells outside a closed arena hold none.
bool covered(ivec2 q) {
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      int c = cellAt(q + ivec2(dx, dy));
      if (c >= 0 && texelFetch(occ, cellCoord(c), 0).r > 0.5) return true;
    }
  }
  return false;
}
#endif

// True if a step senses first (senseFirst() in diffuse.wgsl, ADR 0027): the sources enter the first pass before its
// mean; moving first, the last pass adds them after the decay.
bool senseFirst() { return P.model.w > 0.0; }

// This step's deposits and food and light at the habitable cell q (sources() in diffuse.wgsl).
void sources(ivec2 q, inout vec4 t, inout vec2 s) {
  vec4 e = texelFetch(env, q, 0);
  t += texelFetch(counts, q, 0) * P.deposit;
#if COVERED
  float food = e.g > 0.0 && covered(q) ? P.model.y : 1.0;
  s += vec2(e.g * P.scent.x * food, e.b * P.scent.y);
#else
  s += vec2(e.g * P.scent.x, e.b * P.scent.y);
#endif
}

// Cut tool: only in the extended model the wound also loses its chemicals (wound in diffuse.wgsl).
bool wound(ivec2 q) {
  return P.tool.w == 2.0 && P.tool2.z == 0.0 && toolDistance(vec2(q) + 0.5, P.tool.xy) < P.tool.z;
}

// What a cell is (diffuse.wgsl, ADR 0027): outside the arena and in a wall of the extended model a sink that holds no
// trail and scent; in the Jones model (P.model.z = 1) a wall is part of the lattice that diffuses, without sources.
const int SINK = 0;
const int OPEN = 1;
const int WALL = 2;

// Trail and scent of a cell as the agents sensed them, and its kind. The first pass clears the wound of a cut before
// the step's diffusion.
void load(ivec2 c, out vec4 t, out vec2 s, out int kind) {
  t = vec4(0.0);
  s = vec2(0.0);
  kind = SINK;
  int i = cellAt(c);
  if (i < 0) return;
  ivec2 q = cellCoord(i);
  if (isWall(texelFetch(env, q, 0))) {
    if (P.model.z == 0.0) return;
    kind = WALL;
  } else {
    kind = OPEN;
  }
  t = texelFetch(trailIn, q, 0);
  s = texelFetch(scentIn, q, 0).xy;
#if !VIEW
  if (first && senseFirst() && kind == OPEN) sources(q, t, s);
  if (first && wound(q)) {
    t = vec4(0.0);
    s = vec2(0.0);
  }
#endif
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 t;
  vec2 s;
  int kind;
  load(p, t, s, kind);
  if (blur) {
    // Jones' mean filter at every lattice site: a sink counts as 0 (diffuse.wgsl).
    vec4 sum = vec4(0.0);
    vec2 ssum = vec2(0.0);
    float n = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec4 tt;
        vec2 ss;
        int k;
        load(p + ivec2(dx, dy), tt, ss, k);
        sum += tt;
        ssum += ss;
        // 1 for every kind: a count of 9 that the compiler cannot fold (sensing first, below).
        n += k <= WALL ? 1.0 : 0.0;
      }
    }
    // Moving first, the mean and the decay as one factor, as WebGPU computes them; sensing first, the mean over a count
    // read at run time, and the decay in a step of its own below, the arithmetic of the code before (diffuse.wgsl,
    // ADR 0027).
    if (senseFirst()) {
      t = sum / n;
      s = ssum / n;
    } else if (last) {
      t = sum * (P.keep / 9.0);
      s = ssum * (P.scent.z / 9.0);
    } else {
      t = sum / 9.0;
      s = ssum / 9.0;
    }
  } else if (last && !senseFirst()) {
    t *= P.keep;
    s *= P.scent.z;
  }
  if (last && senseFirst()) {
    t *= P.keep;
    s *= P.scent.z;
  }
#if !VIEW
  if (last) {
    // Moving first, this step's deposits and sources, after the moves, for the sensors of the next step (diffuse.wgsl).
    if (!senseFirst() && kind == OPEN && !wound(p)) sources(p, t, s);
  }
#endif
  if (kind == SINK) {
    t = vec4(0.0);
    s = vec2(0.0);
  }
  outTrail = t;
  outScent = vec4(s, 0.0, 0.0);
}
