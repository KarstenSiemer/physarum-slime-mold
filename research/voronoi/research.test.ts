// The numbers of ADR 0048 come from the logs of this folder (README.md). The logs are one archive, logs.tar.gz: this
// test unpacks it into a folder of its own, makes the tables of tables.ts, and compares them with README.md. It also
// checks the measures of measure.ts on shapes whose answer is known.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { VORONOI_DOTS } from '../../src/model/presets.ts';
import { readArchive, unpackLogs } from '../flow/logs.ts';
import {
  cellsOfDots,
  crossing,
  dishCells,
  distanceTo,
  EDGE_STEP,
  occupancy,
  score,
  voronoiEdges,
  type Dish,
  type Point,
} from './measure.ts';
import { field, reach, reachReport } from './reach.ts';
import { dishOf, jsonl, measureRadius, reduced, report } from './tables.ts';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const ARCHIVE = here('./logs.tar.gz');
const record = mkdtempSync(join(tmpdir(), 'research-voronoi-logs-'));
unpackLogs(record, ARCHIVE);
afterAll(() => {
  rmSync(record, { recursive: true, force: true });
});

/** A mask of `w` × `h` cells with 1 where `on` says so. */
function draw(w: number, h: number, on: (x: number, y: number) => boolean): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = on(x + 0.5, y + 0.5) ? 1 : 0;
  return mask;
}

