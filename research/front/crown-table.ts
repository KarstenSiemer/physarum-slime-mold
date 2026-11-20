// The table of a campaign of crowns.ts (ADR 0076): for each case folder (one record file per seed), at the steps `at`,
// the median over the seeds (least to most) of the measures that tell a crown from a tree, a fan and a sheet. Prototype
// code. Usage:
//   node --import ./research/flow/register.mjs research/front/crown-table.ts research/front/out/e2f/c1 at=4000,8000
// The cases are the folders below the given one, in the order of their names. `base=<case>` compares each case with
// that case (Mann-Whitney) on the share of the old ground with a tube body and on the veins of the young lines.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CrownRow } from './crowns';
import { BANDS, middles } from './measure';
import { mannWhitney } from './tables';

/** The measures of one row (one seed at one step). */
export interface CrownSummary {
  alive: number;
  /**
   * The sheet at the head: the largest share with thick plasm of the bands of ground younger than 1,600 steps (the
   * thick band lies 400 to 1,600 steps behind the rim at drift 1.5, nearer at drift 5), and the share with agents.
   */
  head: number;
  headAgents: number;
  /** The share of the ground aged 1,600 to 6,400 steps with a tube body and with veins: what stays behind. */
  back: number;
  backVeins: number;
  /** The share of the old ground with agents, and the cells of vein on the line of 2,400 steps. */
  backAgents: number;
  veinCells: number;
  /** The mean |cos| of the veins 400 to 1,600 steps behind the rim against the move of the front (NaN without). */
  toward: number;
  /** The vein parts and their cells per part on the line of each band (the outline of the front at its middle). */
  veins: number[];
  widths: number[];
  /** The most cells of thick plasm on one line of 100 to 1,200 steps, and the tube body on the line of 2,400 steps. */
  headCells: number;
  backCells: number;
  /** The mean D and Q of the head (200 to 800 steps) and of the back (1,600 to 6,400). */
  dHead: number;
  qHead: number;
  dBack: number;
  qBack: number;
}

export function summarize(row: CrownRow): CrownSummary {
  const pick = (lo: number, hi: number) => row.bands.filter((_, i) => BANDS[i]! >= lo && BANDS[i + 1]! <= hi);
  const share = (bs: CrownRow['bands'], key: 'thick' | 'agents' | 'body' | 'vein') => {
    const g = bs.reduce((s, b) => s + b.ground, 0);
    return g > 0 ? bs.reduce((s, b) => s + b[key], 0) / g : NaN;
  };
  const meanOf = (bs: CrownRow['bands'], key: 'd' | 'q') => {
    const n = bs.reduce((s, b) => s + b.body, 0);
    return n > 0 ? bs.reduce((s, b) => s + b[key] * b.body, 0) / n : NaN;
  };
  const young = row.bands.filter((_, i) => BANDS[i + 1]! <= 1600);
  const head = pick(200, 800);
  const back = pick(1600, 6400);
  const at = (age: number) => row.bands[middles().indexOf(age)];
  const lines = row.bands.filter((_, i) => middles()[i]! <= 1200).map((x) => x.thickParts * x.thickWidth);
  const b = at(2400);
  return {
    alive: row.alive,
    head: Math.max(...young.map((x) => (x.ground > 0 ? x.thick / x.ground : 0))),
    headAgents: Math.max(...young.map((x) => (x.ground > 0 ? x.agents / x.ground : 0))),
    back: share(back, 'body'),
    backVeins: share(back, 'vein'),
    backAgents: share(back, 'agents'),
    veinCells: b ? b.veinParts * b.veinWidth : 0,
    toward: (() => {
      const t = (row.toward ?? []).filter((_, i) => BANDS[i]! >= 400 && BANDS[i + 1]! <= 1600);
      const n = t.reduce((s, x) => s + x.cells, 0);
      return n > 0 ? t.reduce((s, x) => s + x.cos * x.cells, 0) / n : NaN;
    })(),
    veins: row.bands.map((x) => x.veinParts),
    widths: row.bands.map((x) => x.veinWidth),
    headCells: Math.max(...lines),
    backCells: b ? b.bodyParts * b.bodyWidth : NaN,
    dHead: meanOf(head, 'd'),
    qHead: meanOf(head, 'q'),
    dBack: meanOf(back, 'd'),
    qBack: meanOf(back, 'q'),
  };
}

/** The forms of form(); 'tubes' is a sheet at the head with tubes on bare ground behind, but no more veins near it. */
export const FORMS = ['tree', 'crown', 'fan', 'tubes', 'sheet'] as const;

