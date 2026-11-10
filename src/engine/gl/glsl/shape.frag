// Outlines for the renderer (R wall, G food, B light, A shadow), one byte each: the signed distance to
// the wall and food outlines (cells, positive inside, clamped to ±SHAPE_RANGE, 128 and up inside), the
// light of `env` and the drop shadow of its walls. Mirrors `outline` and `refresh` in ../../shaders/paint.wgsl.
// Runs after paint.frag (gl/sim.ts drawOutlines()): per segment over its outline box (brush.ts outlineRects), `op`
// 0 writes for MAX blending (a union) and 1 the complement for MIN blending (a wall over food, the eraser), with
// `hold` also the hold of the subtracted layers. Else 4 writes that hold for MIN blending once per cell of the run's
// boxes. 2 writes the light and the shadow without blending, once per cell of the run's boxes or, with the hold, per
// eraser. 3 writes every channel without blending from a copy of the target (`old`), after the boundary changed. Color masks pick the channels. Every byte is held to what `env` holds around its
// cell, and a segment's distance to the cells it paints itself, so a cell is inside exactly when `env` holds the
// wall or food there. Cells outside the arena keep their bytes. Prepended with common.glsl and brush.glsl.

uniform int op;
uniform ivec2 layers;  // ops 0, 1 and 4: the layers (wall, food) the color mask writes
uniform int hold;      // op 1: also the hold of op 4, except where the subtraction writes 0
uniform int core;      // op 2 for one eraser (`from`, `to`, `radius`): the cells deep inside it hold no light or shadow
uniform sampler2D env; // after the stroke
uniform sampler2D old; // op 3: the target before, one tile of it
uniform ivec2 tile;    // op 3: the first cell of that tile

out vec4 result;

const float SHAPE_RANGE = 4.0; // cells; SHAPE_RANGE in ../../types.ts and render.frag
const int HOLD_RINGS = 5;      // cells: how far a byte looks for a cell of its layer
const float WALL_BEVEL = 1.5;  // cells: the lit slope of a wall (render.frag `walls`)
const float FOOD_RIM = 2.0;    // cells: the lit rim of food (render.frag `flakeAt`)
const vec2 SHADOW = vec2(1.08, 1.44);
const float SHADOW_SOFT = 1.5;

// A signed distance (cells) as a byte value; the outline lies at 127.5.
float distanceByte(float sd) {
  return round((clamp(sd / SHAPE_RANGE, -1.0, 1.0) * 0.5 + 0.5) * 255.0);
}

// The distance from the middle line of a stroke, rounded off near it (see `rounded` in paint.wgsl).
float rounded(float d, float r, float slope) {
  float rho = min(r, max(2.0 * slope - r, 0.0));
  return d >= rho ? d : (d * d + rho * rho) / (2.0 * rho);
}

// Cell c + d of the grid, with c in the grid and d less than a grid: wrapped with comparisons on the periodic
// grid, (−1, −1) outside a closed one; the dish does not count (see gridIndex in paint.wgsl).
ivec2 gridCell(ivec2 c, ivec2 d) {
  ivec2 size = ivec2(W(), H());
  ivec2 q = c + d;
  if (P.cfg.z == 0u) {
    q += ivec2(lessThan(q, ivec2(0))) * size;
    q -= ivec2(greaterThanEqual(q, size)) * size;
  } else if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, size))) {
    return ivec2(-1);
  }
  return q;
}

// Whether `env` holds a layer (0 wall, 1 food) in cell c + d of the grid: a byte of 128 or more, the threshold
// of isWall() in common.glsl, for food too (see `holds` in paint.wgsl).
bool holds(ivec2 c, ivec2 d, int layer) {
  ivec2 q = gridCell(c, d);
  return q.x >= 0 && texelFetch(env, q, 0)[layer] * 255.0 >= 127.5;
}

// The largest byte a cell may hold for a layer `env` does not hold there (see holdByte in paint.wgsl).
float holdByte(ivec2 c, int layer) {
  for (int k = 1; k <= HOLD_RINGS; k++) {
    for (int t = -k; t <= k; t++) {
      if (holds(c, ivec2(t, -k), layer) || holds(c, ivec2(t, k), layer)) return distanceByte(1.5 - float(k));
    }
    for (int t = 1 - k; t < k; t++) {
      if (holds(c, ivec2(-k, t), layer) || holds(c, ivec2(k, t), layer)) return distanceByte(1.5 - float(k));
    }
  }
  return 0.0;
}

