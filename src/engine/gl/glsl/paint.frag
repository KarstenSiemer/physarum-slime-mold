// Brush stroke on the environment texture (R wall, G food, B light). Blending and color masks in
// gl/sim.ts decide how values combine. Mirrors ../../shaders/paint.wgsl. Prepended with common.glsl
// and brush.glsl.

uniform int kind; // 0 erase, 1 wall, 2 food, 3 light

out vec4 result;

// The soft edge of light: smoothstep(r, 0.3 r, d) written out, because smoothstep with its first edge above its second
// is undefined in GLSL ES 3.00. The same steps as lightEdge() in paint.wgsl and lightByte() in brush.ts.
float lightEdge(float d, float r) {
  float t = clamp((d - r) / (0.3 * r - r), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  float d = strokeDistance(p, radius);
  if (d > radius || cellAt(ivec2(floor(p))) < 0) discard;
  if (kind == 1) result = vec4(1.0, 0.0, 0.0, 0.0);
  else if (kind == 2) result = vec4(0.0, 1.0, 0.0, 0.0);
  else if (kind == 3) result = vec4(0.0, 0.0, lightEdge(d, radius), 0.0);
  else result = vec4(0.0);
}
