// Flow in the tubes (ADR 0029), for the extended model while the setting is on. Prepended with common.wgsl.
//
// Every strain is a plasmodium of its own, with a flow of its own (ADR 0031): sim.ts runs these passes once per strain,
// with the memory and the pressure of that strain. The passes read the trail of that strain alone (U.f.z), so no flux
// passes from the tubes of one strain into the tubes of another.
//
// The network: every open cell (inside the arena, no wall) is a node with a conductivity g, and two cells that share a
// side are joined by an edge whose conductance is the harmonic mean of their conductivities. With the flow over 8
// neighbours (`//#if EIGHT`, ADR 0086) two cells that share a corner are joined too, where both cells beside the corner
// are open, and every edge has a weight (AXIS, DIAG). A food site is one
// painted food stroke, with the cells that it paints (ADR 0029, decision 17; sites.ts). A site that the plasmodium of
// the strain covers gives or takes the flux I0 at its port: the covered cell nearest the centre of the stroke, which
// the pass `sites` finds in every step. The pressure p follows Kirchhoff's law (Tero, Kobayashi and Nakagaki 2007,
// Eq. 1 to 3 and 6; several sources and sinks at once). Four pressure fields run side by side, one per lane of the
// textures: each has its own draw of which sites give and which take.
//
// `memory` holds per cell, for the strain of the pass: x the flow memory D (Tero's conductivity of a tube, 0.0001 to
// 1), y the tube body (the trail of the strain smoothed over time, 0 to 1), z the conductivity g, w the roles of a
// site at its port while the site gives or takes in at least one lane, else 0.
//
// A step runs `blocks` and `sites` once for all strains, then for each strain `update` once and `pressure`
// FLOW_ITERATIONS times:
// - `blocks` and `sites`: for every site and strain its port, from the memory and the food of the step before.
// - `update`: the flux of every lane through the cell, from the pressure and the conductivities of the step before;
//   Tero's adaptation dD/dt = f(Q) − D with f(Q) = Q^gamma / (1 + Q^gamma) (2007, Eq. 5; 2010), as a mean over the
//   lanes; then the body from the trail, the new conductivity, and for a food site its roles.
// - `pressure`: one damped Jacobi iteration of Kirchhoff's law with the acceleration of a second-order Richardson
//   iteration (the pressure of the iteration before as momentum), from the pressure of the step before.
// - `takes`, only with the rules of stage 4: what the sink of each cell takes over its conductivity, for the sensors of
//   the next step (ADR 0075). sim.ts runs it at the start of that step, once per strain.
//
// The pressure stays bounded (ADR 0029, decision 6): only cells with a tube conduct, as many covered sites give as take
// in every lane, a site gives or takes nothing against a pressure beyond its limit, and only cells that conduct take
// the momentum of the iteration.

struct Flow {
  a: vec4f, // I0, gamma, rate, recover
  b: vec4f, // base, food conductivity, ghost conductivity, omega
  c: vec4f, // weight, body rate, body low, fresh memory
  d: vec4f, // memory floor, trail low, 1 / (trail full − trail low), site count
  e: vec4f, // death, half², birth, birth from (agents.wgsl)
  f: vec4f, // the first cell of the first site x, y (referenceCell()), the strain of the pass, blocks of `siteCells`
  g: vec4f, // steps that a lane keeps its roles, pressure limit of a site, 1 / (the part of it where the flux falls)
  sites: array<vec4f, 64>, // its first cell x, y; its cells in `siteCells`: from z, w of them (sites.ts FlowSites)
//#if TERRITORY
  // The constants of the rules of stage 4 after the sites (territory.ts packTerritory()): the chances of the push, the
  // constants of the sinks (sinks.wgsl), and in x of `take` what the sinks of a strain take together, in units of I0
  // (sinks.ts packSinks()).
  push: array<vec4f, 2>,
  sinks: vec4f,
  take: vec4f,
//#endif
}

