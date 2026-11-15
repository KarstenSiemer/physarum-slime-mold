// The tables of README.md and of ADR 0048 from the lines of voronoi.gpu.test.ts and deflect.gpu.test.ts (README.md
// has the definitions). research.test.ts compares what this file prints with the tables of README.md.
// Usage: node --import ./research/flow/register.mjs research/voronoi/tables.ts [folder of the logs]
//        ... tables.ts scores <file.jsonl> [--band=15] [--veins]   every group of a file, to look at a run
//        ... tables.ts reduce <out folder> <logs folder>           the lines of a campaign as the record holds them
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VORONOI_DOTS, VORONOI_RING } from '../../src/model/presets.ts';
import { lacunae, maskOfText } from '../coarsening/measure.ts';
import { cellsOfDots, crossing, DEFLECT, dishCells, edgeField, NEAR, score, type Dish, type Point } from './measure.ts';

export interface Line {
  kind: string;
  scene: string;
  w: number;
  h: number;
  dot: string;
  food: number;
  light: number;
  foodCells: number;
  lightSum: number;
  seed: number;
  step: number;
  alive: number;
  /**
   * The cells that hold an agent, and the cells whose trail lies above a quarter of a deposit (maskText()). A line of
   * the record holds its measures in their place (reduce()).
   */
  cells?: string;
  veins?: string;
  m?: Numbers;
}

/** The measures of one sample (README.md, Definitions). */
export interface Numbers {
  onEdge: number;
  covered: number;
  chance: number;
  distance: number;
  /** The cells of the network inside the circle of the measure. */
  inner: number;
  /** The dots that lie alone in a closed part of the dish. */
  alone: number;
  /** The edges of the diagram that the network draws, and their number. */
  drawn: number;
  edges: number;
  /** The parts of the dish that the network closes off, with a dot or without (at least 20 cells). */
  holes: number;
}

/** The rim band: the measure leaves out this many cells inside the ring of attractant (README.md, Definitions). */
export const BAND = 15;
/** The radius of the circle of the measure, in cells: the inner edge of the ring less the band. */
export const measureRadius = (band = BAND) => VORONOI_RING.radius - VORONOI_RING.width / 2 - band;

/** The dish of the scene on a `w` × `h` lattice: the dots sit on the centres of their cells. */
export function dishOf(w: number, h: number): Dish {
  const centre: Point = [Math.floor(w / 2) + 0.5, Math.floor(h / 2) + 0.5];
  return { w, h, centre, dots: VORONOI_DOTS.map(([x, y]): Point => [centre[0] + x, centre[1] + y]) };
}

export const jsonl = (file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Line);

/**
 * What closes the cells of the diagram: the trail mask, the cells with an agent, and the ring of attractant. A row
 * of agents alone has gaps. The trail alone is open at the rim, where the agents on the ring stand packed: an agent
 * that cannot move deposits nothing.
 */
export function wallsOf(line: Line): Uint8Array {
  const { w, h } = line;
  const [veins, cells] = [maskOfText(line.veins ?? '', w * h), maskOfText(line.cells ?? '', w * h)];
  const { centre } = dishOf(w, h);
  const inner = VORONOI_RING.radius - VORONOI_RING.width / 2;
  const out = new Uint8Array(w * h);
  for (let c = 0; c < w * h; c++) {
    const r = Math.hypot((c % w) + 0.5 - centre[0], Math.floor(c / w) + 0.5 - centre[1]);
    out[c] = veins[c] || cells[c] || r >= inner ? 1 : 0;
  }
  return out;
}

export interface Measured extends Numbers {
  line: Line;
}

const fields = new Map<string, ReturnType<typeof edgeField>>();

/**
 * The measures of one sample: those that a line of the record holds, or else from its masks. The shares are read
 * from the mask `which`; the cells of the diagram from both masks and the ring (wallsOf()).
 */
export function measure(line: Line, band = BAND, which: 'cells' | 'veins' = 'cells'): Measured {
  if (line.m) return { line, ...line.m };
  const { w, h } = line;
  const dish = dishOf(w, h);
  const key = [w, h, band].join('|');
  const field = fields.get(key) ?? edgeField(dish, measureRadius(band));
  fields.set(key, field);
  const s = score(maskOfText(line[which] ?? '', w * h), dish, measureRadius(band), NEAR, field);
  const walls = wallsOf(line);
  const closed = cellsOfDots(walls, dishCells(w, h), dish);
  return {
    line,
    onEdge: s.onEdge,
    covered: s.covered,
    chance: s.chance,
    distance: s.distance,
    inner: s.cells,
    alone: closed.alone,
    drawn: s.drawn,
    edges: s.edges,
    holes: lacunae(walls, w, h).count,
  };
}

/** A line as the record holds it: its measures in place of its masks. */
export function reduced(line: Line): Line {
  const { line: _, ...m } = measure(line);
  const { cells: __, veins: ___, ...rest } = line;
  return { ...rest, m };
}

