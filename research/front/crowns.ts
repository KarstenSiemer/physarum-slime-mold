// The crown at the head of a tube (ADR 0076, part E2f of stage 4): a colony that grows from one food onto open ground,
// with room for its head to spread. Per seed, every `every` steps, the measures of crownProfile() (measure.ts) and the
// spread of the pressure over the sinks (`<name>-sinks.jsonl`, ADR 0078), and pictures at the steps `pics`. Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/crowns.ts layout=neck seeds=1-2 steps=8000 pics=4000 \
//     name=<file> <the rules of stage 4>
// `layout`: neck (a box of `side` × `long` cells; its first `neckLong` rows are wall but for a channel `neckWide` cells
// wide, the food at its closed end), edge (the same box without the walls) or dish (a dish of `side` cells, the food
// in the middle). `scent`: the steps of the food scent before the colony starts, 0 as the app (ADR 0073). `base`: the
// base conductance of a tube cell, FLOW.base (0.02) but in a diagnostic (ADR 0083, the hook of ADR 0079).
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { box, dish, neck } from './layouts';
import {
  BANDS,
  LINE,
  THICK,
  crownProfile,
  middles,
  ridgeCells,
  thickness,
  towardRimByBand,
  type CrownFields,
  type CrownProfile,
} from './measure';
import { look, measureLook, picture } from './picture';
import { Sim, frontFrom, params, sinkSpread, type Front, type Layout } from './sim';

export interface CrownOptions {
  layout: 'neck' | 'edge' | 'dish';
  side: number;
  long: number;
  neckWide: number;
  neckLong: number;
}

export function crownLayout(o: CrownOptions): Layout {
  if (o.layout === 'dish') return dish(o.side, [[o.side / 2, o.side / 2, 5]]);
  if (o.layout === 'edge') return box(o.side, o.long, [[o.side / 2, 8, 5]]);
  return neck(o.side, o.long, o.neckWide, o.neckLong, [[o.side / 2, 8, 5]]);
}

export interface CrownRow extends CrownProfile {
  k: number;
  alive: number;
  /** Per band, whether its veins run toward the rim (towardRimByBand()); only in records of `remeasure=`. */
  toward?: { cos: number; cells: number }[];
}

/**
 * Saves the fields that the measures read (CrownFields), gzipped: the size and the step, the start, then the open
 * cells, the agents, the front stamps, the trail, the body, D and Q. So a changed measure runs again on old runs
 * (`remeasure=`).
 */
export function saveState(sim: CrownFields, path: string) {
  const { cells } = sim;
  const head = new Float64Array([sim.w, sim.h, sim.step, sim.layout.start[0], sim.layout.start[1]]);
  const parts = [
    new Uint8Array(head.buffer),
    sim.layout.open,
    sim.occ,
    new Uint8Array(sim.F.buffer, sim.F.byteOffset, cells * 4),
    ...[sim.trail, sim.B, sim.D, sim.Q].map((f) => new Uint8Array(f.buffer, f.byteOffset, cells * 4)),
  ];
  writeFileSync(path, gzipSync(Buffer.concat(parts)));
}

export function readState(path: string): CrownFields {
  const buf = gunzipSync(readFileSync(path));
  const head = new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + 40));
  const [w, h, step, sx, sy] = [...head] as [number, number, number, number, number];
  const cells = w * h;
  let at = buf.byteOffset + 40;
  const take = (bytes: number) => {
    const out = buf.buffer.slice(at, at + bytes);
    at += bytes;
    return out;
  };
  const open = new Uint8Array(take(cells));
  const occ = new Uint8Array(take(cells));
  const F = new Uint32Array(take(cells * 4));
  const [trail, B, D, Q] = [0, 1, 2, 3].map(() => new Float32Array(take(cells * 4))) as [
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  return { w, h, cells, step, layout: { open, start: [sx, sy] }, occ, F, trail, B, D, Q };
}

/**
 * One line per band of a row: the shares of the ground with agents, thick plasm, a tube body and veins, D, and on the
 * middle line the parts of thick plasm, of the body and of the veins, each as count × cells.
 */
export function bandLines(row: CrownRow): string[] {
  const pct = (a: number, b: number) => (b > 0 ? `${String(Math.round((100 * a) / b)).padStart(3)}%` : '   -');
  const part = (n: number, w: number) => `${String(n).padStart(2)}×${w.toFixed(0).padStart(3)}`;
  return row.bands.map((b, i) => {
    const at = `${String(BANDS[i]).padStart(4)}-${String(BANDS[i + 1]).padEnd(4)}`;
    return `${at} ground ${String(b.ground).padStart(5)} agents ${pct(b.agents, b.ground)} thick ${pct(b.thick, b.ground)} body ${pct(b.body, b.ground)} veins ${pct(b.vein, b.ground)} D ${b.d.toFixed(3)} Q ${b.q.toFixed(3)} | line ${String(b.line).padStart(3)}: thick ${part(b.thickParts, b.thickWidth)} body ${part(b.bodyParts, b.bodyWidth)} veins ${part(b.veinParts, b.veinWidth)}`;
  });
}

