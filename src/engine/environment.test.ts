import { describe, expect, it } from 'vitest';
import { presetById, PRESETS } from '../model/presets';
import { fromFrame, fromShape, fromStroke, MIN_RADIUS, periods, strokeOn, toFrame } from './environment';
import { paintReference } from './paint-reference';
import { gridSize } from './sizing';
import type { Stroke } from './types';

const preset = (id: string) => {
  const p = presetById(id);
  if (!p?.env) throw new Error(`no preset ${id} with an environment`);
  return p.env;
};

const near = (a: number[], b: number[], what?: string) => {
  expect(a, what).toHaveLength(b.length);
  a.forEach((v, i) => {
    expect(v, what).toBeCloseTo(b[i] ?? NaN, 9);
  });
};

const BOUNDARIES = ['dish', 'box', 'wrap'] as const;

describe('the canonical frame', () => {
  it('has its origin at the centre and the short side as its unit on 16:10, also on a portrait grid', () => {
    for (const b of BOUNDARIES) {
      near(toFrame([256, 160], [512, 320], b), [0, 0]);
      near(toFrame([512, 0], [512, 320], b), [0.8, -0.5]);
      // Portrait: the frame's long axis runs down the grid, so its right end is at the bottom.
      near(toFrame([160, 512], [320, 512], b), [0.8, 0]);
      near(toFrame([0, 256], [320, 512], b), [0, 0.5]);
    }
  });

  it('keeps the short side as the unit of a dish on every grid, and stretches a box or a periodic grid', () => {
    // The top right corner of a square and of a 2:1 grid: a dish measures it in short sides, while a box and a
    // periodic grid are the arena themselves, so their corner is the frame's corner on every screen.
    near(toFrame([512, 0], [512, 512], 'dish'), [0.5, -0.5]);
    near(toFrame([512, 0], [512, 256], 'dish'), [1, -0.5]);
    for (const b of ['box', 'wrap'] as const) {
      near(toFrame([512, 0], [512, 512], b), [0.8, -0.5]);
      near(toFrame([512, 0], [512, 256], b), [0.8, -0.5]);
      near(toFrame([128, 512], [256, 512], b), [0.8, 0]);
    }
  });

  it('is turned by a rotation, not a mirror: a clockwise turn of the landscape grid', () => {
    // Left, right and top of a 16:10 grid go to the top, the bottom and the right of a 10:16 grid.
    for (const b of BOUNDARIES) {
      near(fromFrame([-0.8, 0], [320, 512], b), [160, 0]);
      near(fromFrame([0.8, 0], [320, 512], b), [160, 512]);
      near(fromFrame([0, -0.5], [320, 512], b), [320, 256]);
    }
  });

  it('round-trips through every grid shape under every boundary', () => {
    for (const b of BOUNDARIES)
      for (const grid of [
        [512, 320],
        [320, 512],
        [256, 256],
        [1024, 120],
        [120, 1024],
      ] as const)
        for (const p of [
          [0, 0],
          [17.25, 300.5],
          [511, 3],
        ] as const)
          near(fromFrame(toFrame([...p], [...grid], b), [...grid], b), [...p]);
  });
});

