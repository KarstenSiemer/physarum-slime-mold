// The picture of the tubes (ADR 0034), after common.glsl. Mirrors ../../shaders/tubes.wgsl, where the passes are
// described: PASS 0 is `roots` (per cell and strain the factor of the radius of its tube), PASS 1 is `picture` (the
// trail that the view draws). programs.ts defines RADIUS, EDGE, SHEET, SPAN and BODY_LOW from ../../tubes.ts.

out vec4 result;

#if PASS == 0
// The memory of the flow of each strain: x flow memory, y tube body (gl/sim.ts flowMemories()).
uniform sampler2D flowMemory;
uniform sampler2D flowMemory1;
uniform sampler2D flowMemory2;
uniform sampler2D flowMemory3;
// The strains that the state of the flow holds: a sampler beyond them holds the memory of the first strain.
uniform int strains;

// The strength across the tube that the cell at p (cellXY) holds in one memory; 0 on a cell without a tube.
float across(sampler2D memory, ivec2 p) {
  if (texelFetch(memory, p, 0).y < BODY_LOW) return 0.0;
  float sum = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 q = cellXY(p + ivec2(dx, dy));
      if (q.x < 0) continue;
      vec4 m = texelFetch(memory, q, 0);
      if (m.y >= BODY_LOW) sum += m.x * m.y;
    }
  }
  return min(sum / SPAN, 1.0);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = vec4(0.0);
  if (cellXY(p).x >= 0) {
    a.x = across(flowMemory, p);
    if (strains > 1) a.y = across(flowMemory1, p);
    if (strains > 2) a.z = across(flowMemory2, p);
    if (strains > 3) a.w = across(flowMemory3, p);
  }
  result = sqrt(sqrt(a));
}

#else
uniform sampler2D trail; // the trail that the view draws without the tubes
uniform sampler2D shape; // outline distances (shape.frag): r the wall byte
uniform sampler2D roots; // PASS 0

const float SHAPE_RANGE = 4.0; // cells; SHAPE_RANGE in shape.frag

// The distance to the outline of the walls that the wall byte of a texel of `shape` stands for, cells, less half a
// step of the byte (clearOf in tubes.wgsl).
float clearOf(vec4 s) { return max(0.0, (1.0 - 2.0 * s.r - 1.0 / 255.0) * SHAPE_RANGE); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (cellXY(p).x < 0) {
    result = vec4(0.0);
    return;
  }
  float reach = RADIUS + 0.5 * EDGE;
  int window = int(ceil(reach)) - 1;
  vec4 here = texelFetch(shape, p, 0);
  // Of the discs that reach the cell: the largest weight, the sum of the weights, and the sum of the trails by weight.
  vec4 top = vec4(0.0);
  vec4 sum = vec4(0.0);
  vec4 lit = vec4(0.0);
  // No disc reaches a cell of a wall.
  if (!isWall(here)) {
    for (int dy = -window; dy <= window; dy++) {
      for (int dx = -window; dx <= window; dx++) {
        float d = length(vec2(float(dx), float(dy)));
        if (d >= reach) continue;
        ivec2 q = cellXY(p + ivec2(dx, dy));
        if (q.x < 0) continue;
        // The disc of the cell itself reaches it. Another cell: not a wall cell, and no wall on the line between.
        if (dx != 0 || dy != 0) {
          vec4 there = texelFetch(shape, q, 0);
          if (isWall(there) || clearOf(here) + clearOf(there) <= d) continue;
        }
        vec4 root = texelFetch(roots, q, 0);
        vec4 weight = root * clamp((RADIUS * root + 0.5 * EDGE - d) / EDGE, 0.0, 1.0);
        top = max(top, weight);
        sum += weight;
        lit += texelFetch(trail, q, 0) * weight;
      }
    }
  }
  // The tube: the strongest disc, with the mean trail of the cells whose discs reach the cell. Without a disc all
  // three are 0.
  vec4 tube = top * lit / max(sum, vec4(1e-20));
  result = max(SHEET * texelFetch(trail, p, 0), tube);
}
#endif
