// The slime field (ADR 0055); mirrors ../../shaders/slime.wgsl. One fragment per cell. gl/programs.ts compiles the
// file once per PASS, with amount.glsl before it for the second.
//
// PASS 0, into the target of the stamps (R32UI): the number of the step in which the cell last held plasm, plus 1,
// and 0 for a cell without a stamp. A cell holds plasm when the trail of at least one strain of the settings, after
// the diffusion of the step, is at or above the low level of that strain (P.slimeLow). Such a cell gets the stamp of
// the step. The fragment of every other cell is discarded, so the cell keeps what it holds. A wall and a cell outside
// the arena never get a stamp: the diffusion of the step leaves no trail there in the extended model (diffuse.frag),
// and every low level is above 0.
//
// PASS 1, into the free target of the amounts (R16UI): the amount of slime of the cell after the step (ADR 0057), for
// the picture alone. It runs before PASS 0, so `stamps` holds the stamps of before the step. A cell that holds plasm
// starts from what is left of its amount (amountLeft()) and gains 1 of FULL, as long as the amount is below the level
// of the plasm. Every other cell keeps its amount: this backend reads the amounts from one target and writes all of
// them into the other, where slime.wgsl changes its buffer in place.

uniform sampler2D trail;
#if PASS == 1
uniform highp usampler2D stamps;  // the stamps before the step
uniform highp usampler2D amounts; // the amounts before the step
#endif

out uint result;

// Whether a cell with the trail t holds plasm.
bool holdsPlasm(vec4 t) {
  for (int s = 0; s < int(P.cfg.y); s++) {
    if (t[s] >= P.slimeLow[s]) return true;
  }
  return false;
}

#if PASS == 1
const float SPAN = 4.0; // low levels of trail above the low level at which the plasm is full (slime.ts PLASM_SPAN)

// The level of the plasm of a cell with the trail t, 0 to FULL (plasmLevel in slime.wgsl).
uint plasmLevel(vec4 t) {
  float level = 0.0;
  for (int s = 0; s < int(P.cfg.y); s++) level = max(level, (t[s] - P.slimeLow[s]) / (SPAN * P.slimeLow[s]));
  return uint(clamp(level, 0.0, 1.0) * float(FULL) + 0.5);
}
#endif

void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 t = texelFetch(trail, q, 0);
#if PASS == 0
  if (!holdsPlasm(t)) discard;
  result = P.grid.w + 1u;
#else
  uint old = texelFetch(amounts, q, 0).r;
  if (!holdsPlasm(t)) {
    result = old;
    return;
  }
  uint a = amountLeft(old, texelFetch(stamps, q, 0).r);
  result = max(a, min(plasmLevel(t), a + 1u));
#endif
}
