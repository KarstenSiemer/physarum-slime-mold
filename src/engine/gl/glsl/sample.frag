// Auto levels without compute: one summed-trail sample per fragment of a small target; the CPU
// builds the histogram from these samples (gl/backend.ts).
precision highp float;
precision highp sampler2D;

uniform sampler2D trail;
uniform sampler2D occ; // the agents per cell while `held` is 1; any texture else
uniform int held;      // 1 with one agent per cell (ADR 0062)
uniform vec2 outSize;

out vec4 result;

// The first value is the summed trail of the cell of the sample. The second one is 1 if the cell holds an agent,
// while `held` is 1: the black level stays below the plasm (exposure.ts levels()).
void main() {
  ivec2 size = textureSize(trail, 0);
  ivec2 c = min(ivec2(gl_FragCoord.xy / outSize * vec2(size)), size - 1);
  vec4 v = texelFetch(trail, c, 0);
  float agent = held == 1 && texelFetch(occ, c, 0).r > 0.5 ? 1.0 : 0.0;
  result = vec4(v.x + v.y + v.z + v.w, agent, 0.0, 1.0);
}
