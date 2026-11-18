// The map of the growth front (see frontMap in ../../shaders/render.wgsl; ADR 0060), one texel per fragment: texels
// of 2^FRONT_LEVEL cells per side. (the mean of the summed trail over the cells of the texel; that mean times the age
// of the ground, 0 at the front to 1 at FRONT_STEPS; the strain with the most trail; 1). The age of the ground of a
// texel is the age of its oldest front stamp among the cells with slime: the step at which the front first reached
// the texel. A cell with slime and no front stamp is old ground (painted slime), and so is a texel without slime.
// Prepended with view.glsl.

uniform highp usampler2D stamps; // the stamps of the slime field (slime.frag)
uniform highp usampler2D fronts; // the front field (PASS 2 of slime.frag)

void main() {
  ivec2 s = gridSize();
  vec2 span = vec2(s) / vec2(levelSize(FRONT_LEVEL)); // cells per texel
  vec2 lo = floor(gl_FragCoord.xy) * span;
  vec2 hi = lo + span;
  vec4 sum = vec4(0.0);
  uint oldest = 0u;
  bool stamped = false;
  for (int y = int(floor(lo.y)); float(y) < hi.y && y < s.y; y++) {
    float wy = min(hi.y, float(y + 1)) - max(lo.y, float(y));
    for (int x = int(floor(lo.x)); float(x) < hi.x && x < s.x; x++) {
      float w = (min(hi.x, float(x + 1)) - max(lo.x, float(x))) * wy;
      sum += w * texelFetch(trail, ivec2(x, y), 0);
      uint held = texelFetch(stamps, ivec2(x, y), 0).r;
      if (held != 0u && V.slime.x + 1u - held < V.slime.y) {
        uint f = texelFetch(fronts, ivec2(x, y), 0).r;
        stamped = true;
        oldest = max(oldest, f == 0u ? 0xffffffffu : V.slime.x + 1u - f);
      }
    }
  }
  vec4 mean = sum / (span.x * span.y);
  int k = 0;
  for (int j = 1; j < int(V.frame.y); j++) {
    if (mean[j] > mean[k]) k = j;
  }
  float body = mean.x + mean.y + mean.z + mean.w;
  // A texel without slime holds no front stamp, and it shows no fan: its ground counts as old.
  float age = stamped ? min(float(oldest) / FRONT_STEPS, 1.0) : 1.0;
  result = vec4(body, body * age, float(k), 1.0);
}
