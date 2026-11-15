// The numbers of the amendment of ADR 0036 of 2026-11-14 come from the logs of this folder (README.md). The logs are
// one archive, logs.tar.gz: this test unpacks it into a folder of its own, makes the table of reach.ts, and compares
// it with the tables of the ADR.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { unpackLogs } from '../flow/logs.ts';
import { rowsOf, table } from './reach.ts';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const record = mkdtempSync(join(tmpdir(), 'research-scent-logs-'));
unpackLogs(record, here('./logs.tar.gz'));
afterAll(() => {
  rmSync(record, { recursive: true, force: true });
});

const log = (name: string) => join(record, 'logs', `${name}.jsonl`);
/** The cells of a row of a Markdown table, trimmed: Prettier pads them. */
const cells = (line: string) =>
  line
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
const rowsOfTable = (lines: string[]) => lines.filter((l) => /^\| webgpu|^\| webgl2/.test(l)).map(cells);

describe('the record of the reach of the scent', () => {
  const all = table(rowsOf([log('line-webgpu'), log('profile-webgpu'), log('profile-webgl2')]));

  it('gives every row of the tables of ADR 0036 from the logs', () => {
    const adr = readFileSync(here('../../docs/adr/0036-the-reach-of-the-food-scent-as-a-setting.md'), 'utf8');
    const section = adr.split('\n## Amendment 2026-11-14: Scent reach, as built')[1] ?? '';
    const rows = rowsOfTable(section.split('\n'));
    expect(rows.length).toBeGreaterThan(20);
    const made = rowsOfTable(all).map((r) => r.join('|'));
    for (const row of rows) expect(made, row.join(' | ')).toContain(row.join('|'));
  });

  it('measures the fall-off of the formula beside a line, to 0.5 % above a decay of 0.0003', () => {
    for (const r of rowsOfTable(table(rowsOf([log('line-webgpu')])))) {
      const [measured, formula] = [Number(r[4]), Number(r[5])];
      if (Number(r[3]) > 0.0003) expect(Math.abs(measured / formula - 1), r.join(' ')).toBeLessThan(0.005);
    }
  });

  it('gives the same profile of a dab on both backends', () => {
    const [gpu, gl] = [table(rowsOf([log('profile-webgpu')])), table(rowsOf([log('profile-webgl2')]))];
    expect(gl.map((l) => l.replace('| webgl2 ', '| webgpu '))).toEqual(gpu);
  });
});