describe('strokeOn', () => {
  it('repaints an edit on its own grid exactly as painted', () => {
    const s: Stroke = { kind: 'wall', from: [10.1, 20.7], to: [300.3, 7.9], radius: 2.3 };
    expect(strokeOn(fromStroke(s, [512, 320], 'box'), 512, 320)).toEqual({ ...s, boundary: 'box' });
    // Also below MIN_RADIUS, and also outside the grid: on its own grid nothing is changed or dropped.
    const thin: Stroke = { kind: 'food', from: [-30, 5], to: [-20, 5], radius: 0.3 };
    expect(strokeOn(fromStroke(thin, [512, 320], 'box'), 512, 320)).toEqual({ ...thin, boundary: 'box' });
  });

  // The view shows copies of a periodic grid around it (render.wgsl), and the brush paints on them.
  it('moves a stroke on a copy of a periodic grid into the grid, where the copy shows it', () => {
    const copy: Stroke = { kind: 'food', from: [-30, 5], to: [-20, 5], radius: 4 };
    const e = fromStroke(copy, [512, 320], 'wrap');
    expect([e.from, e.to]).toEqual([
      [482, 5],
      [492, 5],
    ]);
    // Several periods away and across both edges: by whole periods, the same move for both ends.
    const far = fromStroke({ ...copy, from: [1100.5, -650.25], to: [1090.5, -655.25] }, [512, 320], 'wrap');
    expect([far.from, far.to]).toEqual([
      [76.5, 309.75],
      [66.5, 304.75],
    ]);
    // So another grid finds it where it was painted, instead of skipping it beside the grid.
    const fine = strokeOn(e, 1024, 640);
    near([...(fine?.from ?? []), ...(fine?.to ?? []), fine?.radius ?? NaN], [964, 10, 984, 10, 8]);
    // A closed arena has no copies: a stroke beside it stays where it is, and other grids skip it.
    expect(strokeOn(fromStroke(copy, [512, 320], 'box'), 1024, 640)).toBeUndefined();
  });

  it('finds the whole periods that put a coordinate into [0, n), also where rounding reaches n', () => {
    for (const [v, n, k] of [
      [0, 512, 0],
      [511.75, 512, 0],
      [512, 512, 512],
      [-0.25, 512, -512],
      [-512, 512, -512],
      [-1e-14, 512, 0], // −1e-14 + 512 rounds to 512: no shift keeps it inside, and 0 keeps it next to the edge
      [1536.5, 320, 1280],
    ] as const) {
      expect(periods(v, n), `${v} in ${n}`).toBe(k);
    }
  });

  it('scales positions and the radius by the ratio of the short sides on a finer grid', () => {
    const e = fromStroke({ kind: 'food', from: [100, 50], to: [200, 60], radius: 3 }, [512, 320], 'wrap');
    const s = strokeOn(e, 1024, 640);
    near([...(s?.from ?? []), ...(s?.to ?? []), s?.radius ?? NaN], [200, 100, 400, 120, 6]);
    expect(s?.boundary).toBe('wrap');
  });

  it('keeps shapes in a dish when the aspect ratio changes: one scale for both axes', () => {
    // 512 × 320 to 512 × 512: the short side grows from 320 to 512 cells, so every length grows by 1.6.
    const e = fromStroke({ kind: 'wall', from: [100, 100], to: [140, 130], radius: 5 }, [512, 320], 'dish');
    const s = strokeOn(e, 512, 512);
    if (!s) throw new Error('outside');
    const length = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
    expect(length).toBeCloseTo(1.6 * 50, 9);
    expect(s.radius).toBeCloseTo(8, 9);
    near(s.from, [256 + 1.6 * (100 - 256), 256 + 1.6 * (100 - 160)]);
  });

  it("maps an edit through the frame of the list's arena, not of the boundary it was painted under", () => {
    // Painted in a box, in a list whose arena is a dish (a dish preset, then Edges set to box): the dish's frame.
    const e = fromStroke({ kind: 'wall', from: [100, 100], to: [140, 130], radius: 5 }, [512, 320], 'box', 'dish');
    const s = strokeOn(e, 512, 512);
    near(s?.from ?? [], [256 + 1.6 * (100 - 256), 256 + 1.6 * (100 - 160)]);
    expect(s?.boundary).toBe('box');
    const shape = strokeOn(fromShape({ kind: 'food', at: [0.4, 0], r: 0.01 }, 'box', 'dish'), 512, 512);
    near(shape?.from ?? [], [256 + 0.4 * 512, 256]);
    expect(shape?.boundary).toBe('box');
  });

  it('keeps an edit of a box or a periodic grid at its place relative to the edges, its radius on the short side', () => {
    for (const b of ['box', 'wrap'] as const) {
      // 512 × 320 to 512 × 512: x keeps its fraction of the width, y of the height; the radius grows by 1.6.
      const e = fromStroke({ kind: 'wall', from: [100, 100], to: [140, 130], radius: 5 }, [512, 320], b);
      const s = strokeOn(e, 512, 512);
      near([...(s?.from ?? []), ...(s?.to ?? []), s?.radius ?? NaN], [100, 160, 140, 208, 8]);
      // A corner of the arena stays its corner, also on a grid turned upright.
      const corner = fromStroke({ kind: 'food', from: [0, 0], to: [512, 320], radius: 2 }, [512, 320], b);
      const square = strokeOn(corner, 427, 427);
      near([...(square?.from ?? []), ...(square?.to ?? [])], [0, 0, 427, 427]);
      const tall = strokeOn(corner, 236, 512);
      near([...(tall?.from ?? []), ...(tall?.to ?? [])], [236, 0, 0, 512]);
    }
  });

  it('turns an edit by 90° on a portrait grid and back on a landscape one', () => {
    const s: Stroke = { kind: 'food', from: [64, 160], to: [128, 160], radius: 4 };
    const e = fromStroke(s, [512, 320], 'box');
    const tall = strokeOn(e, 320, 512);
    // A horizontal stroke on the left of the wide grid is a vertical stroke at the top of the tall one.
    near([...(tall?.from ?? []), ...(tall?.to ?? []), tall?.radius ?? NaN], [160, 64, 160, 128, 4]);
    // Painted again from the tall grid's cells, it comes back to where it was.
    const back = strokeOn(fromStroke(tall ?? s, [320, 512], 'box'), 512, 320);
    near([...(back?.from ?? []), ...(back?.to ?? [])], [64, 160, 128, 160]);
  });

  it('skips an edit that lies completely outside the new grid', () => {
    // 4 cells from the left edge of a 2:1 grid with a dish: outside a square grid, which is narrower in its frame.
    const e = fromStroke({ kind: 'food', from: [4, 64], to: [4, 64], radius: 3 }, [256, 128], 'dish');
    expect(strokeOn(e, 128, 128)).toBeUndefined();
    expect(strokeOn(e, 512, 256)).toBeDefined();
    // Partly inside: painted, and the paint pass cuts the rest.
    const edge = fromStroke({ kind: 'food', from: [40, 64], to: [40, 64], radius: 30 }, [256, 128], 'dish');
    expect(strokeOn(edge, 128, 128)).toBeDefined();
    // A box or a periodic grid stretches with the grid, so the same edit stays 1/64 of the width from the edge.
    for (const b of ['box', 'wrap'] as const) {
      const s = strokeOn(fromStroke({ kind: 'food', from: [4, 64], to: [4, 64], radius: 3 }, [256, 128], b), 128, 128);
      near(s?.from ?? [], [2, 64]);
    }
  });

  it('never paints thinner than MIN_RADIUS, so a wall drawn on a fine grid stays closed on a coarse one', () => {
    const e = fromStroke({ kind: 'wall', from: [10, 10], to: [400, 10], radius: 1.5 }, [1536, 960], 'box');
    expect(strokeOn(e, 256, 160)?.radius).toBe(MIN_RADIUS);
  });

  it('keeps the boundary an edit was painted under', () => {
    const e = fromStroke({ kind: 'light', from: [1, 1], to: [1, 1], radius: 4, boundary: 'dish' }, [64, 64], 'wrap');
    expect(strokeOn(e, 128, 128)?.boundary).toBe('dish');
  });
});

