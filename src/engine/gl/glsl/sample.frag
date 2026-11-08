// Auto levels without compute: one summed-trail sample per fragment of a small target; the CPU
// builds the histogram from these samples (gl/backend.ts).
precision highp float;
precision highp sampler2D;

uniform sampler2D trail;
uniform vec2 outSize;

out vec4 result;

void main() {
  ivec2 size = textureSize(trail, 0);
  ivec2 c = min(ivec2(gl_FragCoord.xy / outSize * vec2(size)), size - 1);
  vec4 v = texelFetch(trail, c, 0);
  result = vec4(v.x + v.y + v.z + v.w, 0.0, 0.0, 1.0);
}
