// Log₂ histogram of the summed trail per cell, for auto exposure. Standalone module.
// Bin b holds values in [2^(b/2 − 10), 2^((b+1)/2 − 10)); empty cells are not counted.

const BINS = 64u;

@group(0) @binding(0) var trail: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>, BINS>;

var<workgroup> local: array<atomic<u32>, BINS>;

@compute @workgroup_size(16, 16)
fn histogram(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  if (all(gid.xy < textureDimensions(trail))) {
    let v = textureLoad(trail, gid.xy, 0);
    let t = v.x + v.y + v.z + v.w;
    if (t > 0.0) {
      atomicAdd(&local[u32(clamp((log2(t) + 10.0) * 2.0, 0.0, f32(BINS - 1u)))], 1u);
    }
  }
  workgroupBarrier();
  if (li < BINS) {
    let c = atomicLoad(&local[li]);
    if (c > 0u) { atomicAdd(&bins[li], c); }
  }
}
