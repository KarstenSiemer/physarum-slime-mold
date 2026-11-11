// 3 × 3 mean diffusion + decay, then this step's deposits and sources, in Jones' order (ADR 0027). Mirrors
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
  if (first && wound(q)) {
    t = vec4(0.0);
    s = vec2(0.0);
  }
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
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec4 tt;
        vec2 ss;
        int k;
        load(p + ivec2(dx, dy), tt, ss, k);
        sum += tt;
        ssum += ss;
      }
    }
    t = sum / 9.0;
    s = ssum / 9.0;
  }
  if (last) {
    t *= P.keep;
    s *= P.scent.z;
    // This step's deposits and sources, after the moves, for the sensors of the next step (diffuse.wgsl).
    if (kind == OPEN && !wound(p)) {
      vec4 e = texelFetch(env, p, 0);
      t += texelFetch(counts, p, 0) * P.deposit;
#if COVERED
      float food = e.g > 0.0 && covered(p) ? P.model.y : 1.0;
      s += vec2(e.g * P.scent.x * food, e.b * P.scent.y);
#else
      s += vec2(e.g * P.scent.x, e.b * P.scent.y);
#endif
    }
  }
  if (kind == SINK) {
    t = vec4(0.0);
    s = vec2(0.0);
  }
  outTrail = t;
  outScent = vec4(s, 0.0, 0.0);
}
