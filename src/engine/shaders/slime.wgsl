// The slime field (ADR 0055), for the extended model while the life time of the slime is above 0. Prepended with
// common.wgsl.
//
// `slime` holds the stamp of every cell: the number of the step in which the cell last held plasm, plus 1, and 0 for a
// cell without a stamp (slime.ts). One field for all strains.
//
// `stamp` runs once per step, after its diffusion. A cell holds plasm when the trail of at least one strain of the
// settings is at or above the low level of that strain (P.slimeLow, flow.ts trailLevels()). Such a cell gets the stamp
// of the step. Every other cell keeps what it holds: the pass writes nothing there.
//
// A wall and a cell outside the arena never get a stamp. The pass has no test of its own for them: the diffusion of
// the step leaves no trail there in the extended model (diffuse.wgsl SINK), the only model with slime, and every low
// level is above 0.
//
// The same pass keeps the amount of slime of the cell (ADR 0057, amount.wgsl), for the picture alone. A cell that
// holds plasm starts from what is left of its amount (amountLeft()): nothing on ground without slime, and what the
// picture showed where the plasm comes back to slime. Then it gains 1 of FULL, as long as the amount is below the
// level of the plasm. So the slime gets thick where a tube stays, a tube that stays for 4,095 steps leaves the full
// amount, and the slime is never thicker than the plasm was.

@group(0) @binding(1) var trail: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> slime: array<u32>;
@group(0) @binding(3) var<storage, read_write> amount: array<u32>;

const SPAN = 4.0; // low levels of trail above the low level at which the plasm is full (slime.ts PLASM_SPAN)

// Whether a cell with the trail t holds plasm.
fn holdsPlasm(t: vec4f) -> bool {
  for (var s = 0u; s < P.cfg.y; s++) {
    if (t[s] >= P.slimeLow[s]) { return true; }
  }
  return false;
}

// The level of the plasm of a cell with the trail t, 0 to FULL: for the strain with the most, the share of its trail
// between its low level and its full level, the share that the tube body follows (flow.wgsl). Rounded to the nearest.
fn plasmLevel(t: vec4f) -> u32 {
  var level = 0.0;
  for (var k = 0u; k < P.cfg.y; k++) { level = max(level, (t[k] - P.slimeLow[k]) / (SPAN * P.slimeLow[k])); }
  return u32(clamp(level, 0.0, 1.0) * f32(FULL) + 0.5);
}

@compute @workgroup_size(8, 8)
fn stamp(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= W() || gid.y >= H()) { return; }
  let t = textureLoad(trail, gid.xy, 0);
  if (!holdsPlasm(t)) { return; }
  let c = gid.y * W() + gid.x;
  let a = amountLeft(amount[c], slime[c]);
  amount[c] = max(a, min(plasmLevel(t), a + 1u));
  slime[c] = P.grid.w + 1u;
}
