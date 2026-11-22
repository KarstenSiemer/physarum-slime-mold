// Auto levels without compute: one summed-trail sample per fragment of a small target; the CPU
// builds the histogram from these samples (gl/backend.ts).
precision highp float;
precision highp sampler2D;

uniform sampler2D trail;
uniform sampler2D occ; // the agents per cell while `held` is 1 or 2; any texture else
// 1: `occ` holds the agents per cell, with one agent per cell (ADR 0062). 2: the agents that moved into each cell in
// the step, one strain per channel, while agents share cells (ADR 0090). 0: no agents.
uniform int held;
uniform vec2 outSize;

out vec4 result;

// Whether the cell `c` holds an agent.
bool holds(ivec2 c) {
  vec4 o = texelFetch(occ, c, 0);
  return held == 1 ? o.r > 0.5 : o.r + o.g + o.b + o.a > 0.5;
}

// The first value is the summed trail of the cell of the sample. While `held` is not 0, the second one is the number
// of cells with an agent in the block of cells of this sample, and the third their mean summed trail: a small colony
// lies between the samples of a large grid, and the floor of the white level must still read it (exposure.ts
// levels()). The blocks of the samples tile the grid.
void main() {
  ivec2 size = textureSize(trail, 0);
  ivec2 c = min(ivec2(gl_FragCoord.xy / outSize * vec2(size)), size - 1);
  vec4 v = texelFetch(trail, c, 0);
  float n = 0.0;
  float sum = 0.0;
  if (held != 0) {
    ivec2 lo = ivec2(floor((gl_FragCoord.xy - 0.5) / outSize * vec2(size)));
    ivec2 hi = min(ivec2(floor((gl_FragCoord.xy + 0.5) / outSize * vec2(size))), size);
    for (int y = lo.y; y < hi.y; y++) {
      for (int x = lo.x; x < hi.x; x++) {
        if (!holds(ivec2(x, y))) continue;
        vec4 t = texelFetch(trail, ivec2(x, y), 0);
        sum += t.x + t.y + t.z + t.w;
        n += 1.0;
      }
    }
  }
  result = vec4(v.x + v.y + v.z + v.w, n, n > 0.0 ? sum / n : 0.0, 1.0);
}
