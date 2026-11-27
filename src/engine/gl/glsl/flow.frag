// Flow in the tubes (ADR 0029), after common.glsl. Mirrors ../../shaders/flow.wgsl, where the model is described:
// PASS 0 is `update` (the memory of each cell), PASS 1 is `pressure` (one iteration of the pressure of the four lanes).
// The port of every site and strain takes three passes (`blocks` and `sites` in flow.wgsl): PASS 2 is `blocks`, a texel
// per block of the list of cells and strain; PASS 3 looks at the blocks of a site, a texel per site, strain and lane
// of 64; PASS 4 takes the least of the lanes, a texel per site and strain. PASS 5, only with the rules of stage 4, is
// what the sensors read of the flow of a strain (`takes` in flow.wgsl, ADR 0075).

// The flow takes the sinks of its strain while the rules of stage 4 run (ADR 0070; `//#if TERRITORY` in
// ../../shaders/flow.wgsl): programs.ts compiles the update and the pressure with it, and gl/sim.ts uses them only
// then. Without it the source is the one of the code before.
#ifndef TERRITORY
#define TERRITORY 0
#endif
// The flow over 8 neighbours (ADR 0086; `//#if EIGHT` in ../../shaders/flow.wgsl): programs.ts compiles the update and
// the pressure with it, and gl/sim.ts uses them only then.
#ifndef EIGHT
#define EIGHT 0
#endif
layout(std140) uniform Flow {
  vec4 a; // I0, gamma, rate, recover
  vec4 b; // base, food conductivity, ghost conductivity, omega
  vec4 c; // weight, body rate, body low, fresh memory
  vec4 d; // memory floor, trail low, 1 / (trail full − trail low), site count
  vec4 e; // death, half², birth, birth from (tools.glsl, agents.frag)
  vec4 f; // reference cell x, y, the strain of the pass, blocks of `cells`
  vec4 g; // steps that a lane keeps its roles, pressure limit of a site, 1 / (the part of it where the flux falls)
  vec4 sites[64]; // its first cell x, y; its cells in `cells`: from z, w of them (sites.ts FlowSites)
#if TERRITORY
  // The constants of the rules of stage 4 after the sites (territory.ts packTerritory()): the chances of the push, the
  // constants of the sinks (sinks.frag), and in x of `take` what the sinks of a strain take together, in units of I0.
  vec4 push[2];
  vec4 sinks;
  vec4 take;
#endif
} U;

uniform sampler2D env;
uniform sampler2D memory; // x flow memory, y tube body, z conductivity, w roles of a site that gives or takes
#if PASS == 0
uniform sampler2D pressureIn;
uniform sampler2D trail;
#elif PASS == 1
uniform sampler2D pressureIn;
uniform sampler2D pressureBefore;
// 1 and 2: the first two iterations of a step take the pressure of the reference cell off (RECENTRE in flow.wgsl).
uniform int recentre;
#elif PASS == 5
// The pressure of the strain as the flow of the step before left it.
uniform sampler2D pressureIn;
#else
// The cells of every site, as indices y · W + x, W per row of the texture, and −1 for no cell (siteCells in
// flow.wgsl).
uniform sampler2D cells;
// Per block of `cells` and strain (blockHits in flow.wgsl): x the first entry of the block that covers its site,
// counted in the block, or −1. Block b of strain s is texel (b % W, s · hitRows + b / W).
uniform sampler2D hits;
uniform int hitRows;
#endif
#if PASS == 2
// The memory of strains B, C and D (`memory` is that of strain A); a scene with fewer strains binds strain A in their
// place, and no texel reads it there.
uniform sampler2D memory1;
uniform sampler2D memory2;
uniform sampler2D memory3;
#elif PASS == 4
// The hit of each lane of PASS 3: texel (site, strain · 64 + lane), x the block, y the entry in it; −1 for none.
uniform sampler2D lanes;
// The ports of the step before (`ports` in flow.wgsl): texel (site, strain), x the port, y the port before it.
uniform sampler2D portsIn;
#endif
#if PASS < 2
// The ports of this step: texel (site, strain), x the port of the site, y its port in the step before; −1 for none.
uniform sampler2D ports;
#endif
#if TERRITORY && (PASS < 2 || PASS == 5)
// The state of the sinks of every strain (sinks.frag PASS 3), texel (k, strain): the update reads the copy of the step
// before, the pressure the copy of this step. PASS 5 reads the copy that the flow of the step before wrote.
uniform sampler2D state;
#endif
#if TERRITORY && (PASS == 1 || PASS == 5)
// The sink rates of the strain of this step (sinks.frag PASS 0), with a minus sign for a sink; for PASS 5 those of
// the step before.
uniform sampler2D rates;
#endif