export const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
export const range = (v: number[], digits = 2) =>
  `${mean(v).toFixed(digits)} (${Math.min(...v).toFixed(digits)} to ${Math.max(...v).toFixed(digits)})`;
export const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;

/** One entry per group of runs (dot, food, light, step), in the order of the file: the measures of its seeds. */
export function groups(lines: Line[], band = BAND, which: 'cells' | 'veins' = 'cells') {
  const by = new Map<string, Measured[]>();
  for (const line of lines) {
    const key = [line.dot, line.food, line.light, line.step].join('|');
    by.set(key, [...(by.get(key) ?? []), measure(line, band, which)]);
  }
  return [...by.values()].map((g) => {
    const first = g[0]!;
    return {
      dot: first.line.dot,
      food: first.line.food,
      light: first.line.light,
      step: first.line.step,
      seeds: g.length,
      alive: mean(g.map((m) => m.line.alive)),
      inner: mean(g.map((m) => m.inner)),
      onEdge: g.map((m) => m.onEdge),
      covered: g.map((m) => m.covered),
      chance: first.chance,
      distance: g.map((m) => m.distance),
      alone: g.map((m) => m.alone),
      holes: g.map((m) => m.holes),
      drawn: g.map((m) => m.drawn),
      /** The runs whose network is the diagram: it draws every edge, and it closes the seven cells and no other. */
      whole: g.filter((m) => m.drawn === m.edges && m.alone === 7 && m.holes === 7).length,
      /** The runs with the cells of the Voronoi diagram: seven parts, each with one dot. */
      exact: g.filter((m) => m.alone === 7 && m.holes === 7).length,
      lightSum: first.line.lightSum,
    };
  });
}

function scores(file: string, band: number, which: 'cells' | 'veins') {
  const out = [
    row([
      'dot',
      'food',
      'light',
      'step',
      'n',
      'alive',
      'inner',
      'on edge',
      'covered',
      'dist',
      'alone',
      'holes',
      'exact',
      'drawn',
    ]),
  ];
  for (const g of groups(jsonl(file), band, which))
    out.push(
      row([
        g.dot,
        g.food,
        g.light,
        g.step,
        g.seeds,
        Math.round(g.alive),
        Math.round(g.inner),
        range(g.onEdge),
        range(g.covered),
        mean(g.distance).toFixed(1),
        `${mean(g.alone).toFixed(1)} (${g.alone.join('')})`,
        g.holes.join(' '),
        g.exact,
        g.drawn.join(' '),
      ]),
    );
  return out.join('\n');
}

