// The sweep changes no byte on the grid on screen (sweep.ts, docs/adr/0019). Random sequences of strokes of every
// kind, in every arena, on grids of every shape, compared after every recorded stroke with the list that keeps every
// stroke recorded since the grid on screen last changed, both painted with paintReference.
import { describe, expect, it } from 'vitest';
import type { Boundary } from '../model/params';
import { presetById } from '../model/presets';
import { dishRadius, paintsCell, SLACK } from './brush';
import { CpuBackend, type CpuSim, hold } from './cpu-backend';
import { Engine } from './engine';
import { fromShape, fromStroke, MIN_RADIUS, strokeOn, type EnvEdit } from './environment';
import { paintReference } from './paint-reference';
import { compact, Placement, sweep } from './sweep';
import type { EnvTool, Stroke } from './types';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 2 ** 32;
  };
}

/** The list painted on a `w` × `h` grid, every edit through the frame of the arena it was painted in. */
function replay(list: readonly EnvEdit[], w: number, h: number) {
  const env = new Uint8Array(w * h * 4);
  for (const e of list) {
    const s = strokeOn(e, w, h);
    if (s) paintReference(env, w, h, s, e.boundary);
  }
  return env;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(a, b) === 0;
const BOUNDARIES = ['dish', 'box', 'wrap'] as const;

/**
 * A random stroke on a `w` × `h` grid in `arena`, near one of a few spots, so that strokes often lie on top of each
 * other: by the edges, on the periodic seam, on the dish's rim, in the middle, also on a copy of a periodic grid.
 */
function strokeNear(rand: () => number, spots: [number, number][], w: number, h: number, arena: Boundary): Stroke {
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)] as T;
  const kind = pick<EnvTool>(['food', 'food', 'food', 'light', 'wall', 'wall', 'erase', 'erase', 'erase', 'erase']);
  const [u, v] = pick(spots);
  const copy = arena === 'wrap' && rand() < 0.15 ? [pick([-1, 1]) * w, pick([-1, 0, 1]) * h] : [0, 0];
  const from: [number, number] = [
    u * w + (rand() * 2 - 1) * 8 + (copy[0] ?? 0),
    v * h + (rand() * 2 - 1) * 8 + (copy[1] ?? 0),
  ];
  const length = rand() < 0.5 ? 0 : rand() * 24;
  const angle = rand() * 2 * Math.PI;
  const big = kind === 'erase' ? 2 + rand() * 10 : MIN_RADIUS + rand() * 6;
  return {
    kind,
    from,
    to: [from[0] + length * Math.cos(angle), from[1] + length * Math.sin(angle)],
    radius: rand() < 0.1 ? 0.3 + rand() : big,
  };
}

/** Spots as fractions of the grid: the edges, the corners, the dish's rim on both axes, the middle. */
function spotsOf(rand: () => number, w: number, h: number): [number, number][] {
  const R = dishRadius(w, h);
  const all: [number, number][] = [
    [0, 0.5],
    [1, 0.3],
    [0.5, 0],
    [0.4, 1],
    [0, 0],
    [1, 1],
    [0.5 - R / w, 0.5],
    [0.5 + R / w, 0.5],
    [0.5, 0.5 - R / h],
    [0.5, 0.5],
    [0.3, 0.6],
  ];
  return all.filter(() => rand() < 0.5).concat([[0.5, 0.5]]);
}

