// The numbers of ADR 0046 come from the logs of this folder (README.md). The logs are one archive, logs.tar.gz: this
// test unpacks it into a folder of its own, makes the table of tables.ts, and compares it with the table of the ADR.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readArchive, unpackLogs } from '../flow/logs.ts';
import { rowsOf, table } from './tables.ts';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const record = mkdtempSync(join(tmpdir(), 'research-mean-window-logs-'));
unpackLogs(record, here('./logs.tar.gz'));
afterAll(() => {
  rmSync(record, { recursive: true, force: true });
});

const log = (name: string) => join(record, 'logs', name);
/** The cells of a row of a Markdown table, trimmed: Prettier pads them. */
const cells = (line: string) =>
  line
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim())
    .join('|');
const dataRows = (lines: string[]) => lines.filter((l) => /^\| \d+ × \d+ /.test(l)).map(cells);

describe('the record of the mean window (ADR 0046)', () => {
  it('holds the 23 logs', () => {
    expect(readArchive(here('./logs.tar.gz'))).toHaveLength(23);
  });

  it('gives every row of the table of the ADR from the logs of the time of a step', () => {
    const adr = readFileSync(here('../../docs/adr/0046-the-mean-window-of-the-jones-model.md'), 'utf8');
    const made = dataRows(table(rowsOf(log('bench'))));
    expect(made).toHaveLength(12);
    expect(dataRows(adr.split('\n'))).toEqual(made);
  });

  it('holds the same digests of every scene for the branch and for main', () => {
    const rows = (name: string) =>
      readFileSync(log(`digest/${name}.jsonl`), 'utf8')
        .split('\n')
        .filter(Boolean);
    const [branch, main] = [rows('digest-branch'), rows('digest-main')];
    expect(branch).toHaveLength(46);
    expect(branch).toEqual(main);
  });

  it('holds a failed test for each of the 26 wrong rules', () => {
    const heads = readFileSync(log('mutations.txt'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('== B'));
    expect(heads).toHaveLength(26);
    for (const head of heads) expect(head).toMatch(/Tests [1-9]\d* failed/);
  });
});