type Group = ReturnType<typeof groups>[number];
const int = (v: number) => Math.round(v).toLocaleString('en-US');
/** The cells of a row that every table of the record shares. */
const shares = (g: Group) => [
  range(g.onEdge),
  range(g.covered),
  mean(g.distance).toFixed(1),
  `${String(g.exact)} of ${String(g.seeds)}`,
  mean(g.drawn).toFixed(1),
  `${String(g.whole)} of ${String(g.seeds)}`,
];
const SHARES = ['on an edge', 'edges covered', 'distance', 'seven cells', 'edges of 12', 'whole diagram'];
const table = (head: string[], rows: (string | number)[][]) =>
  [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');

/** One line of deflect.gpu.test.ts. A line of the record holds the crossing in place of the mask. */
export interface Deflected {
  light: number;
  /** The step at which the network was one path, and the first repellent came. */
  formed: number;
  lightSum: number;
  seed: number;
  stage: string;
  alive: number;
  w: number;
  h: number;
  cells?: string;
  p?: ReturnType<typeof crossing>;
}

/** Where the network of a line of deflect.gpu.test.ts crosses the middle of the dish, above the line of the foods. */
export const crossingOf = (l: Deflected) =>
  l.p ?? crossing(maskOfText(l.cells ?? '', l.w * l.h), l.w, l.h, -5, 5, DEFLECT.foods[0][1]);

/** The files of the record. */
export const FILES = ['scene', 'dots', 'sweep', 'food', 'seeds', 'webgl2'] as const;
/** The samples whose masks the record keeps, in masks.jsonl: the 10 seeds of the scene at step 10,000. */
export const keepsMasks = (l: Line) => l.step === 10000;

/**
 * The record of a campaign: the lines of `out` with their measures in place of their masks, in `logs`. The masks of a
 * run are 4 kB a line after packing, too much for the archive; masks.jsonl keeps those of ten samples, so that the
 * test can make their measures again.
 */
export function reduce(out: string, logs: string): void {
  mkdirSync(logs, { recursive: true });
  const text = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  for (const file of FILES)
    writeFileSync(join(logs, `${file}.jsonl`), text(jsonl(join(out, `${file}.jsonl`)).map(reduced)));
  writeFileSync(join(logs, 'masks.jsonl'), text(jsonl(join(out, 'scene.jsonl')).filter(keepsMasks)));
  const deflect = readFileSync(join(out, 'deflect.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Deflected);
  writeFileSync(
    join(logs, 'deflect.jsonl'),
    text(
      deflect.map((l) => {
        const { cells: _, ...rest } = l;
        return { ...rest, p: crossingOf(l) };
      }),
    ),
  );
}

/** The tables and lines of README.md, "The numbers", from the folder of the logs. */
export function report(logs: string): string {
  const scene = groups(jsonl(join(logs, 'scene.jsonl')));
  const settled = scene.find((g) => g.step === 10000)!;
  const out: string[] = [];
  out.push(
    `Cells at random inside the circle of the measure: ${settled.chance.toFixed(2)} of them lie within ${String(NEAR)} cells of an edge.`,
    '',
    'The scene over time, 10 seeds, WebGPU.',
    '',
    table(
      ['Step', 'agents', 'in the circle', ...SHARES],
      scene.map((g) => [int(g.step), int(g.alive), int(g.inner), ...shares(g)]),
    ),
    '',
    'The dot, at step 10,000, 10 seeds each. The bytes are the sum of the light bytes of one dot.',
    '',
    table(
      ['Dot', 'bytes', ...SHARES],
      [
        ['smooth, radius 2.5 (the scene)', int(settled.lightSum / 7), ...shares(settled)],
        ...groups(jsonl(join(logs, 'dots.jsonl'))).map((g) => [
          g.dot === 'hard' ? 'hard, 3 × 3 cells (the paper)' : `smooth, radius ${g.dot}`,
          int(g.lightSum / 7),
          ...shares(g),
        ]),
      ],
    ),
    '',
    'The repellent strength, at step 10,000, 10 seeds each.',
    '',
    table(
      ['Strength', 'agents', ...SHARES],
      [...groups(jsonl(join(logs, 'sweep.jsonl'))), settled].map((g) => [g.light, int(g.alive), ...shares(g)]),
    ),
    '',
    'The food strength of the ring, at step 10,000, 10 seeds each.',
    '',
    table(
      ['Food strength', 'agents', ...SHARES],
      [...groups(jsonl(join(logs, 'food.jsonl'))), settled].map((g) => [g.food, int(g.alive), ...shares(g)]),
    ),
    '',
    'The scene on the two backends, at step 10,000, 30 seeds each (WebGPU: the 10 seeds above and 20 more).',
    '',
    table(
      ['Backend', 'agents', ...SHARES],
      [
        ...groups([
          ...jsonl(join(logs, 'scene.jsonl')).filter((l) => l.step === 10000),
          ...jsonl(join(logs, 'seeds.jsonl')),
        ]).map((g) => ['WebGPU', int(g.alive), ...shares(g)]),
        ...groups(jsonl(join(logs, 'webgl2.jsonl'))).map((g) => ['WebGL2', int(g.alive), ...shares(g)]),
      ],
    ),
  );
  // The deflected path: where the network crosses the middle of the dish, above the line of the foods.
  const lines = readFileSync(join(logs, 'deflect.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Deflected);
  const stages = ['0', '1', '2', '3', 'away', 'away later'];
  const up = crossingOf;
  const lights = [...new Set(lines.map((l) => l.light))];
  const cell = (light: number, stage: string) =>
    range(
      lines.filter((l) => l.light === light && l.stage === stage).map((l) => up(l).up),
      1,
    );
  const formed = lines.filter((l) => l.stage === '0').map((l) => l.formed);
  const spans = lines.map((l) => up(l).span);
  const agents = lines.filter((l) => l.stage !== '0').map((l) => l.alive);
  out.push(
    '',
    'The deflected path (Fig. 8), 5 seeds each: the height of the path at the middle of the dish above the line of the foods, in cells, with no repellent, with 1, 2 and 3, and 3,000 and 12,000 steps after they are gone.',
    '',
    table(
      ['Strength', 'none', '1', '2', '3', 'gone, 3,000', 'gone, 12,000'],
      [
        ...lights.map((light) => [light, ...stages.map((s) => cell(light, s))]),
        ['the paper', ...DEFLECT.paper.map((v) => v.toFixed(1)), 'no number', 'returns'],
      ],
    ),
    '',
    `The path holds ${int(Math.min(...agents))} to ${int(Math.max(...agents))} agents from the first repellent on. It was one path after ${int(Math.min(...formed))} to ${int(Math.max(...formed))} steps, and at the middle of the dish it is at most ${int(Math.max(...spans))} cells wide in every sample.`,
  );
  return out.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, file] = process.argv.slice(2);
  const band = Number(process.argv.find((a) => a.startsWith('--band='))?.slice(7) ?? BAND);
  const which = process.argv.includes('--veins') ? 'veins' : 'cells';
  if (mode === 'scores' && file) console.log(scores(file, band, which));
  else if (mode === 'reduce' && file)
    reduce(resolve(file), resolve(process.argv[4] ?? fileURLToPath(new URL('./logs', import.meta.url))));
  else console.log(report(resolve(mode ?? fileURLToPath(new URL('./logs', import.meta.url)))));
}