describe('the sweep', () => {
  const GRIDS = [
    [237, 512],
    [511, 287],
    [512, 320],
    [96, 60],
    [61, 37],
    [37, 61],
    [128, 128],
  ] as const;

  it('changes no byte on the grid on screen, after every recorded stroke of random sequences', () => {
    let [checks, deleted, kept] = [0, 0, 0];
    for (let seed = 1; seed <= 160; seed++) {
      const rand = rng(seed);
      const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)] as T;
      let [w, h] = pick(GRIDS);
      let arena: Boundary = pick(BOUNDARIES);
      let spots = spotsOf(rand, w, h);
      // A scene's shapes, in the frame of its arena.
      const scene = pick(['maze', 'shrinking', 'steiner', 'light', 'three-strains'] as const);
      const p = presetById(scene);
      const list = (p?.env ?? []).map((e) => fromShape(e, p?.settings().boundary ?? 'box'));
      /** Every stroke since the grid on screen changed: the sweep may change other grids, not this one. */
      let full = list.slice();
      // Kept in step with the list as the engine keeps it, with the open cells it remembers between sweeps.
      // Every other sequence keeps the index of tiles from the first edit on (the engine from INDEXED on).
      const tiles = seed % 2 ? 0 : undefined;
      let placement = new Placement(w, h, list, tiles);
      let prev: Stroke | undefined;
      for (let op = 0; op < 36; op++) {
        const r = rand();
        if (r < 0.08) {
          [w, h] = pick(GRIDS);
          spots = spotsOf(rand, w, h);
          full = list.slice();
          placement = new Placement(w, h, list, tiles);
          prev = undefined;
          continue;
        }
        if (r < 0.16) {
          arena = pick(BOUNDARIES);
          continue;
        }
        // Now and then an erase or a wall over the last stroke's own segment, with at least its radius: the sweep
        // deletes what it covers without SLACK (coversExactly()), and that too must change no byte.
        const again = prev && rand() < 0.2;
        const s =
          prev && again
            ? { ...prev, kind: pick(['erase', 'wall'] as const), radius: prev.radius + pick([0, 0, 0.5]) }
            : strokeNear(rand, spots, w, h, arena);
        const stroke = { ...s, radius: Math.max(MIN_RADIUS, s.radius) };
        if (!paintsCell(stroke, w, h, arena)) continue;
        prev = stroke;
        const edit = fromStroke(stroke, [w, h], arena);
        list.push(edit);
        full.push(edit);
        placement.push(edit);
        if (edit.kind === 'erase' || edit.kind === 'wall') {
          const gone = sweep(placement);
          // A fresh placement, without the cells that earlier sweeps found open, deletes the same edits.
          if (op % 3 === 0) expect([...sweep(new Placement(w, h, list, 2 - (tiles ?? 2)))]).toEqual([...gone]);
          deleted += gone.size;
          compact(list, gone);
          placement.remove(gone);
        }
        checks++;
        const [swept, all] = [replay(list, w, h), replay(full, w, h)];
        if (!same(swept, all)) expect.fail(`seed ${seed}, op ${op}: ${w} × ${h}, ${JSON.stringify(full.slice(-6))}`);
      }
      kept += list.length;
    }
    // The sequences delete a good share of their strokes, so the comparison means something.
    expect(checks).toBeGreaterThan(3000);
    expect(deleted).toBeGreaterThan(800);
    expect(kept).toBeGreaterThan(800);
  }, 120_000);
});

// Clearing strokes count their cells with the rim moved in by SLACK and a hair of float64 rounding more: on a 2201 × 2201
// dish the centre of cell (1389, 101) lies 6.8e-7 cells inside the rim moved in by SLACK, within that hair of 1.04e-6
// (2026-11-11, for Jones' dish of ADR 0027: a search of every grid side from 16 to 4,096, square and with sides of
// either parity, found no smaller grid with such a cell). The edit stays (mutant IV4).
describe('the sweep at the rim', () => {
  it('keeps an edit whose cell lies within a hair inside the rim moved in, under an erase there', () => {
    const [w, h] = [2201, 2201];
    const inside = dishRadius(w, h) - SLACK - Math.hypot(1389.5 - w / 2, 101.5 - h / 2);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(1e-9 * (1 + dishRadius(w, h) - SLACK));
    const list = [
      fromStroke({ kind: 'food', from: [1389.5, 101.5], to: [1389.5, 101.5], radius: MIN_RADIUS }, [w, h], 'dish'),
      fromStroke({ kind: 'erase', from: [1389, 103], to: [1389, 103], radius: 4 }, [w, h], 'dish'),
    ];
    expect([...sweep(new Placement(w, h, list))]).toEqual([]);
  });

  // A dish erase clears no cell beyond the rim, and a box or a periodic edit paints cells there too. So one stroke
  // covers such an edit only when the edit's reach lies inside the rim, not only its ends (inside(), mutant VM11).
  it('keeps a box or periodic edit across the rim under a dish erase that holds both its ends', () => {
    const [w, h] = [512, 320]; // the dish: radius 0.945 × 160 = 151.2 around (256, 160)
    const beyond = (c: number) => Math.hypot((c % w) + 0.5 - w / 2, Math.floor(c / w) + 0.5 - h / 2) > dishRadius(w, h);
    for (const arena of ['box', 'wrap'] as const) {
      const list = [
        fromStroke({ kind: 'food', from: [404.5, 160.5], to: [404.5, 160.5], radius: 4 }, [w, h], arena),
        fromStroke({ kind: 'erase', from: [402.5, 160.5], to: [402.5, 160.5], radius: 7 }, [w, h], 'dish'),
      ];
      // The food's centre lies 156.5 cells from the dish's centre, and its brush reaches 160.5 cells. The erase clears
      // every cell of it inside the rim. The 6 cells beyond the rim keep their food.
      const env = replay(list, w, h);
      const food = [...Array(w * h).keys()].filter((c) => (env[4 * c + 1] ?? 0) > 0);
      expect([food.length, food.every(beyond)], arena).toEqual([6, true]);
      expect([...sweep(new Placement(w, h, list))], arena).toEqual([]);
    }
  });
});

