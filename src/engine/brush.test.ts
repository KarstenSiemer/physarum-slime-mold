import { describe, expect, it } from 'vitest';
import type { Boundary } from '../model/params';
import {
  dishRadius,
  lightByte,
  outlineBox,
  outlineRects,
  ownHeldEverywhere,
  paintBox,
  paintsCell,
  paintSegments,
  PendingOutlines,
  Rows,
  scissorRects,
  segmentDistance,
  SLACK,
  someCell,
  type Rect,
  unionRects,
} from './brush';
import { MIN_RADIUS } from './environment';
import { paintReference } from './paint-reference';
import { EnvKind, type EnvTool, type Stroke } from './types';

const stroke = (from: [number, number], to: [number, number], radius: number): Stroke => ({
  kind: 'food',
  from,
  to,
  radius,
});

describe('scissorRects', () => {
  it('covers the bounding box grown by one cell', () => {
    expect(scissorRects(stroke([10.5, 20.2], [14.1, 18], 2), 64, 48, true)).toEqual([[7, 15, 11, 9]]);
  });

  it('splits at the edges of a periodic grid and continues on the other side', () => {
    expect(scissorRects(stroke([1, 47], [1, 47], 2), 64, 48, true)).toEqual([
      [62, 44, 2, 4],
      [62, 0, 2, 2],
      [0, 44, 4, 4],
      [0, 0, 4, 2],
    ]);
  });

  it('cuts at the edges of a closed arena, and is empty outside it', () => {
    expect(scissorRects(stroke([1, 47], [1, 47], 2), 64, 48, false)).toEqual([[0, 44, 4, 4]]);
    expect(scissorRects(stroke([-9, 10], [-6, 10], 2), 64, 48, false)).toEqual([]);
  });

  it('takes the whole axis when the stroke is wider than a periodic grid', () => {
    expect(scissorRects(stroke([-10, 5], [80, 5], 1), 64, 48, true)).toEqual([[0, 3, 64, 4]]);
  });

  // A closed arena has no cells beyond its edges: a box wider than the grid is cut as any other (paintBox()).
  it('cuts a stroke wider than a closed arena at its edges, and is empty for one that lies beside it', () => {
    expect(scissorRects(stroke([30, 24], [200, 24], 1), 64, 48, false)).toEqual([[28, 22, 36, 4]]);
    expect(scissorRects(stroke([70, 10], [200, 10], 1), 64, 48, false)).toEqual([]);
    expect(scissorRects(stroke([32, -100], [32, -60], 30), 64, 48, false)).toEqual([]);
  });

  // Every cell the reference paints lies in a rectangle, also across the edges.
  it('holds every cell the brush paints', () => {
    const [w, h] = [40, 30];
    for (const [from, to, r] of [
      [[0.3, 0.2], [0.3, 0.2], 5.5],
      [[39.9, 15], [2, 29.7], 3.2],
      [[20, -1], [21, 31], 0.75],
    ] as const) {
      const s = stroke([...from], [...to], r);
      const env = new Uint8Array(w * h * 4);
      paintReference(env, w, h, s, 'wrap');
      const rects = scissorRects(s, w, h, true);
      for (let c = 0; c < w * h; c++) {
        if (!env[c * 4 + 1]) continue;
        const [x, y] = [c % w, Math.floor(c / w)];
        expect(
          rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh),
          `${x}, ${y}`,
        ).toBe(true);
      }
    }
  });
});

describe('paintSegments', () => {
  it('keeps a stroke that starts inside the grid and spans at most half of it, and any stroke on a closed arena', () => {
    const s = stroke([60.5, 3.25], [90.25, 20], 2);
    expect(paintSegments(s, 64, 48, true)).toEqual([s]);
    const far = stroke([-300, 500], [-100, 900], 2);
    expect(paintSegments(far, 64, 48, false)).toEqual([far]);
  });

  it('moves a stroke on a copy of the grid by whole periods to start inside it', () => {
    expect(paintSegments(stroke([-130.5, 100], [-126.5, 98], 3), 64, 48, true)).toEqual([
      stroke([61.5, 4], [65.5, 2], 3),
    ]);
  });

  // The paint passes look for the nearest copy one period around a cell: exact for such parts (brush.ts).
  it('cuts a longer stroke into parts that each start inside the grid and span at most half of it', () => {
    const [w, h] = [64, 48];
    const s = stroke([-70.25, 10.5], [140.75, -60.5], 1.5);
    const parts = paintSegments(s, w, h, true);
    expect(parts).toHaveLength(Math.ceil(211 / 32));
    let end: [number, number] | undefined;
    for (const p of parts) {
      expect(p.from[0]).toBeGreaterThanOrEqual(0);
      expect(p.from[0]).toBeLessThan(w);
      expect(p.from[1]).toBeGreaterThanOrEqual(0);
      expect(p.from[1]).toBeLessThan(h);
      expect(Math.abs(p.to[0] - p.from[0])).toBeLessThanOrEqual(w / 2);
      expect(Math.abs(p.to[1] - p.from[1])).toBeLessThanOrEqual(h / 2);
      // Each part starts where the last one ended, up to whole periods.
      if (end)
        for (const [a, b, n] of [
          [p.from[0], end[0], w],
          [p.from[1], end[1], h],
        ] as const)
          expect((((a - b) % n) + n) % n).toBeCloseTo(0, 9);
      end = p.to;
    }
    // Together they paint what the stroke paints.
    const [whole, cut] = [new Uint8Array(w * h * 4), new Uint8Array(w * h * 4)];
    paintReference(whole, w, h, s, 'wrap');
    for (const p of parts) paintReference(cut, w, h, p, 'wrap');
    expect(Array.from(cut)).toEqual(Array.from(whole));
  });
});

