// Part E5a of stage 4 (ADR 0086): the time of a step of the Maze per build and backend, from the records of
// research/front/e5a-times.sh: the median of each round, the median over the rounds, and its share above `main`.
// Usage: node research/front/e5a-times.ts [<folder of the records, e.g. research/flow/logs/engine/levers-0086>]
import { existsSync, readFileSync } from 'node:fs';

const folder = process.argv[2];
/** Each build and the folder of its records: the copies of e5a-times.sh, or one folder of the archive. */
const builds: [string, string][] = [
  ['main', folder ?? '.main-src/research/flow/out/engine'],
  ['uniform4', folder ?? '.uniform-src/research/flow/out/engine'],
  ['edges4', folder ?? 'research/flow/out/engine'],
  ['edges8', folder ?? 'research/flow/out/engine'],
];
const median = (v: readonly number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const all = new Map<string, Map<string, number[]>>();
for (const [name, dir] of builds)
  for (let r = 1; r <= 99; r++) {
    const file = `${dir}/steps-${name}-r${String(r)}.jsonl`;
    const raw = `${dir}/${name}-r${String(r)}.jsonl`;
    const path = existsSync(file) ? file : raw;
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as { kind: string; median: number };
      const kind = all.get(row.kind) ?? new Map<string, number[]>();
      all.set(row.kind, kind);
      kind.set(name, [...(kind.get(name) ?? []), row.median]);
    }
  }
for (const [kind, byBuild] of all) {
  const main = median(byBuild.get('main') ?? []);
  console.log(kind);
  for (const [name, times] of byBuild) {
    const m = median(times);
    const share = ((m / main - 1) * 100).toFixed(1);
    const each = times.map((t) => t.toFixed(3)).join(' ');
    console.log(
      `  ${name.padEnd(9)} ${m.toFixed(3)} ms, ${share} % above main, ${String(times.length)} rounds: ${each}`,
    );
  }
}
