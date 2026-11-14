// The food sites of the flow (ADR 0029, decision 17): the strokes of the edit list, and the cells of each one.
import { describe, expect, it } from 'vitest';
import type { Boundary } from '../model/params';
import { packDrawing, unpackDrawing } from '../model/link';
import { BrushDrag } from '../ui/drag';
import { fromStroke, strokeOn, type EnvEdit } from './environment';
import { FLOW_SITES } from './flow';
import { paintReference } from './paint-reference';
import {
  continues,
  flowSites,
  foodStrokes,
  NO_CELL,
  SITE_BLOCK,
  SiteCells,
  type FlowSites,
  type FoodStroke,
} from './sites';
import type { Stroke } from './types';

const food = (from: [number, number], to = from, radius = 3): Stroke => ({ kind: 'food', from, to, radius });

/** An edit as Engine.paint() records it on a 512 × 320 grid under `boundary`. */
const edit = (s: Stroke, boundary: Boundary = 'box', grid: [number, number] = [512, 320]): EnvEdit =>
  fromStroke(s, grid, boundary);

/** The cells that the paint rule of the passes paints with food for some strokes (paint-reference.ts), in order. */
function painted(strokes: readonly Stroke[], w: number, h: number, boundary: Boundary): number[] {
  const env = new Uint8Array(w * h * 4);
  for (const s of strokes) paintReference(env, w, h, s, boundary);
  const cells: number[] = [];
  for (let c = 0; c < w * h; c++) if (env[c * 4 + 1]) cells.push(c);
  return cells;
}

/** The cells of site `i`, in the order of its list. */
const cellsOf = (sites: FlowSites, i: number) => {
  const site = sites.list[i];
  return site ? [...sites.cells.subarray(site.offset, site.offset + site.count)] : [];
};

describe('the food strokes of an edit list', () => {
  it('join the segments of a drag: a dab, then segments that each start at the end of the one before', () => {
    const list = [food([10, 10]), food([10, 10], [12, 10]), food([12, 10], [14, 11]), food([14, 11], [15, 13])].map(
      (s) => edit(s),
    );
    expect(foodStrokes(list)).toEqual([list]);
  });

  it('take what BrushDrag records for one drag as one stroke, and the next drag as another', () => {
    const recorded: EnvEdit[] = [];
    // An engine whose view shows the grid at 2 pixels per cell; paint() records as Engine.paint() does.
    const engine = {
      toGrid: (x: number, y: number): [number, number] => [x / 2, y / 2],
      paint: (s: Stroke) => recorded.push(edit(s)),
    };
    const drag = new BrushDrag();
    for (let x = 100; x <= 400; x += 7) drag.to(engine, [x, 200 + (x % 30)], 'food', 4);
    drag.end();
    for (let x = 100; x <= 300; x += 9) drag.to(engine, [x, 400], 'food', 4);
    drag.end();
    expect(recorded.length).toBeGreaterThan(20);
    const strokes = foodStrokes(recorded);
    expect(strokes.length).toBe(2);
    expect((strokes[0]?.length ?? 0) + (strokes[1]?.length ?? 0)).toBe(recorded.length);
    // The first edit of each drag is a dab.
    for (const s of strokes) expect(s[0]?.from).toEqual(s[0]?.to);
  });

  it('keep dabs apart, also dabs that touch or overlap, as the seven of Tokyo', () => {
    const list = [food([10, 10]), food([13, 10]), food([13, 10.5]), food([40, 40])].map((s) => edit(s));
    expect(foodStrokes(list).map((s) => s.length)).toEqual([1, 1, 1, 1]);
  });

  it('start a new stroke at another radius, grid, arena or kind, and after an edit of another kind', () => {
    const a = food([10, 10], [20, 10]);
    const b = food([20, 10], [30, 10]);
    const base = edit(a);
    expect(continues(base, edit(b))).toBe(true);
    expect(continues(base, edit({ ...b, radius: 4 }))).toBe(false);
    expect(continues(base, edit(b, 'box', [1024, 640]))).toBe(false);
    expect(continues(base, edit(b, 'dish'))).toBe(false);
    expect(continues(base, edit({ ...b, kind: 'light' }))).toBe(false);
    expect(continues(base, edit(food([20.0625, 10], [30, 10])))).toBe(false);
    const erase = edit({ ...b, kind: 'erase' });
    expect(foodStrokes([base, erase, edit(food([30, 10], [40, 10]))]).length).toBe(2);
  });

  it('follow a drag over the edge of a periodic grid, where the list moves a segment by a period', () => {
    // The segment crosses the right edge; the next one starts on the copy of the grid to the right, and the list moves
    // it back into the grid (fromStroke()).
    const first = edit(food([500, 100], [515, 100]), 'wrap');
    const next = edit(food([515, 100], [530, 104]), 'wrap');
    expect(next.from).toEqual([3, 100]);
    expect(continues(first, next)).toBe(true);
    // Not by a fraction of a period, and not on a closed arena.
    expect(continues(first, edit(food([259, 100], [270, 100]), 'wrap'))).toBe(false);
    expect(continues(edit(food([500, 100], [515, 100])), edit(food([3, 100], [10, 100])))).toBe(false);
  });

  it('give a new dab at the exact end of a drag with the same radius to that drag', () => {
    // The case where the rule differs from the drag: the geometry cannot tell such a dab from the next segment.
    const list = [food([10, 10]), food([10, 10], [20, 10]), food([20, 10])].map((s) => edit(s));
    expect(foodStrokes(list).length).toBe(1);
  });

  it('give an old link the strokes of its list: a link holds the edits exactly', () => {
    const list = [food([10, 10]), food([10, 10], [20, 10]), food([20, 10], [30, 12]), food([60, 60])].map((s) =>
      edit(s),
    );
    const bytes = packDrawing({ scene: '', revision: 0, origins: [0], shapes: [], strokes: list });
    if (!bytes) throw new Error('no link');
    const back = unpackDrawing(bytes)?.strokes ?? [];
    expect(back).toEqual(list);
    expect(foodStrokes(back).map((s) => s.length)).toEqual([3, 1]);
  });
});