#if PASS == 5
// Lane s of two targets, which gl/sim.ts masks to the lane of the strain of the pass.
layout(location = 0) out vec4 result;
layout(location = 1) out vec4 share;
#else
out vec4 result;
#endif

#if PASS < 2
// The port of site i for the strain of the pass in this step, or −1 (port in flow.wgsl).
int port(int i) { return int(texelFetch(ports, ivec2(i, int(U.f.z)), 0).x); }
#endif

// The cell at c as coordinates inside the grid if it is open: inside the arena and no wall. Else (−1, −1).
ivec2 openXY(ivec2 c) {
  ivec2 q = cellXY(c);
  if (q.x < 0) return q;
  if (isWall(texelFetch(env, q, 0))) return ivec2(-1);
  return q;
}

// The conductance of an edge: two half cells in series, the harmonic mean. 0 if one cell does not conduct.
float edge(float a, float b) {
  if (a <= 0.0 || b <= 0.0) return 0.0;
  return 2.0 * a * b / (a + b);
}
#if EIGHT && PASS < 2

// The weights of an axis edge and of a diagonal edge over 8 neighbours (AXIS and DIAG in flow.wgsl, ADR 0086). U.g.w is
// 1 then: no pass reads it, the CPU copy does.
const float AXIS = 0.414213568; // √2 − 1
const float DIAG = 0.292893231; // 1 − 1/√2

// The diagonal neighbour of the cell p at p + o, as openXY() gives it, if the two cells beside the edge, a and b, are
// open too (diagonalXY in flow.wgsl); else (−1, −1).
ivec2 diagonalXY(ivec2 p, ivec2 o, ivec2 a, ivec2 b) {
  if (a.x < 0 || b.x < 0) return ivec2(-1);
  return openXY(p + o);
}
#endif
#if TERRITORY && (PASS == 1 || PASS == 5)

// What the sinks of strain s take together while its front takes flux (frontTotal in flow.wgsl): S for each covered
// port, at least one (ADR 0100).
float frontTotal(int s) { return U.take.x * U.a.x * max(1.0, texelFetch(state, ivec2(0, s), 0).w); }

// What the sink of the tube cell p takes while the front of the strain takes flux (taken in flow.wgsl, ADR 0070).
float taken(ivec2 p) {
  int s = int(U.f.z);
  float total = frontTotal(s);
  uint steps = uint(abs(texelFetch(rates, p, 0).r) * 16777216.0);
  float r = float((steps + 128u) >> 8u) * (1.0 / 65536.0);
  return total * r / texelFetch(state, ivec2(0, s), 0).x;
}
#endif

#if PASS == 0
// The conductivity of the cell at q (openXY), 0 for none.
float conductivity(ivec2 q) {
  if (q.x < 0) return 0.0;
  return texelFetch(memory, q, 0).z;
}
#if EIGHT

// The size of the flux per lane over the diagonal edge from the cell whose conductivity is g and whose pressure is pc to
// the cell q (diagonalXY()), without its weight; 0 without the edge (diagonalFlux in flow.wgsl).
vec4 diagonalFlux(float g, vec4 pc, ivec2 q) {
  float e = edge(g, conductivity(q));
  if (e <= 0.0) return vec4(0.0);
  return abs(e * (pc - texelFetch(pressureIn, q, 0)));
}
#endif

// Whether the plasmodium covers site i: a cell of the site held food and a tube in the step before (covered in
// flow.wgsl).
bool covered(int i) { return port(i) >= 0; }

