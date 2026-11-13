// The flux of the app's local solver against an exact solution of Kirchhoff's law, on a dump of the real engine
// (dump.gpu.test.ts with VITE_DUMP_P=1: memory, pressure, environment). ADR 0029, decision 6, has the table.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/exact-flux.ts <name> <w> <h> <i0> <step>...
// Environment variables: BOUNDARY (dish, box or wrap; dish), LANES (the pressure fields, as a list; 0), ITS (the most
// iterations; 60000).
//
// The exact pressure solves the same system as the passes: every open cell with its conductivity plus the ghost
// conductivity, edges as harmonic means, and the flux of the sites by their roles. The solver is the method of
// conjugate gradients with the diagonal as preconditioner, from the pressure of the local solver, to a residual of
// 10⁻⁸ of the right-hand side. A site at its pressure limit (flow.wgsl headroom) gives less than I0 in the app; this
// script gives every site its full I0.
import { readFileSync } from 'node:fs';
import { FLOW } from '../../../src/engine/flow.ts';
import { outDir } from '../prototype/out.ts';

const DIR = process.env.DIR ?? outDir('engine/');
const [name = '', w, h, i0] = [
  process.argv[2],
  Number(process.argv[3]),
  Number(process.argv[4]),
  Number(process.argv[5]),
];
const boundary = process.env.BOUNDARY ?? 'dish';
const GHOST = FLOW.ghost;
const f32 = (file: string) =>
  new Float32Array(new Uint8Array(Buffer.from(readFileSync(DIR + file, 'utf8'), 'base64')).buffer);
const env = new Uint8Array(Buffer.from(readFileSync(`${DIR}${name}-env.u8.b64`, 'utf8'), 'base64'));
const n = w * h;
const R = 0.945 * 0.5 * Math.min(w, h);
const open = new Uint8Array(n);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const inside = boundary !== 'dish' || Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= R;
    open[y * w + x] = inside && env[(y * w + x) * 4]! < 128 ? 1 : 0;
  }
