// The growing colony with a flow over 8 neighbours (ADR 0082, part E2l of stage 4), measured from the saved fields of
// a campaign of crowns.ts (`dump=`). Per run: the form of crown-table.ts, the flux per rim sink, the veins that cross
// arcs around the mouth of the channel (counted as still.ts counts them on the still sheet of ADR 0079 and ADR 0081),
// and a picture of D. A campaign folder holds a folder per case, and in it per seed the record, the sinks and the
// saved fields of crowns.ts. Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/e2l.ts measure=research/front/out/e2l/c1 [at=8000]
//   node --import ./research/flow/register.mjs research/front/e2l.ts table=research/front/out/e2l/c1-8000.jsonl
//   node --import ./research/flow/register.mjs research/front/e2l.ts pics=research/front/out/e2l/c1 [at=8000]
// `measure` writes one line per run to `<folder>-<at>.jsonl` and prints the table; `pics` writes `d-<at>.png` beside
// the pictures of crowns.ts.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLOW } from '../../src/engine/flow';
import { writePng } from '../flow/prototype/world';
import { form, summarize, type CrownSummary } from './crown-table';
import { readState, type CrownRow } from './crowns';
import { crownProfile, ridgeCells, towardRimByBand, veinTowardRim, type CrownFields } from './measure';
import { params, type Front } from './sim';
import { ARCS, FINE_D, STILL, VEIN_D, partsOf, ramp } from './still';

/** The arcs around the mouth: those of the still sheet, and farther ones for a colony that grows beyond its radius. */
export const ARCS_OUT = [...ARCS, 90, 110, 130] as const;

/** The veins on an arc around the mouth, and how much of the arc the colony covers. */
export interface ArcCount {
  r: number;
  /** The parts of the veins (a ridge with D of at least VEIN_D) and of the fine veins (FINE_D) on the arc. */
  veins: number;
  fine: number;
  /** The share of the open cells of the arc with a tube body. */
  cover: number;
  /** The mean |cos| toward the rim of the veins within 3 cells of the arc (veinTowardRim()); 0.64 at random. */
  cos: number;
  /** The mean D and flux Q of the cells of the arc with a body. */
  d: number;
  q: number;
}

/**
 * The veins that cross the arcs of ARCS_OUT around the mouth of the neck (the centre of the half disc of still.ts):
 * the open cells below the neck within 1 cell of the radius, as stillSheet() takes them.
 */
export function arcCounts(f: CrownFields): ArcCount[] {
  const { w, h, cells } = f;
  const [cx, cy] = [STILL.w / 2, STILL.long];
  const ridge = ridgeCells(f, 1.5, 4, VEIN_D);
  const fine = ridgeCells(f, 1.5, 4, FINE_D);
  const toward = veinTowardRim(f, ridge);
  const body = (c: number) => f.B[c]! >= FLOW.bodyLow;
  const round = (v: number, n = 3) => (Number.isFinite(v) ? Number(v.toPrecision(n)) : NaN);
  const meanOf = (list: number[], v: (c: number) => number) => {
    const xs = list.map(v).filter(Number.isFinite);
    return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };
  return ARCS_OUT.map((r) => {
    const [band, near]: [number[], number[]] = [[], []];
    for (let c = 0; c < cells; c++) {
      const [x, y] = [c % w, Math.floor(c / w)];
      if (!f.layout.open[c] || y < STILL.long) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (Math.abs(d - r) < 1) band.push(c);
      if (Math.abs(d - r) < 3) near.push(c);
    }
    const covered = band.filter(body);
    return {
      r,
      veins: partsOf(new Set(band.filter((c) => ridge[c])), w, h).n,
      fine: partsOf(new Set(band.filter((c) => fine[c])), w, h).n,
      cover: round(band.length > 0 ? covered.length / band.length : NaN, 2),
      cos: round(meanOf(near, (c) => toward[c]!)),
      d: round(meanOf(covered, (c) => f.D[c]!)),
      q: round(meanOf(covered, (c) => f.Q[c]!)),
    };
  });
}

/** D on the tube body (log10 D from -3 to 0, as stillPicture()), ground the front reached dark blue, walls grey. */
export function dPicture(f: CrownFields, path: string, zoom = 3) {
  const rgb = new Uint8Array(f.cells * 3);
  for (let c = 0; c < f.cells; c++) {
    let col: [number, number, number] = [90, 90, 90];
    if (f.layout.open[c]) col = f.F[c]! > 0 ? [28, 28, 44] : [18, 18, 22];
    if (f.layout.open[c] && f.B[c]! >= FLOW.bodyLow) col = ramp(f.D[c]!);
    rgb.set(col.map(Math.round), c * 3);
  }
  writePng(path, f.w, f.h, rgb, zoom);
}