// The roles of the food site whose port is p, as a number whose digit k in base 3 is its role in lane k: 1
// gives, 2 takes, 0 neither (roleCode in flow.wgsl; flowRoles() in ../../flow.ts has the rule and the reasons).
float roleCode(ivec2 p) {
  int n = int(U.d.w);
  bool cover[64];
  int count = 0;
  int first = -1;
  int mine = -1;
  int c = p.y * int(W()) + p.x;
  for (int i = 0; i < 64; i++) {
    cover[i] = i < n && covered(i);
    if (cover[i]) {
      count++;
      if (first < 0) first = i;
      if (port(i) == c) mine = i;
    }
  }
  if (mine < 0 || count < 2) return 0.0;
  int pairs = count / 2;
  uint hold = uint(U.g.x);
  float code = 0.0;
  float unit = 1.0;
  for (uint k = 0u; k < 4u; k++) {
    float digit = 0.0;
    if (count == 2) {
      digit = mine == first ? 1.0 : 2.0;
    } else {
      uint epoch = (P.grid.w + k * hold / 4u) / hold;
      uint salt = pcg(epoch ^ pcg((k + 1u) ^ pcg(P.cfg.x ^ 0x1abu)));
      uint h = pcg(uint(mine) ^ salt);
      int rank = 0;
      for (int j = 0; j < 64; j++) {
        if (!cover[j] || j == mine) continue;
        uint other = pcg(uint(j) ^ salt);
        if (other < h || (other == h && j < mine)) rank++;
      }
      if (rank < pairs) digit = 1.0;
      else if (rank < 2 * pairs) digit = 2.0;
    }
    code += digit * unit;
    unit *= 3.0;
  }
  return code;
}

