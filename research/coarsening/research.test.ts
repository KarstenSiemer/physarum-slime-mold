// The numbers of ADR 0045 come from the logs of this folder (README.md). The logs are one archive, logs.tar.gz: this
// test unpacks it into a folder of its own, makes the tables of tables.ts, and compares them with README.md. It also
// checks the measures of measure.ts on shapes whose answer is known.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readArchive, unpackLogs } from '../flow/logs.ts';
import { network } from '../flow/prototype/tokyo.ts';
import { coverage, enclosingCircle, lacunae, maskOfText, maskText, veinMask, veins } from './measure.ts';
import { paperTc, report, runsOf } from './tables.ts';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const ARCHIVE = here('./logs.tar.gz');
const record = mkdtempSync(join(tmpdir(), 'research-coarsening-logs-'));
unpackLogs(record, ARCHIVE);
afterAll(() => {
  rmSync(record, { recursive: true, force: true });
});

/** A mask of `w` × `h` cells with 1 where `on` says so. */
function draw(w: number, h: number, on: (x: number, y: number) => boolean): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = on(x, y) ? 1 : 0;
  return mask;
}
const ring = (cx: number, cy: number, r: number, half: number) => (x: number, y: number) =>
  Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r) <= half;

describe('the measures of the coarsening network', () => {
  it('finds the smallest circle around a mask', () => {
    const disc = draw(100, 100, (x, y) => Math.hypot(x + 0.5 - 40, y + 0.5 - 60) <= 25);
    const c = enclosingCircle(disc, 100, 100);
    expect(c.x).toBeCloseTo(40, 0);
    expect(c.y).toBeCloseTo(60, 0);
    expect(c.r).toBeGreaterThan(24);
    expect(c.r).toBeLessThanOrEqual(25);
    // Two cells: the circle through both centres. One cell: a point.
    const two = draw(50, 50, (x, y) => y === 10 && (x === 5 || x === 25));
    expect(enclosingCircle(two, 50, 50)).toEqual({ x: 15.5, y: 10.5, r: 10 });
    expect(
      enclosingCircle(
        draw(50, 50, (x, y) => x === 7 && y === 9),
        50,
        50,
      ).r,
    ).toBe(0);
    // Every cell of a mask without symmetry lies inside its circle.
    const odd = draw(80, 80, (x, y) => (x * 7 + y * 13) % 31 === 0 && x > 10 && y < 60);
    const o = enclosingCircle(odd, 80, 80);
    for (let cell = 0; cell < odd.length; cell++)
      if (odd[cell])
        expect(Math.hypot((cell % 80) + 0.5 - o.x, Math.floor(cell / 80) + 0.5 - o.y)).toBeLessThan(o.r + 1e-6);
  });

  it('counts the lacunae of a mask, and the coverage of a ring', () => {
    const one = draw(100, 100, ring(50, 50, 30, 2));
    expect(lacunae(one, 100, 100).count).toBe(1);
    // A ring with a gap holds none: its inside reaches the edge of the lattice.
    const open = one.slice();
    for (let x = 70; x < 90; x++) for (let y = 49; y < 52; y++) open[y * 100 + x] = 0;
    expect(lacunae(open, 100, 100).count).toBe(0);
    // Two rings side by side hold two; a hole below 20 cells is no lacuna.
    const two = draw(200, 100, (x, y) => ring(50, 50, 30, 2)(x, y) || ring(150, 50, 30, 2)(x, y));
    expect(lacunae(two, 200, 100).count).toBe(2);
    const small = draw(50, 50, (x, y) => x > 5 && x < 40 && y > 5 && y < 40 && !(x > 20 && x < 24 && y > 20 && y < 24));
    expect(lacunae(small, 50, 50).count).toBe(0);
    // A ring of radius R and width w covers about 2 w / R of its circle.
    const cover = coverage(one, 100, 100);
    expect(cover.holes).toBe(1);
    expect(cover.rho).toBeGreaterThan(0.2);
    expect(cover.rho).toBeLessThan(0.27);
    expect(coverage(new Uint8Array(100), 10, 10)).toEqual({ av: 0, r: 0, rho: 0, holes: 0, holeCells: 0 });
  });

  it('makes the mask of a trail and keeps it through its text', () => {
    const trail = new Float32Array(4 * 20);
    for (const c of [0, 3, 9, 19]) trail[c * 4] = 2;
    trail[4 * 5] = 1.25;
    const mask = veinMask(trail, 20, 1.25);
    expect([...mask].flatMap((m, c) => (m ? [c] : []))).toEqual([0, 3, 9, 19]);
    expect(maskOfText(maskText(mask), 20)).toEqual(mask);
  });

  it('counts the veins and the degrees of a graph', () => {
    // A theta: two junctions joined by three veins, with a loose end and a vertex in the middle of a vein.
    const theta = [
      { a: 0, b: 1, length: 10 },
      { a: 0, b: 1, length: 20 },
      { a: 0, b: 2, length: 5 },
      { a: 2, b: 1, length: 7 },
      { a: 1, b: 3, length: 4 },
      { a: 3, b: 4, length: 4 },
    ];
    const t = veins(theta);
    expect(t.lengths.sort((p, q) => p - q)).toEqual([10, 12, 20]);
    expect(t.degrees).toEqual([3, 3]);
    // A lone ring and a tree hold no vein between junctions.
    expect(
      veins([
        { a: 0, b: 1, length: 9 },
        { a: 1, b: 0, length: 9 },
      ]).lengths,
    ).toEqual([]);
    expect(
      veins([
        { a: 0, b: 1, length: 9 },
        { a: 1, b: 2, length: 9 },
        { a: 1, b: 3, length: 9 },
      ]).lengths,
    ).toEqual([]);
  });

  it('finds the three veins of two rings that share a wall, with the skeleton code of the Tokyo measures', () => {
    const mask = draw(160, 100, (x, y) => ring(55, 50, 30, 3)(x, y) || ring(105, 50, 30, 3)(x, y));
    const v = veins(network(mask, 160, 100, []).links);
    // Two rings that cross twice: 4 junctions of degree 4 would be the answer for thin lines. Thick rings merge
    // around each crossing, so the skeleton holds junctions of degree 3 or 4; the faces stay: 3 lacunae.
    expect(lacunae(mask, 160, 100).count).toBe(3);
    expect(v.lengths.length).toBeGreaterThanOrEqual(4);
    // Euler's formula for a connected planar graph: veins − junctions + 1 = lacunae.
    expect(v.lengths.length - v.degrees.length + 1).toBe(3);
  });
});