// Whether this segment paints cell c + d, by the rule of paint.frag (see `paints` in paint.wgsl).
bool paints(ivec2 c, ivec2 d) {
  ivec2 q = c + d;
  if (P.cfg.z == 0u) {
    ivec2 size = ivec2(W(), H());
    q += ivec2(lessThan(q, ivec2(0))) * size;
    q -= ivec2(greaterThanEqual(q, size)) * size;
  } else if (cellAt(q) < 0) {
    return false;
  }
  return strokeDistance(vec2(q) + 0.5, radius) <= radius;
}

// The hold of holdByte() from the cells this segment paints itself, at cell c, which it does not paint (see
// `ownHold` in paint.wgsl).
float ownHold(ivec2 c) {
  for (int k = 1; k <= HOLD_RINGS; k++) {
    for (int t = -k; t <= k; t++) {
      if (paints(c, ivec2(t, -k)) || paints(c, ivec2(t, k))) return distanceByte(1.5 - float(k));
    }
    for (int t = 1 - k; t < k; t++) {
      if (paints(c, ivec2(-k, t)) || paints(c, ivec2(k, t))) return distanceByte(1.5 - float(k));
    }
  }
  return 0.0;
}

// Whether ownHold() is at least the segment's byte at the cell centre p (see `ownHeld` in paint.wgsl).
bool ownHeld(vec2 p) {
  if (radius < 0.75) return false;
  if (P.cfg.z == 0u) return true;
  vec2 x = nearestPoint(p);
  if (P.cfg.z == 1u) return all(greaterThanEqual(x, vec2(0.0))) && all(lessThanEqual(x, vec2(W(), H())));
  return distance(x, 0.5 * vec2(W(), H())) <= dishRadius() - radius;
}

// The segment's byte s at cell c (centre p), held to the cells it paints where it does not paint c (see `ownByte`
// in paint.wgsl). MIN and MAX blending read the old byte, so every byte above 0 is held.
float ownByte(float s, ivec2 c, vec2 p) {
  if (s == 0.0 || ownHeld(p) || paints(c, ivec2(0))) return s;
  return min(s, ownHold(c));
}

// A byte held to `env` (see `held` in paint.wgsl).
float held(float b, ivec2 c, int layer) {
  if (holds(c, ivec2(0), layer)) return max(b, 128.0);
  float v = min(b, 127.0);
  return v == 0.0 ? 0.0 : min(v, holdByte(c, layer));
}

const float NONE = 32.0; // no cell of the layer within 3 rings (see `nearestCells` in paint.wgsl)

// The smallest byte that a cell may hold for a layer `env` does not hold there (see `floorByte` in paint.wgsl).
float floorByte(float n) {
  return n == NONE ? 0.0 : distanceByte(-sqrt(n));
}

// The squared distances (wall, food) from cell c to the nearest cell of each layer that `env` holds in the arena, up
// to 3 rings away (see `nearestCells` in paint.wgsl).
vec2 nearestCells(ivec2 c) {
  vec2 middle = 0.5 * vec2(W(), H());
  vec2 n = vec2(NONE);
  for (int k = 1; k <= 3; k++) {
    vec2 m = vec2(NONE);
    for (int dy = -k; dy <= k; dy++) {
      int stride = abs(dy) == k ? 1 : 2 * k;
      for (int dx = -k; dx <= k; dx += stride) {
        ivec2 q = gridCell(c, ivec2(dx, dy));
        if (q.x < 0 || (P.cfg.z == 2u && distance(vec2(c + ivec2(dx, dy)) + 0.5, middle) > dishRadius())) continue;
        vec4 e = texelFetch(env, q, 0) * 255.0;
        float r = float(dx * dx + dy * dy);
        if (e.r >= 127.5) m.x = min(m.x, r);
        if (e.g >= 127.5) m.y = min(m.y, r);
      }
    }
    n = mix(n, m, equal(n, vec2(NONE)));
  }
  return n;
}