describe('preset shapes in the canonical frame', () => {
  // presets.ts before 2026-11-10: positions in fractions of width and height, radius in fractions of the short side.
  const before: Record<string, [number, number, number, number, number][]> = {
    'shortest-path': [
      [0.32, 0.5, 0.32, 0.5, 0.02],
      [0.68, 0.5, 0.68, 0.5, 0.02],
    ],
    shrinking: [
      [0.5, 0.5],
      [0.38, 0.32],
      [0.62, 0.3],
      [0.33, 0.62],
      [0.66, 0.66],
      [0.5, 0.78],
      [0.27, 0.45],
      [0.73, 0.47],
    ].map(([x = 0, y = 0]) => [x, y, x, y, 0.012]),
    light: [[0.5, 0.5, 0.5, 0.5, 0.16]],
    maze: [
      [0.25, 0.0, 0.25, 0.7, 0.008],
      [0.5, 0.3, 0.5, 1.0, 0.008],
      [0.75, 0.0, 0.75, 0.7, 0.008],
      [0.25, 0.7, 0.4, 0.7, 0.008],
      [0.6, 0.3, 0.75, 0.3, 0.008],
      [0.1, 0.1, 0.1, 0.1, 0.018],
      [0.9, 0.9, 0.9, 0.9, 0.018],
    ],
  };
  const boundaryOf = (id: string) => presetById(id)?.settings().boundary ?? 'wrap';

  it('land on a 16:10 grid where the fractions of the grid used before put them', () => {
    const [w, h] = [512, 320];
    for (const [id, shapes] of Object.entries(before)) {
      const now = preset(id).map((e) => strokeOn(fromShape(e, boundaryOf(id)), w, h));
      expect(now, id).toHaveLength(shapes.length);
      shapes.forEach(([x0, y0, x1, y1, r], i) => {
        const s = now[i];
        near([...(s?.from ?? []), ...(s?.to ?? []), s?.radius ?? NaN], [x0 * w, y0 * h, x1 * w, y1 * h, r * h], id);
      });
    }
  });

  const grids = {
    '16:9': gridSize(512, 16 / 9),
    '9:19.5': gridSize(512, 9 / 19.5),
    square: gridSize(512, 1),
    '6:5': gridSize(512, 1.2),
  };

  // On 6:5 the short-side frame of a dish put the Maze's two foods beside the grid (review of ADR 0019).
  it('keep the shapes of a box or a periodic grid at those fractions on every screen, turned on a tall one', () => {
    const arenas = Object.keys(before).filter((id) => boundaryOf(id) !== 'dish');
    expect(arenas).toEqual(['light', 'maze']);
    for (const id of arenas)
      for (const [name, [w, h]] of Object.entries(grids)) {
        const now = preset(id).map((e) => strokeOn(fromShape(e, boundaryOf(id)), w, h));
        // A portrait grid turns the landscape layout clockwise: the fraction (fx, fy) lands at (1 − fy, fx).
        const at = (fx: number, fy: number) => (h > w ? [w * (1 - fy), h * fx] : [w * fx, h * fy]);
        before[id]?.forEach(([x0, y0, x1, y1, r], i) => {
          const s = now[i];
          near(
            [...(s?.from ?? []), ...(s?.to ?? []), s?.radius ?? NaN],
            [...at(x0, y0), ...at(x1, y1), r * Math.min(w, h)],
            `${id} on ${name}`,
          );
        });
      }
  });

  it('give the Steiner tree a square of food on every screen shape', () => {
    for (const [name, [w, h]] of Object.entries(grids)) {
      const c = preset('steiner').map((e) => strokeOn(fromShape(e, 'dish'), w, h)?.from ?? [NaN, NaN]);
      const d = (i: number, j: number) =>
        Math.hypot((c[i]?.[0] ?? 0) - (c[j]?.[0] ?? 0), (c[i]?.[1] ?? 0) - (c[j]?.[1] ?? 0));
      // Four equal sides, and diagonals √2 as long.
      for (const [i, j] of [
        [0, 1],
        [1, 3],
        [3, 2],
        [2, 0],
      ] as const)
        expect(d(i, j), name).toBeCloseTo(d(0, 1), 9);
      expect(d(0, 3), name).toBeCloseTo(Math.SQRT2 * d(0, 1), 9);
    }
  });

  it('keep every food source of the dish scenes inside the dish, also on a phone', () => {
    for (const p of PRESETS.filter((x) => x.settings().boundary === 'dish'))
      for (const [name, [w, h]] of Object.entries(grids))
        for (const e of p.env ?? []) {
          const s = strokeOn(fromShape(e, 'dish'), w, h);
          const r = Math.hypot((s?.from[0] ?? 0) - w / 2, (s?.from[1] ?? 0) - h / 2) + (s?.radius ?? 0);
          expect(r, `${p.id} on ${name}`).toBeLessThan(Math.min(w, h) / 2 - 1);
        }
  });

  it('keep the layout of Shortest path and Maze along the long side of a tall screen', () => {
    const [w, h] = grids['9:19.5'];
    const [a, b] = preset('shortest-path').map((e) => strokeOn(fromShape(e, 'dish'), w, h)?.from ?? [NaN, NaN]);
    expect(a?.[0]).toBeCloseTo(b?.[0] ?? NaN, 9);
    expect(Math.abs((a?.[1] ?? 0) - (b?.[1] ?? 0))).toBeGreaterThan(0.5 * Math.min(w, h));
    // The maze's walls run across the long side: on a tall grid they are horizontal.
    for (const e of preset('maze')
      .filter((x) => x.kind === 'wall')
      .slice(0, 3)) {
      const s = strokeOn(fromShape(e, 'box'), w, h);
      expect(s?.from[1], 'wall').toBeCloseTo(s?.to[1] ?? NaN, 9);
    }
  });
});

