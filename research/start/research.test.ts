// The numbers of ADR 0049 come from the logs of this folder (README.md). The logs are one archive, logs.tar.gz: this
// test unpacks it into a folder of its own, makes the table of tables.ts, and compares it with the table of the ADR.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readArchive, unpackLogs } from '../flow/logs.ts';
import { runsOf, table } from './tables.ts';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const record = mkdtempSync(join(tmpdir(), 'research-start-logs-'));
unpackLogs(record, here('./logs.tar.gz'));
afterAll(() => {
  rmSync(record, { recursive: true, force: true });
});

const log = (name: string) => join(record, 'logs', name);
const lines = (name: string) => readFileSync(log(name), 'utf8').split('\n');
/** The cells of a row of a Markdown table, trimmed: Prettier pads them. */
const cells = (line: string) =>
  line
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim())
    .join('|');
const dataRows = (rows: string[]) => rows.filter((l) => /^\| (`\w+\.spec\.ts`|shard|all)/.test(l)).map(cells);
/** The times of the pipelines that a start built one at a time, by their entry point. */
const pipelines = (name: string) =>
  lines(name)
    .map((l) => /^START {3}(\w+)(?: \{.*\})?: ([\d.]+) s$/.exec(l))
    .filter((m) => m !== null)
    .map((m) => ({ entry: m[1], s: Number(m[2]) }));

describe('the record of the start of the app (ADR 0049)', () => {
  it('holds the 6 logs', () => {
    expect(readArchive(here('./logs.tar.gz'))).toHaveLength(6);
  });

  it('gives every row of the table of the ADR from the reports of the e2e tests', () => {
    const adr = readFileSync(
      here('../../docs/adr/0049-build-the-diffusion-and-outline-passes-at-their-first-use.md'),
      'utf8',
    );
    const made = dataRows(table(runsOf(log('e2e/main.json')), runsOf(log('e2e/branch.json'))));
    expect(made).toHaveLength(10);
    expect(dataRows(adr.split('\n'))).toEqual(made);
  });

  it('holds the 30 pipelines of a start on main and the 14 of a start here', () => {
    const [main, branch] = [pipelines('start/start-main.txt'), pipelines('start/start-branch.txt')];
    expect(main).toHaveLength(30);
    expect(main.filter((p) => p.entry === 'diffuse')).toHaveLength(10);
    expect(main.filter((p) => p.entry === 'outline')).toHaveLength(6);
    expect(branch).toHaveLength(14);
    expect(branch.filter((p) => p.entry === 'diffuse' || p.entry === 'outline')).toEqual([]);
  });

  it('holds the same digests of every scene for the branch and for main', () => {
    const rows = (name: string) => lines(`digest/${name}.jsonl`).filter(Boolean);
    const [branch, main] = [rows('digest-branch'), rows('digest-main')];
    expect(branch).toHaveLength(48);
    expect(branch).toEqual(main);
  });
});
