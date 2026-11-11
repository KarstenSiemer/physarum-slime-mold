// 3×3 mean diffusion + decay for trail and scent, then this step's deposits and food/light sources. Prepended with
// common.wgsl. Jones' order of a step (Jones 2010, p. 132–133; ADR 0027): every agent moves and deposits, then every
// agent senses, then the map diffuses. The textures hold the map as the agents sense it: the map after the last
// diffusion with the deposits and sources of the last moves. A step's agent pass senses it and moves; then its
// `passes` dispatches diffuse and decay it, and LAST adds the deposits and sources of this step's moves, the map that
// the agents of the next step sense. FIRST clears the wound of a cut in the extended model; BLUR = false is the
// zero-diffusion variant (Jones 2010, p. 132).

override FIRST: bool = true;
override LAST: bool = true;
override BLUR: bool = true;
// Covered food (Adamatzky and Jones 2010; ADR 0022): a food cell releases P.model.y of its scent while the
// 3 × 3 window around it holds an agent. sim.ts builds the LAST pass with it only while the option is on, so the
// passes without it keep the trail and scent of the code before it, bit for bit (sim.gpu.test.ts).
override COVERED: bool = false;

@group(0) @binding(1) var trailIn: texture_2d<f32>;
@group(0) @binding(2) var scentIn: texture_2d<f32>;
@group(0) @binding(3) var trailOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var scentOut: texture_storage_2d<rg32float, write>;
@group(0) @binding(5) var<storage, read> env: array<u32>;
@group(0) @binding(6) var<storage, read> counts: array<vec4u>;
@group(0) @binding(7) var<storage, read> occ: array<u32>; // agents per cell after this step's moves (COVERED)

const T = 16u;
const SIDE = 18u; // tile plus a one-cell halo
const N = 324u;

var<workgroup> tileTrail: array<vec4f, N>;
var<workgroup> tileScent: array<vec2f, N>;
var<workgroup> tileOpen: array<f32, N>; // 1 for habitable cells, 0 for walls and outside

// True if the 3 × 3 window around cell q holds an agent. Cells outside a closed arena hold none.
fn covered(q: vec2i) -> bool {
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let c = cellAt(q + vec2i(dx, dy));
      if (c >= 0 && occ[c] > 0u) { return true; }
    }
  }
  return false;
}

// Cut tool: in the extended model the wound also loses its chemicals, this app's choice. Jones 2010 (Sec. 4.3,
// p. 148) only removes the agents from the wound and places them elsewhere: the Jones model packs P.tool2.z = 1 and
// keeps them (pack.ts).
fn wound(q: vec2i) -> bool {
  return P.tool.w == 2.0 && P.tool2.z == 0.0 && toolDistance(vec2f(q) + 0.5, P.tool.xy) < P.tool.z;
}

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
      // The wound is cleared before the step's diffusion, so no chemical of it spreads out.
      if (FIRST && wound(q)) {
        t = vec4f(0.0);
        s = vec2f(0.0);
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
    // This step's deposits and sources (Jones 2010, p. 133 and 144): after the moves, for the sensors of the next
    // step, and none in the wound of a cut that clears it.
    if (tileOpen[center] > 0.0 && !wound(p)) {
      let c = p.y * i32(W()) + p.x;
      t += vec4f(counts[c]) * P.deposit;
      let e = envOf(env[c]);
      if (COVERED) {
        let food = select(1.0, P.model.y, e.y > 0.0 && covered(p));
        s += vec2f(e.y * P.scent.x * food, e.z * P.scent.y);
      } else {
        s += vec2f(e.y * P.scent.x, e.z * P.scent.y);
      }
    }
  }
  textureStore(trailOut, p, t);
  textureStore(scentOut, p, vec4f(s, 0.0, 0.0));
}
