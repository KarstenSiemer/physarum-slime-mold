import { describe, expect, it } from 'vitest';
import { dishRadius } from './brush';
import {
  coverOf,
  distanceByte,
  onOutline,
  outlineAt,
  outlineCell,
  outlineModel,
  POLE_SCHEME,
  refreshModel,
  type OutlineGrid,
} from './outline-reference';
import type { Stroke } from './types';

// The outlines that the renderer reads, on the CPU: the model of the outline pass, of the pass that holds the bytes to
// the environment, and of the spline of the view. Both backends are checked against it (sim.gpu.test.ts and
// electrode.gpu.test.ts).
describe('the CPU reference of the outlines', () => {
  const [w, h] = [40, 32];
  const box: OutlineGrid = { width: w, height: h, boundary: 'box' };
  const dab = (kind: Stroke['kind'], x: number, y: number, radius: number): Stroke => ({
    kind,
    from: [x, y],
    to: [x, y],
    radius,
  });
  const line = (kind: Stroke['kind'], from: [number, number], to: [number, number], radius: number): Stroke => ({
    kind,
    from,
    to,
    radius,
  });
  const at = (bytes: Uint8Array, x: number, y: number, layer: number) => bytes[(y * w + x) * 2 + layer] ?? 0;

  it('writes a signed distance as a byte, with the outline between 127 and 128', () => {
    expect([-9, -4, -2, 0, 2, 4, 9].map(distanceByte)).toEqual([0, 0, 64, 128, 191, 255, 255]);
    expect(distanceByte(-0.001)).toBe(127);
  });

  it('gives a wide dab the bytes of its distance, inside exactly in the cells that it paints', () => {
    const bytes = outlineModel([dab('wall', 20.3, 16.2, 6)], 'box', w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + 0.5 - 20.3, y + 0.5 - 16.2);
        expect(at(bytes, x, y, 0) >= 128, `${String(x)},${String(y)}`).toBe(d <= 6);
        // A dab of 3 cells or more is not rounded off: the byte is the distance to its circle, up to 4 cells.
        if (d <= 6) expect(at(bytes, x, y, 0)).toBe(Math.max(128, distanceByte(6 - d)));
        expect(at(bytes, x, y, 1)).toBe(0);
      }
    // 4 cells and more outside the circle: the byte 0.
    expect(at(bytes, 9, 16, 0)).toBe(0);
    expect(at(bytes, 12, 16, 0)).toBeGreaterThan(0);
  });

  it('rounds a thin union off near its middle line, and leaves its outline where it is', () => {
    const plain = (d: number) => distanceByte(1 - d);
    const bytes = outlineModel([line('cathode', [5.5, 16.5], [34.5, 16.5], 1)], 'box', w, h, POLE_SCHEME);
    // The row of the middle line: 1 cell inside by the plain distance, and 0.5 cells by the rounded one.
    expect(plain(0)).toBe(159);
    expect(at(bytes, 20, 16, 0)).toBe(distanceByte(0.5));
    // The rows beside it, 1 cell from the line: on the outline, as the plain distance says.
    expect(at(bytes, 20, 15, 0)).toBe(128);
    expect(at(bytes, 20, 17, 0)).toBe(128);
    expect(at(bytes, 20, 14, 0)).toBe(plain(2));
  });

  it('takes the cells of a pole for the other pole, an erase and a wall; food and light change no byte', () => {
    const wide = dab('cathode', 20, 16, 12);
    const inside = (bytes: Uint8Array, x: number, y: number) => [at(bytes, x, y, 0) >= 128, at(bytes, x, y, 1) >= 128];
    const alone = outlineModel([wide], 'box', w, h, POLE_SCHEME);
    expect(inside(alone, 20, 16)).toEqual([true, false]);
    for (const kind of ['food', 'light'] as const)
      expect(outlineModel([wide, dab(kind, 20, 16, 4)], 'box', w, h, POLE_SCHEME)).toEqual(alone);
    const anode = outlineModel([wide, dab('anode', 20, 16, 4)], 'box', w, h, POLE_SCHEME);
    expect(inside(anode, 20, 16)).toEqual([false, true]);
    expect(inside(anode, 27, 16)).toEqual([true, false]);
    for (const kind of ['erase', 'wall'] as const) {
      const cut = outlineModel([wide, dab('anode', 28, 16, 3), dab(kind, 24, 16, 4)], 'box', w, h, POLE_SCHEME);
      expect(inside(cut, 22, 16), kind).toEqual([false, false]);
      expect(inside(cut, 26, 16), kind).toEqual([false, false]);
      expect(inside(cut, 29, 16), kind).toEqual([false, true]);
      expect(inside(cut, 14, 16), kind).toEqual([true, false]);
    }
  });

  // ADR 0058: a pole and a wall fill the cells that they take, and the view draws them from the rounded byte of their
  // union. The pole below gets the complement of that byte, so the two outlines are one line. An erase fills nothing.
  it('ends the pole below a pole or a wall at the rounded byte of that stroke, below an erase at the plain one', () => {
    const wide = dab('cathode', 20, 16, 14);
    const [from, to]: [[number, number], [number, number]] = [
      [8.3, 12.2],
      [31.7, 19.9],
    ];
    const near = (x: number, y: number) => {
      const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
      const t = ((x + 0.5 - from[0]) * dx + (y + 0.5 - from[1]) * dy) / (dx * dx + dy * dy);
      return { t, d: Math.hypot(x + 0.5 - from[0] - t * dx, y + 0.5 - from[1] - t * dy) };
    };
    for (const radius of [0.75, 1, 1.5, 2, 3]) {
      const of = (kind: Stroke['kind']) => outlineModel([wide, line(kind, from, to, radius)], 'box', w, h, POLE_SCHEME);
      const [anode, wall, erase] = [of('anode'), of('wall'), of('erase')];
      // The union of a wall of the same stroke, as the outlines of walls and food hold it.
      const walls = outlineModel([line('wall', from, to, radius)], 'box', w, h);
      let rounded = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const { t, d } = near(x, y);
          if (t < 0.2 || t > 0.8 || d > radius + 3) continue;
          const plain = 255 - distanceByte(radius - d);
          expect(at(anode, x, y, 0), `anode ${String(radius)}`).toBe(255 - at(anode, x, y, 1));
          expect(at(wall, x, y, 0), `wall ${String(radius)}`).toBe(255 - at(walls, x, y, 0));
          expect(at(erase, x, y, 0), `erase ${String(radius)}`).toBe(plain);
          if (at(anode, x, y, 0) !== plain) rounded++;
        }
      // From 3 cells on a union is not rounded off: the two rules are one.
      expect(rounded > 0, String(radius)).toBe(radius < 3);
    }
  });

  it('holds written cells to the environment: 128 inside, and outside the byte of the way to the nearest cell', () => {
    const cells = new Set([16 * w + 20, 16 * w + 21, 17 * w + 20]);
    const holds = (c: number, layer: number) => layer === 1 && cells.has(c);
    const held = refreshModel(new Uint8Array(w * h * 2), holds, 'box', w, h);
    expect([at(held, 20, 16, 1), at(held, 21, 16, 1), at(held, 20, 17, 1)]).toEqual([128, 128, 128]);
    // Beside a cell, at a corner of it, 2 cells away, and beyond 3 rings.
    expect(at(held, 19, 16, 1)).toBe(distanceByte(-1));
    expect(at(held, 21, 17, 1)).toBe(distanceByte(-1));
    expect(at(held, 19, 15, 1)).toBe(distanceByte(-Math.SQRT2));
    expect(at(held, 18, 16, 1)).toBe(distanceByte(-2));
    expect(at(held, 16, 16, 1)).toBe(0);
    expect(held.filter((_, i) => i % 2 === 0).every((b) => b === 0)).toBe(true);
    // A byte that says "inside" where the environment holds nothing is cut to the hold of the cells near it.
    const old = new Uint8Array(w * h * 2).fill(200);
    const cut = refreshModel(old, holds, 'box', w, h);
    expect(at(cut, 19, 16, 1)).toBe(127);
    expect(at(cut, 18, 16, 1)).toBe(distanceByte(1.5 - 2));
    expect(at(cut, 5, 5, 1)).toBe(0);
    expect(at(cut, 20, 16, 1)).toBe(200);
  });

  it('keeps the bytes outside a dish, and counts no cell outside it for the way to the nearest cell', () => {
    const rim = dishRadius(w, h);
    const outside = (x: number, y: number) => Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > rim;
    // Row 16: the cell 4 lies outside the dish, and the cells 5 and 6 inside it (the rim is at x = 4.88 there).
    expect([outside(4, 16), outside(5, 16), outside(6, 16)]).toEqual([true, false, false]);
    const cells = new Set([16 * w + 4]);
    const old = new Uint8Array(w * h * 2).fill(77);
    const held = refreshModel(old, (c) => cells.has(c), 'dish', w, h);
    expect(at(held, 4, 16, 0)).toBe(77);
    // The cell beside it lies in the dish. Its hold counts the cell outside; its lower bound does not.
    expect(at(held, 5, 16, 0)).toBe(77);
    expect(refreshModel(new Uint8Array(w * h * 2), (c) => cells.has(c), 'dish', w, h).every((b) => b === 0)).toBe(true);
  });

  it('reads the cell of a point outside the grid by the arena: wrapped, clamped, or inside the rim of the dish', () => {
    const cell = (boundary: OutlineGrid['boundary'], x: number, y: number) => {
      const c = outlineCell({ width: w, height: h, boundary }, x, y);
      return [c % w, Math.floor(c / w)];
    };
    expect(cell('wrap', -1, 33)).toEqual([39, 1]);
    expect(cell('wrap', 85, -40)).toEqual([5, 24]);
    expect(cell('box', -3, 40)).toEqual([0, 31]);
    expect(cell('box', 7, 9)).toEqual([7, 9]);
    expect(cell('dish', 7, 16)).toEqual([7, 16]);
    // Left of the rim in the middle row: the cell 0.75 cells inside the rim, on the way to the centre.
    expect(cell('dish', 2, 16)).toEqual([
      Math.floor(w / 2 - (dishRadius(w, h) - 0.75) * Math.cos(Math.atan2(0.5, 17.5))),
      16,
    ]);
  });

  it('rebuilds a straight outline where it is, with a gradient of length 1', () => {
    // The cells left of x = 12.3 are inside, with the distance to that line.
    const bytes = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes[(y * w + x) * 4] = distanceByte(12.3 - (x + 0.5));
    for (const px of [9.1, 11.7, 12.3, 12.9, 14.6])
      for (const py of [10.2, 10.5, 10.9]) {
        const { layers, near } = outlineAt(bytes, box, px, py);
        expect(near).toBe(true);
        // A byte is 1/32 of a cell: the outline lies within half of that.
        expect(layers[0].sd).toBeCloseTo(12.3 - px, 1);
        expect(Math.abs(layers[0].sd - (12.3 - px))).toBeLessThan(0.017);
        expect(layers[0].coverSd).toBe(layers[0].sd);
        expect(layers[0].grad[0]).toBeCloseTo(-1, 1);
        expect(layers[0].grad[1]).toBeCloseTo(0, 1);
        expect(layers[1].sd).toBe(-4);
      }
    expect(outlineAt(bytes, box, 30.5, 10.5).near).toBe(false);
  });

  it('draws the centre of every cell on the side of the outline that its byte says', () => {
    // A row of single cells, as the pass holds them to the environment: the spline alone leaves their centres outside.
    const cells = new Set([10, 12, 14, 16].map((x) => 16 * w + x));
    const held = refreshModel(new Uint8Array(w * h * 2), (c, layer) => layer === 0 && cells.has(c), 'box', w, h);
    for (let x = 8; x < 19; x++) {
      const { layers } = outlineAt(held, box, x + 0.5, 16.5, 2);
      const inside = cells.has(16 * w + x);
      expect(layers[0].sd, String(x)).toBeLessThan(0);
      expect(layers[0].coverSd > 0, String(x)).toBe(inside);
      if (inside) expect(layers[0].coverSd).toBeCloseTo((128 / 255 - 0.5) * 8, 10);
    }
    // The bump fades to nothing at the edges of the cell.
    const edge = outlineAt(held, box, 10.999, 16.5, 2).layers[0];
    expect(edge.coverSd - edge.sd).toBeLessThan(1e-4);
  });

  it('covers a pixel by a ramp one pixel wide across the outline', () => {
    for (const scale of [1 / 32, 0.3, 1, 4]) {
      expect(coverOf(-0.5 * scale, scale)).toBe(0);
      expect(coverOf(0, scale)).toBe(0.5);
      expect(coverOf(0.5 * scale, scale)).toBe(1);
      expect(coverOf(0.25 * scale, scale)).toBeCloseTo(0.84375, 12);
      // The ramp is symmetric: two shapes that share an outline cover a pixel between them.
      expect(coverOf(0.2 * scale, scale) + coverOf(-0.2 * scale, scale)).toBeCloseTo(1, 12);
    }
  });

  it('names the cells whose spline lies exactly on an outline at their centre', () => {
    const bytes = new Uint8Array(w * h * 4);
    // 36 · 130 + 24 · 126 + 4 · 114 = 8160: the weighted mean of the 3 × 3 cells is 127.5.
    for (let y = 9; y <= 11; y++)
      for (let x = 9; x <= 11; x++)
        bytes[(y * w + x) * 4 + 1] = x === 10 && y === 10 ? 130 : x === 10 || y === 10 ? 126 : 114;
    expect(onOutline(bytes, box, 10, 10, 1)).toBe(true);
    expect(onOutline(bytes, box, 10, 10, 0)).toBe(false);
    expect(onOutline(bytes, box, 11, 10, 1)).toBe(false);
    bytes[(10 * w + 10) * 4 + 1] = 131;
    expect(onOutline(bytes, box, 10, 10, 1)).toBe(false);
  });
});
