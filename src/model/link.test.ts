// The drawing of a shared link (docs/adr/0021): exact round trips, the caps, and hostile bytes.
import { describe, expect, it } from 'vitest';
import { paintBox, paintSegments } from '../engine/brush';
import { fromShape, MIN_RADIUS, snap, STEP, strokeOn, type EnvEdit } from '../engine/environment';
import {
  drawingOf,
  kindsOf,
  MAX_STROKES,
  MAX_WORK,
  packDrawing,
  sceneOnly,
  unpackDrawing,
  workOf,
  type Drawing,
} from './link';
import { BOUNDARIES, MAX_STRAINS } from './params';
import { PRESETS, presetById, shapeRevision, shapesAt } from './presets';

/** mulberry32: a seeded random source, so a failure repeats. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const KINDS = ['erase', 'wall', 'food', 'light'] as const;
/** Grids of the app: 16:10, 16:9, phones, a square, both extremes of gridSize(). */
const GRIDS: [number, number][] = [
  [512, 320],
  [1536, 864],
  [236, 512],
  [768, 768],
  [4096, 2304],
  [256, 16],
  [16, 4096],
];

/** A random stroke as Engine.paint() records it: on whole steps, every kind and arena, also beside the grid. */
function stroke(r: () => number, grid: [number, number]): EnvEdit {
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)] as T;
  const at = (side: number) => snap((r() * 1.6 - 0.3) * side);
  const from: [number, number] = [at(grid[0]), at(grid[1])];
  const to: [number, number] =
    r() < 0.3 ? [from[0], from[1]] : [snap(from[0] + (r() - 0.5) * 60), snap(from[1] + (r() - 0.5) * 60)];
  const radius = Math.max(MIN_RADIUS, snap(r() * Math.min(12, Math.min(...grid) / 8)));
  return { kind: pick(KINDS), from, to, radius, grid, boundary: pick(BOUNDARIES) };
}

/**
 * A random drawing: a scene with some of its shapes or none, its strains' origins, then strokes on a few grids, as
 * many as the paint work allows (MAX_WORK): strokes on a grid 16 cells high cover much of every grid.
 */
function drawing(r: () => number, strokes = Math.floor(r() * 300)): Drawing {
  const p = r() < 0.2 ? undefined : PRESETS[Math.floor(r() * PRESETS.length)];
  const strains = p?.settings().strains.length ?? 0;
  const grids = Array.from({ length: 1 + Math.floor(r() * 3) }, () => GRIDS[Math.floor(r() * GRIDS.length)]);
  const list: EnvEdit[] = [];
  let work = 0;
  for (let i = 0; i < strokes; i++) {
    const e = stroke(r, grids[Math.floor(r() * grids.length)] ?? [512, 320]);
    work += workOf(e).work;
    if (work > MAX_WORK) break;
    list.push(e);
  }
  // Any revision of the scene's shapes (ADR 0027).
  const revision = p ? Math.floor(r() * (shapeRevision(p) + 1)) : 0;
  return {
    scene: p?.id ?? '',
    revision,
    origins: p ? Array.from({ length: 1 + Math.floor(r() * 4) }, () => Math.floor(r() * (strains + 1)) - 1) : [],
    shapes: ((p && shapesAt(p, revision)) ?? []).map(() => r() < 0.7),
    strokes: list,
  };
}

/** Every number finite and in range, every name from its fixed set: what a decoded drawing must hold. */
function valid(d: Drawing) {
  const p = presetById(d.scene);
  expect(d.scene === '' || p !== undefined).toBe(true);
  if (p) {
    expect(Number.isInteger(d.revision) && d.revision >= 0 && d.revision <= shapeRevision(p)).toBe(true);
    expect(d.shapes).toHaveLength(shapesAt(p, d.revision)?.length ?? -1);
    expect(d.origins.length >= 1 && d.origins.length <= MAX_STRAINS).toBe(true);
    for (const o of d.origins) expect(o >= -1 && o < p.settings().strains.length).toBe(true);
  } else expect([d.origins, d.revision]).toEqual([[], 0]);
  expect(d.strokes.length).toBeLessThanOrEqual(MAX_STROKES);
  let work = 0;
  for (const e of d.strokes) {
    expect(KINDS).toContain(e.kind);
    expect(BOUNDARIES).toContain(e.boundary);
    for (const v of [...e.from, ...e.to]) expect(Number.isFinite(v) && Math.abs(v) <= 2 ** 20).toBe(true);
    expect(e.radius >= MIN_RADIUS && e.radius <= 2 ** 14).toBe(true);
    for (const v of e.grid ?? []) expect(Number.isInteger(v) && v >= 16 && v <= 4096).toBe(true);
    work += workOf(e).work;
  }
  expect(work).toBeLessThanOrEqual(MAX_WORK);
}