describe('paintBox', () => {
  it('is the bounding box grown by one cell, cut to a closed arena and undefined outside it', () => {
    expect(paintBox(stroke([10.5, 20.2], [14.1, 18], 2), 64, 48, true)).toEqual([7, 15, 11, 9]);
    expect(paintBox(stroke([1, 47], [1, 47], 2), 64, 48, false)).toEqual([0, 44, 4, 4]);
    expect(paintBox(stroke([-9, 10], [-6, 10], 2), 64, 48, false)).toBeUndefined();
  });

  // A brush mapped from a coarse grid to a fine one can be many times the grid: one pass over the grid, not over the
  // brush's box, and on a periodic grid no cell twice.
  it('spans at most the grid', () => {
    expect(paintBox(stroke([32, 24], [32, 24], 5000), 64, 48, false)).toEqual([0, 0, 64, 48]);
    expect(paintBox(stroke([32, 24], [32, 24], 5000), 64, 48, true)).toEqual([-4969, -4977, 64, 48]);
  });

  // Every cell the reference paints lies in the box, wrapped into the grid on the periodic one.
  it('holds every cell the brush paints', () => {
    const [w, h] = [40, 30];
    for (const [from, to, r, wrap] of [
      [[0.3, 0.2], [0.3, 0.2], 5.5, true],
      [[39.9, 15], [22, 29.7], 3.2, true],
      [[20, 1], [21, 14], 30, true],
      [[38, 28], [41, 33], 4, false],
    ] as const) {
      const s = stroke([...from], [...to], r);
      const env = new Uint8Array(w * h * 4);
      paintReference(env, w, h, s, wrap ? 'wrap' : 'box');
      const box = paintBox(s, w, h, wrap);
      if (!box) throw new Error('no box');
      const [bx, by, bw, bh] = box;
      const inside = (v: number, lo: number, n: number, size: number) =>
        wrap ? (((v - lo) % size) + size) % size < n : v >= lo && v < lo + n;
      for (let c = 0; c < w * h; c++) {
        if (!env[c * 4 + 1]) continue;
        const [x, y] = [c % w, Math.floor(c / w)];
        expect(inside(x, bx, bw, w) && inside(y, by, bh, h), `${x}, ${y}`).toBe(true);
      }
    }
  });
});

