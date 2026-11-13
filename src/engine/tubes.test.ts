// The rule of the picture of the tubes (ADR 0034) on the CPU: the numbers of tubes.ts and the reference that
// tubes.gpu.test.ts holds both backends to.
import { describe, expect, it } from 'vitest';
import { defaultSettings, tubeViewHelp, type Settings } from '../model/params';
import { FLOW } from './flow';
import { TUBE_REACH, TUBE_WINDOW, TUBES, tubesShown } from './tubes';
import { clearOf, tubePicture, tubeRoots, wallByte, type TubeGrid } from './tubes-reference';
import { SHAPE_RANGE } from './types';

/** A grid without walls: every byte of `shape` is 0, the byte of a cell 4 cells or more from a wall. */
const open = (width: number, height: number, boundary: TubeGrid['boundary'] = 'box'): TubeGrid => ({
  width,
  height,
  boundary,
  shape: new Uint8Array(width * height * 4),
});

/** The wall byte of a signed distance to the outline of a wall, cells, positive inside (paint.wgsl distanceByte()). */
const byteOf = (sd: number) => Math.round((Math.min(1, Math.max(-1, sd / SHAPE_RANGE)) * 0.5 + 0.5) * 255);

/** The memory of a flow, 4 values per cell: fresh ground without a tube, and what `of` gives for a cell. */
function memoryOf(g: TubeGrid, of: (x: number, y: number) => [memory: number, body: number] | undefined) {
  const m = new Float32Array(g.width * g.height * 4);
  for (let c = 0; c < g.width * g.height; c++) {
    const [d, body] = of(c % g.width, Math.floor(c / g.width)) ?? [FLOW.fresh, 0];
    m[c * 4] = d;
    m[c * 4 + 1] = body;
  }
  return m;
}

/** A trail of strain A, 4 lanes per cell. */
function trailOf(g: TubeGrid, of: (x: number, y: number) => number) {
  const t = new Float32Array(g.width * g.height * 4);
  for (let c = 0; c < g.width * g.height; c++) t[c * 4] = of(c % g.width, Math.floor(c / g.width));
  return t;
}

