// The picture of the tubes (ADR 0034), after common.glsl. Mirrors ../../shaders/tubes.wgsl, where the passes are
// described: PASS 0 is `roots` (per cell and strain the factor of the radius of its tube), PASS 1 is `picture` (the
// trail that the view draws). programs.ts defines RADIUS, EDGE, SHEET, SPAN and BODY_LOW from ../../tubes.ts.

out vec4 result;

uniform sampler2D shape; // shape.frag: r the wall byte

// Whether a cell of a wall lies on the line between the centres of the cell p and of the cell `o` cells from it
// (wallOnLine in tubes.wgsl).
bool wallOnLine(ivec2 p, ivec2 o) {
  ivec2 lo = min(o, ivec2(0));
  ivec2 hi = max(o, ivec2(0));
  int span = abs(o.x) + abs(o.y);
  for (int j = lo.y; j <= hi.y; j++) {
    for (int i = lo.x; i <= hi.x; i++) {
      ivec2 at = ivec2(i, j);
      if (at == ivec2(0) || at == o || 2 * abs(i * o.y - j * o.x) > span) continue;
      ivec2 c = cellXY(p + at);
      if (c.x >= 0 && isWall(texelFetch(shape, c, 0))) return true;
    }
  }
  return false;
}

#if PASS == 0
// The memory of the flow of each strain: x flow memory, y tube body (gl/sim.ts flowMemories()).
uniform sampler2D flowMemory;
uniform sampler2D flowMemory1;
uniform sampler2D flowMemory2;
uniform sampler2D flowMemory3;
// The strains that the state of the flow holds: a sampler beyond them holds the memory of the first strain.
uniform int strains;

// Whether the cell at q (not wrapped) is a cell of a wall. A cell outside the arena is none.
bool wallAt(ivec2 q) {
  ivec2 c = cellXY(q);
  return c.x >= 0 && isWall(texelFetch(shape, c, 0));
}

// The cells of the 3 × 3 cells around p whose strength adds to the strength across a tube at p, as bits
// (openCells in tubes.wgsl).
int openCells(ivec2 p) {
  int open = 0;
  for (int k = 0; k < 9; k++) {
    ivec2 o = ivec2(k % 3 - 1, k / 3 - 1);
    ivec2 q = cellXY(p + o);
    if (q.x < 0 || isWall(texelFetch(shape, q, 0))) continue;
    if (o.x != 0 && o.y != 0 && wallAt(p + ivec2(o.x, 0)) && wallAt(p + ivec2(0, o.y))) continue;
    open |= 1 << k;
  }
  return open;
}

// The strength across the tube that the cell at p (cellXY) holds in one memory, summed over the cells of `open`.
float across(sampler2D memory, ivec2 p, int open) {
  float sum = 0.0;
  for (int k = 0; k < 9; k++) {
    if ((open & (1 << k)) == 0) continue;
    vec4 m = texelFetch(memory, cellXY(p + ivec2(k % 3 - 1, k / 3 - 1)), 0);
    if (m.y >= BODY_LOW) sum += m.x * m.y;
  }
  return min(sum / SPAN, 1.0);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  result = vec4(0.0);
  // A cell of a wall holds no tube.
  if (cellXY(p).x < 0 || isWall(texelFetch(shape, p, 0))) return;
  // The strains with a tube here: a cell without a tube of a strain is no disc of it.
  bvec4 tube = bvec4(
    texelFetch(flowMemory, p, 0).y >= BODY_LOW,
    strains > 1 && texelFetch(flowMemory1, p, 0).y >= BODY_LOW,
    strains > 2 && texelFetch(flowMemory2, p, 0).y >= BODY_LOW,
    strains > 3 && texelFetch(flowMemory3, p, 0).y >= BODY_LOW
  );
  if (!any(tube)) return;
  int open = openCells(p);
  vec4 a = vec4(0.0);
  if (tube.x) a.x = across(flowMemory, p, open);
  if (tube.y) a.y = across(flowMemory1, p, open);
  if (tube.z) a.z = across(flowMemory2, p, open);
  if (tube.w) a.w = across(flowMemory3, p, open);
  result = sqrt(sqrt(a));
}

#else
uniform sampler2D trail; // the trail that the view draws without the tubes
uniform sampler2D roots; // PASS 0

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
        vec4 root = texelFetch(roots, q, 0);
        vec4 weight = root * clamp((RADIUS * root + 0.5 * EDGE - d) / EDGE, 0.0, 1.0);
        // Most cells hold no disc that reaches this far: they add nothing, and they need no look at the walls.
        if (weight == vec4(0.0)) continue;
        // The disc of the cell itself reaches it. The disc of another cell: not across a cell of a wall. A cell
        // of a wall is no disc (PASS 0).
        if (wallOnLine(p, ivec2(dx, dy))) continue;
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
