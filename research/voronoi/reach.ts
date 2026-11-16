// How far the field of a repellent reaches per decade of its strength (README.md, "Fig. 9"): the steady field of a
// source in Jones' update, map = (1 − damping) · mean(map + source), in float64 on a lattice without agents. It
// prints the distance at which the field falls to one fixed level, for strengths a factor of 10 apart. The paper's
// Fig. 9e moves its ring out by about 4 cells per decade.
// Usage: node --import ./research/flow/register.mjs research/voronoi/reach.ts
const N = 201;
const MID = (N - 1) / 2;

/** The steady field of 3 × 3 cells of 1 per step in the middle, with a mean over `side` × `side` cells. */
export function field(side: number, damping: number, steps = 600): Float64Array {
  const r = (side - 1) / 2;
  let map = new Float64Array(N * N);
  const rows = new Float64Array(N * N);
  for (let s = 0; s < steps; s++) {
    for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) map[(MID + v) * N + MID + u]! += 1;
    // The mean as two sums: along the rows, then along the columns. Cells outside count 0.
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let sum = 0;
        for (let u = Math.max(0, x - r); u <= Math.min(N - 1, x + r); u++) sum += map[y * N + u]!;
        rows[y * N + x] = sum;
      }
    const next = new Float64Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let sum = 0;
        for (let v = Math.max(0, y - r); v <= Math.min(N - 1, y + r); v++) sum += rows[v * N + x]!;
        next[y * N + x] = ((1 - damping) * sum) / (side * side);
      }
    map = next;
  }
  return map;
}

/** The distance from the middle, along a row, at which the field of a source of `strength` falls to `level`. */
export function reach(map: Float64Array, strength: number, level: number): number {
  for (let d = 0; d < MID; d++) {
    const [here, next] = [map[MID * N + MID + d]! * strength, map[MID * N + MID + d + 1]! * strength];
    if (here >= level && next < level) return d + Math.log(here / level) / Math.log(here / next);
  }
  return NaN;
}

/** The lines of README.md: the cells per decade for each mean and damping. */
export function reachReport(): string {
  const out: string[] = [];
  for (const [side, damping] of [
    [5, 0.1],
    [3, 0.1],
    [5, 0.25],
  ] as const) {
    const map = field(side, damping);
    const at = [1, 10, 100, 1000].map((s) => reach(map, s, 0.01));
    const steps = at.slice(1).map((v, i) => v - at[i]!);
    out.push(
      `mean ${String(side)} × ${String(side)}, damping ${String(damping)}: ${steps.map((v) => v.toFixed(1)).join(', ')} cells per decade`,
    );
  }
  return out.join('\n');
}

if (process.argv[1]?.endsWith('reach.ts')) console.log(reachReport());
