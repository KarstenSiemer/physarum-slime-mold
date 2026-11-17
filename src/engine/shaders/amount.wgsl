// The amount of slime of a cell (ADR 0057), for slime.wgsl and slime-paint.wgsl, after common.wgsl. gl/glsl/amount.glsl
// mirrors it, and slime-reference.ts has the same rules on the CPU.
//
// `amount` holds one whole number per cell, 0 to FULL: how thick the slime is that the plasm built there. Only the
// picture reads it. The picture shows the amount of a cell times the strength of the age of its stamp, so slime gets
// thinner in a straight line until its life time is over (render.wgsl `filmCell`).

const FULL = 4095u; // slime.ts SLIME_FULL

// What is left of the amount `a` of a cell that holds the stamp `held`, as the picture shows it before the step or
// the stroke that comes: nothing without slime (no stamp, or an age at or above the life time), all of it for slime
// of the age 0 or 1, and else the share 1 − age / life time, rounded down. The age is `P.grid.w + 1u − held`, as in
// slime.wgsl. An amount of FULL times a life time of 240 hours (432,000 steps) fits 32 bits.
fn amountLeft(a: u32, held: u32) -> u32 {
  let age = P.grid.w + 1u - held;
  if (held == 0u || age >= P.slime.x) { return 0u; }
  if (age <= 1u) { return a; }
  return a * (P.slime.x - age) / P.slime.x;
}

// Whether a cell that holds the stamp `held` has slime before the step or the stroke that comes: it has a stamp, and
// the age of the stamp is below the life time. The front field reads this (ADR 0059, slime.wgsl).
fn hasSlime(held: u32) -> bool {
  return held != 0u && P.grid.w + 1u - held < P.slime.x;
}
