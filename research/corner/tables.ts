// The tables of the amendment of ADR 0025 of 2026-11-13 from the lines of maze.gpu.test.ts (README.md).
// Usage: node --import ./research/flow/register.mjs research/corner/tables.ts <command> <folders...>
//
// - `maze <folder>`: the table of the Foraging maze, `main` against the rejected rule "either cell beside the corner
//   blocks" (ADR 0025, decision 35), from <folder>/main-*.txt and either-*.txt, for each backend with files.
// - `same <folder a> <folder b>`: for each file of the maze in both folders, whether its lines are equal. Ends with
//   exit code 1 if a line differs, or if a file of folder a is missing in folder b.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCREENS = [
  ['1280x720', '16:9'],
  ['1280x800', '16:10'],
  ['800x800', '1:1'],
] as const;
const FLOWS = [
  ['start', 'start'],
  ['inoc100', 'inoculate at 100'],
  ['inoc1000', 'inoculate at 1,000'],
] as const;
const KINDS = [
  ['webgpu', 'WebGPU'],
  ['webgl2', 'WebGL2'],
] as const;

/** One run: the step of the first path (−1: none), whether the path holds at the end, agents and share near a wall. */
interface Run {
  reached: number;
  final: boolean;
  alive: number;
  nearWall: number;
}

/** The runs of a file by screen. */
function load(file: string): Map<string, Run[]> {
  const out = new Map<string, Run[]>();
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('MAZE')) continue;
    const parts = line.split(' ');
    const screen = parts[4] ?? '';
    const field = (key: string) => parts.find((p) => p.startsWith(`${key}=`))?.slice(key.length + 1) ?? '';
    const last = /15000:(\d+)\/w(\d+)/.exec(field('pop'));
    const run = {
      reached: Number(field('reached')),
      final: field('final') === 'true',
      alive: Number(last?.[1] ?? Number.NaN),
      nearWall: Number(last?.[2] ?? Number.NaN),
    };
    out.set(screen, [...(out.get(screen) ?? []), run]);
  }
  return out;
}

const number = (v: number) => v.toLocaleString('en-US');

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** "10 of 10, 2,501 to 3,901 (3,251)": the seeds with a path, its first step, range and median. */
function path(runs: Run[]): string {
  const steps = runs
    .filter((r) => r.reached > 0)
    .map((r) => r.reached)
    .sort((a, b) => a - b);
  let text = `${String(steps.length)} of ${String(runs.length)}`;
  const held = runs.filter((r) => r.final).length;
  if (held !== steps.length) text += ` (at 15,000: ${String(held)})`;
  if (steps.length > 0)
    text += `, ${number(steps[0] ?? 0)} to ${number(steps.at(-1) ?? 0)} (${number(Math.round(median(steps)))})`;
  return text;
}

const near = (runs: Run[]) => `${String(Math.round(median(runs.map((r) => r.nearWall))))} %`;
const agents = (runs: Run[]) => {
  const a = runs.map((r) => r.alive);
  return `${number(Math.min(...a))} to ${number(Math.max(...a))}`;
};

function maze(folder: string) {
  console.log(
    '| Backend | Flow | Screen | `main`: path, steps (median) | Near a wall | Either blocks: path, steps (median) | Near a wall | Agents at 15,000: `main` | Either blocks |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [kind, kindName] of KINDS.filter(([k]) => existsSync(join(folder, `main-start-${k}.txt`))))
    for (const [flow, flowName] of FLOWS) {
      const before = load(join(folder, `main-${flow}-${kind}.txt`));
      const after = load(join(folder, `either-${flow}-${kind}.txt`));
      for (const [screen, screenName] of SCREENS) {
        const [a, b] = [before.get(screen) ?? [], after.get(screen) ?? []];
        if (a.length === 0 || b.length === 0) throw new Error(`no runs for ${kind} ${flow} ${screen}`);
        const row = [kindName, flowName, screenName, path(a), near(a), path(b), near(b), agents(a), agents(b)];
        console.log(`| ${row.join(' | ')} |`);
      }
    }
}

function same(a: string, b: string) {
  let bad = 0;
  for (const name of readdirSync(a).filter((f) => /^(main|either)-.*\.txt$/.test(f))) {
    const other = join(b, name);
    if (!existsSync(other)) {
      console.log(`${name}: missing in ${b}`);
      bad++;
      continue;
    }
    const [x, y] = [readFileSync(join(a, name), 'utf8').split('\n'), readFileSync(other, 'utf8').split('\n')];
    const differ = x.filter((line, i) => line !== y[i]).length + Math.max(0, y.length - x.length);
    const verdict = differ === 0 ? 'equal' : `${String(differ)} ${differ === 1 ? 'line differs' : 'lines differ'}`;
    console.log(`${name}: ${verdict} (${String(x.length - 1)} lines)`);
    if (differ > 0) bad++;
  }
  if (bad > 0) process.exit(1);
}

const [command, ...folders] = process.argv.slice(2);
if (command === 'maze' && folders[0]) maze(folders[0]);
else if (command === 'same' && folders[0] && folders[1]) same(folders[0], folders[1]);
else {
  console.error('Usage: tables.ts maze <folder> | same <folder a> <folder b>');
  process.exit(1);
}