// Kirchhoff's law fixes a pressure field only up to a constant, and the field moves as a whole when the sites do not
// sum to zero: by rounding, or while a site at its pressure limit gives less than the others take. So that it stays
// near zero, the first two iterations of a step take the pressure of the reference cell off: iteration 1 off its
// result (RECENTRE = 1), and iteration 2 off the pressure before, its momentum (RECENTRE = 2). Both take the same
// value off, the pressure of that cell at the start of the step, so no pressure difference changes.
override RECENTRE: u32 = 0u;

@group(0) @binding(1) var<uniform> U: Flow;
@group(0) @binding(2) var trail: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> env: array<u32>;
@group(0) @binding(4) var memory: texture_2d<f32>;
@group(0) @binding(5) var memoryOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(6) var pressureIn: texture_2d<f32>;
@group(0) @binding(7) var pressureBefore: texture_2d<f32>;
@group(0) @binding(8) var pressureOut: texture_storage_2d<rgba32float, write>;
// The cells of every site, as indices y · W + x, the run of each site sorted by the distance to its centre. A run starts
// at a multiple of SITE_BLOCK and ends with NO_CELL up to the next one, so no block of SITE_BLOCK entries holds the
// cells of two sites (sites.ts FlowSites).
@group(0) @binding(9) var<storage, read> siteCells: array<u32>;
// Per strain and site (64 per strain): x the port of the site in this step, y its port in the step before; −1 for
// none. `sites` writes them; `update` and `pressure` read them.
@group(0) @binding(10) var<storage, read_write> ports: array<vec2i>;
// Every layer of the memory before the step, for `blocks`.
@group(0) @binding(11) var memories: texture_2d_array<f32>;
// Per strain and block of `siteCells` (U.f.w blocks per strain): the first entry of the block whose cell covers its
// site, counted in the block, or −1. `blocks` writes it, `sites` reads it.
@group(0) @binding(12) var<storage, read_write> blockHits: array<i32>;
//#if TERRITORY

// The flow takes the sinks of its strain while the rules of stage 4 run (ADR 0070; ADR 0065, decision 1; ADR 0067,
// decisions 3 and 6). The lines between `//#if TERRITORY` and `//#endif` are part of the source only then (variant.ts);
// without them the source is the one of the code before, character for character. sinks.wgsl writes both buffers
// after `update` of the strain and before its `pressure`: `update` reads the state of the step before, `pressure` the
// rates and the state of this step.
@group(0) @binding(13) var<storage, read> rates: array<f32>; // per strain and cell: strain · W · H + cell
@group(0) @binding(14) var<storage, read> states: array<vec4f>; // per strain 2 (sinks.ts SINK_STATE_LANES)
// What the sink of each cell takes over the conductivity of the cell, for the sensors (`takes`, ADR 0075): the layer of
// the strain of the pass.
@group(0) @binding(15) var takeOut: texture_storage_2d<r32float, write>;
//#endif

const SITE_BLOCK = 64u;
const NO_CELL = 0xffffffffu;

// The cell at c as coordinates inside the grid if it is open: inside the arena and no wall. Else (−1, −1).
fn openXY(c: vec2i) -> vec2i {
  let q = cellXY(c);
  if (q.x < 0) { return q; }
  if (isWall(env[q.y * i32(W()) + q.x])) { return vec2i(-1); }
  return q;
}

// The conductivity of the cell at q (openXY), 0 for none.
fn conductivity(q: vec2i) -> f32 {
  if (q.x < 0) { return 0.0; }
  return textureLoad(memory, q, 0).z;
}

// The conductance of an edge: two half cells in series, the harmonic mean. 0 if one cell does not conduct.
fn edge(a: f32, b: f32) -> f32 {
  if (a <= 0.0 || b <= 0.0) { return 0.0; }
  return 2.0 * a * b / (a + b);
}

// The edge for the pressure iteration: both cells with the ghost conductivity; 0 without a neighbour.
fn ghostEdge(a: f32, q: vec2i) -> f32 {
  if (q.x < 0) { return 0.0; }
  return edge(a + U.b.z, textureLoad(memory, q, 0).z + U.b.z);
}
//#if EIGHT

