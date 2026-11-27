// The picture of the tubes (ADR 0034), after common.glsl. Mirrors ../../shaders/tubes.wgsl, where the passes are
// described: PASS 0 is `roots` (per cell and strain the factor of the radius of its tube), PASS 1 is `picture` (the
// trail that the view draws), PASS 2 is `stream` (per cell the direction of the flow of the plasm times its speed, for
// the grains, which show with the picture or without it: ADR 0095). PASS 3 and PASS 4, the map of the tiles, run
// between PASS 0 and PASS 1: per tile of TILE × TILE cells what the window of the tile holds, which a workgroup of
// `picture` finds in its own memory (ADR 0034, amendment of 2026-11-15).
// The window is a rectangle of cells, so PASS 3 looks along the rows and PASS 4 along the columns: one pass of 14 × 14
// reads per tile took 0.6 ms more on the Tokyo rail network than the skip saves there.
// programs.ts defines RADIUS, EDGE, SHEET, SPAN, BODY_LOW, FAST, TILE and WINDOW from ../../tubes.ts, and EIGHT for the
// stream over 8 neighbours (ADR 0086; `//#if EIGHT` in ../../shaders/tubes.wgsl).
#ifndef EIGHT
#define EIGHT 0
#endif

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

#if PASS == 0 || PASS == 2
// The memory of the flow of each strain: x flow memory, y tube body, z conductivity (gl/sim.ts flowMemories()).
uniform sampler2D flowMemory;
uniform sampler2D flowMemory1;
uniform sampler2D flowMemory2;
uniform sampler2D flowMemory3;
// The strains that the state of the flow holds: a sampler beyond them holds the memory of the first strain.
uniform int strains;
#endif

#if PASS == 0

// The cells of the 3 × 3 cells around p whose strength adds to the strength across a tube at p, as bits
// (openCells in tubes.wgsl). `near`: cellXY() of each of the 3 × 3 cells, near[3 (dy + 1) + dx + 1].
int openCells(ivec2 near[9]) {
  // The cells of a wall among them. A cell outside the arena is none.
  int walls = 0;
  for (int k = 0; k < 9; k++) {
    if (near[k].x >= 0 && isWall(texelFetch(shape, near[k], 0))) walls |= 1 << k;
  }
  int open = 0;
  for (int k = 0; k < 9; k++) {
    ivec2 o = ivec2(k % 3 - 1, k / 3 - 1);
    if (near[k].x < 0 || (walls & (1 << k)) != 0) continue;
    // The cells beside the corner: near[4 + o.x] and near[4 + 3 o.y].
    int beside = (1 << (4 + o.x)) | (1 << (4 + 3 * o.y));
    if (o.x != 0 && o.y != 0 && (walls & beside) == beside) continue;
    open |= 1 << k;
  }
  return open;
}

// The strength across the tube that the cell at p holds in one memory, summed over the cells of `open`.
float across(sampler2D memory, ivec2 near[9], int open) {
  float sum = 0.0;
  for (int k = 0; k < 9; k++) {
    if ((open & (1 << k)) == 0) continue;
    vec4 m = texelFetch(memory, near[k], 0);
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
  // The 3 × 3 cells and their walls once for every strain. On WebGL2 that took 1 ms less in the start scene than a
  // look per strain; on WebGPU it took more, so tubes.wgsl looks per strain (ADR 0034, amendment of 2026-11-15).
  ivec2 near[9];
  for (int k = 0; k < 9; k++) near[k] = cellXY(p + ivec2(k % 3 - 1, k / 3 - 1));
  int open = openCells(near);
  vec4 a = vec4(0.0);
  if (tube.x) a.x = across(flowMemory, near, open);
  if (tube.y) a.y = across(flowMemory1, near, open);
  if (tube.z) a.z = across(flowMemory2, near, open);
  if (tube.w) a.w = across(flowMemory3, near, open);
  result = sqrt(sqrt(a));
}

#elif PASS == 3
uniform sampler2D roots; // PASS 0

// The first half of the map of the tiles: per tile column and row of cells, of the cells of the row in the window of
// the tile column (the TILE cells of the column and the WINDOW cells on each side), wrapped as cellXY() wraps. x: 1 if
// one holds a disc of a strain. y: 1 if one is a cell of a wall. A cell outside the arena is neither.
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  bool discs = false;
  bool walled = false;
  for (int i = 0; i < TILE + 2 * WINDOW; i++) {
    ivec2 q = cellXY(ivec2(at.x * TILE - WINDOW + i, at.y));
    if (q.x < 0) continue;
    discs = discs || texelFetch(roots, q, 0) != vec4(0.0);
    walled = walled || isWall(texelFetch(shape, q, 0));
  }
  result = vec4(discs ? 1.0 : 0.0, walled ? 1.0 : 0.0, 0.0, 0.0);
}

#elif PASS == 4
uniform sampler2D rows; // PASS 3

// The map of the tiles: per tile, of its window (the tile and the WINDOW cells on each side of it; tileRoots in
// tubes.wgsl), the rows of PASS 3 in the window, wrapped on the periodic grid. x: 1 if a cell of the window holds a
// disc of a strain. y: 1 if a cell of the window is a cell of a wall.
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec2 window = vec2(0.0);
  for (int j = 0; j < TILE + 2 * WINDOW; j++) {
    int y = t.y * TILE - WINDOW + j;
    if (P.cfg.z == 0u) y = wrapAxis(y, H());
    else if (y < 0 || y >= H()) continue;
    window = max(window, texelFetch(rows, ivec2(t.x, y), 0).xy);
  }
  result = vec4(window, 0.0, 0.0);
}

