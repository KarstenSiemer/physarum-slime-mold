// Clearance of the walls (ADR 0020); mirrors ../../shaders/walls.wgsl. One fragment per clearance tile.
// mode 0 marks the tiles that hold a wall cell, 1 gives every tile its clearance from the marks.

uniform sampler2D env;
uniform sampler2D walled; // 1 where a tile holds a wall cell (mode 1)
uniform int mode;

out vec4 result;

// SEARCH and FAR in walls.wgsl.
const int WALL_SEARCH = 10;
const int WALL_FAR = 74;

// The least distance along one axis of `cells` cells between a cell of tile a and a cell of tile b, also with b one
// period to either side.
int gap(int a, int b, int cells) {
  int a0 = a * CLEAR_TILE;
  int a1 = min(a0 + CLEAR_TILE, cells) - 1;
  int b0 = b * CLEAR_TILE;
  int b1 = min(b0 + CLEAR_TILE, cells) - 1;
  int here = max(0, max(b0 - a1, a0 - b1));
  int after = max(0, max(b0 + cells - a1, a0 - b1 - cells));
  int before = max(0, max(b0 - cells - a1, a0 - b1 + cells));
  return min(here, min(after, before));
}

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  ivec2 size = ivec2(W(), H());
  ivec2 n = (size + CLEAR_TILE - 1) / CLEAR_TILE;
  if (mode == 0) {
    ivec2 lo = t * CLEAR_TILE;
    ivec2 hi = min(lo + CLEAR_TILE, size);
    float found = 0.0;
    for (int y = lo.y; y < hi.y; y++) {
      for (int x = lo.x; x < hi.x; x++) {
        if (isWall(texelFetch(env, ivec2(x, y), 0))) found = 1.0;
      }
    }
    result = vec4(found, 0.0, 0.0, 0.0);
    return;
  }
  int d = WALL_FAR;
  for (int dy = -WALL_SEARCH; dy <= WALL_SEARCH; dy++) {
    int by = wrapAxis(t.y + dy, n.y);
    int gy = gap(t.y, by, size.y);
    if (gy >= d) continue;
    for (int dx = -WALL_SEARCH; dx <= WALL_SEARCH; dx++) {
      int bx = wrapAxis(t.x + dx, n.x);
      if (texelFetch(walled, ivec2(bx, by), 0).r > 0.5) d = min(d, max(gap(t.x, bx, size.x), gy));
    }
  }
  result = vec4(float(d), 0.0, 0.0, 0.0);
}