describe('paintsCell', () => {
  const dab = (kind: EnvTool, at: [number, number], radius: number): Stroke => ({ kind, from: at, to: at, radius });

  // A dab beside the box reaches into it only with the cells of its first or last column or row (review of ADR 0019:
  // a scan range one cell short at an edge dropped them).
  it('records a dab beside each edge of a box that reaches one column or row into it', () => {
    for (const at of [
      [-0.9, 10.2],
      [64.9, 10.2],
      [10.2, -0.9],
      [10.2, 64.9],
    ] as const) {
      expect(paintsCell(dab('food', [...at], 1.45), 64, 64, 'box'), `${at[0]}, ${at[1]}`).toBe(true);
      expect(paintsCell(dab('food', [...at], 1.3), 64, 64, 'box'), `${at[0]}, ${at[1]}`).toBe(false);
    }
    // A segment along the outside of the left edge.
    expect(paintsCell({ kind: 'wall', from: [-0.9, 10.2], to: [-0.9, 30.7], radius: 1.45 }, 64, 64, 'box')).toBe(true);
  });

  // Float32 on the GPU may round a cell this close to the edge the other way, and then the stroke paints nothing
  // there while the list would keep it (6 of about 32,000 random strokes, review of ADR 0019).
  it('records a stroke only when a cell lies inside its brush by SLACK', () => {
    // The one cell in reach, (0, 10), lies 1 cell from the dab's centre; the next ones 1.41.
    expect(paintsCell(dab('food', [-0.5, 10.5], 1.005), 64, 64, 'box')).toBe(false);
    expect(paintsCell(dab('food', [-0.5, 10.5], 1 + SLACK), 64, 64, 'box')).toBe(true);
    expect(paintsCell(dab('food', [-0.5, 10.5], 1.015), 64, 64, 'box')).toBe(true);
    // paintReference paints the cell in all three cases.
    const env = new Uint8Array(64 * 64 * 4);
    paintReference(env, 64, 64, dab('food', [-0.5, 10.5], 1.005), 'box');
    expect(env[10 * 64 * 4 + 1]).toBe(255);
  });

  // On a 237 × 512 dish (a 375 × 810 phone) the centre of cell (31, 185) lies 0.0037 cells inside the dish's radius of
  // 111.98 cells (ADR 0027): the CPU counts it inside, and a GPU distance off by a few rounding steps could count it
  // outside.
  it('records a stroke at the rim of a dish only when a cell lies inside the rim by SLACK', () => {
    const [w, h] = [237, 512];
    const inside = dishRadius(w, h) - Math.hypot(31.5 - w / 2, 185.5 - h / 2);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(SLACK);
    // Within 1.6 cells of (30.5, 184.5): cell (31, 185) and cells beyond the rim.
    const rim = dab('food', [30.5, 184.5], 1.6);
    const env = new Uint8Array(w * h * 4);
    paintReference(env, w, h, rim, 'dish');
    expect(env.filter((v, i) => i % 4 === 1 && v > 0).length).toBe(1);
    expect(env[(185 * w + 31) * 4 + 1]).toBe(255);
    expect(paintsCell(rim, w, h, 'dish')).toBe(false);
    // Reaching cells (32, 184), (32, 185) and (31, 186) as well, inside the rim by more than SLACK.
    expect(paintsCell(dab('food', [30.5, 184.5], 2.6), w, h, 'dish')).toBe(true);
  });

  // Its soft edge gives light byte 0 in the outer 1.8 % of the radius: such a stroke changes nothing (69 of 10,721
  // random light strokes were recorded anyway, review of ADR 0019), and on another grid it must not either.
  it('records a light stroke only where a cell gets a light byte of at least 1', () => {
    // Column 0 lies 9.9 cells or more from the centre: inside the radius of 10, at byte 0.
    expect(lightByte(9.9, 10)).toBe(0);
    const faint = dab('light', [-9.4, 160.5], 10);
    const env = new Uint8Array(512 * 320 * 4);
    paintReference(env, 512, 320, faint, 'box');
    expect(env.every((v) => v === 0)).toBe(true);
    expect(paintsCell(faint, 512, 320, 'box')).toBe(false);
    // The same light a little further in: byte 4 in column 0.
    expect(lightByte(9.5, 10)).toBe(4);
    expect(paintsCell(dab('light', [-9, 160.5], 10), 512, 320, 'box')).toBe(true);
    // Food at the same place has cells there.
    expect(paintsCell(dab('food', [-9.4, 160.5], 10), 512, 320, 'box')).toBe(true);
  });

  it('records every stroke of at least MIN_RADIUS on a periodic grid: every point lies within 0.71 cells of a centre', () => {
    for (const kind of ['food', 'light', 'wall', 'erase'] as const)
      for (const at of [
        [0, 0],
        [63.5, 39.5],
        [-100.25, 7.75],
        [31.99, 0.01],
      ] as const)
        expect(paintsCell(dab(kind, [...at], MIN_RADIUS), 64, 40, 'wrap'), `${kind} at ${at[0]}, ${at[1]}`).toBe(true);
  });

  // Random strokes near the edges and the rim, on small and odd grids: a recorded stroke changes a byte, and a stroke
  // with a cell well inside its brush and the arena is recorded.
  it('agrees with paintReference: no recorded stroke that changes nothing, none dropped that clearly paints', () => {
    let seed = 12345;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 2 ** 32;
    };
    const grids = [
      [64, 40],
      [61, 37],
      [37, 61],
      [40, 64],
    ] as const;
    const kinds = ['food', 'light', 'wall', 'erase'] as const;
    const counts = { recorded: 0, dropped: 0 };
    for (let k = 0; k < 4000; k++) {
      const [w, h] = grids[Math.floor(rand() * grids.length)] ?? [64, 40];
      const boundary: Boundary = (['box', 'dish', 'wrap'] as const)[Math.floor(rand() * 3)] ?? 'box';
      const kind = kinds[Math.floor(rand() * kinds.length)] ?? 'food';
      const r = MIN_RADIUS + (rand() < 0.5 ? rand() * 2 : rand() * 10);
      const R = dishRadius(w, h);
      // Near the rim of the dish, or near an edge.
      const phi = rand() * 2 * Math.PI;
      const rho = R + (rand() * 2 - 1) * (r + 2);
      const side = Math.floor(rand() * 4);
      const off = (rand() * 2 - 1) * (r + 2);
      const a: [number, number] =
        boundary === 'dish'
          ? [w / 2 + rho * Math.cos(phi), h / 2 + rho * Math.sin(phi)]
          : side === 0
            ? [off, rand() * h]
            : side === 1
              ? [w + off, rand() * h]
              : side === 2
                ? [rand() * w, off]
                : [rand() * w, h + off];
      const len = rand() < 0.4 ? rand() * 20 : 0;
      const ang = rand() * 2 * Math.PI;
      const s: Stroke = { kind, from: a, to: [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)], radius: r };
      const base = kind === 'erase' ? 255 : 0;
      const env = new Uint8Array(w * h * 4).fill(base);
      paintReference(env, w, h, s, boundary);
      const changes = env.some((v) => v !== base);
      // A cell that paintReference changed, inside its brush and the rim by twice SLACK.
      let clearly = false;
      for (let c = 0; c < w * h; c++) {
        if (![0, 1, 2, 3].some((ch) => env[c * 4 + ch] !== base)) continue;
        const [x, y] = [(c % w) + 0.5, Math.floor(c / w) + 0.5];
        const d = boundary === 'wrap' ? 0 : segmentDistance(x, y, s.from, s.to);
        const rim = boundary === 'dish' ? Math.hypot(x - w / 2, y - h / 2) <= R - 2 * SLACK : true;
        const deep = kind === 'light' ? lightByte(d + 2 * SLACK, r) >= 1 : d <= r - 2 * SLACK;
        if (rim && deep) clearly = true;
      }
      const recorded = paintsCell(s, w, h, boundary);
      if (recorded) expect(changes, JSON.stringify([s, w, h, boundary])).toBe(true);
      if (clearly) expect(recorded, JSON.stringify([s, w, h, boundary])).toBe(true);
      counts[recorded ? 'recorded' : 'dropped']++;
    }
    // Both outcomes occur often enough to mean something.
    expect(counts.recorded).toBeGreaterThan(1000);
    expect(counts.dropped).toBeGreaterThan(500);
  });
});