// boxOf() cuts a box at the edge of a closed grid, and on a periodic grid a box across an edge spans all columns. Such
// a box starts at column 0, and its stroke can paint that column. So Placement.reaches() must count it for a row whose
// runs end in column 0 (mutant RE1).
describe('the sweep at the edge of the grid', () => {
  it('deletes an edit in column 0 that strokes whose boxes start at column 0 clear completely', () => {
    const [w, h] = [512, 320];
    for (const arena of ['box', 'wrap'] as const) {
      const dab = (kind: EnvTool, at: [number, number], radius: number) =>
        fromStroke({ kind, from: at, to: at, radius }, [w, h], arena);
      // In rows 97 and 103 the food paints only column 0. The first erase leaves those cells and (0, 98), (0, 102)
      // open, and the last two erases clear them. On the periodic grid the food also paints cells across the left
      // edge: one more erase clears them.
      const strokes = [
        dab('food', [0.5, 100.5], 3),
        dab('erase', [3.5, 100.5], 3.5),
        ...(arena === 'wrap' ? [dab('erase', [509.5, 100.5], 3.5)] : []),
        dab('erase', [0.5, 97.5], 2),
        dab('erase', [0.5, 103.5], 2),
      ];
      const all = new Placement(w, h, strokes);
      expect(
        strokes.map((_, i) => all.box(i)[0]),
        arena,
      ).toEqual(strokes.map(() => 0));
      for (const tiles of [undefined, 0]) {
        const list: EnvEdit[] = [];
        const placement = new Placement(w, h, [], tiles);
        for (const e of strokes) {
          list.push(e);
          placement.push(e);
          const gone = sweep(placement);
          compact(list, gone);
          placement.remove(gone);
        }
        expect(list, `${arena}, tiles from edit ${tiles ?? 'INDEXED'}`).toEqual([]);
      }
    }
  });
});

// Engine.paint puts every painted stroke on whole steps of 1/16 cell (STEP in environment.ts), but a scene's shapes
// keep their radius. So the sweep can meet an edit and a later stroke with its segment and a radius a hair smaller:
// 5 − 5e-7 is 4.9999995 in float32 too, less than the distance of the 12 cells that lie exactly 5 cells from the
// centre. The erase leaves their food, so it does not cover the food (coversExactly(), mutant VM8).
describe('the sweep with the same segment', () => {
  it('keeps an edit under a later stroke with its segment and a radius a hair smaller, which leaves its edge cells', () => {
    const [w, h] = [512, 320];
    const at: [number, number] = [200.5, 160.5];
    expect(Math.fround(5 - 5e-7)).toBeLessThan(5);
    const list = [
      fromStroke({ kind: 'food', from: at, to: at, radius: 5 }, [w, h], 'box'),
      fromStroke({ kind: 'erase', from: at, to: at, radius: 5 - 5e-7 }, [w, h], 'box'),
    ];
    const env = replay(list, w, h);
    expect([...Array(w * h).keys()].filter((c) => (env[4 * c + 1] ?? 0) > 0).length).toBe(12);
    expect([...sweep(new Placement(w, h, list))]).toEqual([]);
  });
});

