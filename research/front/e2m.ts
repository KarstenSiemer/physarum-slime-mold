// More flux for the veins of the growing colony (ADR 0083, part E2m of stage 4): the measures of e2l.ts (the form, the
// flux per rim sink, the veins on the arcs around the mouth), and how far behind the rim the first veins stand, from
// the saved fields of a campaign of crowns.ts (`research/front/e2m.sh`). Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/e2m.ts measure=research/front/out/e2m/c1 [at=8000]
//   node --import ./research/flow/register.mjs research/front/e2m.ts table=research/front/out/e2m/c1-m8000.jsonl
// `measure` writes one line per run to `<folder>-m<at>.jsonl` and prints the table.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readState } from './crowns';
import { measureCampaign, type E2lRow } from './e2l';
import { ridgeCells, type CrownFields } from './measure';
import { STILL, VEIN_D } from './still';

/** An area of ground that the front has not reached counts as outside the colony from this many cells on. */
export const OUTSIDE = 50;

/**
 * The Chebyshev distance of each open cell to the ground outside the colony: the open cells that the front has not
 * reached (front stamp 0) in areas of at least OUTSIDE cells, so that a small pocket inside the colony is no rim. The
 * distance runs over open cells (8 neighbours); Infinity where no such ground is left.
 */
export function rimDistance(f: CrownFields): Float32Array {
  const { w, h, cells } = f;
  const open = f.layout.open;
  const out = new Float32Array(cells).fill(Infinity);
  const fresh = (c: number) => open[c] === 1 && f.F[c] === 0;
  const seen = new Uint8Array(cells);
  let queue: number[] = [];
  for (let c = 0; c < cells; c++) {
    if (!fresh(c) || seen[c]) continue;
    const area = [c];
    seen[c] = 1;
    // The iterator of an array also visits the cells that the loop appends.
    for (const a of area) {
      const [x, y] = [a % w, Math.floor(a / w)];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [xx, yy] = [x + dx, y + dy];
          const m = yy * w + xx;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || seen[m] || !fresh(m)) continue;
          seen[m] = 1;
          area.push(m);
        }
    }
    if (area.length < OUTSIDE) continue;
    for (const a of area) out[a] = 0;
    queue = queue.concat(area);
  }
  for (let d = 1; queue.length > 0; d++) {
    const next: number[] = [];
    for (const a of queue) {
      const [x, y] = [a % w, Math.floor(a / w)];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [xx, yy] = [x + dx, y + dy];
          const m = yy * w + xx;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !open[m] || out[m]! <= d) continue;
          out[m] = d;
          next.push(m);
        }
    }
    queue = next;
  }
  return out;
}

const quantile = (v: number[], q: number) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length > 0 ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
};

/** How far behind the rim the veins stand: below the neck, the veins of the arcs (ridges with D of at least VEIN_D). */
export interface VeinRim {
  /** The vein cells, and the 10th percentile and the median of their distance to the rim, in cells. */
  cells: number;
  rim10: number;
  rim50: number;
  /** The 10th percentile of their age, the steps since the front reached them. */
  age10: number;
  /** The vein cells within 10 and within 20 cells of the rim. */
  near10: number;
  near20: number;
}

export function veinRim(f: CrownFields): VeinRim {
  const ridge = ridgeCells(f, 1.5, 4, VEIN_D);
  const rim = rimDistance(f);
  const [dist, ages]: [number[], number[]] = [[], []];
  for (let c = 0; c < f.cells; c++) {
    if (!ridge[c] || Math.floor(c / f.w) < STILL.long || f.F[c] === 0) continue;
    dist.push(rim[c]!);
    ages.push(f.step - f.F[c]!);
  }
  return {
    cells: dist.length,
    rim10: quantile(dist, 0.1),
    rim50: quantile(dist, 0.5),
    age10: quantile(ages, 0.1),
    near10: dist.filter((d) => d <= 10).length,
    near20: dist.filter((d) => d <= 20).length,
  };
}

export interface E2mRow extends E2lRow {
  veinRim: VeinRim;
  /** The vein parts on the line of each band of crownProfile() (ages 100, 300, 600, 1,200, 2,400, 4,800 steps). */
  bandVeins: number[];
}

const fmt = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '-');

export function e2mLine(r: E2mRow): string {
  const v = r.veinRim;
  const arcs = r.arcs.map((a) => `${String(a.veins)}/${String(a.fine)}`).join(' ');
  return `${r.case.padEnd(15)}s${String(r.seed)} ${r.form.padEnd(5)} agents ${String(r.alive)} reach ${fmt(r.reach, 0)} per sink ${fmt(r.perSink, 3)} | arcs ${arcs} | rim p10 ${fmt(v.rim10, 0)} p50 ${fmt(v.rim50, 0)}`;
}

const isMain = process.argv[1]?.endsWith('e2m.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  const k = Number(args.at ?? 8000);
  if (args.measure) {
    const rows: E2mRow[] = measureCampaign(args.measure, k).map((r) => {
      const state = join(args.measure!, r.case, `s${String(r.seed)}-state`, `s${String(r.seed)}-${String(k)}.bin.gz`);
      if (!existsSync(state)) throw new Error(`no state ${state}`);
      return { ...r, veinRim: veinRim(readState(state)), bandVeins: r.summary.veins };
    });
    writeFileSync(`${args.measure}-m${String(k)}.jsonl`, rows.map((r) => JSON.stringify(r) + '\n').join(''));
    for (const r of rows) console.log(e2mLine(r));
  } else if (args.table) {
    for (const l of readFileSync(args.table, 'utf8').split('\n').filter(Boolean))
      console.log(e2mLine(JSON.parse(l) as E2mRow));
  } else throw new Error('measure=<folder> or table=<file>');
}
