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

@group(0) @binding(1) var trail: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> slime: array<u32>;

// Whether a cell with the trail t holds plasm.
fn holdsPlasm(t: vec4f) -> bool {
  for (var s = 0u; s < P.cfg.y; s++) {
    if (t[s] >= P.slimeLow[s]) { return true; }
  }
  return false;
}

@compute @workgroup_size(8, 8)
fn stamp(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= W() || gid.y >= H()) { return; }
  if (holdsPlasm(textureLoad(trail, gid.xy, 0))) { slime[gid.y * W() + gid.x] = P.grid.w + 1u; }
}