describe('MIN_RADIUS', () => {
  // Every cell that a segment passes through, found by dense sampling; a diagonal step means the segment passed a
  // cell corner, and then a closed wall also needs one of the two side cells (agents move to 8 neighbours).
  function gaps(radius: number, seed: number) {
    let rng = seed;
    const rand = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 28 + 2;
    let found = 0;
    for (let k = 0; k < 400; k++) {
      const a: [number, number] = [rand(), rand()];
      const b: [number, number] = [rand(), rand()];
      const env = new Uint8Array(32 * 32 * 4);
      paintReference(env, 32, 32, { kind: 'wall', from: a, to: b, radius }, 'box');
      const wall = (x: number, y: number) => env[(y * 32 + x) * 4] === 255;
      let prev: [number, number] | undefined;
      for (let i = 0; i <= 4000; i++) {
        const t = i / 4000;
        const c: [number, number] = [Math.floor(a[0] + t * (b[0] - a[0])), Math.floor(a[1] + t * (b[1] - a[1]))];
        if (!wall(...c)) found++;
        if (prev && prev[0] !== c[0] && prev[1] !== c[1] && !wall(prev[0], c[1]) && !wall(c[0], prev[1])) found++;
        prev = c;
      }
    }
    return found;
  }

  it('paints every cell a segment passes through, without diagonal gaps', () => {
    expect(gaps(MIN_RADIUS, 1)).toBe(0);
  });

  it('is needed: thinner strokes leave gaps that agents walk through', () => {
    expect(gaps(0.45, 1)).toBeGreaterThan(0);
  });
});