/**
 * The form of a run, from its measures (ADR 0076); read it at a step when the old ground (1,600 to 6,400 steps) lies
 * away from the food (step 8,000 in the neck). The limits lie between the groups that the pictures show (README of
 * ADR 0076): a tree's widest young line holds 7 to 31 cells of thick plasm, a sheet's or a crown's 81 to 384; the thin
 * sheet behind a head holds agents on 11 to 15 % of the old ground, bare ground 3 to 5 %.
 * - A tree: at most 60 cells of thick plasm on every young line (a few narrow tips, no sheet at the head).
 * - A sheet at the head: thick plasm on half of a young band or more. Behind it:
 *   - a sheet: agents on 8 % of the old ground or more (a thin sheet that keeps a tube body);
 *   - a fan: less, and fewer than 5 cells of vein on the line of 2,400 steps (nothing stays behind);
 *   - a crown: less, at least 5 cells of vein on that line, and more veins on the line of 1,200 steps than on the line of
 *     4,800, and the veins 400 to 1,600 steps behind the rim run toward it (a mean |cos| of 0.7 or more, towardRimByBand();
 *     0.64 is at random): veins on bare ground, more and running toward the rim near the head;
 *   - tubes: the rest (tubes on bare ground, no more veins near the head).
 */
export function form(s: CrownSummary): (typeof FORMS)[number] {
  if (s.headCells <= 60) return 'tree';
  if (s.head < 0.5) return 'sheet';
  if (s.backAgents >= 0.08) return 'sheet';
  if (s.veinCells < 5) return 'fan';
  if (s.veins[3]! > s.veins[5]! && s.toward >= 0.7) return 'crown';
  return 'tubes';
}

const median = (v: number[]) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const fmt = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const spread = (v: number[], d = 2) => {
  const s = v.filter(Number.isFinite);
  return s.length === 0 ? '-' : `${fmt(median(s), d)} (${fmt(Math.min(...s), d)}–${fmt(Math.max(...s), d)})`;
};

/** The rows of every seed of a case at step k. */
export function caseRows(dir: string, k: number): CrownRow[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) =>
      readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => (JSON.parse(l) as { rows: CrownRow[] }).rows.find((r) => r.k === k)),
    )
    .filter((r): r is CrownRow => r !== undefined);
}

const isMain = process.argv[1]?.endsWith('crown-table.ts');
if (isMain) {
  const root = process.argv[2]!;
  const args = Object.fromEntries(process.argv.slice(3).map((a) => a.split('=') as [string, string]));
  const steps = (args.at ?? '8000').split(',').map(Number);
  const cases = readdirSync(root)
    .filter((f) => statSync(join(root, f)).isDirectory() && !f.endsWith('-pics'))
    .sort();
  for (const k of steps) {
    console.log(`step ${String(k)}: median (least–most) over the seeds`);
    const base = args.base ? caseRows(join(root, args.base), k).map(summarize) : undefined;
    for (const name of cases) {
      const s = caseRows(join(root, name), k).map(summarize);
      if (s.length === 0) continue;
      const p = (f: (x: CrownSummary) => number) =>
        base && name !== args.base ? ` p ${mannWhitney(s.map(f), base.map(f)).toPrecision(2)}` : '';
      const vein = (i: number) => fmt(median(s.map((x) => x.veins[i]!)), 1);
      const width = (i: number) => fmt(median(s.map((x) => x.widths[i]!)), 1);
      const forms = FORMS.map((f) => `${f} ${String(s.filter((x) => form(x) === f).length)}`).join(', ');
      console.log(
        `${name.padEnd(14)} ${String(s.length).padStart(2)} runs (${forms})  alive ${spread(
          s.map((x) => x.alive),
          0,
        )}  head thick ${spread(s.map((x) => x.head))} agents ${spread(s.map((x) => x.headAgents))}  back body ${spread(
          s.map((x) => x.back),
        )}${p((x) => x.back)} veins ${spread(s.map((x) => x.backVeins))}`,
      );
      console.log(
        `${''.padEnd(18)}veins per line ${middles()
          .map((m, i) => `${String(m)}: ${vein(i)}×${width(i)}`)
          .join(', ')}${p((x) => x.veins[1]! + x.veins[2]!)}`,
      );
      console.log(
        `${''.padEnd(18)}young line thick ${spread(
          s.map((x) => x.headCells),
          0,
        )} cells, line 2400 body ${spread(
          s.map((x) => x.backCells),
          0,
        )} cells; D ${fmt(median(s.map((x) => x.dHead)), 3)} Q ${fmt(median(s.map((x) => x.qHead)), 3)} at the head, D ${fmt(
          median(s.map((x) => x.dBack)),
          3,
        )} Q ${fmt(median(s.map((x) => x.qBack)), 3)} behind; agents behind ${spread(s.map((x) => x.backAgents))}, vein cells on the line of 2400 ${spread(
          s.map((x) => x.veinCells),
          0,
        )}, veins toward the rim |cos| ${spread(s.map((x) => x.toward))}`,
      );
    }
  }
}
