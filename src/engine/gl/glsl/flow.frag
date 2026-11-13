// Flow in the tubes (ADR 0029), after common.glsl. Mirrors ../../shaders/flow.wgsl, where the model is described:
// PASS 0 is `update` (the memory of each cell), PASS 1 is `pressure` (one iteration of the pressure of the four lanes).

layout(std140) uniform Flow {
  vec4 a; // I0, gamma, rate, recover
  vec4 b; // base, food conductivity, ghost conductivity, omega
  vec4 c; // weight, body rate, body low, fresh memory
  vec4 d; // memory floor, trail low, 1 / (trail full − trail low), site count
  vec4 e; // death, half², birth, birth from (tools.glsl, agents.frag)
  vec4 f; // reference cell x, y, unused, unused
  vec4 g; // steps that a lane keeps its roles, pressure limit of a site, 1 / (the part of it where the flux falls)
  vec4 sites[64]; // cell x, cell y, unused, unused
} U;

uniform sampler2D env;
uniform sampler2D memory; // x flow memory, y tube body, z conductivity, w roles of a site that gives or takes
uniform sampler2D pressureIn;
#if PASS == 0
uniform sampler2D trail;
#else
uniform sampler2D pressureBefore;
// 1 and 2: the first two iterations of a step take the pressure of the reference cell off (RECENTRE in flow.wgsl).
uniform int recentre;
#endif

out vec4 result;

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

#if PASS == 0
// The conductivity of the cell at q (openXY), 0 for none.
float conductivity(ivec2 q) {
  if (q.x < 0) return 0.0;
  return texelFetch(memory, q, 0).z;
}

// Whether the plasmodium covers site i: its cell held food and a tube in the step before (covered in flow.wgsl).
bool covered(int i) {
  ivec2 s = ivec2(U.sites[i].xy);
  return texelFetch(env, s, 0).g > 0.0 && texelFetch(memory, s, 0).y >= U.c.z;
}

// The roles of the food site whose cell is p, as a number whose digit k in base 3 is its role in lane k: 1
// gives, 2 takes, 0 neither (roleCode in flow.wgsl; flowRoles() in ../../flow.ts has the rule and the reasons).
float roleCode(ivec2 p) {
  int n = int(U.d.w);
  bool cover[64];
  int count = 0;
  int first = -1;
  int mine = -1;
  for (int i = 0; i < 64; i++) {
    cover[i] = i < n && covered(i);
    if (cover[i]) {
      count++;
      if (first < 0) first = i;
      if (ivec2(U.sites[i].xy) == p) mine = i;
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

// Whether a flux runs between foods: at least two food sites give or take (fed in flow.wgsl).
bool fed() {
  int n = int(U.d.w);
  int found = 0;
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    if (texelFetch(memory, ivec2(U.sites[i].xy), 0).w != 0.0) {
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
  // The tube body follows the plasmodium, which the trail of all strains shows.
  vec4 t = texelFetch(trail, p, 0);
  float presence = clamp((t.x + t.y + t.z + t.w - U.d.y) * U.d.z, 0.0, 1.0);
  float body = m.y + U.c.y * (presence - m.y);
  // Only a cell with a tube conducts: food that the plasmodium does not cover is open ground, as any other.
  bool food = texelFetch(env, p, 0).g > 0.0;
  float g = 0.0;
  if (body >= U.c.z) g = body * (food ? U.b.y : U.b.x + d);
  // The roles, if this cell is the cell of a food site that the plasmodium covers (roleCode()).
  float code = 0.0;
  if (food && m.y >= U.c.z) code = roleCode(p);
  result = vec4(d, body, g, code);
}
#else
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

// The share of its flux that the site at this cell gives or takes, per lane: all of it while its pressure lies within
// the limit U.g.y of the mean pressure of the sites that give or take in at least one lane, and none beyond (headroom
// in flow.wgsl).
vec4 headroom(vec4 pc, vec4 signs) {
  int n = int(U.d.w);
  vec4 level = vec4(0.0);
  float count = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    ivec2 s = ivec2(U.sites[i].xy);
    if (texelFetch(memory, s, 0).w != 0.0) {
      level += texelFetch(pressureIn, s, 0);
      count += 1.0;
    }
  }
  if (count > 0.0) level /= count;
  return clamp((U.g.y - signs * (pc - level)) * U.g.z, vec4(0.0), vec4(1.0));
}

// The cell whose pressure the first two iterations of a step take off: the cell of the first site that gives or
// takes, else the cell of the uniform block (referenceCell in flow.wgsl).
ivec2 referenceCell() {
  int n = int(U.d.w);
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    ivec2 s = ivec2(U.sites[i].xy);
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
  float sum = ee + ew + es + en;
  vec4 pc = texelFetch(pressureIn, p, 0);
  vec4 before = texelFetch(pressureBefore, p, 0);
  vec4 next = pc;
  if (sum > 0.0) {
    vec4 acc = vec4(0.0);
    if (ee > 0.0) acc += ee * texelFetch(pressureIn, qe, 0);
    if (ew > 0.0) acc += ew * texelFetch(pressureIn, qw, 0);
    if (es > 0.0) acc += es * texelFetch(pressureIn, qs, 0);
    if (en > 0.0) acc += en * texelFetch(pressureIn, qn, 0);
    // Kirchhoff's law of the cell, with the flux that a site gives or takes.
    vec4 given = vec4(0.0);
    if (m.w != 0.0) {
      vec4 signs = roleSigns(m.w);
      given = signs * U.a.x * headroom(pc, signs);
    }
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
#endif