describe('the drawing of a link', () => {
  it('comes back exactly, for random lists of every kind and arena on many grids', () => {
    const r = random(1);
    for (let trial = 0; trial < 300; trial++) {
      const d = drawing(r);
      const bytes = packDrawing(d);
      expect(bytes, `trial ${trial}`).toBeDefined();
      expect(unpackDrawing(bytes ?? new Uint8Array()), `trial ${trial}`).toEqual(d);
    }
  });

  it('puts every position and radius on whole steps of 1/16 cell, at most half a step away', () => {
    const r = random(2);
    for (let i = 0; i < 10_000; i++) {
      const v = (r() - 0.5) * 2 ** (r() * 24);
      const s = snap(v);
      expect(Math.abs(s - v)).toBeLessThanOrEqual(STEP / 2);
      expect(Number.isInteger(s / STEP)).toBe(true);
      expect(Object.is(s, -0)).toBe(false);
    }
    expect(Number.isInteger(MIN_RADIUS / STEP)).toBe(true);
  });

  it("names a scene's shapes by the scene and which of them the list holds", () => {
    const maze = presetById('maze');
    const env = maze?.env ?? [];
    expect(env.length).toBeGreaterThan(2);
    const list = env.map((e) => fromShape(e, 'box'));
    const dab: EnvEdit = { kind: 'food', from: [10, 10], to: [10, 10], radius: 2, grid: [512, 320], boundary: 'box' };
    // The sweep deleted the second shape, and a stroke came after them.
    const d = drawingOf([list[0], ...list.slice(2), dab] as EnvEdit[], 'maze', env, 'box', [0]);
    expect(d.shapes).toEqual(env.map((_, i) => i !== 1));
    expect(d.strokes).toEqual([dab]);
    // A scene alone takes a few bytes: version, id, revision, origins, the number of shapes and one bit each, no
    // stroke.
    const alone = packDrawing({ ...d, strokes: [] }) ?? new Uint8Array();
    expect(alone.length).toBeLessThan(13);
    expect(unpackDrawing(alone)?.shapes).toEqual(d.shapes);
    // The Maze has 7 shapes: a bit for an eighth is refused, and so is a link that counts 8 shapes.
    const mask = alone.length - 2;
    expect(unpackDrawing(Uint8Array.from(alone, (v, i) => (i === mask ? v | 128 : v)))).toBeUndefined();
    expect(unpackDrawing(Uint8Array.from(alone, (v, i) => (i === mask - 1 ? 8 : v)))).toBeUndefined();
    // A byte after the last stroke is refused.
    expect(unpackDrawing(Uint8Array.from([...alone, 0]))).toBeUndefined();
    // Shapes of another arena are not the scene's: the list cannot go in a link.
    const other = drawingOf(
      env.map((e) => fromShape(e, 'dish')),
      'maze',
      env,
      'box',
      [0],
    );
    expect(other.shapes.every((kept) => !kept)).toBe(true);
    expect(packDrawing(other)).toBeUndefined();
    expect(sceneOnly(d)).toEqual({
      scene: 'maze',
      revision: 0,
      origins: [0],
      shapes: env.map(() => true),
      strokes: [],
    });
  });

  it('refuses another version, and a scene with no strain or more than four', () => {
    const shapes = presetById('maze')?.env?.map(() => true) ?? [];
    const four =
      packDrawing({ scene: 'maze', revision: 0, origins: [0, -1, 0, -1], shapes, strokes: [] }) ?? new Uint8Array();
    expect(unpackDrawing(four)?.origins).toEqual([0, -1, 0, -1]);
    for (const version of [0, 3, 255])
      expect(unpackDrawing(Uint8Array.from(four, (v, i) => (i === 0 ? version : v))), `${version}`).toBeUndefined();
    // The version, the id's length and 'maze', at index 6 the revision of its shapes, then the number of strains, each
    // one's origin plus 1, and after them the shapes and the number of strokes.
    const strains = (n: number) =>
      Uint8Array.from([...four.slice(0, 7), n, ...Array<number>(n).fill(1), ...four.slice(8 + 4)]);
    expect(unpackDrawing(strains(1))?.origins).toEqual([0]);
    expect(unpackDrawing(strains(0))).toBeUndefined();
    expect(unpackDrawing(strains(MAX_STRAINS + 1))).toBeUndefined();
  });

  it('gives up on values off the steps, out of range or not finite, and never throws', () => {
    const base: EnvEdit = { kind: 'wall', from: [5, 5], to: [9, 5], radius: 2, grid: [512, 320], boundary: 'box' };
    const of = (e: Partial<EnvEdit>) =>
      packDrawing({ scene: '', revision: 0, origins: [], shapes: [], strokes: [{ ...base, ...e }] });
    expect(of({})).toBeDefined();
    for (const bad of [NaN, Infinity, -Infinity, 5.01, 2 ** 21]) {
      expect(of({ from: [bad, 5] }), String(bad)).toBeUndefined();
      expect(of({ to: [5, bad] }), String(bad)).toBeUndefined();
      expect(of({ radius: bad }), String(bad)).toBeUndefined();
    }
    expect(of({ radius: MIN_RADIUS - STEP })).toBeUndefined();
    expect(of({ grid: [15, 320] })).toBeUndefined();
    expect(of({ grid: [512, 4097] })).toBeUndefined();
    expect(of({ grid: [512.5, 320] })).toBeUndefined();
    // An edit without a grid is a preset's shape, not a stroke.
    const { grid: _grid, ...shape } = base;
    expect(packDrawing({ scene: '', revision: 0, origins: [], shapes: [], strokes: [shape] })).toBeUndefined();
    expect(of({ boundary: 'torus' as never })).toBeUndefined();
    const scene = (patch: Partial<Drawing>) =>
      packDrawing({
        scene: 'maze',
        revision: 0,
        origins: [0],
        shapes: presetById('maze')?.env?.map(() => true) ?? [],
        strokes: [],
        ...patch,
      });
    expect(scene({})).toBeDefined();
    expect(scene({ scene: 'no-such-scene' })).toBeUndefined();
    expect(scene({ scene: '__proto__' })).toBeUndefined();
    expect(scene({ origins: [1] })).toBeUndefined(); // the Maze has one strain
    expect(scene({ origins: [] })).toBeUndefined();
    expect(scene({ shapes: [true] })).toBeUndefined();
  });

  // ADR 0027: a scene's shapes change, and a link keeps the shapes it was made with. Version 1 links name revision 0;
  // version 2 writes the revision after the scene's id.
  it("names the revision of a scene's shapes, and reads a link of version 1 as revision 0", () => {
    const p = presetById('shrinking');
    if (!p) throw new Error('no Shrinking plasmodium');
    expect(shapeRevision(p)).toBe(1);
    const [old, now] = [shapesAt(p, 0) ?? [], shapesAt(p, 1) ?? []];
    expect([old.length, now.length, now]).toEqual([8, 19, p.env]);
    expect([shapesAt(p, 2), shapesAt(p, -1), shapesAt(p, 0.5)]).toEqual([undefined, undefined, undefined]);
    const of = (revision: number, shapes: readonly unknown[]) => ({
      scene: 'shrinking',
      revision,
      origins: [0],
      shapes: shapes.map(() => true),
      strokes: [],
    });
    for (const [revision, shapes] of [
      [0, old],
      [1, now],
    ] as const) {
      const bytes = packDrawing(of(revision, shapes)) ?? new Uint8Array();
      expect(bytes[0]).toBe(2);
      expect(bytes[1 + 1 + 'shrinking'.length]).toBe(revision); // after the id
      expect(unpackDrawing(bytes)).toEqual(of(revision, shapes));
    }
    // A revision the scene does not have, or the shape count of another revision, is refused.
    expect(packDrawing(of(2, now))).toBeUndefined();
    expect(packDrawing(of(0, now))).toBeUndefined();
    const two = packDrawing(of(1, now)) ?? new Uint8Array();
    const at = 2 + 'shrinking'.length;
    expect(unpackDrawing(Uint8Array.from(two, (v, i) => (i === at ? 2 : v)))).toBeUndefined();
    expect(unpackDrawing(Uint8Array.from(two, (v, i) => (i === at ? 0 : v)))).toBeUndefined();
    // Version 1: the same bytes without the revision, read as revision 0 with its 8 shapes.
    const v2old = packDrawing(of(0, old)) ?? new Uint8Array();
    const v1 = Uint8Array.from([1, ...v2old.slice(1, at), ...v2old.slice(at + 1)]);
    expect(unpackDrawing(v1)).toEqual(of(0, old));
    // A version 1 link with the 19 shapes of revision 1 counts the wrong number of shapes for revision 0.
    const v1now = Uint8Array.from([1, ...two.slice(1, at), ...two.slice(at + 1)]);
    expect(unpackDrawing(v1now)).toBeUndefined();
    // Without a scene there is no revision: the bytes of version 1 and 2 differ only in the version.
    const plain = packDrawing({ scene: '', revision: 0, origins: [], shapes: [], strokes: [] }) ?? new Uint8Array();
    expect(Array.from(plain)).toEqual([2, 0, 0]);
    expect(unpackDrawing(Uint8Array.from([1, 0, 0]))).toEqual({
      scene: '',
      revision: 0,
      origins: [],
      shapes: [],
      strokes: [],
    });
  });

  // kindsOf() reads the shapes of the drawing's revision: a scene whose wall became food (a scene of this test only).
  it('tells the kinds of a drawing from the shapes of its revision', () => {
    const wall = { kind: 'wall' as const, at: [0, 0] as [number, number], to: [0.1, 0] as [number, number], r: 0.01 };
    const food = { kind: 'food' as const, at: [0, 0] as [number, number], r: 0.01 };
    const base = presetById('maze');
    if (!base) throw new Error('no Maze');
    PRESETS.push({ ...base, id: 'test-revisions', env: [food], envHistory: [[wall]] });
    try {
      const d = (revision: number) => ({
        scene: 'test-revisions',
        revision,
        origins: [0],
        shapes: [true],
        strokes: [],
      });
      expect([...kindsOf(d(0))]).toEqual(['wall']);
      expect([...kindsOf(d(1))]).toEqual(['food']);
      expect(unpackDrawing(packDrawing(d(0)) ?? new Uint8Array())).toEqual(d(0));
    } finally {
      PRESETS.pop();
    }
  });

  it('caps the strokes and the paint work, in the encoder and the decoder', () => {
    // Many small dabs at one place: one head byte each after the first.
    const tiny: EnvEdit = { kind: 'food', from: [99, 99], to: [99, 99], radius: 1, grid: [1536, 864], boundary: 'box' };
    const many = (n: number, e: EnvEdit) => ({
      scene: '',
      revision: 0,
      origins: [],
      shapes: [],
      strokes: Array(n).fill(e) as EnvEdit[],
    });
    expect(packDrawing(many(MAX_STROKES, tiny))).toBeDefined();
    expect(packDrawing(many(MAX_STROKES + 1, tiny))).toBeUndefined();
    // A dab that covers its whole grid is a full pass: MAX_WORK of them fit, one more does not.
    const huge: EnvEdit = { kind: 'light', from: [8, 8], to: [8, 8], radius: 20, grid: [16, 16], boundary: 'box' };
    expect(workOf(huge).work).toBe(1);
    expect(packDrawing(many(MAX_WORK, huge))).toBeDefined();
    expect(packDrawing(many(MAX_WORK + 1, huge))).toBeUndefined();
    // The decoder counts the same: one more head byte (same grid, start, end and radius) over the cap.
    const over = (n: number, e: EnvEdit) => {
      const bytes = packDrawing(many(n, e)) ?? new Uint8Array();
      const varint = (v: number) => (v < 128 ? [v] : [(v % 128) | 128, Math.floor(v / 128)]);
      const head = bytes.at(-1) ?? 0; // a repeated dab is one head byte
      const count = varint(n).length;
      return Uint8Array.from([...bytes.slice(0, 2), ...varint(n + 1), ...bytes.slice(2 + count), head]);
    };
    expect(unpackDrawing(over(MAX_STROKES, tiny))).toBeUndefined();
    expect(unpackDrawing(over(MAX_WORK, huge))).toBeUndefined();
    expect(unpackDrawing(over(MAX_WORK - 1, huge))?.strokes).toHaveLength(MAX_WORK);
    // A huge count is refused before any stroke is read.
    expect(unpackDrawing(Uint8Array.from([1, 0, 255, 255, 255, 255, 127]))).toBeUndefined();
  });

  it('bounds the cells and segments a stroke paints on every grid by its estimate', () => {
    // The boxes that the paint passes dispatch over (paintBox() of each segment of paintSegments()) on other grids.
    const r = random(3);
    let checks = 0;
    for (let i = 0; i < 3000; i++) {
      const grid = GRIDS[Math.floor(r() * GRIDS.length)] ?? [512, 320];
      const side = Math.min(...grid);
      const at = () => snap((r() * 3 - 1) * Math.max(...grid));
      // Long strokes over several periods with brushes up to twice the short side, usual strokes, and the smallest
      // dabs, whose box the growth by one cell and MIN_RADIUS make up on a finer grid.
      const usual = stroke(r, grid);
      const pick = r();
      const e: EnvEdit =
        pick < 0.4
          ? { ...usual, to: [at(), at()], radius: Math.max(MIN_RADIUS, snap(r() * r() * 2 * side)) }
          : pick < 0.7
            ? usual
            : { ...usual, to: [usual.from[0], usual.from[1]], radius: MIN_RADIUS };
      const { work, parts } = workOf(e);
      for (const [w, h] of [...GRIDS, [4096, 4096] as [number, number]]) {
        const s = strokeOn(e, w, h);
        if (!s) continue;
        const wrap = s.boundary === 'wrap';
        const segments = paintSegments(s, w, h, wrap);
        const cells = segments.reduce((n, seg) => {
          const b = paintBox(seg, w, h, wrap);
          return n + (b ? b[2] * b[3] : 0);
        }, 0);
        expect(segments.length).toBeLessThanOrEqual(parts);
        expect(cells).toBeLessThanOrEqual(work * 4096 * 4096);
        checks++;
      }
    }
    expect(checks).toBeGreaterThan(10_000);
  });

  it('decodes random, truncated and changed bytes without throwing, to nothing or a valid drawing', () => {
    const r = random(4);
    let decoded = 0;
    for (let i = 0; i < 3000; i++) {
      const junk = Uint8Array.from({ length: Math.floor(r() * 64) }, () => Math.floor(r() * 256));
      if (r() < 0.5) junk[0] = 1; // the version
      const d = unpackDrawing(junk);
      if (d) {
        valid(d);
        decoded++;
      }
    }
    for (let trial = 0; trial < 60; trial++) {
      const bytes = packDrawing(drawing(r, 1 + Math.floor(r() * 40))) ?? new Uint8Array();
      for (let n = 0; n < bytes.length; n++) expect(unpackDrawing(bytes.slice(0, n))).toBeUndefined();
      for (let k = 0; k < 40; k++) {
        const changed = bytes.slice();
        for (let m = 0; m < 1 + Math.floor(r() * 3); m++)
          changed[Math.floor(r() * changed.length)] = Math.floor(r() * 256);
        const d = unpackDrawing(changed);
        if (d) {
          valid(d);
          decoded++;
        }
      }
    }
    expect(decoded).toBeGreaterThan(100); // the checks above saw drawings, not only refusals
    // 0.4 s on an M3 Pro. On GitHub it took 4.1 s and 6.6 s in two runs of 2026-11-13, and the default limit of 5 s
    // failed the second: 60 s keeps it under a quarter (ADR 0010).
  }, 60_000);
});
