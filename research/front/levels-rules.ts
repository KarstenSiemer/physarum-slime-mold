// Plays rules of the smoothing of the auto levels (src/engine/exposure.ts smooth()) over the records of
// research/front/levels.gpu.test.ts, and reads the measures of ADR 0094 for each rule. The levels change no part of
// the model, so the measurements of a run are the same under every rule: a record holds the measurement `m` of every
// frame, and this script replays the turns of the frames (AutoExposure.update(), gl/backend.ts draw()) over them.
// `engine` is the smooth() of the code; its play of a record of the code must give the gain of every frame of the record
// (the column `check`).
//
//   node --import ./research/flow/register.mjs research/front/levels-rules.ts <record.jsonl> ...
import { readFileSync } from 'node:fs';
import { type Measured, measureSoon, smooth } from '../../src/engine/exposure';
import type { Levels } from '../../src/engine/types';

const TARGET = 1.3;
/** The build-up of the trail under a new colony ends before this step (ADR 0094). */
const BUILT = 101;
/** The window of the pop, in steps. */
const WINDOW = 100;

interface Row {
  step: number;
  gain: number;
  median: number;
  m?: Measured;
}
/** The levels of the frames and the floor of the last measurement (0 before the first). */
type State = Levels & { floor: number; building?: boolean };
type Rule = (now: State, l: Measured, blend: number, fallback: number) => Levels & { building?: boolean };

/** The jump of ADR 0090, item 5, and a share of the measurement otherwise. */
function blended(now: Levels, l: Measured, blend: number) {
  const jump = blend === 1 || TARGET / now.gain + now.black < l.floor;
  const share = jump ? 1 : blend;
  return {
    jump,
    gain: now.gain + (l.gain - now.gain) * share,
    black: now.black + (l.black - now.black) * share,
    strand: now.strand + (l.strand - now.strand) * (jump || now.strand === 0 ? 1 : blend && 0.1),
  };
}

const rules: Record<string, Rule> = {
  engine: (now, l, blend) => smooth({ ...now, building: now.building ?? false }, l, blend),
  // ADR 0090, item 7: the cap at the fixed gain while the floor sets the white level.
  cap: (now, l, blend, fallback) => {
    const b = blended(now, l, blend);
    const capped = b.jump || l.white > l.floor ? b.gain : Math.min(b.gain, Math.max(now.gain, fallback));
    return { gain: capped, black: b.black, strand: b.strand };
  },
  // (a): no cap.
  a: (now, l, blend) => {
    const b = blended(now, l, blend);
    return { gain: b.gain, black: b.black, strand: b.strand };
  },
  // (b): no brightening while the floor sets the white level and rises from the last measurement.
  b: (now, l, blend) => {
    const b = blended(now, l, blend);
    const rising = l.white <= l.floor && l.floor > now.floor;
    return { gain: b.jump || !rising ? b.gain : Math.min(b.gain, now.gain), black: b.black, strand: b.strand };
  },
  // (c): (a), and while the floor sets the white level and rises from the last measurement, the frames take at most the
  // gain of the floor grown once more by its last rise: the gain of the trail of the next frame.
  c: (now, l, blend) => {
    const b = blended(now, l, blend);
    const rising = l.white <= l.floor && now.floor > 0 && l.floor > now.floor;
    const next = rising ? TARGET / ((l.floor * l.floor) / now.floor - l.black) : Infinity;
    return {
      gain: b.jump ? Math.min(b.gain, next) : Math.min(b.gain, Math.max(now.gain, next)),
      black: b.black,
      strand: b.strand,
    };
  },
  // (d): (a), and during the build-up of a colony, from the first measurement with a floor to the first whose floor does
  // not rise, the frames take the measurement as if its floor were the floor grown once more by its last rise.
  d: (now, l, blend) => {
    const floor = l.white <= l.floor ? l.floor : 0;
    const building = floor > now.floor && (now.floor === 0 || now.building === true);
    if (!building || now.floor === 0) return { ...rules.a!(now, l, blend, 0), building };
    const next = (floor * floor) / now.floor;
    const ahead = { ...l, floor: next, white: next, gain: TARGET / (next - l.black) };
    return { ...rules.a!(now, ahead, blend, 0), building };
  },
  // (e): (d), and at the first measurement of a build-up, where no rise is known yet, the frames do not brighten.
  e: (now, l, blend) => {
    const d = rules.d!(now, l, blend, 0);
    const first = d.building === true && now.floor === 0;
    return first && TARGET / now.gain + now.black >= l.floor ? { ...d, gain: Math.min(d.gain, now.gain) } : d;
  },
};

function play(rows: Row[], rule: Rule, fallback: number, turn: number) {
  let now: State = { gain: fallback, black: 0, strand: 0, floor: 0 };
  let [frame, due, soon] = [0, false, true];
  return rows.map((r) => {
    const drawn = now.gain; // the measurement of a frame lands after the frame is drawn
    if (frame++ % turn === 0) due = true;
    if (due || soon) {
      const blend = due ? 0.25 : 0;
      due = false;
      if (r.m) now = { building: false, ...rule(now, r.m, blend, fallback), floor: r.m.floor };
      soon = measureSoon(r.m);
    }
    return drawn;
  });
}

const SWEEP = (process.env.SWEEP ?? '').split(',').filter(Boolean).map(Number);

for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((x) => JSON.parse(x) as Record<string, unknown>);
  const head = lines[0] as { backend: string; fallback: number };
  const rows = lines.filter((x) => typeof x.step === 'number') as unknown as Row[];
  const turn = head.backend === 'webgl2' ? 15 : 6;
  console.log(`${file} (${head.backend}, fallback ${head.fallback.toFixed(3)}, ${rows.length} frames)`);
  console.log('rule    check   M1 product (step)   M2 dark (step)   M3 rise (step)   floor phase ends');
  const end = rows.find((r) => r.m && r.m.white > r.m.floor)?.step;
  for (const [name, rule] of Object.entries(rules))
    for (const fallback of [head.fallback, ...SWEEP.filter((f) => f !== head.fallback)]) {
      const g = play(rows, rule, fallback, turn);
      const check = Math.max(...rows.map((r, i) => Math.abs((g[i] ?? 0) / r.gain - 1)));
      let m1 = { v: 0, step: 0 };
      let m2 = { v: 0, step: 0 };
      let m3 = { v: 0, step: 0 };
      rows.forEach((r, i) => {
        const gi = g[i] ?? 0;
        if (gi * r.median > m1.v) m1 = { v: gi * r.median, step: r.step };
        if (r.step < BUILT) return;
        if (r.m && r.m.white <= r.m.floor && r.m.gain / gi > m2.v) m2 = { v: r.m.gain / gi, step: r.step };
        let low = gi;
        for (let j = i; j >= 0 && (rows[j]?.step ?? 0) >= Math.max(BUILT, r.step - WINDOW); j--)
          low = Math.min(low, g[j] ?? 0);
        if (gi / low > m3.v) m3 = { v: gi / low, step: r.step };
      });
      const f = (x: { v: number; step: number }) => `${x.v.toFixed(2).padStart(6)} (${String(x.step).padStart(4)})`;
      const mark = m1.v > 2.6 || m2.v > 1.5 || m3.v > 1.5 ? ' FAIL' : '';
      console.log(
        `${`${name}@${String(fallback)}`.padEnd(11)} ${fallback === head.fallback ? check.toExponential(0).padStart(6) : '     -'}   ${f(m1)}       ${f(m2)}     ${f(m3)}    ${end ?? '-'}${mark}`,
      );
    }
}
