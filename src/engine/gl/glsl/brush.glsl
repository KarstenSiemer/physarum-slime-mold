// A brush segment for paint.frag and shape.frag, after common.glsl. Mirrors nearestPoint, segmentDistance and
// strokeDistance in ../../shaders/paint.wgsl.

uniform vec2 from;
uniform vec2 to;
uniform float radius;

// The point of the segment nearest to p.
vec2 nearestPoint(vec2 p) {
  vec2 ab = to - from;
  float t = clamp(dot(p - from, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return from + t * ab;
}

float segmentDistance(vec2 p) {
  return distance(p, nearestPoint(p));
}

// Distance from the cell centre p to the segment; on the periodic grid to its nearest copy, which lies at most one
// period away for a segment from brush.ts paintSegments(). `reach` is the largest distance the caller needs: where
// the segment grown by it stays inside the grid, no copy is that near a cell of the grid, so the copies are skipped.
float strokeDistance(vec2 p, float reach) {
  float d = segmentDistance(p);
  vec2 size = vec2(W(), H());
  bool inside = all(greaterThanEqual(min(from, to) - reach, vec2(0.0))) &&
    all(lessThanEqual(max(from, to) + reach, size));
  if (P.cfg.z == 0u && !inside) {
    for (int oy = -1; oy <= 1; oy++) {
      for (int ox = -1; ox <= 1; ox++) d = min(d, segmentDistance(p + vec2(ox, oy) * size));
    }
  }
  return d;
}
