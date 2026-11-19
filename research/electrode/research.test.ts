// The numbers of ADR 0047 come from the logs of this folder (README.md). The logs are one archive, logs.tar.gz: this
// test unpacks it into a folder of its own, makes the table of tables.ts, and compares it with the table of the ADR
// and of README.md. So with ADR 0058: its tables come from outline.ts and fit.ts, which compute them on the CPU, and
// its records of the digests and of the wrong rules are in the same archive.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readArchive, unpackLogs } from '../flow/logs.ts';
import { fitReport } from './fit.ts';
import { edgeTable, outlineTable, seamTable, wallTable } from './outline.ts';
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
  it('holds the 13 logs, and the 5 of ADR 0058', () => {
    expect(readArchive(here('./logs.tar.gz'))).toHaveLength(22);
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

describe('the record of the look of the electrodes (ADR 0058)', () => {
  const ADR = '../../docs/adr/0058-the-outlines-and-the-surface-of-the-electrodes.md';
  /** The rows of every table of a text, trimmed. */
  const rowsOf = (file: string) =>
    readFileSync(here(file), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('|'))
      .map(cells);
  /** The rows of a table of a script, without the line below its head. */
  const made = (table: string[]) => table.filter((l) => !l.startsWith('| ---')).map(cells);

  it('gives the tables of the outline and of the seam in the ADR and in README.md from outline.ts', () => {
    const [outline, seam, edge, wall] = [outlineTable(), seamTable(), edgeTable(), wallTable()].map(made);
    if (!outline || !seam || !edge || !wall) throw new Error('no table');
    expect([outline.length, seam.length, edge.length, wall.length]).toEqual([7, 7, 4, 6]);
    for (const row of [...outline, ...seam]) expect(rowsOf(ADR), row).toContain(row);
    for (const row of [...outline, ...seam, ...edge, ...wall]) expect(rowsOf('./README.md'), row).toContain(row);
    // The numbers that the texts quote: a dab from 2.5 cells on lies within 0.06 cells of its circle, a dab of 1.5
    // cells up to 0.16 cells inside it, and the rule of ADR 0047 up to 0.5 cells off.
    const range = (row: string, column: number) =>
      (row.split('|')[column] ?? '').replace(/−/g, '-').split(' to ').map(Number);
    for (const row of outline.slice(4)) for (const v of range(row, 5)) expect(Math.abs(v)).toBeLessThanOrEqual(0.06);
    expect(Math.min(...outline.slice(1, 4).flatMap((row) => range(row, 5)))).toBe(-0.16);
    expect(Math.min(...outline.slice(1).flatMap((row) => range(row, 1)))).toBe(-0.5);
    // No ground on the seam with the rule of ADR 0058, at every radius and zoom; with the plain distance a gap of up
    // to 0.14 cells below a radius of 2 cells.
    for (const row of seam.slice(1)) expect(row.split('|').slice(5)).toEqual(['1.00', '1.00', '1.00', '0.00']);
    expect(seam.slice(1).map((row) => row.split('|')[4])).toEqual(['0.14', '0.10', '0.07', '0.00', '0.00', '0.00']);
    // A wall through a pole: a quarter of the ground on the seam with the rule of ADR 0058, 0.98 before it.
    for (const row of wall.slice(1)) expect(row.split('|').slice(3)).toEqual(['0.25', '0.25']);
    expect(wall[1]?.split('|')[1]).toBe('0.98');
  }, 120_000);

  // One grid when ADR 0058 was built, with 26 scenes and 2,916 cases. Then the slime counted 11 B more per cell
  // (ADR 0057, ADR 0060), and two other grids changed in its place. Since ADR 0064 the list holds 28 scenes: the new
  // start scene adds six cases.
  it('changes eight grids of 3,132 cases with the 4 B per cell of the outlines of the poles', async () => {
    const lines = await fitReport();
    const text = [ADR, './README.md'].map((file) => readFileSync(here(file), 'utf8').replace(/\s+/g, ' '));
    expect(lines[0]).toBe('3132 cases: 8 with another grid');
    // The start scene of ADR 0064 loses its lattice on WebGL2 with a memory hint of 0.5 GB, on all six canvases.
    const start = lines.slice(1).filter((line) => line.startsWith('three-networks on WebGL2, a memory hint of 0.5 GB'));
    expect(start).toHaveLength(6);
    for (const line of start) expect(line).toMatch(/: lattice 384 × 384 before, (256|512) now$/);
    // The two other cases, as the ADR and README.md name them.
    expect(lines.slice(1).filter((line) => !start.includes(line))).toEqual([
      'three-strains on WebGL2, a memory hint of 1 GB, a canvas of 390 × 844: 1024 before, 768 now',
      'maze on WebGL2, a memory hint of 0.5 GB, a canvas of 1000 × 1000: 512 before, 256 now',
    ]);
    for (const t of text) {
      expect(t).toContain('3,132 cases');
      expect(t).toContain('2,916 cases');
      expect(t).toContain('from 512 to 256');
      expect(t).toContain('from 1024 to 768');
    }
    // README.md prints the lines of the command.
    for (const line of lines) expect(text[1]).toContain(line);
  }, 120_000);

  it('holds the digests of main for every scene, after 500 and after 3,000 steps', () => {
    const rows = (name: string) =>
      readFileSync(join(logs, `${name}.jsonl`), 'utf8')
        .split('\n')
        .filter(Boolean)
        .sort();
    expect(rows('digest-0058-branch')).toHaveLength(54);
    expect(rows('digest-0058-branch')).toEqual(rows('digest-0058-main'));
    expect(rows('digest-0058-3000-branch')).toHaveLength(16);
    expect(rows('digest-0058-3000-branch')).toEqual(rows('digest-0058-3000-main'));
  });

  it('holds a failed test for each wrong rule EL1 to EL108, and for SL109', () => {
    const heads = readFileSync(join(logs, 'mutations-0058.txt'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('== '));
    expect(heads.map((h) => h.slice(3).split(' ')[0])).toEqual([
      ...Array.from({ length: 108 }, (_, i) => `EL${String(i + 1)}`),
      'SL109',
    ]);
    for (const head of heads) expect(head).toMatch(/Tests [1-9]\d* failed/);
  });
});