describe('someCell', () => {
  // The sweep (sweep.ts) and paintsCell judge strokes by the cells this visits: without slack exactly the cells that
  // the paint passes change.
  it('visits exactly the cells paintReference paints, across edges, the seam and the rim, and for large brushes', () => {
    let seed = 99;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 2 ** 32;
    };
    for (let k = 0; k < 1500; k++) {
      const [w, h] = (
        [
          [48, 30],
          [31, 47],
          [40, 40],
        ] as const
      )[k % 3] ?? [48, 30];
      const boundary: Boundary = (['box', 'dish', 'wrap'] as const)[Math.floor(rand() * 3)] ?? 'box';
      const kind = (['food', 'light'] as const)[Math.floor(rand() * 2)] ?? 'food';
      const radius = rand() < 0.1 ? 20 + rand() * 60 : MIN_RADIUS + rand() * 8;
      const a: [number, number] = [rand() * 1.6 * w - 0.3 * w, rand() * 1.6 * h - 0.3 * h];
      const long = rand() < 0.2 ? 3 * w : 25;
      const b: [number, number] = rand() < 0.3 ? a : [a[0] + (rand() * 2 - 1) * long, a[1] + (rand() * 2 - 1) * long];
      const s: Stroke = { kind, from: a, to: b, radius, boundary };
      const env = new Uint8Array(w * h * 4);
      paintReference(env, w, h, s, boundary);
      const painted = new Set<number>();
      for (let c = 0; c < w * h; c++) if (env[c * 4 + 1] || env[c * 4 + 2]) painted.add(c);
      const visited = new Set<number>();
      someCell(s, w, h, boundary, 0, (c) => {
        visited.add(c);
        return false;
      });
      expect(
        [...visited].sort((x, y) => x - y),
        JSON.stringify([s, w, h]),
      ).toEqual([...painted].sort((x, y) => x - y));
    }
  });
});

/**
 * The cells a stroke paints with `slack`, cell by cell over its bounding box, wrapped on a periodic grid: the rule of
 * the paint passes written apart from brush.ts (review of ADR 0019).
 */
