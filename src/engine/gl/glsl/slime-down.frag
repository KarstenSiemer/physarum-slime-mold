// The film of the slime on its coarse map (see slimeDown in ../../shaders/render.wgsl; ADR 0057), one texel per
// fragment, at the level V.fx.w: the mean of the map of the film over the cells that the texel covers, each by the
// share it covers, as trail-down.frag has it for the trail. Prepended with view.glsl.

uniform sampler2D film; // the film of the slime, one texel per cell (slime-film.frag)

void main() {
  ivec2 s = gridSize();
  vec2 span = vec2(s) / vec2(levelSize(int(V.fx.w)));
  vec2 lo = floor(gl_FragCoord.xy) * span;
  vec2 hi = lo + span;
  float sum = 0.0;
  for (int y = int(floor(lo.y)); float(y) < hi.y && y < s.y; y++) {
    float wy = min(hi.y, float(y + 1)) - max(lo.y, float(y));
    for (int x = int(floor(lo.x)); float(x) < hi.x && x < s.x; x++) {
      float w = (min(hi.x, float(x + 1)) - max(lo.x, float(x))) * wy;
      sum += w * texelFetch(film, ivec2(x, y), 0).r;
    }
  }
  result = vec4(sum / (span.x * span.y), 0.0, 0.0, 1.0);
}
