// The counts of the births and deaths that the budget settles (ADR 0071, ADR 0100; paid.ts PAID_COUNTS), after
// growth.glsl, with points.frag: `parts` points per agent slot into a target of `lanes` × 1 texels with additive
// blending, a lane per strain. Point k of slot i holds agent i if its bits hold marks[k], and goes to texel texels[k]:
// the agents of the front (FRONT, growth.frag PASS 2) to F, the paid parents (PAID, PASS 5) to K, the respawns that
// wait (WAITS, agents.frag mode 1), and so on. The sums are whole numbers, which no order of the additions changes.
//
// With SHARE (ADR 0100, part A), after PASS 2 of growth.frag and before PASS 5: point k of slot i holds agent i if it
// drew a key (`keys`), and adds the steps of the rate of its cell (paid.ts shareSteps()) to texel texels[k]: part 0 the
// steps / 64, part 1 the rest (`marks` unread). So the sum P of the rates of the agents with a key stays a sum of whole
// numbers below 2^24 in each texel.

#ifndef SHARE
#define SHARE 0
#endif

uniform sampler2D agents;
uniform int agentWidth;
uniform int parts;
uniform int lanes;
uniform uint marks[4];
uniform int texels[4];

flat out vec4 value;

#if SHARE
uniform sampler2D keys; // the key of every agent slot of the test (growth.frag PASS 2)
// The sink rates of the step before of strains A to D, as PASS 2 of growth.frag reads them.
uniform sampler2D rates;
uniform sampler2D rates1;
uniform sampler2D rates2;
uniform sampler2D rates3;

float rateOf(uint s, ivec2 q) {
  if (s == 1u) return texelFetch(rates1, q, 0).r;
  if (s == 2u) return texelFetch(rates2, q, 0).r;
  if (s == 3u) return texelFetch(rates3, q, 0).r;
  return texelFetch(rates, q, 0).r;
}
#endif

void main() {
  int i = gl_VertexID / parts;
  int part = gl_VertexID % parts;
  vec4 a = texelFetch(agents, ivec2(i % agentWidth, i / agentWidth), 0);
  uint bits = bitsOf(a);
  gl_PointSize = 1.0;
  value = vec4(0.0);
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // outside the clip volume: dropped
#if SHARE
  ivec2 slot = ivec2(i % agentWidth, i / agentWidth);
  if (uint(i) >= P.grid.z || texelFetch(keys, slot, 0).r == 3.402823466e38) return;
  uint s = bits & 3u;
  // The rate is a whole number of steps of 2^-24 (sinks.frag): the product is exact.
  uint steps = (uint(abs(rateOf(s, cellCoord(cellOf(a.xy)))) * 16777216.0) + 2048u) >> 12u;
  value[int(s)] = float(part == 0 ? steps >> 6u : steps & 63u);
#else
  if (uint(i) >= P.grid.z || (bits & marks[part]) == 0u) return;
  value[int(bits & 3u)] = 1.0;
#endif
  gl_Position = vec4((2.0 * float(texels[part]) + 1.0) / float(lanes) - 1.0, 0.0, 0.0, 1.0);
}