function bruteCells(s: Stroke, w: number, h: number, under: Boundary, slack: number): Set<number> {
  const out = new Set<number>();
  const r = s.radius;
  const reach = r + Math.max(0, slack) + 1;
  const [a, b] = [s.from, s.to];
  const R = dishRadius(w, h) + slack;
  for (let y = Math.floor(Math.min(a[1], b[1]) - reach); y <= Math.ceil(Math.max(a[1], b[1]) + reach); y++)
    for (let x = Math.floor(Math.min(a[0], b[0]) - reach); x <= Math.ceil(Math.max(a[0], b[0]) + reach); x++) {
      let [cx, cy] = [x, y];
      if (under === 'wrap') [cx, cy] = [((x % w) + w) % w, ((y % h) + h) % h];
      else if (x < 0 || y < 0 || x >= w || y >= h) continue;
      else if (under === 'dish' && Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > R) continue;
      const [abx, aby] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.min(
        1,
        Math.max(0, ((x + 0.5 - a[0]) * abx + (y + 0.5 - a[1]) * aby) / Math.max(abx * abx + aby * aby, 1e-6)),
      );
      const d = Math.hypot(x + 0.5 - a[0] - t * abx, y + 0.5 - a[1] - t * aby);
      const u = Math.min(1, Math.max(0, (d - slack - r) / (0.3 * r - r)));
      if (s.kind === 'light' ? Math.floor(0.5 + 255 * u * u * (3 - 2 * u)) >= 1 : d <= r + slack) out.add(cy * w + cx);
    }
  return out;
}

/** The distance from a light stroke at which its byte falls to 0, by bisection on lightByte(). */
function litEdge(r: number) {
  let [lo, hi] = [0.3 * r, r];
  for (let k = 0; k < 80; k++) [lo, hi] = lightByte((lo + hi) / 2, r) >= 1 ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
  return lo;
}

/**
 * Random strokes near the edges, the periodic seam and the rim, on cell centres and corners, with radii on and a hair
 * beside a cell's distance and the light threshold, long ones and brushes larger than the grid.
 */
function* edgeStrokes(n: number, seed: number) {
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
  };
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)] as T;
  const grids = [
    [37, 61],
    [61, 37],
    [64, 40],
    [41, 41],
    [237, 512],
    [33, 17],
  ] as const;
  for (let k = 0; k < n; k++) {
    const [w, h] = pick(grids);
    const under = pick(['box', 'dish', 'wrap'] as const);
    const kind = pick(['food', 'light', 'wall', 'erase'] as const);
    const R0 = dishRadius(w, h);
    const q = rand();
    let at: [number, number];
    if (q < 0.3) {
      const phi = rand() * 2 * Math.PI;
      const rho = R0 + (rand() * 2 - 1) * 3;
      at = [w / 2 + rho * Math.cos(phi), h / 2 + rho * Math.sin(phi)];
    } else if (q < 0.6) at = [pick([0, w, -0.5, w + 0.5, -w, 2 * w]) + (rand() * 2 - 1) * 3, rand() * h];
    else at = [rand() * 3 * w - w, rand() * 3 * h - h];
    if (rand() < 0.4) at = [Math.floor(at[0]) + pick([0, 0.5]), Math.floor(at[1]) + pick([0, 0.5])];
    // Brushes larger than the grid on the small grids only: the brute force walks their box.
    let r = rand() < 0.1 && w * h < 4000 ? rand() * 2 * Math.max(w, h) : MIN_RADIUS + rand() * 6;
    if (rand() < 0.3) r = Math.max(MIN_RADIUS, Math.round(r)) + pick([0, 0.005, -0.005, 0.01, -0.01, 0.0101, -0.0099]);
    // Light whose byte falls to 0 a hair beside a cell centre's distance.
    if (kind === 'light' && rand() < 0.5)
      r = (Math.round(r) + pick([0, 0.5])) / (litEdge(1000) / 1000) + pick([0, 1e-4, -1e-4, 0.006, -0.006]);
    const len =
      rand() < 0.2 ? rand() * 3 * Math.min(w, h) : rand() < 0.4 ? 0.01 + rand() * 10 : rand() < 0.1 ? rand() * 1e-3 : 0;
    const ang = rand() * 2 * Math.PI;
    const s: Stroke = { kind, from: at, to: [at[0] + len * Math.cos(ang), at[1] + len * Math.sin(ang)], radius: r };
    yield { s, w, h, under };
  }
}

