// The counts of the births that the flux pays (ADR 0071), after growth.glsl, with points.frag: two points per agent slot
// into a target of 2 × 1 texels with additive blending, a lane per strain. Point 2i holds agent i if it is an agent of
// the front of the step (FRONT, growth.frag PASS 2) and goes to texel 0: F. Point 2i + 1 holds it if it is a paid parent
// (PAID, PASS 5) and goes to texel 1: K. The sums are whole numbers, which no order of the additions changes.

uniform sampler2D agents;
uniform int agentWidth;

flat out vec4 value;

void main() {
  int i = gl_VertexID / 2;
  int part = gl_VertexID % 2;
  vec4 a = texelFetch(agents, ivec2(i % agentWidth, i / agentWidth), 0);
  uint bits = bitsOf(a);
  gl_PointSize = 1.0;
  value = vec4(0.0);
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // outside the clip volume: dropped
  uint mark = part == 0 ? FRONT : PAID;
  if (uint(i) >= P.grid.z || (bits & ALIVE) == 0u || (bits & mark) == 0u) return;
  value[int(bits & 3u)] = 1.0;
  gl_Position = vec4(part == 0 ? -0.5 : 0.5, 0.0, 0.0, 1.0);
}
