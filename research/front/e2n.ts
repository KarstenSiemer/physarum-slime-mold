// A front that splits into crowns that move on (ADR 0084, part E2n of stage 4): the measures of e2m.ts (the form, the
// flux per rim sink, the veins on the arcs around the mouth, how far behind the rim the veins stand), and the heads of
// the rim, the depth of the sheet behind the rim, the ground at the walls and the fed sinks, from the saved fields of a
// campaign of crowns.ts (`research/front/e2n.sh`). Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/e2n.ts measure=research/front/out/e2n/c1 [at=16000]
//   node --import ./research/flow/register.mjs research/front/e2n.ts table=research/front/out/e2n/c1-m16000.jsonl
// `measure` writes one line per run to `<folder>-m<at>.jsonl` and prints the table.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readState } from './crowns';
import { ARCS_OUT, measureCampaign } from './e2l';
import { rimDistance, veinRim, type E2mRow } from './e2m';
import { ridgeCells, type CrownFields } from './measure';
import { STILL, VEIN_D } from './still';

/** The arcs around the mouth: those of E2l, and farther ones for the colony of 16,000 steps. */
export const ARCS_E2N = [...ARCS_OUT, 150, 170, 190] as const;
/** A rim cell advances when the front reached it less than this many steps before: the time between two records. */
export const ADVANCE = 1000;
/**
 * The least cells of a part of the rim that counts as a head or as a standing part: the side of the square around a
 * sink that sets its weight (2 · reach + 1 with `reach` 6, `fresh` 'box'), so that a head holds sinks of its own.
 */
export const LEAST = 13;
/** The distances behind the rim of the bands of the sheet profile, in cells. */
export const DEPTHS = [0, 10, 20, 40, 80, Infinity] as const;
/** A cell of reached ground this near to a wall of the box below the neck counts as ground at the wall. */
export const WALL = 3;

/** The parts of the rim: those that advance (heads) and those that stand. */
export interface Heads {
  /** The rim cells: reached ground beside open ground that the front has not reached (rimDistance() 1). */
  rim: number;
  /** The parts of at least LEAST cells that advance, and their cells, the largest first. */
  heads: number;
  headCells: number[];
  /** The parts of at least LEAST cells that stand, and the share of the rim cells that stand. */
  stands: number;
  standShare: number;
}

/** The sizes of the parts of a set of cells that touch over their 8 neighbours. */
export function partSizes(set: ReadonlySet<number>, w: number, h: number): number[] {
  const sizes: number[] = [];
  const done = new Set<number>();
  for (const c of set) {
    if (done.has(c)) continue;
    let size = 0;
    const stack = [c];
    done.add(c);
    while (stack.length > 0) {
      const a = stack.pop()!;
      size++;
      const [x, y] = [a % w, Math.floor(a / w)];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [xx, yy] = [x + dx, y + dy];
          const m = yy * w + xx;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !set.has(m) || done.has(m)) continue;
          done.add(m);
          stack.push(m);
        }
    }
    sizes.push(size);
  }
  return sizes;
}

export function heads(f: CrownFields): Heads {
  const rim = rimDistance(f);
  const [go, stay] = [new Set<number>(), new Set<number>()];
  for (let c = 0; c < f.cells; c++) {
    if (rim[c] !== 1 || f.F[c] === 0) continue;
    (f.step + 1 - f.F[c]! < ADVANCE ? go : stay).add(c);
  }
  const big = (set: Set<number>) => partSizes(set, f.w, f.h).filter((n) => n >= LEAST);
  const goParts = big(go).sort((a, b) => b - a);
  const all = go.size + stay.size;
  return {
    rim: all,
    heads: goParts.length,
    headCells: goParts,
    stands: big(stay).length,
    standShare: all > 0 ? Math.round((stay.size / all) * 1000) / 1000 : NaN,
  };
}

/** How deep the sheet reaches behind the rim: the agents off the veins, below the neck. */
export interface SheetDepth {
  /** The agents off the veins (no ridge of VEIN_D), and the median and the 90th percentile of their rim distance. */
  agents: number;
  p50: number;
  p90: number;
  /** Per band of DEPTHS: the share of the reached open cells off the veins that hold an agent. */
  share: number[];
}

const quantile = (v: number[], q: number) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length > 0 ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
};