// The flow over 8 neighbours (ADR 0086, the form of ADR 0081). The lines between `//#if EIGHT` and `//#endif` are part
// of the source only with it (variant.ts); without them the source is the one of the code before, character for
// character. An axis edge conducts AXIS times the harmonic mean of its two cells, a diagonal edge DIAG times: their
// ratio 1/√2 lets a broad flow read the same flux at 0° and 45°, and a vein of one cell conduct the same along an axis
// and along a diagonal; AXIS + 2 · DIAG = 1 keeps the conductance of a uniform sheet (flow.ts FLOW_EIGHT). U.g.w is 1
// then: no pass reads it, the CPU copy does (flow.ts packFlow()).
const AXIS = 0.414213568; // √2 − 1
const DIAG = 0.292893231; // 1 − 1/√2

// The diagonal neighbour of the cell p at p + o, as openXY() gives it, if the two cells beside the edge are open too: a
// at (p.x + o.x, p.y) and b at (p.x, p.y + o.y), as openXY() gave them. Else (−1, −1): a diagonal edge passes no corner
// of a wall.
fn diagonalXY(p: vec2i, o: vec2i, a: vec2i, b: vec2i) -> vec2i {
  if (a.x < 0 || b.x < 0) { return vec2i(-1); }
  return openXY(p + o);
}

// The size of the flux per lane over the diagonal edge from the cell whose conductivity is g and whose pressure is pc to
// the cell q (diagonalXY()), without its weight; 0 without the edge.
fn diagonalFlux(g: f32, pc: vec4f, q: vec2i) -> vec4f {
  let e = edge(g, conductivity(q));
  if (e <= 0.0) { return vec4f(0.0); }
  return abs(e * (pc - textureLoad(pressureIn, q, 0)));
}
//#endif

// The port of site i for the strain of the pass in this step, or −1: the first cell of its list that held food and a
// tube of the strain in the step before (`sites`).
fn port(i: i32) -> i32 {
  return ports[i32(U.f.z) * 64 + i].x;
}

// Whether a flux runs between foods: at least two food sites gave or took in the step before (their roles are in the
// memory at their ports of that step). Without it no cell adapts: the flow memory keeps its values, so no cell becomes
// a starved cell. The agents still follow the memory that they find (agents.wgsl starved()): on fresh ground one of
// 20,000 starves per step.
fn fed() -> bool {
//#if TERRITORY
  // While the rules of stage 4 run, also while the front of the strain took flux in the step before (ADR 0067,
  // decision 6): the state of the strain still holds it, since sinks.wgsl `state` runs after this pass.
  if (states[u32(U.f.z) * 2u + 1u].x != 0.0) { return true; }
//#endif
  var found = 0;
  for (var i = 0; i < 64; i++) {
    let c = ports[i32(U.f.z) * 64 + i].y;
    if (c >= 0 && textureLoad(memory, cellCoord(u32(c)), 0).w != 0.0) {
      found++;
      if (found == 2) { return true; }
    }
  }
  return false;
}

// The roles of a site's cell as a sign per lane: +1 gives, −1 takes, 0 neither.
fn roleSigns(code: f32) -> vec4f {
  let c = u32(code);
  let d = vec4u(c % 3u, (c / 3u) % 3u, (c / 9u) % 3u, (c / 27u) % 3u);
  return vec4f(d == vec4u(1u)) - vec4f(d == vec4u(2u));
}

// Whether the plasmodium of the strain covers site i: a cell of the site held food and a tube of the strain in the
// step before. Every cell reads the same ports, so all cells see the same covered sites.
fn covered(i: i32) -> bool {
  return port(i) >= 0;
}

