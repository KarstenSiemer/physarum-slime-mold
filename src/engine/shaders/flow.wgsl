// Flow in the tubes (ADR 0029), for the extended model while the setting is on. Prepended with common.wgsl.
//
// Every strain is a plasmodium of its own, with a flow of its own (ADR 0031): sim.ts runs these passes once per strain,
// with the memory and the pressure of that strain. The passes read the trail of that strain alone (U.f.z), so no flux
// passes from the tubes of one strain into the tubes of another.
//
// The network: every open cell (inside the arena, no wall) is a node with a conductivity g, and two cells that share a
// side are joined by an edge whose conductance is the harmonic mean of their conductivities. A food site that the
// plasmodium covers gives or takes the flux I0 at its cell: the start of the food stroke, which is the centre of a
// food dot (flowSites() in flow.ts). The pressure p follows Kirchhoff's law (Tero, Kobayashi and Nakagaki 2007, Eq. 1
// to 3 and 6; several sources and sinks at once). Four pressure fields run side by side, one per lane of the
// textures: each has its own draw of which sites give and which take.
//
// `memory` holds per cell, for the strain of the pass: x the flow memory D (Tero's conductivity of a tube, 0.0001 to
// 1), y the tube body (the trail of the strain smoothed over time, 0 to 1), z the conductivity g, w the roles of a
// site's cell while the site gives or takes in at least one lane, else 0.
//
// A step runs `update` once and then `pressure` FLOW_ITERATIONS times:
// - `update`: the flux of every lane through the cell, from the pressure and the conductivities of the step before;
//   Tero's adaptation dD/dt = f(Q) − D with f(Q) = Q^gamma / (1 + Q^gamma) (2007, Eq. 5; 2010), as a mean over the
//   lanes; then the body from the trail, the new conductivity, and for a food site its roles.
// - `pressure`: one damped Jacobi iteration of Kirchhoff's law with the acceleration of a second-order Richardson
//   iteration (the pressure of the iteration before as momentum), from the pressure of the step before.
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
  f: vec4f, // the first site's cell x, y (referenceCell()), the strain of the pass, unused
  g: vec4f, // steps that a lane keeps its roles, pressure limit of a site, 1 / (the part of it where the flux falls)
  sites: array<vec4f, 64>, // cell x, cell y, unused, unused
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

// Whether a flux runs between foods: at least two food sites give or take (their roles are in the memory). Without it
// no cell adapts: the flow memory keeps its values, so no cell becomes a starved cell. The agents still follow the
// memory that they find (agents.wgsl starved()): on fresh ground one of 20,000 starves per step.
fn fed() -> bool {
  let n = i32(U.d.w);
  var found = 0;
  for (var i = 0; i < n; i++) {
    if (textureLoad(memory, vec2i(U.sites[i].xy), 0).w != 0.0) {
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

// Whether the plasmodium of the strain covers site i: its cell held food and a tube of the strain in the step before.
// Every cell reads the same memory, so all sites see the same covered sites.
fn covered(i: i32) -> bool {
  let s = vec2i(U.sites[i].xy);
  return envOf(env[s.y * i32(W()) + s.x]).y > 0.0 && textureLoad(memory, s, 0).y >= U.c.z;
}

// The roles of the food site whose cell is p, as a number whose digit k in base 3 is its role in lane k: 1
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
  for (var i = 0; i < n; i++) {
    cover[i] = covered(i);
    if (cover[i]) {
      count++;
      if (first < 0) { first = i; }
      if (all(vec2i(U.sites[i].xy) == p)) { mine = i; }
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

// The share of its flux that the site at this cell gives or takes, per lane: all of it while its pressure lies within
// the limit U.g.y of the mean pressure of the sites, on the side it pushes to, and none beyond. The mean of a lane
// runs over every site that gives or takes in at least one lane, also over a site that rests in this lane. So a
// site that no tube joins to the others stops, and its part of the network does not run away from the rest.
fn headroom(pc: vec4f, signs: vec4f) -> vec4f {
  let n = i32(U.d.w);
  var level = vec4f(0.0);
  var count = 0.0;
  for (var i = 0; i < n; i++) {
    let s = vec2i(U.sites[i].xy);
    if (textureLoad(memory, s, 0).w != 0.0) {
      level += textureLoad(pressureIn, s, 0);
      count += 1.0;
    }
  }
  if (count > 0.0) { level /= count; }
  return clamp((U.g.y - signs * (pc - level)) * U.g.z, vec4f(0.0), vec4f(1.0));
}

// The cell whose pressure the first two iterations of a step take off (RECENTRE): the cell of the first site that
// gives or takes, so a cell of the network. A site without a role can lie outside the network or under a wall, and a
// closed cell holds no pressure: with its pressure nothing would be taken off, and the field would move away from
// zero. Without a site that gives or takes, no flux runs: then the cell of the uniform block, the first site.
fn referenceCell() -> vec2i {
  let n = i32(U.d.w);
  for (var i = 0; i < n; i++) {
    let s = vec2i(U.sites[i].xy);
    if (textureLoad(memory, s, 0).w != 0.0) { return s; }
  }
  return vec2i(U.f.xy);
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
  flux *= 0.5;
  // f(Q) per lane and its mean. pow(0, gamma) is 0 by hand: not every GPU gives it.
  let qg = select(pow(flux, vec4f(U.a.y)), vec4f(0.0), flux <= vec4f(0.0));
  let f = qg / (1.0 + qg);
  let mean = (f.x + f.y + f.z + f.w) * 0.25;
  // A cell that held a tube adapts while a flux runs between foods (Tero 2007, Eq. 5). Ground without a tube has at
  // most the memory of fresh ground: a larger memory falls to it at once. A smaller one stays, so starved ground stays
  // marked; the mark fades slowly, up to the memory of fresh ground.
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
  // Only a cell with a tube conducts: food that the plasmodium does not cover is open ground, as any other. Else it
  // would hold a pressure of its own beside the network (ADR 0029, decision 6).
  let food = envOf(env[p.y * i32(W()) + p.x]).y > 0.0;
  var g = 0.0;
  if (body >= U.c.z) { g = body * select(U.b.x + d, U.b.y, food); }
  // The roles, if this cell is the cell of a food site that the plasmodium covers (roleCode()).
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
  let sum = ee + ew + es + en;
  let pc = textureLoad(pressureIn, p, 0);
  var before = textureLoad(pressureBefore, p, 0);
  var next = pc;
  if (sum > 0.0) {
    var acc = vec4f(0.0);
    if (ee > 0.0) { acc += ee * textureLoad(pressureIn, qe, 0); }
    if (ew > 0.0) { acc += ew * textureLoad(pressureIn, qw, 0); }
    if (es > 0.0) { acc += es * textureLoad(pressureIn, qs, 0); }
    if (en > 0.0) { acc += en * textureLoad(pressureIn, qn, 0); }
    // Kirchhoff's law of the cell, with the flux that a site gives or takes.
    var given = vec4f(0.0);
    if (m.w != 0.0) {
      let signs = roleSigns(m.w);
      given = signs * U.a.x * headroom(pc, signs);
    }
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