/** The measures of one run at one step. */
export interface E2lRow {
  case: string;
  seed: number;
  k: number;
  alive: number;
  form: string;
  summary: CrownSummary;
  /** The farthest body cell from the food, and its rise per step over the second half of the run. */
  reach: number;
  speed: number;
  /** The sinks, and the flux per rim sink: the total of the sinks (norm times the flow strength) over their count. */
  sinks: number;
  perSink: number;
  arcs: ArcCount[];
}

const fmt = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '-');

export function rowLine(r: E2lRow): string {
  const s = r.summary;
  const arcs = r.arcs.map((a) => `${String(a.veins)}/${String(a.fine)}:${fmt(a.cover, 1)}`).join(' ');
  return `${r.case.padEnd(15)}s${String(r.seed)} ${r.form.padEnd(5)} alive ${String(r.alive)} speed ${fmt(r.speed, 4)} per sink ${fmt(r.perSink, 3)} Q head ${fmt(s.qHead, 2)} behind ${fmt(s.backAgents, 2)} toward ${fmt(s.toward, 2)} | arcs veins/fine:cover ${arcs}`;
}

/** The runs of a campaign folder at step k: the case folders, in them the records `s<seed>.jsonl`. */
export function measureCampaign(root: string, k: number): E2lRow[] {
  const rows: E2lRow[] = [];
  const cases = readdirSync(root)
    .filter((f) => statSync(join(root, f)).isDirectory())
    .sort();
  for (const name of cases) {
    const dir = join(root, name);
    for (const file of readdirSync(dir).filter((f) => /^s\d+\.jsonl$/.test(f))) {
      const seed = Number(file.slice(1, -6));
      const state = join(dir, `s${String(seed)}-state`, `s${String(seed)}-${String(k)}.bin.gz`);
      if (!existsSync(state)) continue;
      const record = JSON.parse(readFileSync(join(dir, file), 'utf8').split('\n')[0]!) as {
        front: Front;
        rows: CrownRow[];
      };
      const sink = readFileSync(join(dir, `s${String(seed)}-sinks.jsonl`), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { k: number; sinks: number })
        .find((x) => x.k === k);
      const f = readState(state);
      const alive = f.occ.reduce((a, b) => a + b, 0);
      const row: CrownRow = { k, alive, ...crownProfile(f), toward: towardRimByBand(f) };
      const summary = summarize(row);
      const before = record.rows.find((x) => x.k === k / 2);
      const sinks = sink?.sinks ?? NaN;
      rows.push({
        case: name,
        seed,
        k,
        alive,
        form: form(summary),
        summary,
        reach: row.reach,
        speed: before ? (row.reach - before.reach) / (k / 2) : NaN,
        sinks,
        perSink: (record.front.norm * params().flow) / sinks,
        arcs: arcCounts(f),
      });
    }
  }
  return rows;
}

const isMain = process.argv[1]?.endsWith('e2l.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  const k = Number(args.at ?? 8000);
  if (args.measure) {
    const rows = measureCampaign(args.measure, k);
    writeFileSync(`${args.measure}-${String(k)}.jsonl`, rows.map((r) => JSON.stringify(r) + '\n').join(''));
    for (const r of rows) console.log(rowLine(r));
  } else if (args.table) {
    for (const l of readFileSync(args.table, 'utf8').split('\n').filter(Boolean))
      console.log(rowLine(JSON.parse(l) as E2lRow));
  } else if (args.pics) {
    for (const name of readdirSync(args.pics).filter((f) => statSync(join(args.pics!, f)).isDirectory())) {
      const dir = join(args.pics, name);
      for (const state of readdirSync(dir).filter((f) => f.endsWith('-state'))) {
        const seed = state.slice(1, -6);
        const file = join(dir, state, `s${seed}-${String(k)}.bin.gz`);
        if (!existsSync(file)) continue;
        dPicture(readState(file), join(dir, `s${seed}-pics`, `s${seed}`, `d-${String(k)}.png`));
      }
    }
  } else throw new Error('measure=<folder>, table=<file> or pics=<folder>');
}