// The roles of the food site whose port is p, as a number whose digit k in base 3 is its role in lane k: 1
// gives, 2 takes, 0 neither (flowRoles() in flow.ts has the rule and the reasons). Only covered sites get a role, and
// only two or more of them. Two sites: the first gives and the other takes. More: a hash orders the covered sites
// anew every U.g.x steps, each lane at another time; the first half gives, the second half takes, and with an odd
// count the last one does neither.
fn roleCode(p: vec2i) -> f32 {
  let n = i32(U.d.w);
  var cover: array<bool, 64>;
  var count = 0;
  var first = -1;
  var mine = -1;
  let c = p.y * i32(W()) + p.x;
  for (var i = 0; i < n; i++) {
    cover[i] = covered(i);
    if (cover[i]) {
      count++;
      if (first < 0) { first = i; }
      if (port(i) == c) { mine = i; }
    }
  }
  if (mine < 0 || count < 2) { return 0.0; }
  let pairs = count / 2;
  let hold = u32(U.g.x);
  var code = 0.0;
  var unit = 1.0;
  for (var k = 0u; k < 4u; k++) {
    var digit = 0.0;
    if (count == 2) {
      digit = select(2.0, 1.0, mine == first);
    } else {
      let epoch = (P.grid.w + k * hold / 4u) / hold;
      let salt = pcg(epoch ^ pcg((k + 1u) ^ pcg(P.cfg.x ^ 0x1abu)));
      let h = pcg(u32(mine) ^ salt);
      var rank = 0;
      for (var j = 0; j < n; j++) {
        if (!cover[j] || j == mine) { continue; }
        let other = pcg(u32(j) ^ salt);
        if (other < h || (other == h && j < mine)) { rank++; }
      }
      if (rank < pairs) { digit = 1.0; } else if (rank < 2 * pairs) { digit = 2.0; }
    }
    code += digit * unit;
    unit *= 3.0;
  }
  return code;
}

// The share of its flux that the site at this port gives or takes, per lane: all of it while its pressure lies within
// the limit U.g.y of the mean pressure of the sites, on the side it pushes to, and none beyond. The mean of a lane
// runs over every site that gives or takes in at least one lane, also over a site that rests in this lane. So a
// site that no tube joins to the others stops, and its part of the network does not run away from the rest.
fn headroom(pc: vec4f, signs: vec4f) -> vec4f {
  let n = i32(U.d.w);
  var level = vec4f(0.0);
  var count = 0.0;
  for (var i = 0; i < n; i++) {
    let c = port(i);
    if (c < 0) { continue; }
    let s = cellCoord(u32(c));
    if (textureLoad(memory, s, 0).w != 0.0) {
      level += textureLoad(pressureIn, s, 0);
      count += 1.0;
    }
  }
  if (count > 0.0) { level /= count; }
  return clamp((U.g.y - signs * (pc - level)) * U.g.z, vec4f(0.0), vec4f(1.0));
}
//#if TERRITORY

// What the sink of the tube cell c takes in this step while the front of the strain takes flux (ADR 0070): the share
// S · r / R of S = U.take.x · I0, with its rate r as R counted it, in steps of 2^-16 rounded to the nearest (ADR 0067,
// decision 3), and R from the state.
fn taken(c: i32) -> f32 {
  let s = u32(U.f.z);
  let total = U.take.x * U.a.x;
  let steps = u32(abs(rates[s * W() * H() + u32(c)]) * 16777216.0);
  let r = f32((steps + 128u) >> 8u) * (1.0 / 65536.0);
  return total * r / states[s * 2u].x;
}

// What the sinks of the strain take and what its sources give at the cell p, whose conductivity is g, in this step
// (ADR 0070): nothing while its front takes no flux (sinks.wgsl `state`). Else the sinks take S together, each tube
// cell its share (taken()). The covered ports give S in equal shares, and without one every tube cell gives S / C, C
// the tube cells. So the sources give what the sinks take, up to the rounding of the floats.
fn sinksAndSources(p: vec2i, g: f32) -> f32 {
  let s = u32(U.f.z);
  if (states[s * 2u + 1u].x == 0.0) { return 0.0; }
  // R, C, N and the covered ports P.
  let sums = states[s * 2u];
  let total = U.take.x * U.a.x;
  let c = p.y * i32(W()) + p.x;
  var q = 0.0;
  if (g > 0.0) {
    q -= taken(c);
    if (sums.w == 0.0) { q += total / sums.y; }
  }
  // Only a cell with food is the port of a site.
  if (sums.w > 0.0 && envOf(env[c]).y > 0.0) {
    for (var i = 0; i < i32(U.d.w); i++) {
      if (port(i) == c) { q += total / sums.w; }
    }
  }
  return q;
}
//#endif

