// Gel height field, one texel per cell plus a one-cell border, rendered before the main pass
// (gl/backend.ts). Mirrors `heightField` in ../../shaders/render.wgsl: the summed trail above the
// black level times the exposure, an affine function of the trail, so filtering it equals filtering
// the trail first. Clamped to keep fp16 finite. In collision mode occupied food cells raise it by up
// to PRESENCE, weighted by the spline of render.frag at the cell centre. A wall cell takes the mean of
// its neighbours outside walls (see besideWall). Prepended with view.glsl.

float levelAt(ivec2 c) {
  vec4 v = trailAt(c);
  return (v.x + v.y + v.z + v.w - V.fx.y) * V.exposure;
}

#if ENV
float besideWall(ivec2 c, float y) {
  float sum = 0.0;
  float n = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 k = c + ivec2(i, j);
      if (cellAt(k) < 0 || shapeAt(k).r >= 0.5) continue;
      sum += levelAt(k);
      n += 1.0;
    }
  }
  return n > 0.0 ? sum / n : y;
}
#endif

void main() {
  ivec2 c = ivec2(floor(gl_FragCoord.xy)) - 1;
  float y = levelAt(c);
#if ENV
  if (V.frame.z != 0u) {
    vec4 own = shapeAt(c);
    if (own.r >= 0.5 && cellAt(c) >= 0) y = besideWall(c, y);
    // A food byte of 0 lies SHAPE_RANGE cells outside the food, so no cell of the 3 × 3 holds food.
    if (V.frame.w != 0u && own.g > 0.0) {
      const vec3 b = vec3(0.125, 0.75, 0.125); // the spline of render.frag at a cell centre
      float w = 0.0;
      for (int j = 0; j < 3; j++) {
        for (int i = 0; i < 3; i++) {
          ivec2 n = c + ivec2(i - 1, j - 1);
          w += b[i] * b[j] * presenceWeight(cellAt(n), (shapeAt(n).g - 0.5) * 2.0 * SHAPE_RANGE);
        }
      }
      y = mix(y, max(y, 0.0), w) + PRESENCE * w;
    }
  }
#endif
  result = vec4(clamp(y, -6e4, 6e4), 0.0, 0.0, 1.0);
}
