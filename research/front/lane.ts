// The crown at the head of a tube in a lane (the lane of shots.ts, which measured the crown for ADR 0065: a box of
// `side` × `long` cells, 80 × 300, the food at one end), for the forms of the drift of part E2d (ADR 0074). Per seed,
// every `every` steps: the row of the front and the measures of measure.ts: crown(), head(), alignment() (the veins
// along the flow) and veinDelay() (the steps from the front to a vein). At the end the speed of the front: the slope of
// its row over the steps from `from` on, while it lies `margin` rows or more before the far end. Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/lane.ts seeds=1-10 steps=8000 scent=0 name=<file> ...
// The other keys set the rules of stage 4 (`front` of sim.ts). `table=<dir>` prints the table of the records in dir.
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { box } from './layouts';
import { alignment, crown, head, veinDelay } from './measure';
import { Sim, frontFrom, params, type Front } from './sim';
import { mannWhitney } from './tables';

export interface LaneRow {
  k: number;
  alive: number;
  /** The last row with plasm, and the measures of crown() (widths in cells, veins per row). */
  front: number;
  crown: number;
  tube: number;
  veinsFront: number;
  veinsBack: number;
  /** head(): the cells per step of the band at the head and of the band 40 to 60 steps behind it. */
  head: number;
  headTube: number;
  /**
   * alignment(): the mean |cos| of the veins against the flux; veinDelay(): the median steps from the front to a vein.
   * null without a vein.
   */
  cos: number | null;
  delay: number | null;
}

export interface LaneRun {
  seed: number;
  /** Rows of the front per step, from step `from` on (NaN: too few rows). */
  speed: number;
  rows: LaneRow[];
  ms: number;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function runLane(
  seed: number,
  front: Front,
  o: { steps: number; every: number; side: number; long: number; scent: number; from: number; margin: number },
) {
  const layout = box(o.side, o.long, [[o.side / 2, 8, 5]]);
  const sim = new Sim(layout, params({ seed, front, scentSteps: o.scent }));
  const t0 = performance.now();
  const rows: LaneRow[] = [];
  for (let k = 1; k <= o.steps; k++) {
    sim.advance();
    if (k % o.every !== 0) continue;
    const c = crown(sim);
    const hd = head(sim);
    const al = alignment(sim);
    const vd = veinDelay(sim);
    rows.push({
      k,
      alive: sim.aliveCount,
      front: c.front,
      crown: c.crown,
      tube: c.tube,
      veinsFront: round(c.veinsFront),
      veinsBack: round(c.veinsBack),
      head: round(hd.head),
      headTube: round(hd.tube),
      cos: al.cells > 0 ? round(al.cos, 3) : null,
      delay: vd.cells > 0 ? vd.median : null,
    });
    if (c.front >= o.long - o.margin) break;
  }
  const fit = rows.filter((r) => r.k >= o.from && r.front < o.long - o.margin);
  let speed = NaN;
  if (fit.length >= 3) {
    const mk = fit.reduce((a, r) => a + r.k, 0) / fit.length;
    const mf = fit.reduce((a, r) => a + r.front, 0) / fit.length;
    let [sxy, sxx] = [0, 0];
    for (const r of fit) {
      sxy += (r.k - mk) * (r.front - mf);
      sxx += (r.k - mk) ** 2;
    }
    speed = sxy / sxx;
  }
  return { seed, speed: round(speed, 5), rows, ms: Math.round(performance.now() - t0) } satisfies LaneRun;
}

const median = (v: number[]) => {
  const s = [...v].filter(Number.isFinite).sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/**
 * One line per record file: the speed of the front, and at the steps `at` the medians over the seeds of the crown,
 * the tube, their ratio and the veins. `base`: a record file to compare with (Mann-Whitney).
 */
function table(dir: string, at: number[], base?: string) {
  const read = (file: string) =>
    readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LaneRun);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  const baseRuns = base ? read(base) : undefined;
  const row = (r: LaneRun, k: number) => r.rows.find((x) => x.k === k);
  for (const file of files) {
    const runs = read(file);
    const speeds = runs.map((r) => r.speed).filter(Number.isFinite);
    const p =
      baseRuns && file !== base
        ? `, p ${mannWhitney(speeds, baseRuns.map((r) => r.speed).filter(Number.isFinite)).toPrecision(2)}`
        : '';
    const parts = [
      `speed ${median(speeds).toFixed(4)} (${Math.min(...speeds).toFixed(4)} to ${Math.max(...speeds).toFixed(4)})${p}`,
    ];
    for (const k of at) {
      const rs = runs.map((r) => row(r, k)).filter((x): x is LaneRow => x !== undefined);
      if (rs.length === 0) continue;
      const ratio = rs.filter((x) => x.tube > 0).map((x) => x.crown / x.tube);
      const ratioP =
        baseRuns && file !== base
          ? `, p ${mannWhitney(
              ratio,
              baseRuns
                .map((r) => row(r, k))
                .filter((x): x is LaneRow => x !== undefined && x.tube > 0)
                .map((x) => x.crown / x.tube),
            ).toPrecision(2)}`
          : '';
      parts.push(
        `at ${String(k)} (${String(rs.length)}): front ${String(median(rs.map((x) => x.front)))}, crown ${String(median(rs.map((x) => x.crown)))}, tube ${String(median(rs.map((x) => x.tube)))}, crown/tube ${median(ratio).toFixed(2)} (${String(ratio.length)}${ratioP}), veins ${median(rs.map((x) => x.veinsFront)).toFixed(1)} : ${median(rs.map((x) => x.veinsBack)).toFixed(1)}, |cos| ${median(rs.map((x) => x.cos ?? NaN)).toFixed(2)}, delay ${String(median(rs.map((x) => x.delay ?? NaN)))}, alive ${String(median(rs.map((x) => x.alive)))}`,
      );
    }
    console.log(`${file.replace('.jsonl', '').padEnd(22)} ${String(runs.length)} runs  ${parts.join('; ')}`);
  }
}

const isMain = process.argv[1]?.endsWith('lane.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  if (args.table) table(args.table, (args.at ?? '3000,5000').split(',').map(Number), args.base);
  else {
    const own = ['seeds', 'steps', 'every', 'side', 'long', 'name', 'scent', 'from', 'margin'];
    const front = frontFrom(args, own);
    const [from = 1, to = from] = (args.seeds ?? '1-2').split('-').map(Number);
    const name = args.name ?? 'lane';
    const file = `research/front/out/${name}.jsonl`;
    mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    const o = {
      steps: Number(args.steps ?? 8000),
      every: Number(args.every ?? 250),
      side: Number(args.side ?? 80),
      long: Number(args.long ?? 300),
      scent: Number(args.scent ?? 0),
      from: Number(args.from ?? 1000),
      margin: Number(args.margin ?? 20),
    };
    for (const n of Object.values(o)) if (!Number.isFinite(n)) throw new Error('a number does not parse');
    for (let seed = from; seed <= to; seed++) {
      const run = runLane(seed, front, o);
      appendFileSync(file, JSON.stringify({ ...run, front }) + '\n');
      const end = run.rows.at(-1);
      console.log(
        `seed ${String(seed)}: speed ${String(run.speed)}, at ${String(end?.k)} front ${String(end?.front)} crown ${String(end?.crown)} tube ${String(end?.tube)} alive ${String(end?.alive)} (${String(run.ms)} ms)`,
      );
    }
  }
}
