// The map of the growth front (see frontMap in ../../shaders/render.wgsl; ADR 0060), one texel per fragment: texels
// of 2^FRONT_LEVEL cells per side. For each strain, the share of the texel that is young ground of the strain. A cell
// is young ground while it has slime and a front stamp. With the age a of the stamp in steps it counts
// (1 − e^(−a / SKIRT_RISE)) · e^(−a / SKIRT_STEPS). Its strain is the one with the most trail in it. A cell with
// slime and no front stamp is old ground (painted slime). Prepended with view.glsl.

uniform highp usampler2D stamps; // the stamps of the slime field (slime.frag)
uniform highp usampler2D fronts; // the front field (PASS 2 of slime.frag)

void main() {
  ivec2 s = gridSize();
  vec2 span = vec2(s) / vec2(levelSize(FRONT_LEVEL)); // cells per texel
  vec2 lo = floor(gl_FragCoord.xy) * span;
  vec2 hi = lo + span;
  vec4 sum = vec4(0.0);
  for (int y = int(floor(lo.y)); float(y) < hi.y && y < s.y; y++) {
    float wy = min(hi.y, float(y + 1)) - max(lo.y, float(y));
    for (int x = int(floor(lo.x)); float(x) < hi.x && x < s.x; x++) {
      float w = (min(hi.x, float(x + 1)) - max(lo.x, float(x))) * wy;
      uint held = texelFetch(stamps, ivec2(x, y), 0).r;
      uint f = texelFetch(fronts, ivec2(x, y), 0).r;
      if (f == 0u || held == 0u || V.slime.x + 1u - held >= V.slime.y) continue;
      float a = float(V.slime.x + 1u - f);
      vec4 t = texelFetch(trail, ivec2(x, y), 0);
      int k = 0;
      for (int j = 1; j < int(V.frame.y); j++) {
        if (t[j] > t[k]) k = j;
      }
      sum[k] += w * (1.0 - exp(-a / SKIRT_RISE)) * exp(-a / SKIRT_STEPS);
    }
  }
  result = sum / (span.x * span.y);
}
