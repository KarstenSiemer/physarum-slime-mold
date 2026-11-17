// The slime field (ADR 0055); mirrors ../../shaders/slime.wgsl. One fragment per cell, into the target of the stamps
// (R32UI): the number of the step in which the cell last held plasm, plus 1, and 0 for a cell without a stamp.
//
// A cell holds plasm when the trail of at least one strain of the settings, after the diffusion of the step, is at or
// above the low level of that strain (P.slimeLow). Such a cell gets the stamp of the step. The fragment of every other
// cell is discarded, so the cell keeps what it holds. A wall and a cell outside the arena never get a stamp: the
// diffusion of the step leaves no trail there in the extended model (diffuse.frag), and every low level is above 0.

uniform sampler2D trail;

out uint result;

// Whether a cell with the trail t holds plasm.
bool holdsPlasm(vec4 t) {
  for (int s = 0; s < int(P.cfg.y); s++) {
    if (t[s] >= P.slimeLow[s]) return true;
  }
  return false;
}

void main() {
  if (!holdsPlasm(texelFetch(trail, ivec2(gl_FragCoord.xy), 0))) discard;
  result = P.grid.w + 1u;
}
