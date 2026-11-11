// Deposit + 3 × 3 mean diffusion + decay. Mirrors ../../shaders/diffuse.wgsl (no tiling: one
// fragment reads its 3 × 3 neighbourhood).

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

// Trail and scent of a cell including this step's sources; `open` is 0 for walls and outside.
void load(ivec2 c, out vec4 t, out vec2 s, out float open) {
  t = vec4(0.0);
  s = vec2(0.0);
  open = 0.0;
  int i = cellAt(c);
  if (i < 0) return;
  ivec2 q = cellCoord(i);
  vec4 e = texelFetch(env, q, 0);
  if (isWall(e)) return;
  t = texelFetch(trailIn, q, 0);
  s = texelFetch(scentIn, q, 0).xy;
  if (first) {
    t += texelFetch(counts, q, 0) * P.deposit;
#if COVERED
    float food = e.g > 0.0 && covered(q) ? P.model.y : 1.0;
    s += vec2(e.g * P.scent.x * food, e.b * P.scent.y);
#else
    s += vec2(e.g * P.scent.x, e.b * P.scent.y);
#endif
    // Cut tool: only in the extended model the wound also loses its chemicals (diffuse.wgsl).
    if (P.tool.w == 2.0 && P.tool2.z == 0.0 && distance(vec2(q) + 0.5, P.tool.xy) < P.tool.z) {
      t = vec4(0.0);
      s = vec2(0.0);
    }
  }
  open = 1.0;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 t;
  vec2 s;
  float open;
  load(p, t, s, open);
  if (blur && open > 0.0) {
    vec4 sum = vec4(0.0);
    vec2 ssum = vec2(0.0);
    float n = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec4 tt;
        vec2 ss;
        float o;
        load(p + ivec2(dx, dy), tt, ss, o);
        sum += tt;
        ssum += ss;
        n += o;
      }
    }
    t = sum / n;
    s = ssum / n;
  }
  if (last) {
    t *= P.keep;
    s *= P.scent.z;
  }
  outTrail = t;
  outScent = vec4(s, 0.0, 0.0);
}
