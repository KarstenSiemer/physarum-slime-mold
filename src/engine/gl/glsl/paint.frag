// Brush stroke on the environment texture (R wall, G food, B light). Blending and color masks in
// gl/sim.ts decide how values combine. Mirrors ../../shaders/paint.wgsl. Prepended with common.glsl
// and brush.glsl.

uniform int kind; // 0 erase, 1 wall, 2 food, 3 light

out vec4 result;

void main() {
  vec2 p = gl_FragCoord.xy;
  float d = strokeDistance(p, radius);
  if (d > radius || cellAt(ivec2(floor(p))) < 0) discard;
  if (kind == 1) result = vec4(1.0, 0.0, 0.0, 0.0);
  else if (kind == 2) result = vec4(0.0, 1.0, 0.0, 0.0);
  else if (kind == 3) result = vec4(0.0, 0.0, smoothstep(radius, 0.3 * radius, d), 0.0);
  else result = vec4(0.0);
}