describe('cells with SLACK', () => {
  // The sweep judges an edit's cells with its brush and rim moved out by SLACK and a clearing stroke's with both moved
  // in (review of ADR 0019: without a slack of its own, light's margin went untested, mutant BR1; so did someCell's
  // scan range widened by a positive slack, BR4).
  it('someCell visits exactly the cells of the rule, with the edge moved out and in by SLACK', () => {
    let lit = 0;
    for (const { s, w, h, under } of edgeStrokes(3000, 4242)) {
      for (const slack of [SLACK, -SLACK]) {
        const visited = new Set<number>();
        someCell(s, w, h, under, slack, (c) => {
          visited.add(c);
          return false;
        });
        const want = bruteCells(s, w, h, under, slack);
        expect(
          [...visited].sort((x, y) => x - y),
          JSON.stringify([s, w, h, under, slack]),
        ).toEqual([...want].sort((x, y) => x - y));
        if (s.kind === 'light' && want.size !== bruteCells(s, w, h, under, 0).size) lit++;
      }
    }
    // SLACK decides cells of light strokes often enough to mean something.
    expect(lit).toBeGreaterThan(50);
  }, 60_000);

  // Rows: per row the runs of cells, with every edge moved out (outer) or in by a hair of float64 rounding. Outer runs
  // hold every cell of the rule and inner runs only such cells, and neither is off by more than 1e-5 cells.
  it('Rows gives every row as runs that hold the cells of the rule, and only those within 1e-5 cells of it', () => {
    let rows = 0;
    for (const { s, w, h, under } of edgeStrokes(1500, 99)) {
      const runs = new Rows(s, w, h, under);
      const [dx, dy] = [s.to[0] - s.from[0], s.to[1] - s.from[1]];
      // Both passes measure a segment shorter than 1e-3 cells from a point near its start: inner runs take its disc.
      const tiny = dx * dx + dy * dy < 1e-6 && (dx !== 0 || dy !== 0);
      for (const slack of [SLACK, -SLACK]) {
        const [cells, wider, narrower] = [
          bruteCells(s, w, h, under, slack),
          bruteCells(s, w, h, under, slack + 1e-5),
          bruteCells(s, w, h, under, slack - (tiny ? 2e-3 : 1e-5)),
        ];
        for (const outer of [true, false]) {
          const got = new Set<number>();
          for (let y = 0; y < h; y++) {
            const out: number[] = [];
            const n = runs.runs(y, slack, outer, out);
            for (let k = 0; k < n; k++) {
              const [x0, x1] = [out[2 * k] ?? 0, out[2 * k + 1] ?? 0];
              // Sorted and apart, inside the grid.
              expect(x0 >= 0 && x1 < w && x0 <= x1 && (k === 0 || x0 > (out[2 * k - 1] ?? 0) + 1)).toBe(true);
              for (let x = x0; x <= x1; x++) got.add(y * w + x);
            }
            rows++;
          }
          const where = JSON.stringify([s, w, h, under, slack, outer]);
          const [holds, within] = outer ? [cells, wider] : [narrower, cells];
          expect(
            [...holds].filter((c) => !got.has(c)),
            where,
          ).toEqual([]);
          expect(
            [...got].filter((c) => !within.has(c)),
            where,
          ).toEqual([]);
        }
      }
    }
    expect(rows).toBeGreaterThan(100_000);
  }, 60_000);

  // Runs move each edge by a hair of float64 rounding, out for an edit's cells and in for a clearing stroke's: a cell on
  // the edge, or a hair beyond it, counts only outward (mutants IV3, IV3b).
  it('Rows counts a cell on the edge of the brush, or a hair beyond it, only in the outer runs', () => {
    // 2.99 + SLACK and 3.01 - SLACK are exactly 3 in float64.
    expect([2.99 + SLACK, 3.01 - SLACK]).toEqual([3, 3]);
    const out: number[] = [];
    const dab = (y: number, r: number): Stroke => ({ kind: 'erase', from: [100.5, y], to: [100.5, y], radius: r });
    // The cell (100, 103) lies exactly 3 cells from (100.5, 100.5), which someCell() counts both ways.
    expect(new Rows(dab(100.5, 2.99), 200, 200, 'box').runs(103, SLACK, true, out)).toBe(1);
    expect(new Rows(dab(100.5, 3.01), 200, 200, 'box').runs(103, -SLACK, false, out)).toBe(0);
    // The cell (100, 97) lies 3 + 1e-10 cells from (100.5, 100.5 + 1e-10): beyond the narrowed brush.
    const beyond = dab(100.5 + 1e-10, 3.01);
    expect(someCell(beyond, 200, 200, 'box', -SLACK, (c) => c === 97 * 200 + 100)).toBe(false);
    expect(new Rows(beyond, 200, 200, 'box').runs(97, -SLACK, false, out)).toBe(0);
    expect(new Rows(beyond, 200, 200, 'box').runs(97, -SLACK, true, out)).toBe(1);
  });

  // Both passes measure a segment shorter than 1e-3 cells from a point between its start and the nearest point
  // (segmentDistance()): 1.85e-8 cells farther than the segment for the cell (100, 101) here (mutant IV7).
  it('Rows narrows a segment shorter than 1e-3 cells to the disc around its start', () => {
    const s: Stroke = { kind: 'erase', from: [100.4997115, 100.5], to: [100.5002885, 100.5], radius: 1.01 + 1e-8 };
    const d = segmentDistance(100.5, 101.5, s.from, s.to);
    expect(d - 1).toBeGreaterThan(1.8e-8);
    expect(d).toBeGreaterThan(s.radius - SLACK);
    const out: number[] = [];
    for (const boundary of ['box', 'wrap'] as const) {
      expect(new Rows(s, 200, 200, boundary).runs(101, -SLACK, false, out)).toBe(0);
      expect(new Rows(s, 200, 200, boundary).runs(101, -SLACK, true, out)).toBe(1);
    }
  });
});