const edge = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));
for (const step of process.argv.slice(6).map(Number)) {
  const m = f32(`${name}-memory-${step}.f32.b64`);
  const p = f32(`${name}-pressure-${step}.f32.b64`);
  // Edge conductances to the east and to the south of each cell, with the ghost conductivity (as the passes).
  const ge = new Float64Array(n);
  const gs = new Float64Array(n);
  const diag = new Float64Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (!open[c]) continue;
      if (x + 1 < w && open[c + 1]) ge[c] = edge(m[c * 4 + 2]! + GHOST, m[(c + 1) * 4 + 2]! + GHOST);
      if (y + 1 < h && open[c + w]) gs[c] = edge(m[c * 4 + 2]! + GHOST, m[(c + w) * 4 + 2]! + GHOST);
    }
  for (let c = 0; c < n; c++) {
    if (!open[c]) continue;
    diag[c] = ge[c]! + gs[c]! + (c % w > 0 ? ge[c - 1]! : 0) + (c >= w ? gs[c - w]! : 0);
  }
  /** out = A x: Kirchhoff's law of every cell, the sum of the fluxes over its edges. */
  const apply = (x: Float64Array, out: Float64Array) => {
    for (let c = 0; c < n; c++) {
      if (!open[c] || diag[c] === 0) {
        out[c] = 0;
        continue;
      }
      let v = diag[c]! * x[c]!;
      if (ge[c]! > 0) v -= ge[c]! * x[c + 1]!;
      if (gs[c]! > 0) v -= gs[c]! * x[c + w]!;
      if (c % w > 0 && ge[c - 1]! > 0) v -= ge[c - 1]! * x[c - 1]!;
      if (c >= w && gs[c - w]! > 0) v -= gs[c - w]! * x[c - w]!;
      out[c] = v;
    }
  };
  /** The flux through each cell with a tube, as the pass `update` counts it: without the ghost conductivity. */
  const flux = (press: (c: number) => number): Float64Array => {
    const q = new Float64Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = y * w + x;
        const g = m[c * 4 + 2]!;
        if (!open[c] || g <= 0) continue;
        let f = 0;
        for (const [nb, ok] of [
          [c + 1, x + 1 < w],
          [c - 1, x > 0],
          [c + w, y + 1 < h],
          [c - w, y > 0],
        ] as const)
          if (ok && open[nb]) f += Math.abs(edge(g, m[nb * 4 + 2]!) * (press(c) - press(nb)));
        q[c] = 0.5 * f;
      }
    return q;
  };
  for (const lane of (process.env.LANES ?? '0').split(',').map(Number)) {
    // The right-hand side: +I0 at a site that gives in this lane, −I0 at one that takes.
    const s = new Float64Array(n);
    let sites = 0;
    for (let c = 0; c < n; c++) {
      const code = m[c * 4 + 3]!;
      if (code === 0) continue;
      const digit = Math.floor(code / 3 ** lane) % 3;
      s[c] = digit === 1 ? i0 : digit === 2 ? -i0 : 0;
      sites++;
    }
    const x = new Float64Array(n);
    for (let c = 0; c < n; c++) x[c] = open[c] ? p[c * 4 + lane]! : 0;
    const r = new Float64Array(n);
    const z = new Float64Array(n);
    const d = new Float64Array(n);
    const q = new Float64Array(n);
    apply(x, q);
    let rz = 0;
    let norm0 = 0;
    for (let c = 0; c < n; c++) {
      const rc = open[c] ? s[c]! - q[c]! : 0;
      const zc = diag[c]! > 0 ? rc / diag[c]! : 0;
      r[c] = rc;
      z[c] = zc;
      d[c] = zc;
      rz += rc * zc;
      norm0 += s[c]! * s[c]!;
    }
    let its = 0;
    const max = Number(process.env.ITS ?? 60000);
    for (; its < max; its++) {
      apply(d, q);
      let dq = 0;
      for (let c = 0; c < n; c++) dq += d[c]! * q[c]!;
      const alpha = rz / dq;
      let rr = 0;
      let rzNew = 0;
      for (let c = 0; c < n; c++) {
        x[c] = x[c]! + alpha * d[c]!;
        const rc = r[c]! - alpha * q[c]!;
        const zc = diag[c]! > 0 ? rc / diag[c]! : 0;
        r[c] = rc;
        z[c] = zc;
        rr += rc * rc;
        rzNew += rc * zc;
      }
      if (rr < 1e-16 * norm0) break;
      const beta = rzNew / rz;
      rz = rzNew;
      for (let c = 0; c < n; c++) d[c] = z[c]! + beta * d[c]!;
    }
    const exact = flux((c) => x[c]!);
    const local = flux((c) => p[c * 4 + lane]!);
    let [sumE, sumL, sumD, cells] = [0, 0, 0, 0];
    const rel: number[] = [];
    for (let c = 0; c < n; c++) {
      if (m[c * 4 + 2]! <= 0) continue;
      cells++;
      sumE += exact[c]!;
      sumL += local[c]!;
      sumD += Math.abs(exact[c]! - local[c]!);
      if (exact[c]! > 0.05 * i0) rel.push(Math.abs(local[c]! - exact[c]!) / exact[c]!);
    }
    rel.sort((a, b) => a - b);
    const pct = (f: number) => (100 * (rel[Math.floor(f * (rel.length - 1))] ?? 0)).toFixed(0);
    console.log(
      `${name} step ${step} lane ${lane}: ${sites} sites, ${cells} tube cells, CG ${its} its | sum of flux: exact ${sumE.toFixed(1)}, local ${sumL.toFixed(1)} (${((100 * sumL) / sumE).toFixed(0)} %) | sum of |difference| ${((100 * sumD) / sumE).toFixed(0)} % | cells with exact flux above 5 % of I0: ${rel.length}, error median ${pct(0.5)} %, 90th percentile ${pct(0.9)} %`,
    );
  }
}
