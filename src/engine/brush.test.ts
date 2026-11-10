import { describe, expect, it } from 'vitest';
import type { Boundary } from '../model/params';
import {
  lightByte,
  paintBox,
  paintsCell,
  paintSegments,
  scissorRects,
  segmentDistance,
  SLACK,
  someCell,
  type Cursor,
} from './brush';
import { MIN_RADIUS } from './environment';
import { paintReference } from './paint-reference';
import type { EnvTool, Stroke } from './types';

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

  it('takes the whole axis when the stroke is wider than the grid', () => {
    expect(scissorRects(stroke([-10, 5], [80, 5], 1), 64, 48, true)).toEqual([[0, 3, 64, 4]]);
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

  // On a 237 × 512 dish (a 375 × 810 phone) six rim cells lie exactly at the dish's radius of 117.5 cells: the CPU
  // counts them inside, and a GPU distance off by a rounding step outside.
  it('records a stroke at the rim of a dish only when a cell lies inside the rim by SLACK', () => {
    const [w, h] = [237, 512];
    expect(Math.hypot(118.5 - w / 2, 138.5 - h / 2)).toBe(Math.min(w, h) / 2 - 1); // cell (118, 138)
    // Within 1.6 cells of (118.5, 137): cell (118, 138) and cells beyond the rim.
    const rim = dab('food', [118.5, 137], 1.6);
    const env = new Uint8Array(w * h * 4);
    paintReference(env, w, h, rim, 'dish');
    expect(env.filter((v, i) => i % 4 === 1 && v > 0).length).toBe(1);
    expect(paintsCell(rim, w, h, 'dish')).toBe(false);
    // Reaching cell (118, 139) as well, one cell inside the rim.
    expect(paintsCell(dab('food', [118.5, 137], 2.6), w, h, 'dish')).toBe(true);
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
      const R = Math.min(w, h) / 2 - 1;
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

  // The sweep (sweep.ts) goes on where its last visit of a stroke stopped: the cells before stay cleared.
  it('goes on from a cursor where an earlier visit stopped, in the same order', () => {
    let seed = 7;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 2 ** 32;
    };
    for (let k = 0; k < 300; k++) {
      const [w, h] = k % 2 ? [48, 30] : [31, 47];
      const boundary: Boundary = (['box', 'dish', 'wrap'] as const)[k % 3] ?? 'box';
      const a: [number, number] = [rand() * 1.4 * w - 0.2 * w, rand() * 1.4 * h - 0.2 * h];
      const long = rand() < 0.3 ? 2 * w : 15;
      const b: [number, number] = [a[0] + (rand() * 2 - 1) * long, a[1] + (rand() * 2 - 1) * long];
      const s: Stroke = { kind: 'food', from: a, to: b, radius: rand() < 0.1 ? 40 : MIN_RADIUS + rand() * 6, boundary };
      const all: number[] = [];
      someCell(s, w, h, boundary, SLACK, (c) => {
        all.push(c);
        return false;
      });
      if (all.length < 4) continue;
      const stopAt = 2 + Math.floor(rand() * (all.length - 2));
      const cursor: Cursor = { part: -1, y: 0, x: 0 };
      let n = 0;
      someCell(s, w, h, boundary, SLACK, () => n++ === stopAt, cursor);
      const rest: number[] = [];
      someCell(
        s,
        w,
        h,
        boundary,
        SLACK,
        (c) => {
          rest.push(c);
          return false;
        },
        cursor,
      );
      // The cells under the two ends come first again, then the visit goes on from the cell where it stopped.
      const ends = rest.length - (all.length - stopAt);
      expect(ends).toBeGreaterThanOrEqual(0);
      expect(ends).toBeLessThanOrEqual(2);
      expect(rest, JSON.stringify([s, w, h, stopAt])).toEqual([...all.slice(0, ends), ...all.slice(stopAt)]);
    }
  });
});
