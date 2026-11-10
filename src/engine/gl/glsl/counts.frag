// Exact deposit counts without float blending (gl/sim.ts deposit()): each strain's panel holds the
// carries (red, one per 256 agents) and the remainder (green) of its cells.

uniform sampler2D panels;

out vec4 result;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 size = ivec2(W(), H());
  vec4 n = vec4(0.0);
  for (int s = 0; s < 4; s++) {
    vec2 v = texelFetch(panels, c + ivec2(s & 1, s >> 1) * size, 0).rg;
    n[s] = 256.0 * v.r + v.g;
  }
  result = n;
}
