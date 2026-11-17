// Brush stroke on the slime field (ADR 0055, decision 7). Mirrors ../../shaders/slime-paint.wgsl. Prepended with
// common.glsl and brush.glsl: the footprint of a stroke here is the one of paint.frag, the cells inside the arena of
// the stroke whose centre lies within its radius. gl/programs.ts compiles the file once per PASS, with amount.glsl
// before it for the second and the third.
//
// PASS 0, into the target of the stamps (R32UI). A stroke of the Slime tool gives each open cell of its footprint the
// stamp of the current step, `P.grid.w + 1u`: the stamp that the next step writes on a cell with plasm (slime.frag).
// A cell is open when it lies inside the arena of the simulation and holds no wall. An erase and a wall clear the
// stamp of every cell of their footprint: no wall ever holds a stamp. A discarded fragment keeps what its cell holds.
// The pass runs for these three kinds only (gl/sim.ts brushSlime()), after the strokes changed the environment.
//
// PASS 1, into the target of the amounts (R16UI), before PASS 0 of the same segment (ADR 0057). A stroke of the Slime
// tool leaves slime that rises from the edge of the stroke to the full amount over RIM cells, and a cell keeps what
// is left of its amount where that is more: `old` holds the amounts of the cells of the segment as they were, and
// `stamps` their stamps. An erase and a wall clear the amount.
//
// PASS 2, into the target of the front field (R32UI, ADR 0059), before PASS 0 of the same segment. No front reached
// painted slime: a stroke of the Slime tool clears the front stamp of each open cell of its footprint that had no
// slime (`stamps`: the stamps before the segment). Every other fragment is discarded.

uniform sampler2D env;
uniform int kind;  // 0 erase, 1 wall, 6 slime (EnvKind in types.ts)
uniform int arena; // the boundary of the simulation, as P.cfg.z names the boundary of the stroke
#if PASS >= 1
uniform highp usampler2D stamps; // the stamps before the segment
#endif
#if PASS == 1
uniform highp usampler2D old;    // the amounts before the segment
#endif

out uint result;

// Whether cell q of the grid lies inside the arena of the simulation. `P` holds the boundary of the stroke, which can
// be another one (Stroke.boundary in types.ts). Only a dish is smaller than the grid: the rule of cellXY() in
// common.glsl.
bool inArena(ivec2 q) {
  ivec2 size = ivec2(W(), H());
  return arena != 2 || distance(vec2(q) + 0.5, 0.5 * vec2(size)) <= dishRadius();
}

#if PASS == 1
const float RIM = 4.0; // cells from the edge of a stroke to its full amount (slime.ts SLIME_RIM)

// The amount that a stroke of the Slime tool gives a cell whose centre lies d cells from the middle line of the
// stroke (paintedAmount in slime-paint.wgsl).
uint paintedAmount(float d) {
  float t = clamp((radius - d + 0.5) / RIM, 0.0, 1.0);
  return uint(t * t * t * (t * (t * 6.0 - 15.0) + 10.0) * float(FULL) + 0.5);
}
#endif

#if PASS != 2
// What a cell of the footprint of a stroke of the Slime tool gets, d cells from the middle line of the stroke.
uint painted(ivec2 q, float d) {
#if PASS == 0
  return P.grid.w + 1u;
#else
  return max(amountLeft(texelFetch(old, q, 0).r, texelFetch(stamps, q, 0).r), paintedAmount(d));
#endif
}
#endif

void main() {
  vec2 p = gl_FragCoord.xy;
  ivec2 q = ivec2(floor(p));
  float d = strokeDistance(p, radius);
  if (d > radius || cellAt(q) < 0) discard;
#if PASS == 2
  bool open = kind == 6 && inArena(q) && !isWall(texelFetch(env, q, 0));
  if (!open || hasSlime(texelFetch(stamps, q, 0).r)) discard;
  result = 0u;
#else
  if (kind == 0) result = 0u;
  else if (kind == 1) result = 0u;
  else if (kind == 6 && inArena(q) && !isWall(texelFetch(env, q, 0))) result = painted(q, d);
  else discard;
#endif
}
