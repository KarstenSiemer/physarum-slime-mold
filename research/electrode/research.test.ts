// The numbers of ADR 0047 come from the logs of this folder (README.md). The logs are one archive, logs.tar.gz: this
// test unpacks it into a folder of its own, makes the table of tables.ts, and compares it with the table of the ADR
// and of README.md.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readArchive, unpackLogs } from '../flow/logs.ts';
import { MOVED, RUNS, runsOf, samplesOf, table } from './tables.ts';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const record = mkdtempSync(join(tmpdir(), 'research-electrode-logs-'));
unpackLogs(record, here('./logs.tar.gz'));
afterAll(() => {
  rmSync(record, { recursive: true, force: true });
});

const logs = join(record, 'logs');
/** The cells of a row of a Markdown table, trimmed: Prettier pads them. */
const cells = (line: string) =>
  line
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim())
    .join('|');
/** The rows of the runs in a text: the lines of a table that start with the name of a run. */
const runRows = (lines: string[]) =>
  lines.filter((l) => RUNS.some(([, name]) => l.startsWith(`| ${name} `))).map(cells);

describe('the record of the Electrode tool (ADR 0047)', () => {
  it('holds the 13 logs', () => {
    expect(readArchive(here('./logs.tar.gz'))).toHaveLength(13);
  });

  it('gives every row of the table of the ADR and of README.md from the logs', () => {
    const made = runRows(table(logs));
    expect(made).toHaveLength(RUNS.length);
    for (const file of ['../../docs/adr/0047-an-electrode-tool-and-the-scene-electrotaxis.md', './README.md'])
      expect(runRows(readFileSync(here(file), 'utf8').split('\n')), file).toEqual(made);
  });

  it('holds 10 seeds of 1,500 agents for every run, and the colony at the cathodes on both backends', () => {
    for (const [label] of RUNS) {
      const runs = runsOf(samplesOf(logs, label));
      expect(
        runs.map((r) => r.seed),
        label,
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      for (const r of runs) expect(r.alive, label).toBe(1500);
    }
    for (const label of ['app-webgpu', 'app-webgl2'])
      for (const r of runsOf(samplesOf(logs, label))) {
        expect(r.toward.get(450), label).toBeGreaterThan(MOVED);
        expect(r.toward.get(800), label).toBeGreaterThan(80);
        expect(r.back, label).toBe(0);
        expect(r.atAnode, label).toBe(0);
      }
  });

  it('holds the digests of main for every scene but Electrotaxis', () => {
    const rows = (name: string) =>
      readFileSync(join(logs, `${name}.jsonl`), 'utf8')
        .split('\n')
        .filter(Boolean);
    const [branch, main] = [rows('digest-branch'), rows('digest-main')];
    const other = branch.filter((line) => (JSON.parse(line) as { id: string }).id !== 'electrotaxis');
    expect(main).toHaveLength(46);
    expect(branch).toHaveLength(48);
    expect(other).toEqual(main);
  });

  it('holds a failed test for each of the 21 wrong rules', () => {
    const heads = readFileSync(join(logs, 'mutations.txt'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('== EL'));
    expect(heads).toHaveLength(21);
    for (const head of heads) expect(head).toMatch(/Tests [1-9]\d* failed/);
  });
});
