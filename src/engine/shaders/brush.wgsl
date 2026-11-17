// A brush segment for paint.wgsl and slime-paint.wgsl, after common.wgsl: the slot of the segment, its distance to a
// cell and the cells of its box. Both files take them from here, so the brush on the slime field reaches the cells
// that the brush on the environment reaches. gl/glsl/brush.glsl mirrors nearestPoint, segmentDistance and
// strokeDistance.

struct Brush {
  a: vec2f,      // segment start (cells), inside the grid on the periodic grid (brush.ts paintSegments)
  b: vec2f,      // segment end (cells)
  origin: vec2i, // first cell of the paint box (brush.ts paintBox; on the periodic grid it wraps)
  radius: f32,
  kind: u32,     // 0 erase, 1 wall, 2 food, 3 light, 4 anode, 5 cathode, 6 slime (types.ts EnvKind)
  reach: vec2i,  // first cell of the outline box: the paint box grown by SHAPE_RANGE (sim.ts paint())
  extent: vec2u, // the size of the outline box in cells
  arena: u32,    // the boundary of the simulation, as P.cfg.z names the boundary of the stroke (slime-paint.wgsl)
}

@group(0) @binding(2) var<uniform> B: Brush;

// The point of the segment nearest to p.
fn nearestPoint(p: vec2f) -> vec2f {
  let ab = B.b - B.a;
  let t = clamp(dot(p - B.a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return B.a + t * ab;
}

fn segmentDistance(p: vec2f) -> f32 {
  return distance(p, nearestPoint(p));
}

// Distance from the centre of cell q to the segment; on the periodic grid to its nearest copy, which lies at most
// one period away for a segment from paintSegments(), as in brush.glsl. `reach` is the largest distance the caller
// needs: where the segment grown by it stays inside the grid, no copy is that near a cell of the grid, so the copies
// are skipped. `paint` and `outline` of paint.wgsl and `paintSlime` of slime-paint.wgsl measure with it, so the
// outline and the slime field see the cells that `paint` painted.
fn strokeDistance(q: vec2i, reach: f32) -> f32 {
  let p = vec2f(q) + 0.5;
  var d = segmentDistance(p);
  let size = vec2f(f32(W()), f32(H()));
  let inside = all(min(B.a, B.b) - reach >= vec2f(0.0)) && all(max(B.a, B.b) + reach <= size);
  if (P.cfg.z == 0u && !inside) {
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) { d = min(d, segmentDistance(p + vec2f(f32(ox), f32(oy)) * size)); }
    }
  }
  return d;
}

// The index of cell q of a box, and q wrapped into the grid: on the periodic grid every cell of a box wraps (a box
// spans at most one period), in a closed arena the cells outside it are −1.
fn boxCell(cell: vec2i) -> vec3i {
  let size = vec2i(i32(W()), i32(H()));
  if (P.cfg.z == 0u) {
    let q = ((cell % size) + size) % size;
    return vec3i(q, q.y * size.x + q.x);
  }
  return vec3i(cell, cellAt(cell));
}