// The cell whose pressure the first two iterations of a step take off (RECENTRE): the port of the first site that
// gives or takes, so a cell of the network. A cell of a site without a role can lie outside the network or under a
// wall, and a closed cell holds no pressure: with its pressure nothing would be taken off, and the field would move
// away from zero. Without a site that gives or takes, no flux runs: then the cell of the uniform block, the first cell
// of the first site.
fn referenceCell() -> vec2i {
  let n = i32(U.d.w);
  for (var i = 0; i < n; i++) {
    let c = port(i);
    if (c < 0) { continue; }
    let s = cellCoord(u32(c));
    if (textureLoad(memory, s, 0).w != 0.0) { return s; }
  }
  return vec2i(U.f.xy);
}

// The port of every site for every strain (ADR 0029, decision 17) is the first entry of the site's list whose cell is
// open and holds food and a tube of the strain in the memory before the step, so the covered cell nearest the centre
// of the stroke; −1 if the strain covers no cell of the site. Food painted over a wall stays under it: such a cell is
// closed, holds no tube after a step, and takes no role in `update`. Both passes run with the block of the first
// strain: every strain has the same sites and the same level of the tube body. One invocation alone would look at the
// cells of a large site that no tube covers one after the other, in every step; so the list is cut into blocks.
//
// `blocks`: one invocation per block of SITE_BLOCK entries and strain, the strain in gid.y. It finds the first entry of
// the block that covers its site.
@compute @workgroup_size(64)
fn blocks(@builtin(global_invocation_id) gid: vec3u) {
  let b = gid.x;
  let n = u32(U.f.w);
  if (b >= n) { return; }
  var hit = -1;
  for (var o = 0u; o < SITE_BLOCK; o++) {
    let c = siteCells[b * SITE_BLOCK + o];
    if (c == NO_CELL) { break; }
    let e = env[c];
    if (!isWall(e) && envOf(e).y > 0.0 && textureLoad(memories, cellCoord(c), gid.y, 0).y >= U.c.z) {
      hit = i32(o);
      break;
    }
  }
  blockHits[gid.y * n + b] = hit;
}

// The first entry of the site of the workgroup that covers it: its index in the list, or NO_CELL.
var<workgroup> least: atomic<u32>;

// `sites`: one workgroup of 64 invocations per site and strain, the site in the workgroup's x and the strain in its y.
// Each invocation looks at every 64th block of the site, from its own, up to the first block with a hit; the least
// entry of these hits is the port. The port of the step before moves to y: `fed` reads the roles there.
@compute @workgroup_size(64)
fn sites(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) { atomicStore(&least, NO_CELL); }
  workgroupBarrier();
  let i = wg.x;
  let n = u32(U.f.w);
  if (i < u32(U.d.w)) {
    let first = u32(U.sites[i].z) / SITE_BLOCK;
    let end = (u32(U.sites[i].z) + u32(U.sites[i].w) + SITE_BLOCK - 1u) / SITE_BLOCK;
    for (var b = first + lane; b < end; b += 64u) {
      let hit = blockHits[wg.y * n + b];
      if (hit >= 0) {
        atomicMin(&least, b * SITE_BLOCK + u32(hit));
        break;
      }
    }
  }
  workgroupBarrier();
  if (lane == 0u) {
    let k = wg.y * 64u + i;
    let j = atomicLoad(&least);
    var found = -1;
    if (j != NO_CELL) { found = i32(siteCells[j]); }
    ports[k] = vec2i(found, ports[k].x);
  }
}

