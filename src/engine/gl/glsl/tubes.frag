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

// The strength of the tube of a cell from its memory: its body times its flow memory, 0 without a tube.
float strength(vec4 m) { return m.y >= BODY_LOW ? m.x * m.y : 0.0; }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (cellXY(p).x < 0) {
    result = vec4(0.0);
    return;
  }
  vec4 sum = vec4(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 q = cellXY(p + ivec2(dx, dy));
      if (q.x < 0) continue;
      sum.x += strength(texelFetch(flowMemory, q, 0));
      if (strains > 1) sum.y += strength(texelFetch(flowMemory1, q, 0));
      if (strains > 2) sum.z += strength(texelFetch(flowMemory2, q, 0));
      if (strains > 3) sum.w += strength(texelFetch(flowMemory3, q, 0));
    }
  }
  result = sqrt(sqrt(min(sum / SPAN, vec4(1.0))));
}

#else
uniform sampler2D trail; // the trail that the view draws without the tubes
uniform sampler2D shape; // outline distances (shape.frag): r the wall byte
uniform sampler2D roots; // PASS 0

const float SHAPE_RANGE = 4.0; // cells; SHAPE_RANGE in shape.frag

// The distance of the cell at q (cellXY) to the outline of the walls, cells: 0 in a wall, at most SHAPE_RANGE.
float clearOf(ivec2 q) { return max(0.0, (1.0 - 2.0 * texelFetch(shape, q, 0).r) * SHAPE_RANGE); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (cellXY(p).x < 0) {
    result = vec4(0.0);
    return;
  }
  float reach = RADIUS + 0.5 * EDGE;
  int window = int(ceil(reach)) - 1;
  float here = clearOf(p);
  // Of the discs that reach the cell: the largest weight, the sum of the weights, and the sum of the trails by weight.
  vec4 top = vec4(0.0);
  vec4 sum = vec4(0.0);
  vec4 lit = vec4(0.0);
  for (int dy = -window; dy <= window; dy++) {
    for (int dx = -window; dx <= window; dx++) {
      float d = length(vec2(float(dx), float(dy)));
      if (d >= reach) continue;
      ivec2 q = cellXY(p + ivec2(dx, dy));
      if (q.x < 0) continue;
      // A wall lies on the line between the cells, or one of them is a wall.
      if (here + clearOf(q) <= d) continue;
      vec4 root = texelFetch(roots, q, 0);
      vec4 weight = root * clamp((RADIUS * root + 0.5 * EDGE - d) / EDGE, 0.0, 1.0);
      top = max(top, weight);
      sum += weight;
      lit += texelFetch(trail, q, 0) * weight;
    }
  }
  // The tube: the strongest disc, with the mean trail of the cells whose discs reach the cell. Without a disc all
  // three are 0.
  vec4 tube = top * lit / max(sum, vec4(1e-20));
  result = max(SHEET * texelFetch(trail, p, 0), tube);
}
#endif
