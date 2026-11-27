// Brush strokes on the slime field (ADR 0055, decision 7). Prepended with common.wgsl and brush.wgsl: the footprint of
// a stroke here is the one of paint.wgsl, the cells inside the arena of the stroke whose centre lies within its radius.
//
// A stroke of the Slime tool gives each open cell of its footprint the stamp of the current step, `P.grid.w + 1u`:
// the stamp that the next step writes on a cell with plasm (slime.wgsl). So painted slime starts with the age 0 and
// ages as the slime of the colony does. A cell is open when it lies inside the arena of the simulation and holds no
// wall. An erase and a wall clear the stamp of every cell of their footprint: no wall ever holds a stamp. The pass
// runs for these three kinds only (sim.ts brushSlime()), after the strokes changed the environment.
//
// The brush paints the amount of slime too (ADR 0057, amount.wgsl, prepended before this file). A stroke of the Slime
// tool leaves slime that rises from the edge of the stroke to the full amount over RIM cells, with no step in its
// slope, so the picture draws a painted stroke with a smooth rim. A cell keeps what is left of its amount where that
// is more. An erase and a wall clear the amount with the stamp.

@group(0) @binding(1) var<storage, read> env: array<u32>;
@group(0) @binding(3) var<storage, read_write> slime: array<u32>;
@group(0) @binding(4) var<storage, read_write> amount: array<u32>;
@group(0) @binding(5) var<storage, read_write> front: array<u32>;

const RIM = 4.0; // cells from the edge of a stroke to its full amount (slime.ts SLIME_RIM)

// The amount that a stroke of the Slime tool gives a cell whose centre lies d cells from the middle line of the
// stroke: 0 half a cell outside its radius, FULL from RIM cells inside that on, and between them the curve
// t³ (t (6 t − 15) + 10), which starts and ends flat. Rounded to the nearest.
fn paintedAmount(d: f32) -> u32 {
  let t = clamp((B.radius - d + 0.5) / RIM, 0.0, 1.0);
  return u32(t * t * t * (t * (t * 6.0 - 15.0) + 10.0) * f32(FULL) + 0.5);
}

// Whether cell q of the grid lies inside the arena of the simulation. `P` holds the boundary of the stroke, which can
// be another one (Stroke.boundary in types.ts), so the slot of the brush names the boundary of the simulation. Only a
// dish is smaller than the grid: the rule of cellXY() in common.wgsl.
fn inArena(q: vec2i) -> bool {
  let size = vec2i(i32(W()), i32(H()));
  return B.arena != 2u || distance(vec2f(q) + 0.5, 0.5 * vec2f(size)) <= dishRadius();
}

@compute @workgroup_size(16, 16)
fn paintSlime(@builtin(global_invocation_id) gid: vec3u) {
  // The box spans at most one period: a cell comes twice only from workgroups past its end, with the same value.
  let cell = boxCell(B.origin + vec2i(gid.xy));
  let q = cell.xy;
  let c = cell.z;
  if (c < 0) { return; }
  let d = strokeDistance(q, B.radius);
  if (d > B.radius) { return; }
  switch B.kind {
    case 0u: {
      slime[c] = 0u;
      amount[c] = 0u;
    }
    case 1u: {
      slime[c] = 0u;
      amount[c] = 0u;
    }
    case 6u: {
      if (inArena(q) && !isWall(env[c])) {
        amount[c] = max(amountLeft(amount[c], slime[c]), paintedAmount(d));
        // No front reached painted slime (ADR 0060): a cell that had no slime loses its front stamp.
        if (!hasSlime(slime[c])) { front[c] = 0u; }
        slime[c] = P.grid.w + 1u;
      }
    }
    default: {}
  }
}