@compute @workgroup_size(8, 8)
fn update(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  if (openXY(p).x < 0) {
    textureStore(memoryOut, p, vec4f(U.c.w, 0.0, 0.0, 0.0));
    return;
  }
  let m = textureLoad(memory, p, 0);
  let qe = openXY(p + vec2i(1, 0));
  let qw = openXY(p + vec2i(-1, 0));
  let qs = openXY(p + vec2i(0, 1));
  let qn = openXY(p + vec2i(0, -1));
  // The flux through the cell per lane: half the sum of the absolute fluxes over its edges.
  let pc = textureLoad(pressureIn, p, 0);
  var flux = vec4f(0.0);
  let ge = edge(m.z, conductivity(qe));
  let gw = edge(m.z, conductivity(qw));
  let gs = edge(m.z, conductivity(qs));
  let gn = edge(m.z, conductivity(qn));
  if (ge > 0.0) { flux += abs(ge * (pc - textureLoad(pressureIn, qe, 0))); }
  if (gw > 0.0) { flux += abs(gw * (pc - textureLoad(pressureIn, qw, 0))); }
  if (gs > 0.0) { flux += abs(gs * (pc - textureLoad(pressureIn, qs, 0))); }
  if (gn > 0.0) { flux += abs(gn * (pc - textureLoad(pressureIn, qn, 0))); }
//#if EIGHT
  // Over 8 edges (ADR 0086): the 4 axis edges with the weight AXIS, the 4 diagonal edges with DIAG.
  let across = diagonalFlux(m.z, pc, diagonalXY(p, vec2i(1, 1), qe, qs))
    + diagonalFlux(m.z, pc, diagonalXY(p, vec2i(-1, -1), qw, qn))
    + diagonalFlux(m.z, pc, diagonalXY(p, vec2i(-1, 1), qw, qs))
    + diagonalFlux(m.z, pc, diagonalXY(p, vec2i(1, -1), qe, qn));
  flux = AXIS * flux + DIAG * across;
//#endif
  flux *= 0.5;
  // f(Q) per lane and its mean. pow(0, gamma) is 0 by hand: not every GPU gives it.
  let qg = select(pow(flux, vec4f(U.a.y)), vec4f(0.0), flux <= vec4f(0.0));
  let f = qg / (1.0 + qg);
  let mean = (f.x + f.y + f.z + f.w) * 0.25;
  // A cell that held a tube adapts while a flux runs between foods (Tero 2007, Eq. 5). Ground without a tube has at
  // most the memory of fresh ground: a larger memory falls to it at once. A smaller one stays, so starved ground stays
  // marked; the mark fades slowly, up to the memory of fresh ground. A starved tube that vanishes leaves its ground at
  // the floor of the memory (below, ADR 0054), so every such cell holds the same mark for the same time.
  var d = m.x;
  if (m.y >= U.c.z) {
    if (fed()) { d = max(U.d.x, d + U.a.z * (mean - d)); }
  } else {
    d = min(U.c.w, max(d, U.d.x) * (1.0 + U.a.w));
  }
  // The tube body follows the plasmodium of the strain, which the trail of the strain shows (ADR 0031).
  let t = textureLoad(trail, p, 0)[u32(U.f.z)];
  let presence = clamp((t - U.d.y) * U.d.z, 0.0, 1.0);
  let body = m.y + U.c.y * (presence - m.y);
  if (m.y >= U.c.z && body < U.c.z && d * d < U.e.y) { d = U.d.x; }
  // Only a cell with a tube conducts: food that the plasmodium does not cover is open ground, as any other. Else it
  // would hold a pressure of its own beside the network (ADR 0029, decision 6).
  let food = envOf(env[p.y * i32(W()) + p.x]).y > 0.0;
  var g = 0.0;
  if (body >= U.c.z) { g = body * select(U.b.x + d, U.b.y, food); }
  // The roles, if this cell is the port of a food site that the plasmodium covers (roleCode()).
  var code = 0.0;
  if (food && m.y >= U.c.z) { code = roleCode(p); }
  textureStore(memoryOut, p, vec4f(d, body, g, code));
}

