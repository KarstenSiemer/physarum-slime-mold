// Mean diffusion + decay, and this step's deposits and sources, in either order of a step (ADR 0027): the 3 × 3 mean,
// and with BOX the mean over a larger window (ADR 0046). Mirrors ../../shaders/diffuse.wgsl (no tiling: one fragment
// reads its 3 × 3 neighbourhood).

uniform sampler2D trailIn;
uniform sampler2D scentIn;
uniform sampler2D counts;
uniform sampler2D env;
uniform sampler2D occ; // agents per cell after this step's moves (COVERED)
uniform bool first;
uniform bool last;
uniform bool blur;

layout(location = 0) out vec4 outTrail;
layout(location = 1) out vec4 outScent;

// Covered food (COVERED in diffuse.wgsl, ADR 0022): programs.ts compiles the pass with it, and gl/sim.ts uses that one
// only while the option is on.
#ifndef COVERED
#define COVERED 0
#endif

// The view of a step that moves first (VIEW in diffuse.wgsl, gl/sim.ts viewTargets(), ADR 0027): the step's diffusion
// and decay without its sources and its cut, into targets that the simulation does not read. A program of its own.
#ifndef VIEW
#define VIEW 0
#endif

// The mean over a window above 3 × 3 (the entry point `box` in diffuse.wgsl, ADR 0046), a program of its own: two
// draws, the sums along the rows of the window (`columns` false), then the sums of those along its columns and the
// mean. `radius`: the cells of the window on each side of its middle (RADIUS in diffuse.wgsl).
#ifndef BOX
#define BOX 0
#endif
#if BOX
uniform int radius;
uniform bool columns;
#endif

#if COVERED
// True if the 3 × 3 window around cell q holds an agent; cells outside a closed arena hold none.
bool covered(ivec2 q) {
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 c = cellXY(q + ivec2(dx, dy));
      if (c.x >= 0 && texelFetch(occ, c, 0).r > 0.5) return true;
    }
  }
  return false;
}
#endif

// True if a step senses first (senseFirst() in diffuse.wgsl, ADR 0027): the sources enter the first pass before its
// mean; moving first, the last pass adds them after the decay.
bool senseFirst() { return P.model.w > 0.0; }

// This step's deposits and food and light at the habitable cell q (sources() in diffuse.wgsl).
void sources(ivec2 q, inout vec4 t, inout vec2 s) {
  vec4 e = texelFetch(env, q, 0);
  t += texelFetch(counts, q, 0) * P.deposit;
#if COVERED
  float food = e.g > 0.0 && covered(q) ? P.model.y : 1.0;
  s += vec2(e.g * P.scent.x * food, e.b * P.scent.y);
#else
  s += vec2(e.g * P.scent.x, e.b * P.scent.y);
#endif
  // The Electrode tool (sources() in diffuse.wgsl, ADR 0047): the cathode into the food scent, the anode into the
  // repellent.
  if (e.a > 0.0) s += e.a > 0.75 ? vec2(P.electrode.x, 0.0) : vec2(0.0, P.electrode.x);
}

// Cut tool: only in the extended model the wound also loses its chemicals (wound in diffuse.wgsl).
bool wound(ivec2 q) {
  return P.tool.w == 2.0 && P.tool2.z == 0.0 && toolDistance(vec2(q) + 0.5, P.tool.xy) < P.tool.z;
}

// What a cell is (diffuse.wgsl, ADR 0027): outside the arena and in a wall of the extended model a sink that holds no
// trail and scent; in the Jones model (P.model.z = 1) a wall is part of the lattice that diffuses, without sources.
const int SINK = 0;
const int OPEN = 1;
const int WALL = 2;

// Trail and scent of a cell as the agents sensed them, and its kind. The first pass clears the wound of a cut before
// the step's diffusion.
void load(ivec2 c, out vec4 t, out vec2 s, out int kind) {
  t = vec4(0.0);
  s = vec2(0.0);
  kind = SINK;
  // The coordinates of the cell straight from the wrap: cellCoord() of the index would divide.
  ivec2 q = cellXY(c);
  if (q.x < 0) return;
  if (isWall(texelFetch(env, q, 0))) {
    if (P.model.z == 0.0) return;
    kind = WALL;
  } else {
    kind = OPEN;
  }
  t = texelFetch(trailIn, q, 0);
  s = texelFetch(scentIn, q, 0).xy;
#if !VIEW
  if (first && senseFirst() && kind == OPEN) sources(q, t, s);
  if (first && wound(q)) {
    t = vec4(0.0);
    s = vec2(0.0);
  }
#endif
}

