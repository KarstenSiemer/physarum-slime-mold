// The numbers of the amendment of ADR 0025 of 2026-11-13 come from the logs of this folder (README.md). The logs are
// one archive, logs.tar.gz: this test unpacks it into a folder of its own, runs tables.ts as a person would, and
// compares what it prints with the table of the ADR.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { readArchive, unpackLogs } from '../flow/logs.ts';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const exec = promisify(execFile);
const ARCHIVE = here('./logs.tar.gz');
// Each check that runs tables.ts starts a Node process, which loads the TypeScript compiler: about 1 s on an M3 Pro.
// The limit follows ADR 0010 (four times the time on GitHub at least).
const LIMIT = 60_000;

const record = mkdtempSync(join(tmpdir(), 'research-corner-logs-'));
unpackLogs(record, ARCHIVE);
afterAll(() => {
  rmSync(record, { recursive: true, force: true });
});

/** Runs tables.ts; gives its exit code and what it printed. */
async function tables(args: string[]): Promise<{ code: number; text: string }> {
  const file = here('./tables.ts');
  try {
    const { stdout } = await exec(process.execPath, ['--import', here('../flow/register.mjs'), file, ...args]);
    return { code: 0, text: stdout };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string };
    return { code: failed.code ?? -1, text: failed.stdout ?? '' };
  }
}

/** The rows of a Markdown table as lists of trimmed cells, without the line of dashes. */
const cells = (lines: string[]) =>
  lines
    .filter((line) => line.startsWith('|') && !/^\|[\s|:-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    );

describe('the record of the corner rule', () => {
  it(
    'gives the table of the Foraging maze in ADR 0025 from the logs',
    async () => {
      const { code, text } = await tables(['maze', join(record, 'logs', 'maze')]);
      expect(code).toBe(0);
      const adr = readFileSync(here('../../docs/adr/0025-growth-and-shrinkage.md'), 'utf8');
      const section =
        adr.split('\n## Amendment 2026-11-13: no child between two walls that touch at a corner')[1] ?? '';
      const lines = section.split('\n');
      // The header of the table: Prettier pads its cells.
      const start = lines.findIndex(
        (line) => cells([line])[0]?.slice(0, 4).join('|') === 'Backend|Flow|Screen|`main`: path, steps (median)',
      );
      expect(start).toBeGreaterThan(0);
      const rows = lines.slice(start);
      const end = rows.findIndex((line) => !line.startsWith('|'));
      expect(cells(rows.slice(0, end))).toEqual(cells(text.trim().split('\n')));
    },
    LIMIT,
  );

  it(
    'finds the lines of a rerun equal, and fails on a changed line',
    async () => {
      const maze = join(record, 'logs', 'maze');
      const same = await tables(['same', maze, maze]);
      expect(same.code).toBe(0);
      expect(same.text).not.toContain('differ');
      const changed = mkdtempSync(join(tmpdir(), 'research-corner-changed-'));
      try {
        cpSync(maze, changed, { recursive: true });
        const file = join(changed, 'either-start-webgpu.txt');
        writeFileSync(file, readFileSync(file, 'utf8').replace('reached=', 'reached=1'));
        const differ = await tables(['same', maze, changed]);
        expect(differ.code).toBe(1);
        expect(differ.text).toContain('either-start-webgpu.txt: 1 line differs');
      } finally {
        rmSync(changed, { recursive: true, force: true });
      }
    },
    LIMIT,
  );

  it('holds the logs of the record', () => {
    const digest = createHash('sha256');
    for (const { name, data } of readArchive(ARCHIVE)) digest.update(`${name}\0${String(data.length)}\0`).update(data);
    // A new campaign changes the record: pack the archive again (README.md) and put the new number here.
    expect(digest.digest('hex')).toBe('32c69472ad2c914f51e477b542f34efcf3f58897a13d679c13bd37fddbb9179f');
  });
});