// Rule 2 looks at the erases over an edit that went: a box that only touches the erase's box holds no cell of it
// (boxes are grown by a cell), in the pass over the list and in the tiles alike (mutant TL4).
describe('the sweep beside an erase', () => {
  it('keeps an erase that clears nothing between two edits that went, whose boxes touch its box', () => {
    const [w, h] = [128, 128];
    const dab = (kind: EnvTool, x: number, radius: number, to = x) =>
      fromStroke({ kind, from: [x, 20.5], to: [to, 20.5], radius }, [w, h], 'box');
    // Boxes: the erase's columns 16 to 24, the foods' 7 to 15 and 25 to 33.
    const list = [dab('erase', 20.5, 3), dab('food', 11.5, 3), dab('food', 29.5, 3), dab('erase', 11.5, 5, 29.5)];
    for (const tiles of [undefined, 0]) {
      const placement = new Placement(w, h, list, tiles);
      expect([placement.box(0)[0], placement.box(0)[2], placement.box(1)[2], placement.box(2)[0]]).toEqual([
        16, 25, 16, 25,
      ]);
      expect([...sweep(placement)].sort()).toEqual([1, 2, 3]);
    }
  });
});

// The same rule through the engine: the CPU simulation holds every stroke painted since it was built, the engine's
// list only what the sweep left, and after every operation the two must give the same bytes (I1 of the review of
// ADR 0019). A stroke drawn while a new grid is allocated, a Clear, a preset load and arena switches are included.
describe('the engine with the sweep', () => {
  const CANVASES = [
    [1600, 1000], // 512 × 320
    [1280, 720], // 512 × 288
    [1000, 1000], // 512 × 512
    [474, 1024], // 237 × 512
    [1784, 1000], // 512 × 287
  ] as const;
  const edits = (e: Engine) => (e as unknown as { edits: EnvEdit[] }).edits;

  it('holds in the simulation exactly what its list paints, after every operation of random sequences', async () => {
    let [ops, swept] = [0, 0];
    for (let seed = 1; seed <= 24; seed++) {
      const rand = rng(1000 + seed);
      const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)] as T;
      const [cw, ch] = pick(CANVASES);
      const canvas = { width: cw, height: ch } as HTMLCanvasElement;
      const backend = new CpuBackend();
      const p = presetById(pick(['maze', 'shrinking', 'three-strains', 'steiner'] as const));
      if (!p) throw new Error('no preset');
      const start = { ...p.settings(), resolution: pick([256, 512] as const), seed: 7 };
      const engine = await Engine.create(canvas, start, undefined, backend);
      await engine.load(start, p.env ?? []);
      const sim = () => engine.sim as CpuSim;
      const strokeOnScreen = () => {
        const [w, h] = [sim().width, sim().height];
        return strokeNear(rand, spotsOf(rand, w, h), w, h, engine.settings.boundary);
      };
      for (let op = 0; op < 30; op++) {
        const r = rand();
        const before = edits(engine).length;
        if (r < 0.55) {
          for (let k = 0; k < 1 + Math.floor(rand() * 4); k++) engine.paint(strokeOnScreen());
        } else if (r < 0.65) {
          await engine.apply({ ...engine.settings, boundary: pick(BOUNDARIES) });
        } else if (r < 0.77) {
          [canvas.width, canvas.height] = pick(CANVASES);
          await engine.apply({ ...engine.settings, density: Math.round((0.05 + rand() * 0.3) * 100) / 100 });
        } else if (r < 0.85) {
          await engine.apply({ ...engine.settings, resolution: pick([256, 512] as const) });
        } else if (r < 0.95) {
          // Strokes while a new grid is allocated: the view still shows the old one.
          const release = hold(backend);
          const density = engine.settings.density === 0.21 ? 0.22 : 0.21;
          const rebuilt = engine.apply({ ...engine.settings, resolution: pick([256, 512] as const), density });
          for (let k = 0; k < 3; k++) engine.paint(strokeOnScreen());
          release();
          await rebuilt;
        } else if (r < 0.98) {
          engine.clearEnvironment();
        } else {
          await engine.load(start, p.env ?? []);
        }
        if (edits(engine).length < before) swept++;
        engine.frame(0, 0);
        ops++;
        const expected = replay(edits(engine), sim().width, sim().height);
        if (!same(sim().env, expected)) expect.fail(`seed ${seed}, op ${op}: the simulation is not the list`);
      }
    }
    expect(ops).toBe(24 * 30);
    expect(swept).toBeGreaterThan(20);
  }, 120_000);
});
