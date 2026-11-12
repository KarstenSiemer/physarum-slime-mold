// 3×3 mean diffusion + decay for trail and scent, and this step's deposits and food/light sources. Prepended with
// common.wgsl. The textures hold the map as the agents sense it, in either order of a step (ADR 0027):
// - Move first (Jones 2010, p. 133): every agent moves and deposits, then every agent senses, then the map diffuses.
//   The textures hold the map after the last diffusion with the deposits and sources of the last moves. A step's
//   agent pass senses it and moves; then its `passes` dispatches diffuse and decay it, and LAST adds the deposits and
//   sources of this step's moves, the map that the agents of the next step sense.
// - Sense first (P.model.w = 1; Jones 2011, p. 1350, his later papers, Fogleman): every agent senses, moves and
//   deposits, then the map diffuses. The textures hold the map after the diffusion, and FIRST adds the step's deposits
//   and sources before its mean.
// FIRST clears the wound of a cut in the extended model; BLUR = false is the zero-diffusion variant (Jones 2010,
// p. 132).

override FIRST: bool = true;
override LAST: bool = true;
override BLUR: bool = true;
// Covered food (Adamatzky and Jones 2010; ADR 0022): a food cell releases P.model.y of its scent while the
// 3 × 3 window around it holds an agent. sim.ts builds the pass that adds the sources with it only while the option is
// on (LAST moving first, FIRST sensing first), so the
// passes without it keep the trail and scent of the code before it, bit for bit (sim.gpu.test.ts).
override COVERED: bool = false;
// The order of a step (ADR 0027): sim.ts builds every pass for each order, from Settings.stepOrder as P.model.w is.
// A constant, not P.model.w: inside a branch on a uniform, Metal's compiler folds the mean and the decay of sensing
// first into one factor, and the code before ADR 0027 rounded them apart.
override SENSE_FIRST: bool = false;
// The view of a step that moves first (sim.ts `viewTextures`, ADR 0027): the step's diffusion and decay of the map
// that the textures hold, trail and scent, without its sources and its cut, into textures that the simulation does not
// read. The view then draws the map after the step's diffusion, as a scene that senses first draws it.
override VIEW: bool = false;

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

// What a cell of the tile is (ADR 0027): outside the arena and in a wall of the extended model it is a sink that holds
// no trail and scent; in the Jones model a wall is part of the lattice that diffuses, but takes no deposit or source.
const SINK = 0u;
const OPEN = 1u;
const WALL = 2u;

var<workgroup> tileTrail: array<vec4f, N>;
var<workgroup> tileScent: array<vec2f, N>;
var<workgroup> tileKind: array<u32, N>;

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

// True if a step senses first (SENSE_FIRST, ADR 0027): its deposits and sources enter the first pass before its mean,
// as before ADR 0027; moving first, the last pass adds them after the decay.
fn senseFirst() -> bool { return SENSE_FIRST; }

// This step's deposits and food and light at the habitable cell c (cell q), with covered food while it is on.
fn sources(c: i32, q: vec2i, t: ptr<function, vec4f>, s: ptr<function, vec2f>) {
  *t += vec4f(counts[c]) * P.deposit;
  let e = envOf(env[c]);
  if (COVERED) {
    let food = select(1.0, P.model.y, e.y > 0.0 && covered(q));
    *s += vec2f(e.y * P.scent.x * food, e.z * P.scent.y);
  } else {
    *s += vec2f(e.y * P.scent.x, e.z * P.scent.y);
  }
}

// Cut tool: in the extended model the wound also loses its chemicals, this app's choice. Jones 2010 (Sec. 4.3,
// p. 148) only removes the agents from the wound and places them elsewhere: the Jones model packs P.tool2.z = 1 and
// keeps them (pack.ts).
fn wound(q: vec2i) -> bool {
  return P.tool.w == 2.0 && P.tool2.z == 0.0 && toolDistance(vec2f(q) + 0.5, P.tool.xy) < P.tool.z;
}