// Whether a flux runs between foods: at least two food sites gave or took in the step before, at their ports of that
// step (fed in flow.wgsl).
bool fed() {
#if TERRITORY
  // While the rules of stage 4 run, also while the front of the strain took flux in the step before (fed in flow.wgsl).
  if (texelFetch(state, ivec2(1, int(U.f.z)), 0).x != 0.0) return true;
#endif
  int found = 0;
  for (int i = 0; i < 64; i++) {
    int c = int(texelFetch(ports, ivec2(i, int(U.f.z)), 0).y);
    if (c >= 0 && texelFetch(memory, cellCoord(c), 0).w != 0.0) {
      found++;
      if (found == 2) return true;
    }
  }
  return false;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (openXY(p).x < 0) {
    result = vec4(U.c.w, 0.0, 0.0, 0.0);
    return;
  }
  vec4 m = texelFetch(memory, p, 0);
  ivec2 qe = openXY(p + ivec2(1, 0));
  ivec2 qw = openXY(p + ivec2(-1, 0));
  ivec2 qs = openXY(p + ivec2(0, 1));
  ivec2 qn = openXY(p + ivec2(0, -1));
  // The flux through the cell per lane: half the sum of the absolute fluxes over its edges.
  vec4 pc = texelFetch(pressureIn, p, 0);
  vec4 flux = vec4(0.0);
  float ge = edge(m.z, conductivity(qe));
  float gw = edge(m.z, conductivity(qw));
  float gs = edge(m.z, conductivity(qs));
  float gn = edge(m.z, conductivity(qn));
  if (ge > 0.0) flux += abs(ge * (pc - texelFetch(pressureIn, qe, 0)));
  if (gw > 0.0) flux += abs(gw * (pc - texelFetch(pressureIn, qw, 0)));
  if (gs > 0.0) flux += abs(gs * (pc - texelFetch(pressureIn, qs, 0)));
  if (gn > 0.0) flux += abs(gn * (pc - texelFetch(pressureIn, qn, 0)));
#if EIGHT
  // Over 8 edges (ADR 0086): the 4 axis edges with the weight AXIS, the 4 diagonal edges with DIAG (update in flow.wgsl).
  vec4 across = diagonalFlux(m.z, pc, diagonalXY(p, ivec2(1, 1), qe, qs))
    + diagonalFlux(m.z, pc, diagonalXY(p, ivec2(-1, -1), qw, qn))
    + diagonalFlux(m.z, pc, diagonalXY(p, ivec2(-1, 1), qw, qs))
    + diagonalFlux(m.z, pc, diagonalXY(p, ivec2(1, -1), qe, qn));
  flux = AXIS * flux + DIAG * across;
#endif
  flux *= 0.5;
  // f(Q) per lane and its mean. pow(0, gamma) is 0 by hand: GLSL leaves it undefined.
  vec4 qg = mix(pow(max(flux, vec4(1e-30)), vec4(U.a.y)), vec4(0.0), lessThanEqual(flux, vec4(0.0)));
  vec4 f = qg / (1.0 + qg);
  float mean = (f.x + f.y + f.z + f.w) * 0.25;
  // A cell that held a tube adapts while a flux runs between foods (Tero 2007, Eq. 5). Ground without a tube has at
  // most the memory of fresh ground; a smaller memory stays, and the mark fades slowly (update in flow.wgsl).
  float d = m.x;
  if (m.y >= U.c.z) {
    if (fed()) d = max(U.d.x, d + U.a.z * (mean - d));
  } else {
    d = min(U.c.w, max(d, U.d.x) * (1.0 + U.a.w));
  }
  // The tube body follows the plasmodium of the strain, which the trail of the strain shows (ADR 0031).
  float t = texelFetch(trail, p, 0)[int(U.f.z)];
  float presence = clamp((t - U.d.y) * U.d.z, 0.0, 1.0);
  float body = m.y + U.c.y * (presence - m.y);
  // A starved tube that vanishes leaves its ground at the floor of the memory (ADR 0054; update in flow.wgsl).
  if (m.y >= U.c.z && body < U.c.z && d * d < U.e.y) d = U.d.x;
  // Only a cell with a tube conducts: food that the plasmodium does not cover is open ground, as any other.
  bool food = texelFetch(env, p, 0).g > 0.0;
  float g = 0.0;
  if (body >= U.c.z) g = body * (food ? U.b.y : U.b.x + d);
  // The roles, if this cell is the port of a food site that the plasmodium covers (roleCode()).
  float code = 0.0;
  if (food && m.y >= U.c.z) code = roleCode(p);
  result = vec4(d, body, g, code);
}
#elif PASS == 1
// The edge for the pressure iteration: both cells with the ghost conductivity; 0 without a neighbour.
float ghostEdge(float a, ivec2 q) {
  if (q.x < 0) return 0.0;
  return edge(a + U.b.z, texelFetch(memory, q, 0).z + U.b.z);
}

// The roles of a site's cell as a sign per lane: +1 gives, −1 takes, 0 neither.
vec4 roleSigns(float code) {
  uint c = uint(code);
  uvec4 d = uvec4(c % 3u, (c / 3u) % 3u, (c / 9u) % 3u, (c / 27u) % 3u);
  return vec4(equal(d, uvec4(1u))) - vec4(equal(d, uvec4(2u)));
}

// The share of its flux that the site at this port gives or takes, per lane: all of it while its pressure lies within
// the limit U.g.y of the mean pressure of the sites that give or take in at least one lane, and none beyond (headroom
// in flow.wgsl).
vec4 headroom(vec4 pc, vec4 signs) {
  int n = int(U.d.w);
  vec4 level = vec4(0.0);
  float count = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    int c = port(i);
    if (c < 0) continue;
    ivec2 s = cellCoord(c);
    if (texelFetch(memory, s, 0).w != 0.0) {
      level += texelFetch(pressureIn, s, 0);
      count += 1.0;
    }
  }
  if (count > 0.0) level /= count;
  return clamp((U.g.y - signs * (pc - level)) * U.g.z, vec4(0.0), vec4(1.0));
}
#if TERRITORY