// The drop shadow at cell c, 0…255 (see shadowByte in paint.wgsl).
float shadowByte(ivec2 c) {
  vec2 x = vec2(c) + 0.5 - SHADOW;
  ivec2 k0 = ivec2(floor(x));
  vec2 middle = 0.5 * vec2(W(), H());
  float sum = 0.0;
  float total = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      ivec2 k = k0 + ivec2(dx, dy);
      float w = max(1.0 - distance(vec2(k) + 0.5, x) / SHADOW_SOFT, 0.0);
      total += w;
      // cellAt(k), wrapped with comparisons.
      ivec2 q = gridCell(c, k - c);
      bool arena = q.x >= 0 && (P.cfg.z != 2u || distance(vec2(k) + 0.5, middle) <= dishRadius());
      if (arena && isWall(texelFetch(env, q, 0))) sum += w;
    }
  }
  return round(sum / total * 255.0);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  ivec2 c = ivec2(floor(p));
  // Outside the arena paint.frag changed nothing, so neither does this.
  if (cellAt(c) < 0) discard;
  vec4 e = texelFetch(env, c, 0);
  if (op == 3) {
    vec4 o = texelFetch(old, c - tile, 0) * 255.0;
    vec2 n = nearestCells(c);
    vec2 v = max(vec2(held(round(o.r), c, 0), held(round(o.g), c, 1)), vec2(floorByte(n.x), floorByte(n.y)));
    result = vec4(v, round(e.b * 255.0), shadowByte(c)) / 255.0;
    return;
  }
  if (op == 2) {
    // Deep inside an eraser (its byte 255, more than 3.98 cells inside) every cell that the shadow weighs (within 3.3
    // cells) is erased: no light and no shadow (see `eraserCore` in paint.wgsl).
    bool deep = core != 0 && distanceByte(radius - strokeDistance(p, radius + SHAPE_RANGE)) == 255.0;
    result = deep ? vec4(0.0) : vec4(0.0, 0.0, e.b, shadowByte(c) / 255.0);
    return;
  }
  if (op == 4) {
    // The hold of `held` (paint.wgsl) for MIN blending: after the subtractions of op 1 a byte that `env` does not
    // hold is at most 127, so min(byte, holdByte) is `held` of it, and a byte that `env` holds keeps it.
    vec2 cap = vec2(0.0);
    for (int layer = 0; layer < 2; layer++) {
      if (layers[layer] != 0) cap[layer] = holds(c, ivec2(0), layer) ? 255.0 : holdByte(c, layer);
    }
    result = vec4(cap / 255.0, 0.0, 0.0);
    return;
  }
  // Ops 0 and 1 run over the whole outline box, as paint.wgsl applies them.
  float d = strokeDistance(p, radius + SHAPE_RANGE);
  // A subtraction's byte, held to the cells the segment paints (see `ownByte` in paint.wgsl).
  float t = op == 1 ? ownByte(distanceByte(radius - d), c, p) : 0.0;
  vec2 out2 = vec2(0.0);
  for (int layer = 0; layer < 2; layer++) {
    if (layers[layer] == 0) continue;
    float v;
    if (op == 0) {
      // A union adds the stroke rounded off near its middle line, held to the cells it paints; MAX blending keeps
      // the old byte, which keeps its hold (see `united` in paint.wgsl).
      float u = distanceByte(radius - rounded(d, radius, layer == 0 ? WALL_BEVEL : FOOD_RIM));
      v = holds(c, ivec2(0), layer) ? max(u, 128.0) : ownByte(min(u, 127.0), c, p);
    } else {
      // MIN blending of the complement: a byte that `env` still holds was outside the stroke, so at least 128
      // already. The hold of op 4 then holds the bytes that `env` does not hold; MIN blending takes both in one draw.
      // Deep in the subtraction (t is 255) the byte is 0, which no hold changes.
      bool inside = holds(c, ivec2(0), layer);
      v = inside ? max(255.0 - t, 128.0) : min(255.0 - t, 127.0);
      if (hold != 0 && !inside && t < 255.0) v = min(v, holdByte(c, layer));
    }
    out2[layer] = v;
  }
  result = vec4(out2, 0.0, 0.0) / 255.0;
}
