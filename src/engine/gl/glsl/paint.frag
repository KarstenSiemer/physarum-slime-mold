// Brush stroke on the environment texture (R wall, G food, B light). Blending and color masks in
// gl/sim.ts decide how values combine. Mirrors ../../shaders/paint.wgsl.

uniform vec2 from;
uniform vec2 to;
uniform float radius;
uniform int kind; // 0 erase, 1 wall, 2 food, 3 light

out vec4 result;

float segmentDistance(vec2 p) {
  vec2 ab = to - from;
  float t = clamp(dot(p - from, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return distance(p, from + t * ab);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  float d = segmentDistance(p);
  if (P.cfg.z == 0u) {
    vec2 size = vec2(W(), H());
    for (int oy = -1; oy <= 1; oy++) {
      for (int ox = -1; ox <= 1; ox++) d = min(d, segmentDistance(p + vec2(ox, oy) * size));
    }
  }
  if (d > radius || cellAt(ivec2(floor(p))) < 0) discard;
  if (kind == 1) result = vec4(1.0, 0.0, 0.0, 0.0);
  else if (kind == 2) result = vec4(0.0, 1.0, 0.0, 0.0);
  else if (kind == 3) result = vec4(0.0, 0.0, smoothstep(radius, 0.3 * radius, d), 0.0);
  else result = vec4(0.0);
}