// What the sinks of the strain take and what its sources give at the cell p, whose conductivity is g, in this step
// (sinksAndSources in flow.wgsl, ADR 0070).
float sinksAndSources(ivec2 p, float g) {
  int s = int(U.f.z);
  if (texelFetch(state, ivec2(1, s), 0).x == 0.0) return 0.0;
  // R, C, N and the covered ports P.
  vec4 sums = texelFetch(state, ivec2(0, s), 0);
  float total = frontTotal(s);
  int c = p.y * W() + p.x;
  float q = 0.0;
  if (g > 0.0) {
    q -= taken(p);
    if (sums.w == 0.0) q += total / sums.y;
  }
  // Only a cell with food is the port of a site.
  if (sums.w > 0.0 && texelFetch(env, p, 0).g > 0.0) {
    int n = int(U.d.w);
    for (int i = 0; i < 64; i++) {
      if (i >= n) break;
      if (port(i) == c) q += total / sums.w;
    }
  }
  return q;
}
#endif

// The cell whose pressure the first two iterations of a step take off: the port of the first site that gives or
// takes, else the cell of the uniform block (referenceCell in flow.wgsl).
ivec2 referenceCell() {
  int n = int(U.d.w);
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    int c = port(i);
    if (c < 0) continue;
    ivec2 s = cellCoord(c);
    if (texelFetch(memory, s, 0).w != 0.0) return s;
  }
  return ivec2(U.f.xy);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (openXY(p).x < 0) {
    result = vec4(0.0);
    return;
  }
  vec4 m = texelFetch(memory, p, 0);
  ivec2 qe = openXY(p + ivec2(1, 0));
  ivec2 qw = openXY(p + ivec2(-1, 0));
  ivec2 qs = openXY(p + ivec2(0, 1));
  ivec2 qn = openXY(p + ivec2(0, -1));
  float ee = ghostEdge(m.z, qe);
  float ew = ghostEdge(m.z, qw);
  float es = ghostEdge(m.z, qs);
  float en = ghostEdge(m.z, qn);
#if EIGHT
  // Over 8 edges (ADR 0086): the axis edges with the weight AXIS, the diagonal edges with DIAG, each with the ghost
  // conductivity on both cells (pressure in flow.wgsl).
  ivec2 qse = diagonalXY(p, ivec2(1, 1), qe, qs);
  ivec2 qnw = diagonalXY(p, ivec2(-1, -1), qw, qn);
  ivec2 qsw = diagonalXY(p, ivec2(-1, 1), qw, qs);
  ivec2 qne = diagonalXY(p, ivec2(1, -1), qe, qn);
  float ese = ghostEdge(m.z, qse);
  float enw = ghostEdge(m.z, qnw);
  float esw = ghostEdge(m.z, qsw);
  float ene = ghostEdge(m.z, qne);
  float sum = AXIS * (ee + ew + es + en) + DIAG * (ese + enw + esw + ene);
#else
  float sum = ee + ew + es + en;
#endif
  vec4 pc = texelFetch(pressureIn, p, 0);
  vec4 before = texelFetch(pressureBefore, p, 0);
  vec4 next = pc;
  if (sum > 0.0) {
    vec4 acc = vec4(0.0);
    if (ee > 0.0) acc += ee * texelFetch(pressureIn, qe, 0);
    if (ew > 0.0) acc += ew * texelFetch(pressureIn, qw, 0);
    if (es > 0.0) acc += es * texelFetch(pressureIn, qs, 0);
    if (en > 0.0) acc += en * texelFetch(pressureIn, qn, 0);
#if EIGHT
    vec4 across = vec4(0.0);
    if (ese > 0.0) across += ese * texelFetch(pressureIn, qse, 0);
    if (enw > 0.0) across += enw * texelFetch(pressureIn, qnw, 0);
    if (esw > 0.0) across += esw * texelFetch(pressureIn, qsw, 0);
    if (ene > 0.0) across += ene * texelFetch(pressureIn, qne, 0);
    acc = AXIS * acc + DIAG * across;
#endif
    // Kirchhoff's law of the cell, with the flux that a site gives or takes.
    vec4 given = vec4(0.0);
    if (m.w != 0.0) {
      vec4 signs = roleSigns(m.w);
      given = signs * U.a.x * headroom(pc, signs);
    }
#if TERRITORY
    // The same in every lane: what the sinks take and the sources give (ADR 0070).
    given += vec4(sinksAndSources(p, m.z));
#endif
    vec4 balanced = (acc + given) / sum;
    vec4 jacobi = pc + U.c.x * (balanced - pc);
    if (recentre == 2) before -= texelFetch(pressureBefore, referenceCell(), 0);
    // Only a cell that conducts takes the momentum of the iteration (pressure in flow.wgsl).
    float omega = m.z > 0.0 ? U.b.w : 1.0;
    next = omega * jacobi + (1.0 - omega) * before;
  }
  if (recentre == 1) next -= texelFetch(pressureIn, referenceCell(), 0);
  result = next;
}
#elif PASS == 2
// The memory of strain s at cell q.
vec4 memoryOf(int s, ivec2 q) {
  if (s == 1) return texelFetch(memory1, q, 0);
  if (s == 2) return texelFetch(memory2, q, 0);
  if (s == 3) return texelFetch(memory3, q, 0);
  return texelFetch(memory, q, 0);
}

