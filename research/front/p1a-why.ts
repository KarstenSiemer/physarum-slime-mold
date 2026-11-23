// Study 1a (ADR 0091): why the sheet stays and the rim does not split, from the states that `p1a.sh` saves at steps
// 6,000 and 12,000. Per case, the median over the seeds of: the share of the old ground (reached more than 1,500 steps
// before) with plasm, near a vein (within NEAR cells of a ridge of D ≥ FINE_D) and away from the veins; the share of
// the old ground with an agent; and, per sector of 10 degrees around the centre, the rim radius against the flux of the
// strongest vein that crosses the arc at 0.8 of the radius of the colony (the Pearson correlation over the sectors).
// Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/p1a-why.ts root=research/front/out/p1a/box at=12000
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FLOW } from '../../src/engine/flow';
import { readState } from './crowns';
import { rimDistance } from './e2m';
import { ridgeCells, type CrownFields } from './measure';
import { BEHIND, p1aLayout, type Place } from './p1a';
import { FINE_D } from './still';

/** A cell of old ground within this many cells (Chebyshev) of a ridge counts as near a vein. */
export const NEAR = 3;
/** The sectors of the rim, in degrees. */
export const SECTOR = 10;

export interface Why {
  plasmNear: number;
  plasmFar: number;
  farShare: number;
  agents: number;
  /** The correlation of the rim radius with the flux of the strongest vein over the sectors, and the sectors. */
  rimFlux: number;
  sectors: number;
}

export function why(f: CrownFields, place: Place, low: number): Why {
  const { w, h, cells, step: k } = f;
  const ridge = ridgeCells(f, 1.5, 4, FINE_D);
  const near = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) {
    if (!ridge[c]) continue;
    const [x, y] = [c % w, Math.floor(c / w)];
    for (let dy = -NEAR; dy <= NEAR; dy++)
      for (let dx = -NEAR; dx <= NEAR; dx++) {
        const [xx, yy] = [x + dx, y + dy];
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1;
      }
  }
  let [nOld, nNear, pNear, pFar, agents] = [0, 0, 0, 0, 0];
  for (let c = 0; c < cells; c++) {
    if (!f.layout.open[c] || f.F[c] === 0 || Math.floor(c / w) < place.top || k + 1 - f.F[c]! <= BEHIND) continue;
    nOld++;
    if (f.occ[c]) agents++;
    const plasm = f.trail[c]! >= low ? 1 : 0;
    if (near[c]) [nNear, pNear] = [nNear + 1, pNear + plasm];
    else pFar += plasm;
  }
  // The rim radius per sector, and the largest flux on the body cells of the arc at 0.8 of the median rim radius.
  const rim = rimDistance(f);
  const sectors = Math.round(360 / SECTOR);
  const radius = Array.from({ length: sectors }, () => [] as number[]);
  const polar = (c: number) => {
    const [dx, dy] = [(c % w) + 0.5 - place.cx, Math.floor(c / w) + 0.5 - place.cy];
    const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    return [Math.hypot(dx, dy), Math.min(sectors - 1, Math.floor(a / SECTOR))] as const;
  };
  const all: number[] = [];
  for (let c = 0; c < cells; c++) {
    if (rim[c] !== 1 || f.F[c] === 0 || Math.floor(c / w) < place.top) continue;
    const [r, s] = polar(c);
    radius[s]!.push(r);
    all.push(r);
  }
  all.sort((a, b) => a - b);
  const r08 = 0.8 * (all[Math.floor(all.length / 2)] ?? NaN);
  const flux = new Array<number>(sectors).fill(0);
  for (let c = 0; c < cells; c++) {
    if (!f.layout.open[c] || f.B[c]! < FLOW.bodyLow || Math.floor(c / w) < place.top) continue;
    const [r, s] = polar(c);
    if (Math.abs(r - r08) < 1) flux[s] = Math.max(flux[s]!, f.Q[c]!);
  }
  const [xs, ys]: [number[], number[]] = [[], []];
  radius.forEach((list, s) => {
    if (list.length < 3) return;
    xs.push(list.reduce((a, b) => a + b, 0) / list.length);
    ys.push(flux[s]!);
  });
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const [mx, my] = [mean(xs), mean(ys)];
  let [sxy, sxx, syy] = [0, 0, 0];
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i]! - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  });
  const share = (a: number, b: number) => (b > 0 ? a / b : NaN);
  return {
    plasmNear: share(pNear, nNear),
    plasmFar: share(pFar, nOld - nNear),
    farShare: share(nOld - nNear, nOld),
    agents: share(agents, nOld),
    rimFlux: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN,
    sectors: xs.length,
  };
}

const isMain = process.argv[1]?.endsWith('p1a-why.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  const root = args.root!;
  const at = Number(args.at ?? 12000);
  const { place } = p1aLayout(root.endsWith('box') ? 'box' : 'ring');
  const med = (v: number[]) => {
    const s = v.filter(Number.isFinite).sort((a, b) => a - b);
    return s.length > 0 ? s[Math.floor(s.length / 2)]!.toFixed(2) : '-';
  };
  for (const name of readdirSync(root).sort()) {
    const rows: Why[] = [];
    for (let s = 1; s <= 6; s++) {
      const file = join(root, name, `s${String(s)}-${String(at)}.bin.gz`);
      if (existsSync(file)) rows.push(why(readState(file), place, 1));
    }
    if (rows.length === 0) continue;
    const m = (f: (r: Why) => number) => med(rows.map(f));
    console.log(
      `${name.padEnd(7)} ${String(at)}: plasm near ${m((r) => r.plasmNear)} far ${m((r) => r.plasmFar)} (far share ${m((r) => r.farShare)})` +
        ` agents ${m((r) => r.agents)} | rim radius vs vein flux r ${m((r) => r.rimFlux)} over ${m((r) => r.sectors)} sectors`,
    );
  }
}
