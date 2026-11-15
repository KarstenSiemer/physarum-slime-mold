// The table of ADR 0046 from the logs of research/flow/engine/bench.gpu.test.ts: the time of a step of the scene
// Transport network with a mean window of 3, 5 and 15 cells, on its lattice and on a larger one (README.md).
// Usage: node --import ./research/flow/register.mjs research/mean-window/tables.ts [folder of the logs]
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A line of bench.gpu.test.ts: the median, the least and the most time of a step over its samples, in ms. */
interface Row {
  kind: string;
  w: number;
  h: number;
  agents: number;
  meanWindow: number;
  median: number;
}

/** The lines of every round of the folder: files `<name>-r<round>.jsonl`. */
export function rowsOf(folder: string): Row[] {
  return readdirSync(folder)
    .filter((name) => /-r\d+\.jsonl$/.test(name))
    .sort()
    .flatMap((name) =>
      readFileSync(join(folder, name), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Row),
    );
}

/**
 * The table: per grid, backend and window the median over the rounds of the median time of a step, the least and the
 * most of the rounds, and the median against that of the window of 3 cells.
 */
export function table(rows: Row[]): string[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${String(r.w)} × ${String(r.h)}|${r.kind}|${String(r.meanWindow)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const median = (list: Row[]) => list.map((r) => r.median).sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;
  const lines = [
    '| Grid | Backend | Window | Rounds | ms per step | least | most | against 3 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const order = (key: string) => {
    const [grid = '', kind = '', window = ''] = key.split('|');
    return [parseInt(grid, 10), kind === 'webgpu' ? 0 : 1, Number(window)] as const;
  };
  const keys = [...groups.keys()].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  for (const key of keys) {
    const list = groups.get(key) ?? [];
    const [grid = '', kind = '', window = ''] = key.split('|');
    const base = groups.get(`${grid}|${kind}|3`);
    const times = list.map((r) => r.median);
    const factor = base ? (median(list) / median(base)).toFixed(2) : '';
    lines.push(
      `| ${grid} | ${kind} | ${window} | ${String(list.length)} | ${median(list).toFixed(3)} | ${Math.min(...times).toFixed(3)} | ${Math.max(...times).toFixed(3)} | ${factor} |`,
    );
  }
  return lines;
}

// Only when Node runs this file as a script, and not when a test loads it.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2] ?? fileURLToPath(new URL('./logs/bench', import.meta.url));
  console.log(table(rowsOf(folder)).join('\n'));
}
