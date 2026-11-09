// Bloom in trail space. Mirrors ../../shaders/bloom.wgsl; mode 0 prefilter, 1 down, 2 up.
precision highp float;
precision highp sampler2D;

uniform sampler2D src;   // previous level (down, up)
uniform sampler2D trail; // prefilter source
uniform vec2 texel;      // 1 / source size
uniform vec2 outSize;    // target size
uniform float gain;
uniform float black;
uniform int mode;

out vec4 result;

const float THRESHOLD = 0.5;

void main() {
  vec2 uv = gl_FragCoord.xy / outSize;
  if (mode == 0) {
    ivec2 base = ivec2(floor(gl_FragCoord.xy)) * 2;
    ivec2 size = textureSize(trail, 0) - 1;
    vec4 sum = vec4(0.0);
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 2; x++) sum += texelFetch(trail, min(base + ivec2(x, y), size), 0);
    }
    vec4 avg = 0.25 * sum;
    float t = avg.x + avg.y + avg.z + avg.w;
    vec4 v = avg * (max(t - black, 0.0) / max(t, 1e-20)) * gain;
    vec4 bright = max(v - vec4(THRESHOLD), vec4(0.0));
    result = bright / (1.0 + 0.25 * bright);
  } else if (mode == 1) {
    vec2 o = texel;
    result = (4.0 * texture(src, uv) + texture(src, uv + vec2(-o.x, -o.y)) + texture(src, uv + vec2(o.x, -o.y)) +
              texture(src, uv + vec2(-o.x, o.y)) + texture(src, uv + vec2(o.x, o.y))) / 8.0;
  } else {
    vec2 o = texel;
    vec4 s = texture(src, uv + vec2(-2.0 * o.x, 0.0)) + texture(src, uv + vec2(2.0 * o.x, 0.0)) +
             texture(src, uv + vec2(0.0, -2.0 * o.y)) + texture(src, uv + vec2(0.0, 2.0 * o.y));
    s += 2.0 * (texture(src, uv + vec2(-o.x, -o.y)) + texture(src, uv + vec2(o.x, -o.y)) +
                texture(src, uv + vec2(-o.x, o.y)) + texture(src, uv + vec2(o.x, o.y)));
    result = s / 12.0;
  }
}
