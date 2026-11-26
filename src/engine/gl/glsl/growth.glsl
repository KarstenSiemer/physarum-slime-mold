// Growth and shrinkage of the population (Jones 2011, Sec. 5.1; ADR 0025), after common.glsl, for the fragment
// passes (growth.frag) and the points (growth.vert). Mirrors ../../shaders/growth.wgsl.

// Agent bits of a parent that divides in this step (growth.frag PASS 2): GROWS, and the neighbour in bits 7 to 9.
const uint GROWS = 64u;
const uint DIR_SHIFT = 7u;
// Agent bits of the births that the flux pays in a growth step (ADR 0071): FRONT for an agent of the front (PASS 2),
// PAID with GROWS for a paid parent (PASS 5). PASS 4 clears them with the other bits of the step.
const uint FRONT = 1024u;
const uint PAID = 2048u;
// With the rules of stage 4 (ADR 0100): JONES with the neighbour in bits 7 to 9 for a parent of Jones' rule that waits
// for the budget (PASS 2), which PASS 6 turns into GROWS; CROWDED for an agent that shrinkage deletes (PASS 2); BORN for
// a child (PASS 4). paid.vert counts them.
const uint JONES = 32768u;
const uint CROWDED = 65536u;
const uint BORN = 131072u;
const uint DIRS = 7u << DIR_SHIFT;

// Random streams of their own, as in growth.wgsl.
const uint GROW = 4u;
const uint BIRTH = 5u;
const uint PLACE_ORDER = 6u;
const uint SHADE = 10u;
const uint PAID_KEY = 12u;
const uint PAY_JONES = 14u;

bool growthTest() { return P.growth.x > 0u && P.grid.w % P.growth.x == 0u; }
bool shrinkTest() { return P.shrinkage.x > 0u && P.grid.w % P.shrinkage.x == 0u; }

// Neighbour k of 8 around a cell, in rows from the top left; the cell itself is skipped (around in growth.wgsl).
ivec2 around(uint k) {
  int j = int(k) + (k >= 4u ? 1 : 0);
  return ivec2(j % 3 - 1, j / 3 - 1);
}

// The number k of the neighbour at offset o != (0, 0): around(k) is o (aroundIndex in growth.wgsl).
uint aroundIndex(ivec2 o) {
  uint j = uint((o.y + 1) * 3 + o.x + 1);
  return j - (j > 4u ? 1u : 0u);
}

// The position of cell c in the order of the births: a bijection of the cells, new for every step (place in
// growth.wgsl).
uint place(uint c) {
  uint w = uint(W());
  uint h = uint(H());
  uint x = c % w;
  uint y = c / w;
  uint k = pcg(P.grid.w ^ pcg(P.cfg.x ^ PLACE_ORDER));
  for (int r = 0; r < 2; r++) {
    x = (x + pcg(y ^ k) % w) % w;
    k = pcg(k);
    y = (y + pcg(x ^ k) % h) % h;
    k = pcg(k);
  }
  return y * w + x;
}