// WebGPU outlines a segment without the search of its own cells where this holds (sim.ts paint()): the GPU tests
// check the bytes; here the rule itself.
describe('ownHeldEverywhere', () => {
  it('holds on the periodic grid, for a segment inside a box and for a brush inside the dish', () => {
    expect(ownHeldEverywhere(stroke([-5, -5], [70, 50], 0.75), 64, 48, 'wrap')).toBe(true);
    expect(ownHeldEverywhere(stroke([10, 10], [20, 10], 0.74), 64, 48, 'wrap')).toBe(false); // thinner than 0.75
    expect(ownHeldEverywhere(stroke([0, 0], [64, 48], 3), 64, 48, 'box')).toBe(true); // the corners still count
    expect(ownHeldEverywhere(stroke([10, 10], [64.1, 10], 3), 64, 48, 'box')).toBe(false);
    // The dish of 64 × 48 has radius 0.945 × 24 = 22.68 around (32, 24): the brush must stay inside it.
    expect(ownHeldEverywhere(stroke([32, 24], [32 + 19.67, 24], 3), 64, 48, 'dish')).toBe(true);
    expect(ownHeldEverywhere(stroke([32, 24], [32 + 19.69, 24], 3), 64, 48, 'dish')).toBe(false);
  });
});

describe('outlineBox', () => {
  // The outline pass holds every byte of this box to `env` after a subtraction (ADR 0009): it must hold every cell
  // within 5 rings (Chebyshev, paint.wgsl HOLD_RINGS) of a cell the brush paints, and every cell within SHAPE_RANGE
  // (4 cells) of the brush.
  it('holds every cell within 5 rings of a painted cell', () => {
    const [w, h] = [40, 30];
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const missing: string[] = [];
    for (let t = 0; t < 300; t++) {
      const wrap = t % 2 === 0;
      const from: [number, number] = [rnd() * w, rnd() * h];
      const s = stroke(from, [from[0] + 6 * rnd() - 3, from[1] + 6 * rnd() - 3], 0.75 + 6 * rnd());
      const env = new Uint8Array(w * h * 4);
      paintReference(env, w, h, s, wrap ? 'wrap' : 'box');
      const [bx, by, bw, bh] = outlineBox(s, w, h, wrap) ?? [0, 0, 0, 0];
      const inside = (v: number, lo: number, n: number, size: number) =>
        wrap ? (((v - lo) % size) + size) % size < n : v >= lo && v < lo + n;
      for (let c = 0; c < w * h; c++) {
        if (!env[c * 4 + 1]) continue;
        const [x, y] = [c % w, Math.floor(c / w)];
        for (let dy = -5; dy <= 5; dy++)
          for (let dx = -5; dx <= 5; dx++) {
            const [qx, qy] = [x + dx, y + dy];
            if (!wrap && (qx < 0 || qy < 0 || qx >= w || qy >= h)) continue;
            if (!inside(qx, bx, bw, w) || !inside(qy, by, bh, h)) missing.push(`stroke ${t}: ${qx}, ${qy}`);
          }
      }
    }
    expect(missing).toEqual([]);
  });

  // WebGL2 draws the outline over these rectangles and WebGPU over the box: the same cells, also for a stroke
  // longer than a closed arena or beside it, where the box is cut or undefined.
  it.each([
    ['across a corner', stroke([1.2, 46.3], [3.4, 44.1], 2.5)],
    ['longer than the grid', stroke([30, 24], [200, 24], 1)],
    ['wider than the grid', stroke([32, 24], [32, 24], 90)],
    ['beside the grid', stroke([75, 10], [200, 10], 1)],
  ])('gives the scissor rectangles of the same cells (outlineRects, %s)', (_, s) => {
    for (const wrap of [true, false]) {
      const cells = (rects: Rect[]) =>
        new Set(
          rects.flatMap(([x, y, w, h]) =>
            Array.from({ length: w * h }, (_, i) => `${x + (i % w)},${y + Math.floor(i / w)}`),
          ),
        );
      const [bx, by, bw, bh] = outlineBox(s, 64, 48, wrap) ?? [0, 0, 0, 0];
      const wrapped = Array.from({ length: bw * bh }, (_, i) => {
        const [x, y] = [bx + (i % bw), by + Math.floor(i / bw)];
        return wrap ? `${((x % 64) + 64) % 64},${((y % 48) + 48) % 48}` : `${x},${y}`;
      }).filter((k) => wrap || k.split(',').every((v, a) => Number(v) >= 0 && Number(v) < (a ? 48 : 64)));
      expect(cells(outlineRects(s, 64, 48, wrap)), wrap ? 'periodic' : 'closed').toEqual(new Set(wrapped));
    }
  });
});