// The first entry of block b of the list of cells whose cell is open and holds food and a tube of strain s in the memory
// before the step, counted in the block, or −1 (blocks in flow.wgsl).
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  int w = W();
  int s = at.y / hitRows;
  int b = (at.y % hitRows) * w + at.x;
  float hit = -1.0;
  if (b < int(U.f.w)) {
    for (int o = 0; o < 64; o++) {
      int k = b * 64 + o;
      int c = int(texelFetch(cells, ivec2(k % w, k / w), 0).r);
      if (c < 0) break;
      ivec2 q = cellCoord(c);
      vec4 e = texelFetch(env, q, 0);
      if (!isWall(e) && e.g > 0.0 && memoryOf(s, q).y >= U.c.z) {
        hit = float(o);
        break;
      }
    }
  }
  result = vec4(hit, 0.0, 0.0, 0.0);
}
#elif PASS == 3
// Lane l of site i and strain s: every 64th block of the site from the block l on, up to the first block with a hit
// (sites in flow.wgsl). x the block, y the entry in it, or −1.
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  int i = at.x;
  int s = at.y / 64;
  int lane = at.y % 64;
  int w = W();
  vec4 found = vec4(-1.0, -1.0, 0.0, 0.0);
  if (i < int(U.d.w)) {
    int first = int(U.sites[i].z) / 64;
    int end = (int(U.sites[i].z) + int(U.sites[i].w) + 63) / 64;
    for (int b = first + lane; b < end; b += 64) {
      float hit = texelFetch(hits, ivec2(b % w, s * hitRows + b / w), 0).x;
      if (hit >= 0.0) {
        found = vec4(float(b), hit, 0.0, 0.0);
        break;
      }
    }
  }
  result = found;
}
#elif PASS == 5
// What the sensors of the strain read of its flow (agents.frag driftOf(), ADR 0075), from the flow of the step before:
// the mean pressure of the four lanes, and in `share` what the sink of the cell takes over its conductivity, 0 at a
// cell without a tube and while the front takes no flux (`takes` in flow.wgsl).
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 pr = texelFetch(pressureIn, p, 0);
  result = vec4((pr.x + pr.y + pr.z + pr.w) * 0.25);
  float g = texelFetch(memory, p, 0).z;
  float t = 0.0;
  if (g > 0.0 && texelFetch(state, ivec2(1, int(U.f.z)), 0).x != 0.0) t = taken(p) / g;
  share = vec4(t);
}
#else
// The port of site i (x of the texel) for strain s (y of the texel): the cell of the least entry of the lanes of
// PASS 3, else −1; the port of the step before moves to y (sites in flow.wgsl).
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  int least = -1;
  for (int lane = 0; lane < 64; lane++) {
    vec4 hit = texelFetch(lanes, ivec2(at.x, at.y * 64 + lane), 0);
    if (hit.x < 0.0) continue;
    int j = int(hit.x) * 64 + int(hit.y);
    if (least < 0 || j < least) least = j;
  }
  float found = -1.0;
  int w = W();
  if (least >= 0) found = texelFetch(cells, ivec2(least % w, least / w), 0).r;
  result = vec4(found, texelFetch(portsIn, at, 0).x, 0.0, 0.0);
}
#endif
