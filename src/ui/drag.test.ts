import { describe, expect, it } from 'vitest';
import { fromFrame, toFrame } from '../engine/environment';
import type { Stroke } from '../engine/types';
import type { Boundary } from '../model/params';
import { StraightLine } from './drag';

/** The parts of the engine a straight line uses: a canvas pixel is a cell, and a new grid can replace the grid. */
function fakeEngine(boundary: Boundary = 'box') {
  const strokes: Stroke[] = [];
  const engine = {
    strokes,
    gridOnScreen: [320, 200] as readonly [number, number] | undefined,
    settings: { boundary } as never,
    toGrid: (px: number, py: number): [number, number] => [px, py],
    paint: (s: Stroke) => {
      strokes.push(s);
    },
  };
  return engine;
}

describe('a straight line with Shift (ADR 0035)', () => {
  it('paints nothing on the first click and one stroke from it on the second', () => {
    const e = fakeEngine();
    const line = new StraightLine();
    line.click(e, [10, 20], 'wall', 4);
    expect(e.strokes).toEqual([]);
    expect(line.waiting).toBe(true);
    line.click(e, [110, 70], 'wall', 4);
    expect(e.strokes).toEqual([{ kind: 'wall', from: [10, 20], to: [110, 70], radius: 4 }]);
  });

  it('starts the next line at the end of the last one, so the strokes join', () => {
    const e = fakeEngine();
    const line = new StraightLine();
    line.click(e, [10, 20], 'food', 3);
    line.click(e, [110, 20], 'food', 3);
    line.click(e, [110, 90], 'food', 3);
    expect(e.strokes.map((s) => [s.from, s.to])).toEqual([
      [
        [10, 20],
        [110, 20],
      ],
      [
        [110, 20],
        [110, 90],
      ],
    ]);
  });

  it('keeps no start after end(): the next click only sets one', () => {
    const e = fakeEngine();
    const line = new StraightLine();
    line.click(e, [10, 20], 'erase', 5);
    line.end();
    expect(line.waiting).toBe(false);
    expect(line.startOn(e)).toBeUndefined();
    line.click(e, [50, 50], 'erase', 5);
    expect(e.strokes).toEqual([]);
    expect(line.startOn(e)).toEqual([50, 50]);
  });

  it('sets no start while no grid is on screen', () => {
    const e = fakeEngine();
    e.gridOnScreen = undefined;
    const line = new StraightLine();
    line.click(e, [10, 20], 'light', 5);
    expect(line.waiting).toBe(false);
  });

  // The startup check can lower the grid between the two clicks: the start stays on its place in the arena.
  for (const boundary of ['box', 'wrap', 'dish'] as const)
    it(`takes the start to a new grid through the canonical frame of the arena (${boundary})`, () => {
      const e = fakeEngine(boundary);
      const line = new StraightLine();
      line.click(e, [40, 150], 'wall', 4);
      e.gridOnScreen = [256, 160];
      const expected = fromFrame(toFrame([40, 150], [320, 200], boundary), [256, 160], boundary);
      expect(line.startOn(e)).toEqual(expected);
      line.click(e, [200, 30], 'wall', 4);
      expect(e.strokes).toEqual([{ kind: 'wall', from: expected, to: [200, 30], radius: 4 }]);
      // On a grid of the same shape, the same place relative to the edges: 40/320 and 150/200 of it.
      expect(expected[0]).toBeCloseTo(32, 9);
      expect(expected[1]).toBeCloseTo(120, 9);
    });
});