@compute @workgroup_size(8, 8)
fn pressure(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  if (openXY(p).x < 0) {
    textureStore(pressureOut, p, vec4f(0.0));
    return;
  }
  let m = textureLoad(memory, p, 0);
  let qe = openXY(p + vec2i(1, 0));
  let qw = openXY(p + vec2i(-1, 0));
  let qs = openXY(p + vec2i(0, 1));
  let qn = openXY(p + vec2i(0, -1));
  let ee = ghostEdge(m.z, qe);
  let ew = ghostEdge(m.z, qw);
  let es = ghostEdge(m.z, qs);
  let en = ghostEdge(m.z, qn);
//#if EIGHT
  // Over 8 edges (ADR 0086): the 4 axis edges with the weight AXIS, the 4 diagonal edges with DIAG, each with the ghost
  // conductivity on both cells. A diagonal edge needs both cells beside it open, so their axis edges conduct: `sum` is
  // above 0 exactly where it is with 4 edges.
  let qse = diagonalXY(p, vec2i(1, 1), qe, qs);
  let qnw = diagonalXY(p, vec2i(-1, -1), qw, qn);
  let qsw = diagonalXY(p, vec2i(-1, 1), qw, qs);
  let qne = diagonalXY(p, vec2i(1, -1), qe, qn);
  let ese = ghostEdge(m.z, qse);
  let enw = ghostEdge(m.z, qnw);
  let esw = ghostEdge(m.z, qsw);
  let ene = ghostEdge(m.z, qne);
  let sum = AXIS * (ee + ew + es + en) + DIAG * (ese + enw + esw + ene);
//#else
  let sum = ee + ew + es + en;
//#endif
  let pc = textureLoad(pressureIn, p, 0);
  var before = textureLoad(pressureBefore, p, 0);
  var next = pc;
  if (sum > 0.0) {
    var acc = vec4f(0.0);
    if (ee > 0.0) { acc += ee * textureLoad(pressureIn, qe, 0); }
    if (ew > 0.0) { acc += ew * textureLoad(pressureIn, qw, 0); }
    if (es > 0.0) { acc += es * textureLoad(pressureIn, qs, 0); }
    if (en > 0.0) { acc += en * textureLoad(pressureIn, qn, 0); }
//#if EIGHT
    var across = vec4f(0.0);
    if (ese > 0.0) { across += ese * textureLoad(pressureIn, qse, 0); }
    if (enw > 0.0) { across += enw * textureLoad(pressureIn, qnw, 0); }
    if (esw > 0.0) { across += esw * textureLoad(pressureIn, qsw, 0); }
    if (ene > 0.0) { across += ene * textureLoad(pressureIn, qne, 0); }
    acc = AXIS * acc + DIAG * across;
//#endif
    // Kirchhoff's law of the cell, with the flux that a site gives or takes.
    var given = vec4f(0.0);
    if (m.w != 0.0) {
      let signs = roleSigns(m.w);
      given = signs * U.a.x * headroom(pc, signs);
    }
//#if TERRITORY
    // The same in every lane: what the sinks take and the sources give (ADR 0070).
    given += vec4f(sinksAndSources(p, m.z));
//#endif
    let balanced = (acc + given) / sum;
    let jacobi = pc + U.c.x * (balanced - pc);
    if (RECENTRE == 2u) { before -= textureLoad(pressureBefore, referenceCell(), 0); }
    // Only a cell that conducts takes the momentum of the iteration. With the momentum a pressure swings for hundreds
    // of iterations. A cell without a tube would swing by itself beside the network; when the trail gives it a tube, its
    // swing would pass into the network and come back larger at the next such cell (ADR 0029, decision 6).
    let omega = select(1.0, U.b.w, m.z > 0.0);
    next = omega * jacobi + (1.0 - omega) * before;
  }
  if (RECENTRE == 1u) { next -= textureLoad(pressureIn, referenceCell(), 0); }
  textureStore(pressureOut, p, next);
}
//#if TERRITORY

// `takes`: what the sink of each cell takes over the conductivity G of the cell, take / G, for the sensors of the agent
// passes (agents.wgsl driftOf(), ADR 0075): 0 at a cell without a tube of the strain and while its front takes no
// flux. sim.ts runs it at the start of a step, before the agent passes, with the memory, the rates and the state as the
// flow of the step before left them: so it gives what that flow took.
@compute @workgroup_size(8, 8)
fn takes(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (p.x >= i32(W()) || p.y >= i32(H())) { return; }
  let g = textureLoad(memory, p, 0).z;
  var t = 0.0;
  if (g > 0.0 && states[u32(U.f.z) * 2u + 1u].x != 0.0) { t = taken(p.y * i32(W()) + p.x) / g; }
  textureStore(takeOut, p, vec4f(t, 0.0, 0.0, 0.0));
}
//#endif