#elif PASS == 1
uniform sampler2D trail; // the trail that the view draws without the tubes
uniform sampler2D roots; // PASS 0
uniform sampler2D tiles; // PASS 4: per tile, whether its window holds a disc (x) and a cell of a wall (y)

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (cellXY(p).x < 0) {
    result = vec4(0.0);
    return;
  }
  float reach = RADIUS + 0.5 * EDGE;
  vec4 here = texelFetch(shape, p, 0);
  vec2 tile = texelFetch(tiles, p / TILE, 0).xy;
  // Without a cell of a wall in the window of the tile no line between two of its cells meets one.
  bool walls = tile.y != 0.0;
  // Of the discs that reach the cell: the largest weight, the sum of the weights, and the sum of the trails by weight.
  vec4 top = vec4(0.0);
  vec4 sum = vec4(0.0);
  vec4 lit = vec4(0.0);
  // No disc reaches a cell of a wall. A window without a disc adds nothing: the tiles away from the tubes.
  if (!isWall(here) && tile.x != 0.0) {
    for (int dy = -WINDOW; dy <= WINDOW; dy++) {
      for (int dx = -WINDOW; dx <= WINDOW; dx++) {
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
        if (walls && wallOnLine(p, ivec2(dx, dy))) continue;
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

#else
// The pressure of the 4 lanes of the flow of each strain (gl/sim.ts flowPressures()).
uniform sampler2D flowPressure;
uniform sampler2D flowPressure1;
uniform sampler2D flowPressure2;
uniform sampler2D flowPressure3;

#if EIGHT
// The weights of an axis edge and of a diagonal edge over 8 neighbours (AXIS and DIAG in tubes.wgsl, ADR 0086).
const float AXIS = 0.414213568; // √2 − 1
const float DIAG = 0.292893231; // 1 − 1/√2

// Whether the cell at q (not wrapped) is open for the flow: in the arena and no cell of a wall (flowOpen in tubes.wgsl).
bool flowOpen(ivec2 q) {
  ivec2 c = cellXY(q);
  return c.x >= 0 && !isWall(texelFetch(shape, c, 0));
}
#endif

// The stream of the plasm of one strain through the cell p: xy its direction, z its speed (streamOf in tubes.wgsl).
vec3 streamOf(sampler2D memory, sampler2D pressure, ivec2 p) {
  float g = texelFetch(memory, p, 0).z;
  if (g <= 0.0) return vec3(0.0);
  vec4 own = texelFetch(pressure, p, 0);
  vec4 flux = vec4(0.0);
  vec4 x = vec4(0.0);
  vec4 y = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2((1 - k) * (1 - (k & 1)), (2 - k) * (k & 1)); // east, south, west, north
    ivec2 n = cellXY(p + o);
    if (n.x < 0) continue;
    float gn = texelFetch(memory, n, 0).z;
    if (gn <= 0.0) continue;
    vec4 leaves = 2.0 * g * gn / (g + gn) * (own - texelFetch(pressure, n, 0));
    flux += abs(leaves);
    x += float(o.x) * leaves;
    y += float(o.y) * leaves;
  }
#if EIGHT
  // Over 8 neighbours: the axis edges with the weight AXIS, and the 4 diagonal edges with DIAG where both cells beside
  // the edge are open (streamOf in tubes.wgsl).
  flux *= AXIS;
  x *= AXIS;
  y *= AXIS;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(1 - 2 * (k & 1), 1 - 2 * (k >> 1)); // south-east, south-west, north-east, north-west
    if (!flowOpen(p + ivec2(o.x, 0)) || !flowOpen(p + ivec2(0, o.y))) continue;
    ivec2 n = cellXY(p + o);
    if (n.x < 0) continue;
    float gn = texelFetch(memory, n, 0).z;
    if (gn <= 0.0) continue;
    vec4 leaves = DIAG * (2.0 * g * gn / (g + gn)) * (own - texelFetch(pressure, n, 0));
    flux += abs(leaves);
    x += float(o.x) * leaves;
    y += float(o.y) * leaves;
  }
#endif
  int lane = 0;
  for (int k = 1; k < 4; k++) {
    if (flux[k] > flux[lane]) lane = k;
  }
  vec2 along = vec2(x[lane], y[lane]);
  float l = length(along);
  if (l <= 0.0) return vec3(0.0);
  return vec3(along / l, 0.5 * flux[lane] / sqrt(g));
}

// The stream of one strain if the cell holds a tube of it and its flow is faster than `fastest`, else `fastest`.
vec3 faster(vec3 fastest, sampler2D memory, sampler2D pressure, ivec2 p) {
  if (texelFetch(memory, p, 0).y < BODY_LOW) return fastest;
  vec3 v = streamOf(memory, pressure, p);
  return v.z > fastest.z ? v : fastest;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 fastest = vec3(0.0);
  if (cellXY(p).x >= 0) {
    fastest = faster(fastest, flowMemory, flowPressure, p);
    if (strains > 1) fastest = faster(fastest, flowMemory1, flowPressure1, p);
    if (strains > 2) fastest = faster(fastest, flowMemory2, flowPressure2, p);
    if (strains > 3) fastest = faster(fastest, flowMemory3, flowPressure3, p);
  }
  result = vec4(fastest.xy * min(fastest.z / FAST, 1.0), 0.0, 0.0);
}
#endif
