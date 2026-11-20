// The table of the shift test of part E2d (ADR 0074; shift.sh): per form of the drift and shift of the level of the
// network, the agents of the dish at the steps of the marks over the seeds, and Mann-Whitney's test against the runs
// without a shift. Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/shift.ts research/front/out/<name> [steps=1500,3000]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mannWhitney } from './tables';

const [dir = '', ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => a.split('=') as [string, string]));
const steps = (args.steps ?? '1500,3000').split(',').map(Number);
/** Agents per form, shift and step, one number per seed in the order of the seeds. */
const runs = new Map<string, Map<string, Map<number, Map<number, number>>>>();
for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
  // <form>-<shift>[-s<seed>].txt, the shift `none` or <step>at<by>.
  const m = /^([a-z]+)-(none|\d+at-?\d+)(?:-s\d+)?\.txt$/.exec(file);
  if (!m) continue;
  const [, form = '', shift = ''] = m;
  const byShift = runs.get(form) ?? new Map<string, Map<number, Map<number, number>>>();
  runs.set(form, byShift);
  const byStep = byShift.get(shift) ?? new Map<number, Map<number, number>>();
  byShift.set(shift, byStep);
  let seed = -1;
  for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
    const s = /seed (\d+):/.exec(line);
    if (s) seed = Number(s[1]);
    const a = /^\s+step (\d+) alive (\d+)/.exec(line);
    if (a && seed >= 0) {
      const k = Number(a[1]);
      const bySeed = byStep.get(k) ?? new Map<number, number>();
      byStep.set(k, bySeed);
      bySeed.set(seed, Number(a[2]));
    }
  }
}
const SHIFTS = ['none', '100at200', '100at-200', '1000at200', '1000at-200'];
const NAMES: Record<string, string> = {
  none: 'no shift',
  '100at200': '+200 at 100',
  '100at-200': '−200 at 100',
  '1000at200': '+200 at 1,000',
  '1000at-200': '−200 at 1,000',
};
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
for (const k of steps) {
  console.log(`\nAgents at step ${String(k)}: median (least to most), seeds; p of Mann-Whitney against no shift`);
  console.log(`| Form | ${SHIFTS.map((s) => NAMES[s]).join(' | ')} |`);
  console.log(`| --- | ${SHIFTS.map(() => '---').join(' | ')} |`);
  for (const [form, byShift] of [...runs].sort()) {
    const base = [...(byShift.get('none')?.get(k)?.values() ?? [])];
    const cells = SHIFTS.map((s) => {
      const v = [...(byShift.get(s)?.get(k)?.values() ?? [])];
      if (v.length === 0) return '-';
      const range = `${String(median(v))} (${String(Math.min(...v))} to ${String(Math.max(...v))}), ${String(v.length)}`;
      return s === 'none' || base.length === 0 ? range : `${range}; p ${mannWhitney(v, base).toPrecision(2)}`;
    });
    console.log(`| ${form} | ${cells.join(' | ')} |`);
  }
}
