// The table of ADR 0049 from two JSON reports of Playwright: the minutes of each file of the e2e tests and of each of
// the two shards of CI, on `main` and on the branch (README.md).
// Usage: node --import ./research/flow/register.mjs research/start/tables.ts [main.json branch.json]
// Without files it reads the logs of the record (research/start/logs/e2e/, logs.ts unpacks them).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Suite {
  file?: string;
  suites?: Suite[];
  specs?: { line: number; tests: { results: { duration: number }[] }[] }[];
}

/** A test of a report: its file, its line, and the time of its first run in ms. */
export interface Run {
  file: string;
  line: number;
  ms: number;
}

/**
 * The tests of a report in the order of Playwright, which is the order of its shards: the files in their order, and
 * the tests of a file by their line. A report lists the tests of a describe block apart from the others of its file.
 * The sort is stable: the tests of a loop share a line and keep their order.
 */
export function runsOf(path: string): Run[] {
  const report = JSON.parse(readFileSync(path, 'utf8')) as { suites: Suite[] };
  const runs: Run[] = [];
  const walk = (suite: Suite, file: string) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests) runs.push({ file, line: spec.line, ms: t.results[0]?.duration ?? 0 });
    for (const s of suite.suites ?? []) walk(s, s.file ?? file);
  };
  for (const s of report.suites) walk(s, s.file ?? '');
  const files = [...new Set(runs.map((r) => r.file))];
  return files.flatMap((f) => runs.filter((r) => r.file === f).sort((a, b) => a.line - b.line));
}

/**
 * The tests of each of `total` shards, as `--shard` shares them out (filterForShard in playwright/lib/runner): by
 * their count, in their order, the first shards one more where the count does not divide.
 */
export function shards(runs: Run[], total = 2): Run[][] {
  const size = Math.floor(runs.length / total);
  const extra = runs.length - size * total;
  const parts: Run[][] = [];
  let at = 0;
  for (let i = 0; i < total; i++) {
    const n = size + (i < extra ? 1 : 0);
    parts.push(runs.slice(at, at + n));
    at += n;
  }
  return parts;
}

const minutes = (runs: Run[]) => (runs.reduce((sum, r) => sum + r.ms, 0) / 60_000).toFixed(1);

/** The rows of the table of the ADR: each file, each shard and all tests, with their count and minutes before and after. */
export function table(main: Run[], branch: Run[]): string[] {
  const files = [...new Set(main.map((r) => r.file))];
  const row = (name: string, a: Run[], b: Run[]) => `| ${name} | ${String(a.length)} | ${minutes(a)} | ${minutes(b)} |`;
  const [a, b] = [shards(main), shards(branch)];
  return [
    '| Tests | Count | `main` (min) | Here (min) |',
    '| --- | --: | --: | --: |',
    ...files.map((f) =>
      row(
        `\`${f.replace(/^e2e\//, '')}\``,
        main.filter((r) => r.file === f),
        branch.filter((r) => r.file === f),
      ),
    ),
    row('shard 1 of 2', a[0] ?? [], b[0] ?? []),
    row('shard 2 of 2', a[1] ?? [], b[1] ?? []),
    row('all', main, branch),
  ];
}

// Only when Node runs this file as a script, and not when a test loads it.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
  const [main = here('logs/e2e/main.json'), branch = here('logs/e2e/branch.json')] = process.argv.slice(2);
  console.log(table(runsOf(main), runsOf(branch)).join('\n'));
}