const isMain = process.argv[1]?.endsWith('crowns.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  if (args.table) {
    for (const l of readFileSync(args.table, 'utf8').split('\n').filter(Boolean)) {
      const run = JSON.parse(l) as { seed: number; rows: CrownRow[] };
      for (const row of run.rows.filter((r) => !args.at || args.at.split(',').map(Number).includes(r.k))) {
        console.log(
          `seed ${String(run.seed)} step ${String(row.k)} alive ${String(row.alive)} reach ${String(row.reach)}`,
        );
        for (const line of bandLines(row)) console.log(`  ${line}`);
      }
    }
    process.exit(0);
  }
  if (args.remeasure) {
    // The measures again from the saved states of a folder (`dump=`): one record per seed, as a run writes it.
    const dir = args.remeasure;
    const bySeed = new Map<number, CrownRow[]>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.bin.gz'))) {
      const [seed, k] = f.replace('.bin.gz', '').slice(1).split('-').map(Number) as [number, number];
      const state = readState(join(dir, f));
      const alive = state.occ.reduce((s, v) => s + v, 0);
      const list = bySeed.get(seed) ?? [];
      list.push({ k, alive, ...crownProfile(state), toward: towardRimByBand(state) });
      bySeed.set(seed, list);
    }
    const out = args.out ?? `${dir}.jsonl`;
    writeFileSync(
      out,
      [...bySeed.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([seed, rows]) => JSON.stringify({ seed, rows: rows.sort((a, b) => a.k - b.k) }) + '\n')
        .join(''),
    );
    process.exit(0);
  }
  const own = ['layout', 'side', 'long', 'neckWide', 'neckLong', 'seeds', 'steps', 'every', 'pics', 'dump', 'name'];
  own.push('scent', 'base');
  const front: Front = frontFrom(args, own);
  const layoutName = args.layout ?? 'neck';
  if (layoutName !== 'neck' && layoutName !== 'edge' && layoutName !== 'dish') throw new Error(`layout=${layoutName}`);
  const o: CrownOptions = {
    layout: layoutName,
    side: Number(args.side ?? 200),
    long: Number(args.long ?? 240),
    neckWide: Number(args.neckWide ?? 14),
    neckLong: Number(args.neckLong ?? 40),
  };
  const steps = Number(args.steps ?? 8000);
  const every = Number(args.every ?? 500);
  const scent = Number(args.scent ?? 0);
  const base = args.base === undefined ? undefined : Number(args.base);
  for (const n of [o.side, o.long, o.neckWide, o.neckLong, steps, every, scent, base ?? 0])
    if (!Number.isFinite(n)) throw new Error('a number does not parse');
  const pics = (args.pics ?? '').split(',').filter(Boolean).map(Number);
  const dumps = (args.dump ?? '').split(',').filter(Boolean).map(Number);
  const [from = 1, to = from] = (args.seeds ?? '1-1').split('-').map(Number);
  const name = args.name ?? 'crowns';
  const file = `research/front/out/${name}.jsonl`;
  const sinkFile = `research/front/out/${name}-sinks.jsonl`;
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  for (let seed = from; seed <= to; seed++) {
    const layout = crownLayout(o);
    const sim = new Sim(layout, params({ seed, front, scentSteps: scent }));
    if (base !== undefined) sim.base = base;
    const rows: CrownRow[] = [];
    const t0 = performance.now();
    for (let k = 1; k <= steps; k++) {
      sim.advance();
      if (k % every === 0) {
        const row = { k, alive: sim.aliveCount, ...crownProfile(sim) };
        rows.push(row);
        // The spread of the pressure over the sinks (ADR 0078), in a file of its own: the records keep their form.
        const { food, sinks, ports } = sim.sinkPressures();
        const drop = food - sinks.reduce((a, b) => a + b, 0) / sinks.length;
        const spread = sinkSpread(food, sinks);
        // With `sinkOn` 'fed' (ADR 0084) also the rim cells that could be sinks and the passes without a fed one.
        const fed = front.sinkOn === 'fed' ? { candidates: sim.rimCandidates, fallback: sim.fedFallback } : {};
        appendFileSync(sinkFile, JSON.stringify({ seed, k, sinks: sinks.length, ports, drop, spread, ...fed }) + '\n');
      }
      if (dumps.includes(k)) {
        const dir = `research/front/out/${name}-state`;
        mkdirSync(dir, { recursive: true });
        saveState(sim, `${dir}/s${String(seed)}-${String(k)}.bin.gz`);
      }
      if (!pics.includes(k)) continue;
      const dir = `research/front/out/${name}-pics/s${String(seed)}`;
      mkdirSync(dir, { recursive: true });
      look(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 3 }, `${dir}/look-${String(k)}.png`);
      picture(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 2 }, `${dir}/fields-${String(k)}.png`);
      const full = { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 3 };
      const p = crownProfile(sim);
      const share = thickness(sim);
      const thick = (c: number) => share[c]! >= THICK;
      measureLook(sim, full, `${dir}/measure-${String(k)}.png`, ridgeCells(sim), middles(), LINE, thick);
      if (p.headX >= 0) {
        const size = 90;
        const x = Math.min(Math.max(Math.round(p.headX - size / 2), 0), Math.max(0, sim.w - size));
        const y = Math.min(Math.max(Math.round(p.headY - size * 0.75), 0), Math.max(0, sim.h - size));
        look(
          sim,
          { x, y, w: Math.min(size, sim.w), h: Math.min(size, sim.h), zoom: 6 },
          `${dir}/close-${String(k)}.png`,
        );
      }
    }
    const ms = Math.round(performance.now() - t0);
    // The base conductance only when it is set, so that the records of the default keep their form.
    const record = base === undefined ? { seed, o, front, rows, ms } : { seed, o, front, base, rows, ms };
    appendFileSync(file, JSON.stringify(record) + '\n');
    const end = rows.at(-1);
    console.log(`seed ${String(seed)}: ${JSON.stringify(end)} (${String(ms)} ms)`);
  }
}
