// Brush strokes on the environment (walls, food, light). Prepended with common.wgsl.

struct Brush {
  a: vec2f,      // segment start (cells)
  b: vec2f,      // segment end (cells)
  origin: vec2i, // first cell of the dispatch box (may be negative, wraps)
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

@compute @workgroup_size(16, 16)
fn paint(@builtin(global_invocation_id) gid: vec3u) {
  let cell = B.origin + vec2i(gid.xy);
  let c = cellAt(cell);
  if (c < 0) { return; }
  let d = segmentDistance(vec2f(cell) + 0.5);
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
