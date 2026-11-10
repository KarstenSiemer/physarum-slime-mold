// Gel height field, one texel per cell plus a one-cell border, rendered before the main pass
// (gl/backend.ts). Mirrors `heightField` in ../../shaders/render.wgsl: the summed trail above the
// black level times the exposure, an affine function of the trail, so filtering it equals filtering
// the trail first. Clamped to keep fp16 finite. Prepended with view.glsl.

void main() {
  vec4 v = trailAt(ivec2(floor(gl_FragCoord.xy)) - 1);
  float y = (v.x + v.y + v.z + v.w - V.fx.y) * V.exposure;
  result = vec4(clamp(y, -6e4, 6e4), 0.0, 0.0, 1.0);
}
