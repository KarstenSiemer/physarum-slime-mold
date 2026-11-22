// Log₂ histogram of the summed trail per cell, for auto exposure. Standalone module.
// Bin b holds values in [2^(b/2 − 10), 2^((b+1)/2 − 10)); empty cells are not counted, but for `held`.

const BINS = 64u;

@group(0) @binding(0) var trail: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>, BINS>;
// `held`: the agents per cell, at y · width + x; `moved`: the agents that moved in, 4 strains per cell.
@group(0) @binding(2) var<storage, read> occ: array<u32>;

var<workgroup> local: array<atomic<u32>, BINS>;

// The bin of a summed trail above 0.
fn binOf(t: f32) -> u32 {
  return u32(clamp((log2(t) + 10.0) * 2.0, 0.0, f32(BINS - 1u)));
}

@compute @workgroup_size(16, 16)
fn histogram(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  if (all(gid.xy < textureDimensions(trail))) {
    let v = textureLoad(trail, gid.xy, 0);
    let t = v.x + v.y + v.z + v.w;
    if (t > 0.0) {
      atomicAdd(&local[binOf(t)], 1u);
    }
  }
  workgroupBarrier();
  if (li < BINS) {
    let c = atomicLoad(&local[li]);
    if (c > 0u) { atomicAdd(&bins[li], c); }
  }
}

// The same histogram over the cells for which `holds` is true. Here a cell without trail counts too, in bin 0: an
// agent holds it.
fn countHeld(gid: vec3u, li: u32, holds: bool) {
  if (holds) {
    let v = textureLoad(trail, gid.xy, 0);
    let t = v.x + v.y + v.z + v.w;
    if (t > 0.0) {
      atomicAdd(&local[binOf(t)], 1u);
    } else {
      atomicAdd(&local[0], 1u);
    }
  }
  workgroupBarrier();
  if (li < BINS) {
    let c = atomicLoad(&local[li]);
    if (c > 0u) { atomicAdd(&bins[li], c); }
  }
}

// Over the cells that hold an agent, with one agent per cell: the black level stays below the plasm (ADR 0062), and
// the white level above it (ADR 0090; exposure.ts levels()).
@compute @workgroup_size(16, 16)
fn held(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  let size = textureDimensions(trail);
  countHeld(gid, li, all(gid.xy < size) && occ[gid.y * size.x + gid.x] != 0u);
}

// Over the cells that an agent moved into in the step, while agents share cells: `occ` holds the counts of the four
// strains of each cell (agents.wgsl `counts`). The white level stays above their trail (ADR 0090).
@compute @workgroup_size(16, 16)
fn moved(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  let size = textureDimensions(trail);
  let i = (gid.y * size.x + gid.x) * 4u;
  countHeld(gid, li, all(gid.xy < size) && occ[i] + occ[i + 1u] + occ[i + 2u] + occ[i + 3u] != 0u);
}
