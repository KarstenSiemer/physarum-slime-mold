// The amount of slime of a cell (ADR 0057), for slime.frag and slime-paint.frag, after common.glsl. Mirrors
// ../../shaders/amount.wgsl.
//
// The amounts are whole numbers from 0 to FULL in a target of unsigned integers (R16UI): how thick the slime is that
// the plasm built in a cell. Only the picture reads them.

const uint FULL = 4095u; // slime.ts SLIME_FULL

// What is left of the amount `a` of a cell that holds the stamp `held`, as the picture shows it before the step or
// the stroke that comes (amountLeft in amount.wgsl): nothing without slime, all of it for slime of the age 0 or 1,
// and else the share 1 − age / life time, rounded down.
uint amountLeft(uint a, uint held) {
  uint age = P.grid.w + 1u - held;
  if (held == 0u || age >= P.slime.x) return 0u;
  if (age <= 1u) return a;
  return a * (P.slime.x - age) / P.slime.x;
}