describe('unionRects', () => {
  it('covers every cell of the rectangles once', () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let t = 0; t < 500; t++) {
      const rects = Array.from({ length: Math.floor(rnd() * 12) }, (): Rect => [
        Math.floor(rnd() * 30),
        Math.floor(rnd() * 30),
        Math.floor(rnd() * 12),
        Math.floor(rnd() * 12),
      ]);
      const want = new Set<string>();
      for (const [x, y, w, h] of rects)
        for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) want.add(`${x + i},${y + j}`);
      const seen = new Map<string, number>();
      for (const [x, y, w, h] of unionRects(rects))
        for (let i = 0; i < w; i++)
          for (let j = 0; j < h; j++) seen.set(`${x + i},${y + j}`, (seen.get(`${x + i},${y + j}`) ?? 0) + 1);
      expect([...seen.values()].every((v) => v === 1)).toBe(true);
      expect(new Set(seen.keys())).toEqual(want);
    }
  });

  it('joins overlapping boxes of a drag into few rectangles', () => {
    const drag = Array.from({ length: 50 }, (_, i): Rect => [10 + 4 * i, 20, 30, 30]);
    expect(unionRects(drag)).toEqual([[10, 20, 226, 30]]);
  });
});

describe('PendingOutlines', () => {
  const { food, wall, erase } = EnvKind;

  // Buckets of 16 × 16 cells: a box meets the pending boxes of other kinds in its buckets, so a box that meets one
  // always meets, and a box far from all of them never does.
  it('meets a segment of another kind whose box shares a bucket with a pending box', () => {
    const p = new PendingOutlines(64, 48);
    p.add([[20, 20, 10, 10]], food, false);
    expect(p.meets([[20, 20, 10, 10]], food, false)).toBe(false); // the same kind never meets
    expect(p.meets([[28, 28, 4, 4]], wall, false)).toBe(true); // overlaps the box
    expect(p.meets([[30, 30, 2, 2]], wall, false)).toBe(true); // beside it, in the same bucket
    expect(p.meets([[34, 20, 4, 4]], wall, false)).toBe(false); // beside it, in other buckets
    expect(p.meets([[50, 40, 4, 4]], erase, false)).toBe(false); // far away
    p.clear();
    expect(p.meets([[20, 20, 10, 10]], wall, false)).toBe(false);
  });

  it('wraps a box on a periodic grid, and cuts it on a closed one', () => {
    const p = new PendingOutlines(64, 48);
    p.add([[62, 46, 4, 4]], food, true); // wraps into the corner at 0, 0
    expect(p.meets([[0, 0, 2, 2]], wall, true)).toBe(true);
    p.clear();
    p.add([[62, 46, 4, 4]], food, false);
    expect(p.meets([[0, 0, 2, 2]], wall, false)).toBe(false);
  });

  // Every cell that a box overlaps lies in a bucket that meets() checks: random boxes that overlap always meet.
  it('meets every box that overlaps a pending box of another kind', () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let t = 0; t < 500; t++) {
      const wrap = t % 2 === 0;
      const p = new PendingOutlines(64, 48);
      const box = (): Rect => [
        Math.floor(rnd() * 80) - 8,
        Math.floor(rnd() * 60) - 6,
        1 + Math.floor(rnd() * 20),
        1 + Math.floor(rnd() * 20),
      ];
      const [a, b] = [box(), box()];
      const cells = (r: Rect) => {
        const out = new Set<string>();
        for (let i = 0; i < r[2]; i++)
          for (let j = 0; j < r[3]; j++) {
            const [x, y] = [r[0] + i, r[1] + j];
            if (wrap) out.add(`${(((x % 64) + 64) % 64).toString()},${(((y % 48) + 48) % 48).toString()}`);
            else if (x >= 0 && y >= 0 && x < 64 && y < 48) out.add(`${x.toString()},${y.toString()}`);
          }
        return out;
      };
      const overlap = [...cells(a)].some((c) => cells(b).has(c));
      p.add([a], food, wrap);
      if (overlap) expect(p.meets([b], wall, wrap), `${a.join(' ')} / ${b.join(' ')}`).toBe(true);
    }
  });
});
