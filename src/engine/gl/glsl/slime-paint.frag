// Brush stroke on the slime field (ADR 0055, decision 7), into the target of the stamps (R32UI). Mirrors
// ../../shaders/slime-paint.wgsl. Prepended with common.glsl and brush.glsl: the footprint of a stroke here is the one
// of paint.frag, the cells inside the arena of the stroke whose centre lies within its radius.
//
// A stroke of the Slime tool gives each open cell of its footprint the stamp of the current step, `P.grid.w + 1u`:
// the stamp that the next step writes on a cell with plasm (slime.frag). A cell is open when it lies inside the arena
// of the simulation and holds no wall. An erase and a wall clear the stamp of every cell of their footprint: no wall
// ever holds a stamp. A discarded fragment keeps what its cell holds. The pass runs for these three kinds only
// (gl/sim.ts brushSlime()), after the strokes changed the environment.

uniform sampler2D env;
uniform int kind;  // 0 erase, 1 wall, 6 slime (EnvKind in types.ts)
uniform int arena; // the boundary of the simulation, as P.cfg.z names the boundary of the stroke

out uint result;

// Whether cell q of the grid lies inside the arena of the simulation. `P` holds the boundary of the stroke, which can
// be another one (Stroke.boundary in types.ts). Only a dish is smaller than the grid: the rule of cellXY() in
// common.glsl.
bool inArena(ivec2 q) {
  ivec2 size = ivec2(W(), H());
  return arena != 2 || distance(vec2(q) + 0.5, 0.5 * vec2(size)) <= dishRadius();
}

void main() {
  vec2 p = gl_FragCoord.xy;
  ivec2 q = ivec2(floor(p));
  if (strokeDistance(p, radius) > radius || cellAt(q) < 0) discard;
  if (kind == 0) result = 0u;
  else if (kind == 1) result = 0u;
  else if (kind == 6 && inArena(q) && !isWall(texelFetch(env, q, 0))) result = P.grid.w + 1u;
  else discard;
}