export function sheetDepth(f: CrownFields): SheetDepth {
  const ridge = ridgeCells(f, 1.5, 4, VEIN_D);
  const rim = rimDistance(f);
  const dist: number[] = [];
  const [cells, held] = [DEPTHS.slice(1).map(() => 0), DEPTHS.slice(1).map(() => 0)];
  for (let c = 0; c < f.cells; c++) {
    if (!f.layout.open[c] || f.F[c] === 0 || ridge[c] || Math.floor(c / f.w) < STILL.long) continue;
    const d = rim[c]!;
    const band = DEPTHS.findIndex((lo, i) => d >= lo && d < DEPTHS[i + 1]!);
    if (band < 0) continue;
    cells[band]!++;
    if (!f.occ[c]) continue;
    held[band]!++;
    dist.push(d);
  }
  return {
    agents: dist.length,
    p50: quantile(dist, 0.5),
    p90: quantile(dist, 0.9),
    share: cells.map((n, i) => (n > 0 ? Math.round((held[i]! / n) * 1000) / 1000 : NaN)),
  };
}

/** The reached ground within WALL cells of a wall of the box below the neck: a colony there no longer grows freely. */
export function atWall(f: CrownFields): number {
  let n = 0;
  for (let c = 0; c < f.cells; c++) {
    const [x, y] = [c % f.w, Math.floor(c / f.w)];
    if (y < STILL.long || f.F[c] === 0) continue;
    if (x < WALL || x >= f.w - WALL || y >= f.h - WALL) n++;
  }
  return n;
}

export interface E2nRow extends E2mRow {
  heads: Heads;
  sheet: SheetDepth;
  wall: number;
  /** `sinkOn` 'fed': the rim cells that could be sinks at step k, and the flow passes without a fed one until then. */
  candidates?: number;
  fallback?: number;
}

const fmt = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '-');

export function e2nLine(r: E2nRow): string {
  const [h, s, v] = [r.heads, r.sheet, r.veinRim];
  const arcs = r.arcs.map((a) => String(a.veins)).join(' ');
  const fed =
    r.candidates === undefined ? '' : ` fed ${String(r.sinks)}/${String(r.candidates)} fb ${String(r.fallback)}`;
  return [
    `${r.case.padEnd(6)}s${String(r.seed)} ${r.form.padEnd(5)} agents ${String(r.alive)} reach ${fmt(r.reach, 0)}`,
    `per sink ${fmt(r.perSink, 3)}${fed} wall ${String(r.wall)}`,
    `| heads ${String(h.heads)} [${h.headCells.join(',')}] stands ${String(h.stands)} (${fmt(h.standShare, 2)} of ${String(h.rim)})`,
    `| sheet p50 ${fmt(s.p50, 0)} p90 ${fmt(s.p90, 0)} share ${s.share.map((x) => fmt(x, 2)).join(' ')}`,
    `| veins rim p10 ${fmt(v.rim10, 0)} | arcs ${arcs}`,
  ].join(' ');
}

const isMain = process.argv[1]?.endsWith('e2n.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  const k = Number(args.at ?? 16000);
  if (args.measure) {
    const rows: E2nRow[] = measureCampaign(args.measure, k, ARCS_E2N).map((r) => {
      const dir = join(args.measure!, r.case);
      const state = join(dir, `s${String(r.seed)}-state`, `s${String(r.seed)}-${String(k)}.bin.gz`);
      if (!existsSync(state)) throw new Error(`no state ${state}`);
      const f = readState(state);
      const sink = readFileSync(join(dir, `s${String(r.seed)}-sinks.jsonl`), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { k: number; candidates?: number; fallback?: number })
        .find((x) => x.k === k);
      return {
        ...r,
        veinRim: veinRim(f),
        bandVeins: r.summary.veins,
        heads: heads(f),
        sheet: sheetDepth(f),
        wall: atWall(f),
        ...(sink?.candidates === undefined ? {} : { candidates: sink.candidates, fallback: sink.fallback }),
      };
    });
    writeFileSync(`${args.measure}-m${String(k)}.jsonl`, rows.map((r) => JSON.stringify(r) + '\n').join(''));
    for (const r of rows) console.log(e2nLine(r));
  } else if (args.table) {
    for (const l of readFileSync(args.table, 'utf8').split('\n').filter(Boolean))
      console.log(e2nLine(JSON.parse(l) as E2nRow));
  } else throw new Error('measure=<folder> or table=<file>');
}
