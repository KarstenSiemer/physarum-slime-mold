// Brush strokes on the environment (walls, food, light). Prepended with common.wgsl.

struct Brush {
  a: vec2f,      // segment start (cells), inside the grid on the periodic grid (brush.ts paintSegments)
  b: vec2f,      // segment end (cells)
  origin: vec2i, // first cell of the dispatch box (brush.ts paintBox; on the periodic grid it wraps)
  radius: f32,
  kind: u32,     // 0 erase, 1 wall, 2 food, 3 light
}

@group(0) @binding(1) var<storage, read_write> env: array<u32>;
@group(0) @binding(2) var<uniform> B: Brush;

fn segmentDistance(p: vec2f) -> f32 {
  let ab = B.b - B.a;
  let t = clamp(dot(p - B.a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return distance(p, B.a + t * ab);
}

// Distance from the centre of cell q to the segment; on the periodic grid to its nearest copy, which lies at most
// one period away for a segment from paintSegments(), as in paint.frag. Where the brush stays inside the grid, no
// copy is near enough to paint a cell of the grid, so the copies are skipped.
fn strokeDistance(q: vec2i) -> f32 {
  let p = vec2f(q) + 0.5;
  var d = segmentDistance(p);
  let size = vec2f(f32(W()), f32(H()));
  let inside = all(min(B.a, B.b) - B.radius >= vec2f(0.0)) && all(max(B.a, B.b) + B.radius <= size);
  if (P.cfg.z == 0u && !inside) {
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) { d = min(d, segmentDistance(p + vec2f(f32(ox), f32(oy)) * size)); }
    }
  }
  return d;
}

@compute @workgroup_size(16, 16)
fn paint(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2i(i32(W()), i32(H()));
  var q = B.origin + vec2i(gid.xy);
  var c = -1;
  if (P.cfg.z == 0u) {
    // The box spans at most one period: a cell comes twice only from workgroups past its end, with the same value.
    q = ((q % size) + size) % size;
    c = q.y * size.x + q.x;
  } else {
    c = cellAt(q);
    if (c < 0) { return; }
  }
  let d = strokeDistance(q);
  if (d > B.radius) { return; }
  var e = envOf(env[c]);
  switch B.kind {
    case 0u: { e = vec4f(0.0); }
    case 1u: { e = vec4f(1.0, 0.0, 0.0, 0.0); }
    case 2u: { e.y = 1.0; }
    // Soft edge, so the repellent has a gradient from the start.
    default: { e.z = max(e.z, smoothstep(B.radius, 0.3 * B.radius, d)); }
  }
  env[c] = pack4x8unorm(e);
}