describe('paintReference', () => {
  it('paints food, light and walls, and erases them (the expectations of sim.gpu.test.ts)', () => {
    const env = new Uint8Array(64 * 64 * 4);
    const paint = (s: Stroke) => {
      paintReference(env, 64, 64, s, 'wrap');
    };
    paint({ kind: 'food', from: [10, 10], to: [20, 10], radius: 3 });
    paint({ kind: 'light', from: [40, 40], to: [40, 40], radius: 6 });
    paint({ kind: 'wall', from: [10, 50], to: [50, 50], radius: 1.5 });
    const at = (x: number, y: number, ch: number) => env[(y * 64 + x) * 4 + ch] ?? 0;
    expect(at(15, 10, 1)).toBe(255);
    expect(at(40, 40, 2)).toBeGreaterThan(200);
    expect(at(30, 50, 0)).toBe(255);
    expect(at(5, 30, 1) + at(5, 30, 0)).toBe(0);
    paint({ kind: 'erase', from: [15, 10], to: [15, 10], radius: 2 });
    expect(at(15, 10, 1)).toBe(0);
  });

  it('wraps strokes around the edges only under the periodic boundary', () => {
    const food: Stroke = { kind: 'food', from: [63, 32], to: [63, 32], radius: 3 };
    const wrap = new Uint8Array(64 * 64 * 4);
    const box = new Uint8Array(64 * 64 * 4);
    const own = new Uint8Array(64 * 64 * 4);
    paintReference(wrap, 64, 64, food, 'wrap');
    paintReference(box, 64, 64, food, 'box');
    paintReference(own, 64, 64, { ...food, boundary: 'wrap' }, 'box'); // the stroke's own boundary counts
    expect(wrap[(32 * 64 + 1) * 4 + 1]).toBe(255);
    expect(box[(32 * 64 + 1) * 4 + 1]).toBe(0);
    expect(own[(32 * 64 + 1) * 4 + 1]).toBe(255);
  });
});