#if BOX
// The cell at c inside the rectangle of the grid: wrapped on the periodic grid, (−1, −1) outside the rectangle of a
// closed arena; it keeps a cell outside the dish (gridXY in diffuse.wgsl).
ivec2 gridXY(ivec2 c) {
  ivec2 size = ivec2(W(), H());
  if (P.cfg.z == 0u) return wrapCell(c, size);
  if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, size))) return ivec2(-1);
  return c;
}

// The mean over a window of (2 · radius + 1)² cells with the rules of the 3 × 3 mean (`box` in diffuse.wgsl): a sink
// counts as 0, and the divisor is the number of cells of the window at every site. The rows: every cell of the grid, a
// sink too, gets the sum of its row of the window. The columns: the sum of those sums, the mean and the decay as one
// factor, the sources of a step that moves first, and 0 in a sink.
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 t = vec4(0.0);
  vec2 s = vec2(0.0);
  if (!columns) {
    for (int d = -radius; d <= radius; d++) {
      vec4 tt;
      vec2 ss;
      int k;
      load(p + ivec2(d, 0), tt, ss, k);
      t += tt;
      s += ss;
    }
    outTrail = t;
    outScent = vec4(s, 0.0, 0.0);
    return;
  }
  for (int d = -radius; d <= radius; d++) {
    ivec2 q = gridXY(p + ivec2(0, d));
    if (q.x < 0) continue;
    t += texelFetch(trailIn, q, 0);
    s += texelFetch(scentIn, q, 0).xy;
  }
  float cells = float((2 * radius + 1) * (2 * radius + 1));
  if (last) {
    t *= P.keep / cells;
    s *= P.scent.z / cells;
  } else {
    t /= cells;
    s /= cells;
  }
  int kind = SINK;
  ivec2 q = cellXY(p);
  if (q.x >= 0) kind = isWall(texelFetch(env, q, 0)) ? (P.model.z == 0.0 ? SINK : WALL) : OPEN;
#if !VIEW
  // Moving first, this step's deposits and sources, after the decay, and none in the wound of a cut that clears it.
  if (last && !senseFirst() && kind == OPEN && !wound(p)) sources(p, t, s);
#endif
  if (kind == SINK) {
    t = vec4(0.0);
    s = vec2(0.0);
  }
  outTrail = t;
  outScent = vec4(s, 0.0, 0.0);
}
#else
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 t;
  vec2 s;
  int kind;
  load(p, t, s, kind);
  if (blur) {
    // Jones' mean filter at every lattice site: a sink counts as 0 (diffuse.wgsl).
    vec4 sum = vec4(0.0);
    vec2 ssum = vec2(0.0);
    float n = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec4 tt;
        vec2 ss;
        int k;
        load(p + ivec2(dx, dy), tt, ss, k);
        sum += tt;
        ssum += ss;
        // 1 for every kind: a count of 9 that the compiler cannot fold (sensing first, below).
        n += k <= WALL ? 1.0 : 0.0;
      }
    }
    // Moving first, the mean and the decay as one factor, as WebGPU computes them; sensing first, the mean over a count
    // read at run time, and the decay in a step of its own below, the arithmetic of the code before (diffuse.wgsl,
    // ADR 0027).
    if (senseFirst()) {
      t = sum / n;
      s = ssum / n;
    } else if (last) {
      t = sum * (P.keep / 9.0);
      s = ssum * (P.scent.z / 9.0);
    } else {
      t = sum / 9.0;
      s = ssum / 9.0;
    }
  } else if (last && !senseFirst()) {
    t *= P.keep;
    s *= P.scent.z;
  }
  if (last && senseFirst()) {
    t *= P.keep;
    s *= P.scent.z;
  }
#if !VIEW
  if (last) {
    // Moving first, this step's deposits and sources, after the moves, for the sensors of the next step (diffuse.wgsl).
    if (!senseFirst() && kind == OPEN && !wound(p)) sources(p, t, s);
  }
#endif
  if (kind == SINK) {
    t = vec4(0.0);
    s = vec2(0.0);
  }
  outTrail = t;
  outScent = vec4(s, 0.0, 0.0);
}
#endif
