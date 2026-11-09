// Deposit + 3×3 mean diffusion + decay for trail and scent. Prepended with common.wgsl.
// One step runs `passes` dispatches: FIRST adds this step's deposits and food/light sources,
// LAST applies decay, BLUR = false is the zero-diffusion variant (Jones 2010, p. 132).

override FIRST: bool = true;
override LAST: bool = true;
override BLUR: bool = true;

@group(0) @binding(1) var trailIn: texture_2d<f32>;
@group(0) @binding(2) var scentIn: texture_2d<f32>;
@group(0) @binding(3) var trailOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var scentOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(5) var<storage, read> env: array<u32>;
@group(0) @binding(6) var<storage, read> counts: array<vec4u>;

const T = 16u;
const SIDE = 18u; // tile plus a one-cell halo
const N = 324u;

var<workgroup> tileTrail: array<vec4f, N>;
var<workgroup> tileScent: array<vec2f, N>;
var<workgroup> tileOpen: array<f32, N>; // 1 for habitable cells, 0 for walls and outside

@compute @workgroup_size(16, 16)
fn diffuse(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) lid: vec3u,
           @builtin(local_invocation_index) li: u32) {
  let origin = vec2i(wg.xy * T) - 1;
  for (var k = li; k < N; k += 256u) {
    let c = cellAt(origin + vec2i(i32(k % SIDE), i32(k / SIDE)));
    var t = vec4f(0.0);
    var s = vec2f(0.0);
    var open = 0.0;
    if (c >= 0 && !isWall(env[c])) {
      let q = cellCoord(u32(c));
      t = textureLoad(trailIn, q, 0);
      s = textureLoad(scentIn, q, 0).xy;
      if (FIRST) {
        t += vec4f(counts[c]) * P.deposit;
        let e = envOf(env[c]);
        s += vec2f(e.y * P.scent.x, e.z * P.scent.y);
        // Cut tool: the wound also loses its chemicals. This app's choice: Jones 2010 (Sec. 4.3,
        // p. 148) only removes the agents from the wound and places them elsewhere.
        if (P.tool.w == 2.0 && distance(vec2f(q) + 0.5, P.tool.xy) < P.tool.z) {
          t = vec4f(0.0);
          s = vec2f(0.0);
        }
      }
      open = 1.0;
    }
    tileTrail[k] = t;
    tileScent[k] = s;
    tileOpen[k] = open;
  }
  workgroupBarrier();

  let p = vec2i(wg.xy * T + lid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  let center = (lid.y + 1u) * SIDE + lid.x + 1u;
  var t = tileTrail[center];
  var s = tileScent[center];
  if (BLUR && tileOpen[center] > 0.0) {
    // Mean over habitable neighbours only: no flux into walls or out of the arena.
    var sum = vec4f(0.0);
    var ssum = vec2f(0.0);
    var n = 0.0;
    for (var dy = 0u; dy < 3u; dy++) {
      for (var dx = 0u; dx < 3u; dx++) {
        let k = (lid.y + dy) * SIDE + lid.x + dx;
        sum += tileTrail[k];
        ssum += tileScent[k];
        n += tileOpen[k];
      }
    }
    t = sum / n;
    s = ssum / n;
  }
  if (LAST) {
    t *= P.keep;
    s *= P.scent.z;
  }
  textureStore(trailOut, p, t);
  textureStore(scentOut, p, vec4f(s, 0.0, 0.0));
}