describe('the picture of the tubes', () => {
  it('is drawn only with the setting, the flow and a style that draws the trail', () => {
    const on: Settings = { ...defaultSettings(), model: 'extended', flow: true };
    expect(defaultSettings().showTubes).toBe(true);
    expect(tubesShown(on)).toBe(true);
    expect(tubesShown({ ...on, showTubes: false })).toBe(false);
    expect(tubesShown({ ...on, flow: false })).toBe(false);
    // The Jones model has no flow, whatever the switch says (flow.ts flowOn()).
    expect(tubesShown({ ...on, model: 'jones' })).toBe(false);
    expect(tubesShown({ ...on, style: 'agents' })).toBe(false);
    for (const style of ['glow', 'gel', 'paper'] as const) expect(tubesShown({ ...on, style })).toBe(true);
  });

  it('reaches no farther than the engine knows the distance to a wall', () => {
    expect(TUBE_REACH).toBe(TUBES.radius + TUBES.edge / 2);
    expect(TUBE_REACH).toBeLessThanOrEqual(SHAPE_RANGE);
    // The whole cells nearer than the reach: a cell 4 cells away holds nothing of a disc.
    expect(TUBE_WINDOW).toBe(3);
  });

  it('states its numbers in the help of the switch', () => {
    // A disc of the largest radius covers the whole cells nearer than its reach: a tube is so much wider on each side.
    expect(tubeViewHelp.help).toContain(`is ${String(TUBE_WINDOW)} cells wider on each side`);
    expect(TUBES.sheet).toBe(0.25);
    expect(tubeViewHelp.help).toContain('a quarter of its brightness');
    expect(tubeViewHelp.help).toContain('fourth root');
  });

  it('takes the strength across a tube from the 3 × 3 cells around a cell with a tube, and its fourth root', () => {
    const g = open(24, 16);
    const at = (roots: Float32Array, x: number, y: number) => roots[(y * g.width + x) * 4] ?? 0;
    // A tube of one cell along row 8 with a flow memory of 0.01: three of its cells lie in the 3 × 3 cells around a
    // cell of it, over a length of 3 cells. The rows beside it hold no tube, so they hold no factor.
    const line = tubeRoots(g, [memoryOf(g, (_, y) => (y === 8 ? [0.01, 1] : undefined))]);
    expect(at(line, 12, 8)).toBeCloseTo(0.01 ** 0.25, 6);
    expect([7, 9, 6].map((y) => at(line, 12, y))).toEqual([0, 0, 0]);
    // A band of 3 rows holds 3 times the strength across it, and the strength is at most 1.
    const band = (memory: number) =>
      tubeRoots(g, [memoryOf(g, (_, y) => (y >= 7 && y <= 9 ? [memory, 1] : undefined))]);
    expect(at(band(0.01), 12, 8)).toBeCloseTo(0.03 ** 0.25, 6);
    expect(at(band(0.01), 12, 7)).toBeCloseTo(0.02 ** 0.25, 6);
    expect(at(band(0.9), 12, 8)).toBe(1);
    // One cell alone: a third of its strength. The body counts, and a body below the least body is no tube.
    const dot = (body: number) =>
      tubeRoots(g, [memoryOf(g, (x, y) => (x === 12 && y === 8 ? [0.6, body] : undefined))]);
    expect(at(dot(1), 12, 8)).toBeCloseTo((0.6 / 3) ** 0.25, 6);
    expect(at(dot(0.5), 12, 8)).toBeCloseTo((0.3 / 3) ** 0.25, 6);
    expect(at(dot(1), 13, 9)).toBe(0);
    expect(at(dot(0.99 * FLOW.bodyLow), 12, 8)).toBe(0);
    // Fresh ground holds a flow memory and no body: it is no tube.
    expect(Math.max(...tubeRoots(g, [memoryOf(g, () => undefined)]))).toBe(0);
    // Every strain has its own lane.
    const two = tubeRoots(g, [memoryOf(g, () => undefined), memoryOf(g, (_, y) => (y === 8 ? [1, 1] : undefined))]);
    expect([0, 1, 2, 3].map((s) => two[(8 * g.width + 12) * 4 + s])).toEqual([0, 1, 0, 0]);
  });

  it('draws a tube as a disc around every cell of it, and the trail without a tube at a quarter', () => {
    const g = open(32, 24);
    // A full tube of one cell along row 12, and a trail without a tube on a part of row 3.
    const tube = memoryOf(g, (_, y) => (y === 12 ? [1, 1] : undefined));
    const trail = trailOf(g, (x, y) => (y === 12 ? 8 : y === 3 && x < 16 ? 6 : 0));
    const picture = tubePicture(g, trail, tubeRoots(g, [tube]));
    const at = (x: number, y: number) => picture[(y * g.width + x) * 4] ?? 0;
    // A disc of the full radius, 3.5 cells, covers a cell up to 3 cells away, and nothing of a cell 4 cells away: the
    // tube is 7 cells wide.
    expect([12, 13, 14, 15, 16].map((y) => at(20, y))).toEqual([8, 8, 8, 8, 0]);
    expect([11, 10, 9, 8].map((y) => at(20, y))).toEqual([8, 8, 8, 0]);
    // The trail without a tube stays, at a quarter, and it is no wider than it was.
    expect(at(8, 3)).toBe(TUBES.sheet * 6);
    expect([at(8, 2), at(8, 4), at(20, 3)]).toEqual([0, 0, 0]);
    // One tube cell alone holds a third of its strength across. The edge of its disc is one cell wide, so a cell
    // 2.83 cells away holds a part.
    const dot = memoryOf(g, (x, y) => (x === 12 && y === 12 ? [1, 1] : undefined));
    const root = (1 / 3) ** 0.25;
    const one = tubePicture(
      g,
      trailOf(g, (x, y) => (x === 12 && y === 12 ? 8 : 0)),
      tubeRoots(g, [dot]),
    );
    expect(one[(12 * g.width + 12) * 4]).toBeCloseTo(8 * root, 6);
    expect(one[(14 * g.width + 14) * 4]).toBeCloseTo(8 * root * (TUBES.radius * root + 0.5 - Math.hypot(2, 2)), 5);
    expect(one[(15 * g.width + 15) * 4]).toBe(0);
    // A weak tube: a hundredth of the flow memory gives a third of the radius and of the brightness.
    const weak = memoryOf(g, (_, y) => (y === 12 ? [0.01, 1] : undefined));
    const thin = tubePicture(
      g,
      trailOf(g, (_, y) => (y === 12 ? 8 : 0)),
      tubeRoots(g, [weak]),
    );
    const factor = 0.01 ** 0.25;
    expect(thin[(12 * g.width + 20) * 4]).toBeCloseTo(8 * factor, 6);
    expect(thin[(13 * g.width + 20) * 4]).toBeCloseTo(8 * factor * (TUBES.radius * factor + 0.5 - 1), 6);
    expect(thin[(14 * g.width + 20) * 4]).toBe(0);
  });

  it('gives a tube the mean trail of the cells whose discs reach a cell, each by its weight', () => {
    const g = open(32, 24);
    // A full tube of two rows, with a trail of 8 on row 12 and of 2 on row 13. At a cell of row 12 the discs of 7
    // cells of its row reach it whole, and of row 13 the discs of 5 cells whole and of 2 at their edge.
    const tube = memoryOf(g, (_, y) => (y === 12 || y === 13 ? [1, 1] : undefined));
    const picture = tubePicture(
      g,
      trailOf(g, (_, y) => (y === 12 ? 8 : y === 13 ? 2 : 0)),
      tubeRoots(g, [tube]),
    );
    const beside = 5 + 2 * (TUBE_REACH - Math.hypot(3, 1));
    expect(picture[(12 * g.width + 16) * 4]).toBeCloseTo((7 * 8 + beside * 2) / (7 + beside), 5);
    expect(picture[(13 * g.width + 16) * 4]).toBeCloseTo((beside * 8 + 7 * 2) / (7 + beside), 5);
    // Equal trails give that trail: a thick tube is smooth.
    const even = tubePicture(
      g,
      trailOf(g, (_, y) => (y === 12 || y === 13 ? 8 : 0)),
      tubeRoots(g, [tube]),
    );
    expect(even[(12 * g.width + 16) * 4]).toBeCloseTo(8, 5);
    expect(even[(10 * g.width + 16) * 4]).toBeCloseTo(8, 5);
  });

  it('wraps on the periodic grid, and ends at the edge of a box and at the rim of a dish', () => {
    const tube = (g: TubeGrid) => memoryOf(g, (_, y) => (y === 1 ? [1, 1] : undefined));
    const row = (g: TubeGrid, y: number) =>
      tubePicture(
        g,
        trailOf(g, (_, yy) => (yy === 1 ? 8 : 0)),
        tubeRoots(g, [tube(g)]),
      )[(y * g.width + 12) * 4];
    const [wrap, box] = [open(24, 16, 'wrap'), open(24, 16, 'box')];
    // Row 14 lies 3 cells above row 1 on the periodic grid, and 13 cells below it in a box.
    expect([0, 15, 14, 13].map((y) => row(wrap, y))).toEqual([8, 8, 8, 0]);
    expect([0, 15, 14, 13].map((y) => row(box, y))).toEqual([8, 0, 0, 0]);
    // A dish: no cell outside the rim holds a part of the picture.
    const dish = open(24, 24, 'dish');
    const all = memoryOf(dish, () => [1, 1]);
    const picture = tubePicture(
      dish,
      trailOf(dish, () => 8),
      tubeRoots(dish, [all]),
    );
    expect(picture[0]).toBe(0);
    expect(picture[(12 * 24 + 12) * 4]).toBeCloseTo(8, 5);
  });

  it('draws no tube across a wall', () => {
    const g = open(32, 24);
    // A wall of two rows, 16 and 17: its outline lies half a cell above the centres of row 16.
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++) {
        const sd = y < 16 ? y - 15.5 : y > 17 ? 17.5 - y : Math.min(y - 15.5, 17.5 - y);
        g.shape[(y * g.width + x) * 4] = byteOf(sd);
      }
    expect([14, 15, 16, 17, 18].map((y) => wallByte(g, y * g.width + 5) >= 128)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
    // A full tube along row 14, two rows above the wall.
    const tube = memoryOf(g, (_, y) => (y === 14 ? [1, 1] : undefined));
    const trail = trailOf(g, (_, y) => (y === 14 ? 8 : 0));
    const picture = tubePicture(g, trail, tubeRoots(g, [tube]));
    const at = (y: number) => picture[(y * g.width + 16) * 4] ?? 0;
    // The tube fills the open cell before the wall. The wall holds nothing.
    expect([13, 12, 11].map(at)).toEqual([8, 8, 8]);
    expect(at(15)).toBe(8);
    expect([16, 17].map(at)).toEqual([0, 0]);
    // Without the wall the same tube reaches row 17, 3 cells below it.
    const free = open(32, 24);
    expect(tubePicture(free, trail, tubeRoots(free, [tube]))[(17 * 32 + 16) * 4]).toBe(8);
    // A wall of one row, 15, stops the discs of a tube on row 13 too. Without it they reach row 16.
    const [nearTube, nearTrail] = [
      (g2: TubeGrid) => memoryOf(g2, (_, y) => (y === 13 ? [1, 1] : undefined)),
      (g2: TubeGrid) => trailOf(g2, (_, y) => (y === 13 ? 8 : 0)),
    ];
    expect(tubePicture(free, nearTrail(free), tubeRoots(free, [nearTube(free)]))[(16 * 32 + 16) * 4]).toBe(8);
    const thin = open(32, 24);
    for (let y = 0; y < thin.height; y++)
      for (let x = 0; x < thin.width; x++) thin.shape[(y * thin.width + x) * 4] = byteOf(0.5 - Math.abs(y - 15));
    const behind = tubePicture(thin, nearTrail(thin), tubeRoots(thin, [nearTube(thin)]));
    expect([15, 16, 17].map((y) => behind[(y * 32 + 16) * 4])).toEqual([0, 0, 0]);
    expect([14, 12].map((y) => behind[(y * 32 + 16) * 4])).toEqual([8, 8]);
  });

  it('never takes a wall byte for more than the distance that it was made from', () => {
    // A byte holds a distance in steps of 8 / 255 cells, rounded. The distance that the wall test takes from it is
    // at most the true one, and at most one step below it.
    for (let d = 0; d <= SHAPE_RANGE; d += 0.001) {
      const clear = clearOf(byteOf(-d));
      expect(clear).toBeLessThanOrEqual(d);
      expect(clear).toBeGreaterThan(d - (2 * SHAPE_RANGE) / 255 - 1e-9);
    }
    expect(clearOf(0)).toBeCloseTo(SHAPE_RANGE * (1 - 1 / 255), 9);
    // One wall cell alone, with the bytes that the engine holds around it after a change of boundary: the distance
    // to the centre of the wall cell, rounded (paint.wgsl floorByte()). The cell diagonally beside it gets byte 82,
    // which stands for 1.4275 cells: more than the 1.4142 cells to the wall cell.
    const g = open(32, 24);
    const [wx, wy] = [16, 12];
    for (let y = 0; y < g.height; y++)
      for (let x = 0; x < g.width; x++) {
        const n = (x - wx) ** 2 + (y - wy) ** 2;
        g.shape[(y * g.width + x) * 4] = n === 0 ? 128 : n <= 18 ? byteOf(-Math.sqrt(n)) : 0;
      }
    expect(wallByte(g, 11 * g.width + 15)).toBe(82);
    // A tube cell diagonally beside the wall cell: its disc reaches neither the wall cell nor the cell behind it,
    // 2.83 cells away on the line through the wall cell. Without the wall it reaches both.
    const dot = memoryOf(g, (x, y) => (x === 15 && y === 11 ? [1, 1] : undefined));
    const trail = trailOf(g, (x, y) => (x === 15 && y === 11 ? 8 : 0));
    const walled = tubePicture(g, trail, tubeRoots(g, [dot]));
    expect([walled[(12 * g.width + 16) * 4], walled[(13 * g.width + 17) * 4]]).toEqual([0, 0]);
    expect(walled[(10 * g.width + 14) * 4]).toBeGreaterThan(4);
    const free = open(32, 24);
    const unwalled = tubePicture(free, trail, tubeRoots(free, [dot]));
    expect(unwalled[(12 * g.width + 16) * 4]).toBeGreaterThan(4);
    expect(unwalled[(13 * g.width + 17) * 4]).toBeGreaterThan(1);
  });
});