describe('the measures of the Voronoi diagram', () => {
  // Two dots side by side: their diagram is the one line halfway between them.
  const two: Dish = {
    w: 100,
    h: 100,
    centre: [50, 50],
    dots: [
      [30, 50],
      [70, 50],
    ],
  };

  it('finds the edges of a diagram inside a circle', () => {
    const edges = voronoiEdges(two.dots, two.centre, 40);
    for (const [x, y] of edges) {
      expect(x).toBeCloseTo(50, 9);
      expect(Math.abs(y - 50)).toBeLessThanOrEqual(40);
    }
    // The line crosses the circle along its diameter of 80 cells.
    expect(edges.length * EDGE_STEP).toBeCloseTo(80, 0);
    // Three dots at the corners of a triangle with equal sides: three edges that meet at its centre. Each runs from
    // the centre to the circle, away from the corner across.
    const r = 30;
    const corners: Point[] = [0, 1, 2].map((k): Point => {
      const a = (2 * Math.PI * k) / 3;
      return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
    });
    const three = voronoiEdges(corners, [50, 50], 40);
    // The point at the centre lies on all three.
    expect(Math.abs(three.length * EDGE_STEP - 3 * 40)).toBeLessThan(1);
    for (const [x, y] of three) {
      const d = corners.map((c) => Math.hypot(x - c[0], y - c[1])).sort((p, q) => p - q);
      expect((d[1] ?? 0) - (d[0] ?? 0)).toBeLessThan(1e-6);
    }
  });

  it('holds the diagram of the seven dots of the scene: a hexagon and six spokes', () => {
    const dish = dishOf(239, 239);
    expect(dish.centre).toEqual([119.5, 119.5]);
    expect(dish.dots).toHaveLength(VORONOI_DOTS.length);
    const edges = voronoiEdges(dish.dots, dish.centre, 109.5);
    // Every edge point lies as far from its nearest dot as from the next.
    for (const [x, y] of edges) {
      const d = dish.dots.map((c) => Math.hypot(x - c[0], y - c[1])).sort((p, q) => p - q);
      expect((d[1] ?? 0) - (d[0] ?? 0)).toBeLessThan(1e-6);
    }
    // The hexagon around the middle dot (its side about 25 cells) and six spokes of 70 to 90 cells.
    const length = edges.length * EDGE_STEP;
    expect(length).toBeGreaterThan(6 * 22 + 6 * 70);
    expect(length).toBeLessThan(6 * 28 + 6 * 90);
    // The diagram closes seven cells with the rim: each dot alone in one.
    const mask = new Uint8Array(239 * 239);
    for (const [x, y] of edges) mask[Math.floor(y) * 239 + Math.floor(x)] = 1;
    const thick = draw(239, 239, (x, y) => {
      for (let v = -1; v <= 1; v++)
        for (let u = -1; u <= 1; u++) if (mask[Math.floor(y + v) * 239 + Math.floor(x + u)]) return true;
      return Math.hypot(x - 119.5, y - 119.5) >= 109.5;
    });
    expect(cellsOfDots(thick, dishCells(239, 239), dish)).toEqual({ parts: 7, alone: 7, covered: 0 });
  });

  it('gives the distance of every cell from a set of points', () => {
    const points: Point[] = [
      [10.5, 10.5],
      [80.5, 40.5],
    ];
    const d = distanceTo(points, 100, 60);
    for (const [x, y] of [
      [10, 10],
      [0, 0],
      [99, 59],
      [45, 25],
      [80, 0],
    ] as const) {
      const exact = Math.min(...points.map((p) => Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1])));
      expect(d[y * 100 + x]).toBeCloseTo(exact, 4);
    }
  });

  it('scores a network on the edge, beside it and across it', () => {
    const radius = 40;
    // A line of 3 cells on the edge: every cell on it, the whole edge covered.
    const on = score(
      draw(100, 100, (x) => Math.abs(x - 50) <= 1.5),
      two,
      radius,
    );
    expect([on.onEdge, on.covered]).toEqual([1, 1]);
    expect(on.distance).toBeLessThan(1.1);
    // The same line 10 cells beside the edge: no cell on it, nothing covered.
    const beside = score(
      draw(100, 100, (x) => Math.abs(x - 60) <= 1.5),
      two,
      radius,
    );
    expect([beside.onEdge, beside.covered]).toEqual([0, 0]);
    expect(beside.distance).toBeCloseTo(10, 0);
    // A line across the edge: it covers the 6 cells of the edge around the crossing, of 80.
    const across = score(
      draw(100, 100, (_x, y) => Math.abs(y - 50) <= 0.5),
      two,
      radius,
    );
    expect(across.covered).toBeGreaterThan(0.06);
    expect(across.covered).toBeLessThan(0.1);
    expect(across.onEdge).toBeGreaterThan(0.06);
    expect(across.onEdge).toBeLessThan(0.1);
    // Cells at random: the band of 3 cells on each side of the diameter, over the area of the circle.
    expect(on.chance).toBeCloseTo((2 * 3 * 80) / (Math.PI * 40 * 40), 1);
    expect(score(new Uint8Array(100 * 100), two, radius).cells).toBe(0);
  });

  it('counts the dots that a network closes off alone', () => {
    const open = dishCells(100, 100);
    const rim = (x: number, y: number) => Math.hypot(x - 50, y - 50) >= 44;
    // The rim alone: both dots in one part.
    expect(cellsOfDots(draw(100, 100, rim), open, two)).toEqual({ parts: 1, alone: 0, covered: 0 });
    // The rim and the line between them: each dot alone.
    const split = draw(100, 100, (x, y) => rim(x, y) || Math.abs(x - 50) <= 1);
    expect(cellsOfDots(split, open, two)).toEqual({ parts: 2, alone: 2, covered: 0 });
    // A gap in the line joins the parts again; a gap in the rim opens one part to the outside.
    const gap = draw(100, 100, (x, y) => rim(x, y) || (Math.abs(x - 50) <= 1 && Math.abs(y - 50) > 2));
    expect(cellsOfDots(gap, open, two).alone).toBe(0);
    const leak = draw(100, 100, (x, y) => (rim(x, y) && !(x < 20 && Math.abs(y - 50) < 3)) || Math.abs(x - 50) <= 1);
    expect(cellsOfDots(leak, open, two)).toEqual({ parts: 2, alone: 1, covered: 0 });
    // A network on a dot covers it.
    const onDot = draw(100, 100, (x, y) => rim(x, y) || Math.hypot(x - 30, y - 50) < 3);
    expect(cellsOfDots(onDot, open, two).covered).toBe(1);
  });

  it('reads the cells of the agents alive, and the height of a path', () => {
    const agents = [
      { x: 3.2, y: 4.9, bits: 4 },
      { x: 3.9, y: 4.1, bits: 4 },
      { x: 7.5, y: 0.5, bits: 0 },
      { x: 9.99, y: 9.99, bits: 5 },
    ];
    const mask = occupancy(agents, 10, 10, (bits) => (bits & 4) !== 0);
    expect([...mask].flatMap((m, c) => (m ? [c] : []))).toEqual([43, 99]);
    // A path 12 cells above the middle of a 200 × 200 lattice, 4 cells thick.
    const path = draw(200, 200, (_x, y) => Math.abs(y - 88) <= 1.5);
    const c = crossing(path, 200, 200, -5, 5, 0);
    expect(c.up).toBeCloseTo(12, 6);
    expect(c.span).toBe(3);
    expect(c.cells).toBe(4 * 11);
    expect(crossing(new Uint8Array(200 * 200), 200, 200, -5, 5, 0)).toEqual({ cells: 0, up: 0, span: 0 });
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

describe('the record of the Voronoi diagram', () => {
  const logs = join(record, 'logs');

  it('gives the tables and the lines of README.md from the logs', () => {
    const text = report(logs);
    const readme = readFileSync(here('./README.md'), 'utf8');
    const numbers = readme.split('\n## The numbers')[1]?.split('\n## ')[0] ?? '';
    expect(tableRows(numbers)).toEqual(tableRows(text));
    for (const line of text.split('\n').filter((l) => l !== '' && !l.startsWith('|')))
      expect(numbers.replace(/\s+/g, ' ')).toContain(line);
  }, 120_000);

  it('holds 10 seeds of the scene at five steps, on its lattice, with its ring and its dots', () => {
    const lines = jsonl(join(logs, 'scene.jsonl'));
    expect(lines).toHaveLength(50);
    expect(new Set(lines.map((l) => l.seed)).size).toBe(10);
    expect([...new Set(lines.map((l) => l.step))]).toEqual([300, 1000, 3000, 10000, 20000]);
    for (const l of lines) {
      expect([l.w, l.h, l.food, l.light, l.dot, l.kind]).toEqual([239, 239, 0.5, 0.5, 'scene', 'webgpu']);
      // The ring: about 2 π · 111 · 3 cells. The dots: 7 times 2,243 bytes, less what rounds off the cell centres.
      expect(l.foodCells).toBeGreaterThan(2050);
      expect(l.foodCells).toBeLessThan(2150);
      expect(Math.abs(l.lightSum - 7 * 2243)).toBeLessThan(7 * 10);
    }
    expect(measureRadius()).toBe(94.5);
  });

  it('makes the measures of the record again from the masks that it keeps', () => {
    // A line of the record holds its measures in place of its masks (reduce() in tables.ts). masks.jsonl keeps the
    // masks of the 10 seeds of the scene at step 10,000.
    const masks = jsonl(join(logs, 'masks.jsonl'));
    const scene = jsonl(join(logs, 'scene.jsonl')).filter((l) => l.step === 10000);
    expect(masks).toHaveLength(10);
    for (const l of jsonl(join(logs, 'scene.jsonl'))) expect([l.cells, l.veins]).toEqual([undefined, undefined]);
    masks.forEach((l, i) => {
      expect(l.m).toBeUndefined();
      expect(reduced(l)).toEqual(scene[i]);
    });
    // All 12 edges of the diagram lie in part inside the circle of the measure.
    for (const l of scene) expect(l.m?.edges).toBe(12);
  }, 120_000);

  it('holds 30 seeds of the scene on each backend at step 10,000', () => {
    const gpu = [...jsonl(join(logs, 'scene.jsonl')), ...jsonl(join(logs, 'seeds.jsonl'))].filter(
      (l) => l.step === 10000,
    );
    const gl = jsonl(join(logs, 'webgl2.jsonl'));
    const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(gpu.map((l) => [l.kind, l.seed])).toEqual(seeds.map((seed) => ['webgpu', seed]));
    expect(gl.map((l) => [l.kind, l.seed, l.step])).toEqual(seeds.map((seed) => ['webgl2', seed, 10000]));
    // Both backends paint the same ring and the same dots.
    for (const l of [...gpu, ...gl]) expect([l.foodCells, l.lightSum]).toEqual([gpu[0]?.foodCells, gpu[0]?.lightSum]);
  });

  it('gives the reach of a repellent per decade of its strength, as README.md has it', () => {
    const readme = readFileSync(here('./README.md'), 'utf8');
    for (const line of reachReport().split('\n')) expect(readme).toContain(line);
    // The field of a source falls with the distance, and ten times the source reaches farther.
    const map = field(3, 0.1, 200);
    expect(reach(map, 10, 0.01)).toBeGreaterThan(reach(map, 1, 0.01) + 3);
    expect(reach(map, 1, 1e9)).toBeNaN();
  }, 120_000);

  it('holds the logs of the record', () => {
    const entries = readArchive(ARCHIVE);
    expect(entries).toHaveLength(8);
    const digest = createHash('sha256');
    for (const { name, data } of entries) digest.update(`${name}\0${String(data.length)}\0`).update(data);
    // A new campaign changes the record: pack the archive again (README.md) and put the new number here.
    expect(digest.digest('hex')).toBe('a3bb52e786b4688ddf40a2265ce5f885ef85a64cb5f46fa87fcce90df2e62ded');
  });
});