// The kind of cell c (cellAt), SINK for −1. P.model.z is 1 where walls diffuse: in the Jones model (pack.ts).
fn kindOf(c: i32) -> u32 {
  if (c < 0) { return SINK; }
  if (!isWall(env[c])) { return OPEN; }
  return select(SINK, WALL, P.model.z > 0.0);
}

@compute @workgroup_size(16, 16)
fn diffuse(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) lid: vec3u,
           @builtin(local_invocation_index) li: u32) {
  let origin = vec2i(wg.xy * T) - 1;
  for (var k = li; k < N; k += 256u) {
    // The coordinates and the index of the cell from one wrap: cellCoord() of the index would divide.
    let q = cellXY(origin + vec2i(i32(k % SIDE), i32(k / SIDE)));
    let c = indexOf(q);
    let kind = kindOf(c);
    var t = vec4f(0.0);
    var s = vec2f(0.0);
    if (kind != SINK) {
      t = textureLoad(trailIn, q, 0);
      s = textureLoad(scentIn, q, 0).xy;
      if (!VIEW && FIRST && senseFirst() && kind == OPEN) { sources(c, q, &t, &s); }
      // The wound is cleared before the step's diffusion, so no chemical of it spreads out.
      if (!VIEW && FIRST && wound(q)) {
        t = vec4f(0.0);
        s = vec2f(0.0);
      }
    }
    tileTrail[k] = t;
    tileScent[k] = s;
    tileKind[k] = kind;
  }
  workgroupBarrier();

  let p = vec2i(wg.xy * T + lid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  let center = (lid.y + 1u) * SIDE + lid.x + 1u;
  let kind = tileKind[center];
  var t = tileTrail[center];
  var s = tileScent[center];
  if (BLUR) {
    // Jones' mean filter at every lattice site (ADR 0027): a sink counts as 0, so trail and scent that leave the
    // arena or enter a wall of the extended model are lost.
    var sum = vec4f(0.0);
    var ssum = vec2f(0.0);
    var n = 0.0;
    for (var dy = 0u; dy < 3u; dy++) {
      for (var dx = 0u; dx < 3u; dx++) {
        let k = (lid.y + dy) * SIDE + lid.x + dx;
        sum += tileTrail[k];
        ssum += tileScent[k];
        // 1 for every kind: a count of 9 that the compiler cannot fold (sensing first, below).
        n += select(0.0, 1.0, tileKind[k] <= WALL);
      }
    }
    // Moving first, the last pass takes the mean and the decay as one factor, (1 − decay) / 9: Metal's compiler turns
    // the mean, then × (1 − decay), into this product on WebGPU, so diffuse.frag writes it out and both backends round
    // alike (ADR 0027). Sensing first, the arithmetic of the code before ADR 0027, which ran that order: the mean over
    // a count read at run time, and the decay in a block of its own below, so a scene in that order keeps its bytes
    // where its edges and walls do not change it.
    if (senseFirst()) {
      // A branch at run time, as in the code before: else Metal folds the mean and the decay below into one factor.
      if (n > 0.0) {
        t = sum / n;
        s = ssum / n;
      }
    } else if (LAST) {
      t = sum * (P.keep / 9.0);
      s = ssum * (P.scent.z / 9.0);
    } else {
      t = sum / 9.0;
      s = ssum / 9.0;
    }
  } else if (LAST && !senseFirst()) {
    t *= P.keep;
    s *= P.scent.z;
  }
  if (LAST && senseFirst()) {
    t *= P.keep;
    s *= P.scent.z;
  }
  if (LAST) {
    // Moving first, this step's deposits and sources (Jones 2010, p. 133 and 144): after the moves, for the sensors of
    // the next step, and none in the wound of a cut that clears it.
    if (!VIEW && !senseFirst() && kind == OPEN && !wound(p)) { sources(p.y * i32(W()) + p.x, p, &t, &s); }
  }
  if (kind == SINK) {
    t = vec4f(0.0);
    s = vec2f(0.0);
  }
  textureStore(trailOut, p, t);
  textureStore(scentOut, p, vec4f(s, 0.0, 0.0));
}
