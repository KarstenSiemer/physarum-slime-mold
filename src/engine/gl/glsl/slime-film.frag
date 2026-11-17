// The map of the film of the slime, one texel per cell (see slimeFilm in ../../shaders/render.wgsl; ADR 0057), filled
// once for each state of the slime that a frame draws (gl/backend.ts). Prepended with view.glsl.
//
// The thickness of the slime of a cell is its amount as a share of the full amount, times the strength of the age of
// its stamp. The film of a cell is the mean of the thickness of the open cells among the 3 × 3 around it, with the
// weights 1, 2, 1 along each axis: a wall and a cell outside the arena take the film of the open cells beside them.
// A cell with no open cell among them takes the 5 × 5, with the weights 1, 2, 3, 2, 1.

uniform highp usampler2D stamps;  // the stamps of the slime field (slime.frag PASS 0)
uniform highp usampler2D amounts; // the amounts of slime (slime.frag PASS 1)

const float SLIME_FULL = 4095.0; // the full amount of slime of a cell (slime.ts SLIME_FULL)

// The strength of the slime of a cell that holds the stamp `held`, 0 to 1 (slimeOf in render.wgsl).
float slimeOf(uint held) {
  uint age = V.slime.x + 1u - held;
  if (held == 0u || age >= V.slime.y) return 0.0;
  return 1.0 - float(age) / float(V.slime.y);
}

// Whether grid cell c lies in the arena (slimeArena in render.wgsl).
bool slimeArena(ivec2 c) {
  if (V.boundary == 0u) return true;
  ivec2 s = gridSize();
  if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, s))) return false;
  return V.boundary != 2u || distance(vec2(c) + 0.5, 0.5 * vec2(s)) <= DISH_FILL * 0.5 * float(min(s.x, s.y));
}

// The thickness of the slime of the cell c of the grid, 0 to 1 (filmCell in render.wgsl).
float filmCell(ivec2 c) {
  return slimeOf(texelFetch(stamps, c, 0).r) * float(texelFetch(amounts, c, 0).r) / SLIME_FULL;
}

// The film of cell c, which may hold a wall or lie outside the arena (filmOf in render.wgsl): the mean over the open
// cells of the 3 × 3 around it, and over those of the 5 × 5 where the 3 × 3 hold none.
float filmOf(ivec2 c) {
  ivec2 s = gridSize();
  for (int r = 1; r <= 2; r++) {
    float sum = 0.0;
    float total = 0.0;
    for (int j = -r; j <= r; j++) {
      for (int i = -r; i <= r; i++) {
        ivec2 k = c + ivec2(i, j);
        if (V.boundary == 0u) k = wrapCell(k, s);
        if (!slimeArena(k)) continue;
#if ENV
        // A wall that the picture draws holds no slime: its byte in `shape` is 128 or more.
        if (V.frame.z != 0u && texelFetch(shape, k, 0).r >= 0.5) continue;
#endif
        float w = float((r + 1 - abs(i)) * (r + 1 - abs(j)));
        sum += w * filmCell(k);
        total += w;
      }
    }
    if (total > 0.0) return sum / total;
  }
  return 0.0;
}

void main() {
  result = vec4(filmOf(ivec2(floor(gl_FragCoord.xy))), 0.0, 0.0, 1.0);
}
