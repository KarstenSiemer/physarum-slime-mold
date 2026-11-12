// The trail on its coarse map (see trailDown in ../../shaders/render.wgsl), one texel per fragment, at the level
// V.fx.w: the mean over the cells that the texel covers, each by the share it covers. Prepended with view.glsl.

void main() {
  ivec2 s = gridSize();
  vec2 span = vec2(s) / vec2(levelSize(int(V.fx.w)));
  vec2 lo = floor(gl_FragCoord.xy) * span;
  vec2 hi = lo + span;
  vec4 sum = vec4(0.0);
  for (int y = int(floor(lo.y)); float(y) < hi.y && y < s.y; y++) {
    float wy = min(hi.y, float(y + 1)) - max(lo.y, float(y));
    for (int x = int(floor(lo.x)); float(x) < hi.x && x < s.x; x++) {
      float w = (min(hi.x, float(x + 1)) - max(lo.x, float(x))) * wy;
      sum += w * texelFetch(trail, ivec2(x, y), 0);
    }
  }
  result = sum / (span.x * span.y);
}
