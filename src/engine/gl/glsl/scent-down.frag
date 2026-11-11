// The scent on the coarse map of the scent view (see scentDown in ../../shaders/render.wgsl), one texel per
// fragment, at the level V.scentFx.x. Prepended with view.glsl.

uniform sampler2D scent; // food scent (r) and light repellent (g)

ivec2 scentLevelSize(int k) { return (gridSize() + ((1 << k) - 1)) >> k; }

// 1 where a cell holds scent (in the arena, not a wall), else 0.
float scentOpen(ivec2 c) {
  ivec2 s = gridSize();
  if (texelFetch(shape, c, 0).r >= 0.5) return 0.0;
  if (V.boundary == 2u && distance(vec2(c) + 0.5, 0.5 * vec2(s)) > 0.5 * float(min(s.x, s.y)) - 1.0) return 0.0;
  return 1.0;
}

void main() {
  ivec2 s = gridSize();
  vec2 span = vec2(s) / vec2(scentLevelSize(int(V.scentFx.x)));
  vec2 lo = floor(gl_FragCoord.xy) * span;
  vec2 hi = lo + span;
  vec3 sum = vec3(0.0);
  for (int y = int(floor(lo.y)); float(y) < hi.y && y < s.y; y++) {
    float wy = min(hi.y, float(y + 1)) - max(lo.y, float(y));
    for (int x = int(floor(lo.x)); float(x) < hi.x && x < s.x; x++) {
      ivec2 c = ivec2(x, y);
      float w = (min(hi.x, float(x + 1)) - max(lo.x, float(x))) * wy * scentOpen(c);
      sum += w * vec3(texelFetch(scent, c, 0).xy, 1.0);
    }
  }
  result = vec4(sum / (span.x * span.y), 0.0);
}