describe('the cells of a food site', () => {
  const [w, h] = [64, 40];

  it('are the cells that the stroke paints with food, by the rule of the paint passes', () => {
    for (const boundary of ['box', 'wrap', 'dish'] as const) {
      const drag: FoodStroke = [food([20.5, 20]), food([20.5, 20], [30, 22.25]), food([30, 22.25], [41, 30])];
      const sites = flowSites([drag], w, h, boundary);
      expect(sites.list.length, boundary).toBe(1);
      expect(
        [...cellsOf(sites, 0)].sort((a, b) => a - b),
        boundary,
      ).toEqual(painted(drag, w, h, boundary));
    }
    // A dab across the edges of a periodic grid paints both sides.
    const edge = flowSites([[food([0.5, 1], [0.5, 1], 4)]], w, h, 'wrap');
    expect([...cellsOf(edge, 0)].sort((a, b) => a - b)).toEqual(painted([food([0.5, 1], [0.5, 1], 4)], w, h, 'wrap'));
  });

  it('are sorted by their distance to the start of the stroke, ties by the lower index', () => {
    const drag: FoodStroke = [food([20.25, 20.75]), food([20.25, 20.75], [40, 21])];
    const sites = flowSites([drag], w, h, 'box');
    const d = (c: number) => ((c % w) + 0.5 - 20.25) ** 2 + (Math.floor(c / w) + 0.5 - 20.75) ** 2;
    const cells = cellsOf(sites, 0);
    for (let i = 1; i < cells.length; i++) {
      const [a, b] = [cells[i - 1] ?? 0, cells[i] ?? 0];
      expect(d(a) < d(b) || (d(a) === d(b) && a < b), `${String(a)} before ${String(b)}`).toBe(true);
    }
    // The first cell is that of the centre.
    expect([sites.list[0]?.x, sites.list[0]?.y]).toEqual([20, 20]);
    // On a periodic grid the distance is to the nearest copy: the cells on the far side of the edge come early.
    const wrapped = flowSites([[food([0.5, 20.5], [0.5, 20.5], 3)]], w, h, 'wrap');
    expect(
      cellsOf(wrapped, 0)
        .slice(0, 5)
        .sort((a, b) => a - b),
    ).toEqual([19 * w, 20 * w, 20 * w + 1, 20 * w + 63, 21 * w]);
  });

  it('keep two dabs that touch or overlap two sites, and give a shared cell to the nearer centre', () => {
    const a = food([20.5, 20.5], [20.5, 20.5], 3);
    const b = food([24.5, 20.5], [24.5, 20.5], 3);
    const sites = flowSites([[a], [b]], w, h, 'box');
    expect(sites.list.map((s) => s.stroke)).toEqual([0, 1]);
    const [ca, cb] = [cellsOf(sites, 0), cellsOf(sites, 1)];
    // No cell twice, and together every cell of both.
    expect(ca.filter((c) => cb.includes(c))).toEqual([]);
    expect([...ca, ...cb].sort((x, y) => x - y)).toEqual(painted([a, b], w, h, 'box'));
    // Column 22 lies as far from both centres: it stays with the first dab. Column 23 is nearer the second.
    expect(ca.filter((c) => c % w === 22).length).toBeGreaterThan(0);
    expect(cb.filter((c) => c % w === 22)).toEqual([]);
    expect(ca.filter((c) => c % w === 23)).toEqual([]);
  });

  it('start the run of each site at a block of 64 entries, and fill the rest of its last block with no cell', () => {
    const sites = flowSites(
      [[food([10.5, 10.5], [10.5, 10.5], 3)], [food([40.5, 20.5], [40.5, 20.5], 6)]],
      w,
      h,
      'box',
    );
    const [a, b] = sites.list;
    expect([a?.count, b?.count]).toEqual([29, 113]);
    expect([a?.offset, b?.offset]).toEqual([0, SITE_BLOCK]);
    expect(sites.cells.length).toBe(3 * SITE_BLOCK);
    expect([...sites.cells.subarray(29, SITE_BLOCK)].every((c) => c === NO_CELL)).toBe(true);
    expect([...sites.cells.subarray(SITE_BLOCK + 113)].every((c) => c === NO_CELL)).toBe(true);
    expect([...sites.cells.subarray(0, 29), ...sites.cells.subarray(SITE_BLOCK, SITE_BLOCK + 113)]).not.toContain(
      NO_CELL,
    );
  });

  it('drop a stroke that paints no cell, and a stroke whose every cell is nearer another centre', () => {
    const outside = food([-20, -20], [-20, -20], 3);
    const big = food([20.5, 20.5], [20.5, 20.5], 6);
    const twin = food([20.5, 20.5], [20.5, 20.5], 2);
    const sites = flowSites([[outside], [big], [twin]], w, h, 'box');
    expect(sites.list.map((s) => s.stroke)).toEqual([1]);
  });

  it('spread evenly over the strokes when there are more than FLOW_SITES, the first one among them', () => {
    const many = Array.from({ length: 200 }, (_, i): FoodStroke => [food([i + 0.5, 0.5], [i + 0.5, 0.5], 0.5)]);
    const sites = flowSites(many, 256, 4, 'box');
    expect(sites.list.length).toBe(FLOW_SITES);
    expect(sites.list[0]?.stroke).toBe(0);
    const xs = sites.list.map((s) => s.x);
    for (let i = 1; i < xs.length; i++) {
      const gap = (xs[i] ?? 0) - (xs[i - 1] ?? 0);
      expect(gap === 3 || gap === 4, String(gap)).toBe(true);
    }
    expect(sites.list.every((s) => s.count === 1)).toBe(true);
  });

  it('give the same sites from cells kept between calls as from a fresh start', () => {
    const memo = new SiteCells();
    const segments = Array.from({ length: 30 }, (_, i) => food([5 + i, 10 + (i % 3)], [6 + i, 10 + ((i + 1) % 3)]));
    const dabs = [[food([50.5, 30.5])], [food([10.5, 30.5])]] as FoodStroke[];
    for (let n = 1; n <= segments.length; n++) {
      // A drag that grows, between two dabs; then the first dab goes, as after a sweep.
      const strokes = [dabs[0] ?? [], segments.slice(0, n), ...(n % 7 === 0 ? [] : [dabs[1] ?? []])];
      expect(memo.sites(strokes, w, h, 'box')).toEqual(flowSites(strokes, w, h, 'box'));
    }
    // A shorter drag, and another grid.
    expect(memo.sites([segments.slice(0, 4)], w, h, 'box')).toEqual(flowSites([segments.slice(0, 4)], w, h, 'box'));
    expect(memo.sites([segments], 80, 50, 'wrap')).toEqual(flowSites([segments], 80, 50, 'wrap'));
  });

  it('follow the edits of the engine onto another grid through the canonical frame', () => {
    // The same drag on its own grid and on a grid twice as large: about four times the cells.
    const list = [food([100, 100]), food([100, 100], [140, 120])].map((s) => edit(s));
    const on = (W: number, H: number) =>
      flowSites(
        foodStrokes(list).map((s) => s.flatMap((e) => strokeOn(e, W, H) ?? [])),
        W,
        H,
        'box',
      );
    const [small, large] = [on(512, 320), on(1024, 640)];
    expect(small.list.length).toBe(1);
    expect(large.list[0]?.count ?? 0).toBeGreaterThan(3.5 * (small.list[0]?.count ?? 0));
    // The start (200, 200) is the corner of four cells, all as near: the one with the lowest index comes first.
    expect([large.list[0]?.x, large.list[0]?.y]).toEqual([199, 199]);
  });
});