/** The rows of the Markdown tables of a text as lists of trimmed cells, without the lines of dashes. */
const tableRows = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[\s|:-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    );

describe('the record of the coarsening network', () => {
  const logs = join(record, 'logs');

  it('gives the tables and the lines of README.md from the logs', () => {
    const text = report(logs);
    const readme = readFileSync(here('./README.md'), 'utf8');
    const numbers = readme.split('\n## The numbers')[1]?.split('\n## ')[0] ?? '';
    expect(tableRows(numbers)).toEqual(tableRows(text));
    for (const line of text.split('\n').filter((l) => l !== '' && !l.startsWith('|'))) expect(numbers).toContain(line);
  });

  it('holds 3 runs of each sensor distance, each one down to a spot', () => {
    const lines = readFileSync(join(logs, 'coarsen-webgpu.jsonl'), 'utf8').trim().split('\n');
    const runs = runsOf(lines.map((l) => JSON.parse(l) as Parameters<typeof runsOf>[0][number]));
    expect(runs.map((r) => r.so)).toEqual([3, 5, 7, 9, 11, 13, 15].flatMap((so) => [so, so, so]));
    for (const r of runs) {
      expect(r.tc, `${String(r.so)}/${String(r.seed)}`).toBeGreaterThan(0);
      // In one run (SO 13, seed 2) the last two lacunae closed between two samples: no sample holds its ring.
      expect(r.tmax).toBeGreaterThanOrEqual(r.tc);
      // The run went on for 1,500 steps after its last lacuna.
      expect((r.samples.at(-1)?.step ?? 0) - r.tmax).toBeGreaterThanOrEqual(1400);
    }
    expect(Math.round(paperTc(5))).toBe(7036);
  });

  it('holds the logs of the record', () => {
    const entries = readArchive(ARCHIVE);
    expect(entries).toHaveLength(3);
    const digest = createHash('sha256');
    for (const { name, data } of entries) digest.update(`${name}\0${String(data.length)}\0`).update(data);
    // A new campaign changes the record: pack the archive again (README.md) and put the new number here.
    expect(digest.digest('hex')).toBe('92f4d7ee7efeab86efb946b1a6847e68d2c9e96ff6e349f416d5db54953cf2ca');
  });
});
