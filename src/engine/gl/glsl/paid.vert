// The counts of the births and deaths that the budget settles (ADR 0071, ADR 0100; paid.ts PAID_COUNTS), after
// growth.glsl, with points.frag: `parts` points per agent slot into a target of `lanes` × 1 texels with additive
// blending, a lane per strain. Point k of slot i holds agent i if its bits hold marks[k], and goes to texel texels[k]:
// the agents of the front (FRONT, growth.frag PASS 2) to F, the paid parents (PAID, PASS 5) to K, the respawns that
// wait (WAITS, agents.frag mode 1), and so on. The sums are whole numbers, which no order of the additions changes.

uniform sampler2D agents;
uniform int agentWidth;
uniform int parts;
uniform int lanes;
uniform uint marks[4];
uniform int texels[4];

flat out vec4 value;

void main() {
  int i = gl_VertexID / parts;
  int part = gl_VertexID % parts;
  vec4 a = texelFetch(agents, ivec2(i % agentWidth, i / agentWidth), 0);
  uint bits = bitsOf(a);
  gl_PointSize = 1.0;
  value = vec4(0.0);
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // outside the clip volume: dropped
  if (uint(i) >= P.grid.z || (bits & marks[part]) == 0u) return;
  value[int(bits & 3u)] = 1.0;
  gl_Position = vec4((2.0 * float(texels[part]) + 1.0) / float(lanes) - 1.0, 0.0, 0.0, 1.0);
}
