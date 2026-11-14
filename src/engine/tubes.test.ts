// The rule of the picture of the tubes (ADR 0034) on the CPU: the numbers of tubes.ts and the reference that
// tubes.gpu.test.ts holds both backends to.
import { describe, expect, it } from 'vitest';
import { defaultSettings, tubeViewHelp, type Settings } from '../model/params';
import { FLOW } from './flow';
import { STREAM, TUBE_REACH, TUBE_WINDOW, TUBES, tubesShown } from './tubes';
import { arenaCell, tubePicture, tubeRoots, tubeStream, wallByte, wallOnLine, type TubeGrid } from './tubes-reference';
import { SHAPE_RANGE } from './types';

/** A grid without walls: every byte of `shape` is 0. */
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

  it('reaches 4 cells, so a pass looks at the 7 × 7 cells around a cell', () => {
    expect(TUBE_REACH).toBe(TUBES.radius + TUBES.edge / 2);
    expect(TUBE_REACH).toBe(4);
    // The whole cells nearer than the reach: a cell 4 cells away holds nothing of a disc.
    expect(TUBE_WINDOW).toBe(3);
  });

  it('states its numbers in the help of the switch', () => {
    // A disc of the largest radius covers the whole cells nearer than its reach: a tube is so much wider on each side.
    expect(tubeViewHelp.help).toContain(`is ${String(TUBE_WINDOW)} cells wider on each side`);
    expect(TUBES.sheet).toBe(0.25);
    expect(tubeViewHelp.help).toContain('a quarter of its brightness');
    expect(tubeViewHelp.help).toContain('fourth root');
    expect(tubeViewHelp.help).toContain('grains move in each tube with the flow');
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

  // The cells that a line between two cell centres touches, by a way of its own: along the line the distance to the
  // centre of a cell, as the larger of its two parts, falls and then rises. So it is least at an end of the line or
  // where one of its parts is 0 or both are equal, and the line touches the cell if it is half a cell or less there.
  // `a / b` is such a place on the line from 0 to 1, in whole numbers.
  const touches = (ox: number, oy: number, i: number, j: number) => {
    const places: [a: number, b: number][] = [
      [0, 1],
      [1, 1],
      [i * Math.sign(ox), Math.abs(ox)],
      [j * Math.sign(oy), Math.abs(oy)],
      [(i - j) * Math.sign(ox - oy), Math.abs(ox - oy)],
      [(i + j) * Math.sign(ox + oy), Math.abs(ox + oy)],
    ];
    return places.some(
      ([a, b]) => b > 0 && a >= 0 && a <= b && 2 * Math.abs(ox * a - i * b) <= b && 2 * Math.abs(oy * a - j * b) <= b,
    );
  };

  it('finds every cell that the line between two cells touches, also at a corner', () => {
    const g = open(16, 16);
    const [px, py] = [8, 8];
    let [pairs, onLine] = [0, 0];
    for (let oy = -TUBE_WINDOW; oy <= TUBE_WINDOW; oy++)
      for (let ox = -TUBE_WINDOW; ox <= TUBE_WINDOW; ox++) {
        if ((ox === 0 && oy === 0) || Math.hypot(ox, oy) >= TUBE_REACH) continue;
        for (let j = -4; j <= 4; j++)
          for (let i = -4; i <= 4; i++) {
            if ((i === 0 && j === 0) || (i === ox && j === oy)) continue;
            // One wall cell alone.
            const c = ((py + j) * g.width + px + i) * 4;
            g.shape[c] = 128;
            const found = wallOnLine(g, px, py, ox, oy);
            g.shape[c] = 0;
            expect(found, `the line to (${String(ox)}, ${String(oy)}), a wall at (${String(i)}, ${String(j)})`).toBe(
              touches(ox, oy, i, j),
            );
            pairs++;
            if (found) onLine++;
          }
      }
    // 44 cells lie in reach of a disc, and 79 places are left for the wall cell. The cells on a line: none, 1 and 2
    // for a cell 1, 2 and 3 cells away along a row or a column, 2 and 5 on a diagonal, 2 for (2, 1), and 4 for
    // (3, 1) and (3, 2). With 4, 4 and 8 cells of each kind that is 120.
    expect([pairs, onLine]).toEqual([44 * 79, 4 * (0 + 1 + 2) + 4 * (2 + 5) + 8 * (2 + 4 + 4)]);
    // The line to the cell 3 to the right and 1 down runs through the corner between four cells: all four are on it.
    expect([touches(3, 1, 1, 0), touches(3, 1, 2, 0), touches(3, 1, 1, 1), touches(3, 1, 2, 1)]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([touches(3, 1, 3, 0), touches(3, 1, 0, 1), touches(1, 0, 2, 0)]).toEqual([false, false, false]);
  });

  /** A grid with these wall cells. */
  const walled = (walls: [x: number, y: number][]) => {
    const g = open(32, 24);
    for (const [x, y] of walls) g.shape[(y * g.width + x) * 4] = 128;
    return g;
  };
  /** The picture of one tube cell with the factor 1 and a trail of 8, at some cells. */
  const dot = (g: TubeGrid, tube: [number, number], cells: [number, number][]) => {
    const memory = memoryOf(g, (x, y) => (x === tube[0] && y === tube[1] ? [1, 1] : undefined));
    const roots = tubeRoots(g, [memory]);
    // One tube cell alone has a third of the strength: here it gets the full factor.
    roots[(tube[1] * g.width + tube[0]) * 4] = 1;
    const picture = tubePicture(
      g,
      trailOf(g, (x, y) => (x === tube[0] && y === tube[1] ? 8 : 0)),
      roots,
    );
    return cells.map(([x, y]) => picture[(y * g.width + x) * 4] ?? 0);
  };

  it('stops a disc at a wall cell that the line touches off its centre', () => {
    // A review found this case: one wall cell at (16, 12), a tube cell beside it at (15, 12), and a cell at
    // (18, 13). The line between the two runs through the wall cell, 0.32 cells from its centre. The first wall
    // test added the distances of the two cells to the centre of the wall cell, 1 and 2.24 cells: more than the
    // 3.16 cells between the cells, so the disc passed.
    const g = walled([[16, 12]]);
    expect(1 + Math.hypot(2, 1)).toBeGreaterThan(Math.hypot(3, 1));
    expect(wallOnLine(g, 15, 12, 3, 1)).toBe(true);
    expect(dot(g, [15, 12], [[18, 13]])).toEqual([0]);
    // The cells above and below the tube cell lie in the open, and the cell behind the wall cell does not.
    expect(
      dot(
        g,
        [15, 12],
        [
          [15, 9],
          [15, 15],
          [17, 12],
        ],
      ).map((v) => v > 0),
    ).toEqual([true, true, false]);
    expect(dot(open(32, 24), [15, 12], [[18, 13]])[0]).toBeGreaterThan(3);
  });

  it('stops a disc between two wall cells that touch at a corner', () => {
    // A wall along a diagonal, one cell thick: its cells touch at their corners only. A tube cell at (17, 12) lies
    // on one side of it, and the cell at (16, 13) on the other side, 1.41 cells away.
    const diagonal: [number, number][] = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((x) => [x, x - 4]);
    const g = walled(diagonal);
    expect([wallByte(g, 12 * g.width + 16), wallByte(g, 13 * g.width + 17)]).toEqual([128, 128]);
    expect(wallOnLine(g, 17, 12, -1, 1)).toBe(true);
    // No cell on the other side of the wall holds a part of the tube: the cells below the diagonal.
    const below: [number, number][] = [];
    for (let y = 8; y <= 17; y++) for (let x = 12; x <= 21; x++) if (y > x - 4) below.push([x, y]);
    expect(Math.max(...dot(g, [17, 12], below))).toBe(0);
    // The cells on its own side hold it, and without the wall the cell across the diagonal holds all of it.
    expect(
      dot(
        g,
        [17, 12],
        [
          [18, 12],
          [17, 11],
          [19, 10],
        ],
      ).map((v) => v > 0),
    ).toEqual([true, true, true]);
    expect(dot(open(32, 24), [17, 12], [[16, 13]])).toEqual([8]);
  });

  it('keeps the strength across a tube on its own side of a wall', () => {
    // A wall along a diagonal, one cell thick: its cells touch at their corners only. A weak tube runs along one side
    // of it and a strong tube along the other side. A cell of the weak tube touches a cell of the strong one at a
    // corner, between two wall cells.
    const diagonal: [number, number][] = [];
    for (let x = 4; x <= 19; x++) diagonal.push([x, x]);
    const tubes = (g: TubeGrid) =>
      memoryOf(g, (x, y) => (y === x + 1 ? [0.0025, 1] : y === x - 1 ? [1, 1] : undefined));
    const factor = (g: TubeGrid, x: number, y: number) => tubeRoots(g, [tubes(g)])[(y * g.width + x) * 4] ?? 0;
    const g = walled(diagonal);
    // Three cells of the weak tube lie in the 3 × 3 cells around one of them: 3 × 0.0025 over 3.
    expect(factor(g, 10, 11)).toBeCloseTo(0.0025 ** 0.25, 6);
    expect(factor(g, 11, 10)).toBeCloseTo(1, 6);
    // Without the wall the weak cell also takes the strong cell at its corner: (3 × 0.0025 + 1) / 3.
    expect(factor(open(32, 24), 10, 11)).toBeCloseTo(((3 * 0.0025 + 1) / 3) ** 0.25, 6);
    // So the weak tube stays faint in the picture: a quarter of its trail. With the strong cell in its strength its
    // own disc would show 0.76 of its trail.
    const trail = trailOf(g, (x, y) => (y === x + 1 ? 8 : 0));
    expect(tubePicture(g, trail, tubeRoots(g, [tubes(g)]))[(11 * 32 + 10) * 4]).toBeCloseTo(2, 6);
    // A tube along a wall keeps its own cells: two cells of the weak tube touch at a corner beside one wall cell,
    // and plasmodium goes from one to the other through the open cell beside that corner.
    const alone = walled(diagonal);
    const weak = memoryOf(alone, (x, y) => (y === x + 1 ? [0.0025, 1] : undefined));
    expect(tubeRoots(alone, [weak])[(11 * 32 + 10) * 4]).toBeCloseTo(0.0025 ** 0.25, 6);
  });

  it('takes a cell of a wall for no tube', () => {
    // A full tube along row 12, and a wall cell on it at (16, 12): its memory still holds the tube that it had.
    const g = walled([[16, 12]]);
    const tube = memoryOf(g, (_, y) => (y === 12 ? [1, 1] : undefined));
    const roots = tubeRoots(g, [tube]);
    const factor = (x: number) => roots[(12 * g.width + x) * 4] ?? 0;
    // The wall cell is no disc. The cells beside it hold two cells of the tube in their 3 × 3 cells, not three.
    expect(factor(16)).toBe(0);
    expect([15, 17].map(factor)).toEqual([(2 / 3) ** 0.25, (2 / 3) ** 0.25].map((v) => Math.fround(v)));
    expect([14, 18].map(factor)).toEqual([1, 1]);
    // No disc shows on the wall cell, and none crosses it along the row.
    const picture = tubePicture(
      g,
      trailOf(g, (x, y) => (y === 12 && x < 16 ? 8 : 0)),
      roots,
    );
    expect([16, 17, 18].map((x) => picture[(12 * g.width + x) * 4])).toEqual([0, 0, 0]);
    expect(picture[(12 * g.width + 15) * 4]).toBeCloseTo(8, 6);
  });
  it('keeps the rule of a corner across the edge of the periodic grid, and takes no cell outside a dish for a wall', () => {
    const [weak, both] = [(0.0025 / 3) ** 0.25, ((0.0025 + 1) / 3) ** 0.25];
    const pair = (g: TubeGrid, p: [number, number], q: [number, number]) =>
      tubeRoots(g, [
        memoryOf(g, (x, y) => (x === p[0] && y === p[1] ? [0.0025, 1] : x === q[0] && y === q[1] ? [1, 1] : undefined)),
      ])[(p[1] * g.width + p[0]) * 4] ?? 0;
    // On the periodic grid the cells (0, 10) and (31, 11) touch at a corner across the edge. The two cells beside
    // that corner are (31, 10) and (0, 11).
    const torus = open(32, 24, 'wrap');
    expect(pair(torus, [0, 10], [31, 11])).toBeCloseTo(both, 6);
    for (const [x, y] of [
      [31, 10],
      [0, 11],
    ] as const)
      torus.shape[(y * 32 + x) * 4] = 128;
    expect(pair(torus, [0, 10], [31, 11])).toBeCloseTo(weak, 6);
    // In a dish: two cells inside that touch at a corner, with one cell beside that corner outside the rim and the
    // other inside. Both hold the byte of a wall. The cell outside is no wall of the dish, as for a move and for a
    // child of growth, so the two cells are not parted.
    const dish = open(32, 24, 'dish');
    const inside = (x: number, y: number) => arenaCell(dish, x, y) >= 0;
    let found: [number, number] | undefined;
    for (let y = 0; y < 23 && !found; y++)
      for (let x = 0; x < 31 && !found; x++)
        if (inside(x, y) && inside(x + 1, y + 1) && inside(x, y + 1) && !inside(x + 1, y)) found = [x, y];
    expect(found).toBeDefined();
    const [x, y] = found ?? [0, 0];
    for (const [wx, wy] of [
      [x + 1, y],
      [x, y + 1],
    ] as const)
      dish.shape[(wy * 32 + wx) * 4] = 128;
    expect(pair(dish, [x, y], [x + 1, y + 1])).toBeCloseTo(both, 6);
    // With both cells beside the corner inside the dish, the same two walls part the cells: one row lower.
    const lower = open(32, 24, 'dish');
    expect([inside(x + 1, y + 1), inside(x, y + 2), inside(x + 1, y + 2)]).toEqual([true, true, true]);
    for (const [wx, wy] of [
      [x + 1, y + 1],
      [x, y + 2],
    ] as const)
      lower.shape[(wy * 32 + wx) * 4] = 128;
    expect(pair(lower, [x, y + 1], [x + 1, y + 2])).toBeCloseTo(weak, 6);
  });

  // The stream of the plasm (tubes.ts, point 6).
  describe('the stream of the plasm', () => {
    const [W, H] = [24, 12];
    /** A memory with a tube of the conductivity that `of` gives for a cell (body 1), and none where it gives 0. */
    const conducting = (of: (x: number, y: number) => number) => {
      const m = new Float32Array(W * H * 4);
      for (let c = 0; c < W * H; c++) {
        const g = of(c % W, Math.floor(c / W));
        m.set(g > 0 ? [FLOW.fresh, 1, g, 0] : [FLOW.fresh, 0, 0, 0], c * 4);
      }
      return m;
    };
    /** A pressure with what `of` gives for a cell in each of the 4 lanes. */
    const pressing = (of: (x: number, y: number) => [number, number, number, number]) => {
      const p = new Float32Array(W * H * 4);
      for (let c = 0; c < W * H; c++) p.set(of(c % W, Math.floor(c / W)), c * 4);
      return p;
    };
    const at = (stream: Float32Array, x: number, y: number) => [stream[(y * W + x) * 4], stream[(y * W + x) * 4 + 1]];
    /** A tube along a row, from x = 4 to x = 19, with a conductivity of 0.25. */
    const row = conducting((x, y) => (y === 6 && x >= 4 && x <= 19 ? 0.25 : 0));

    it('runs from high to low pressure, as fast as the flux over the root of the conductivity', () => {
      expect(STREAM.fast).toBe(2);
      // The pressure of one lane falls by 2 per cell to the east. An edge has the conductance 0.25, so 0.5 leaves a
      // cell to the east and 0.5 comes from the west: the flux is 0.5. Over the root of 0.25 and over 2: a speed of 0.5.
      const east = tubeStream(open(W, H), [row], [pressing((x) => [0, 0, -2 * x, 0])]);
      expect(at(east, 10, 6)).toEqual([0.5, 0]);
      // A cell at an end of the tube has one edge, so half the flux.
      expect(at(east, 4, 6)).toEqual([0.25, 0]);
      expect(at(east, 19, 6)).toEqual([0.25, 0]);
      // No stream beside the tube, and the two unused values stay 0.
      expect(at(east, 10, 5)).toEqual([0, 0]);
      expect(at(east, 3, 6)).toEqual([0, 0]);
      expect([east[(6 * W + 10) * 4 + 2], east[(6 * W + 10) * 4 + 3]]).toEqual([0, 0]);
      // The other way round.
      const west = tubeStream(open(W, H), [row], [pressing((x) => [0, 0, 2 * x, 0])]);
      expect(at(west, 10, 6)).toEqual([-0.5, 0]);
      // A tube with 4 times the conductivity and the same fall of the pressure: 4 times the flux, and twice the speed.
      const wide = conducting((x, y) => (y === 6 && x >= 4 && x <= 19 ? 1 : 0));
      expect(at(tubeStream(open(W, H), [wide], [pressing((x) => [0, 0, -x, 0])]), 10, 6)).toEqual([0.5, 0]);
      expect(at(tubeStream(open(W, H), [row], [pressing((x) => [0, 0, -x, 0])]), 10, 6)).toEqual([0.25, 0]);
      // Without a fall of the pressure nothing moves.
      expect(at(tubeStream(open(W, H), [row], [pressing(() => [3, 3, 3, 3])]), 10, 6)).toEqual([0, 0]);
    });

    it('follows a tube down the grid, where y grows', () => {
      const column = conducting((x, y) => (x === 12 && y >= 2 && y <= 9 ? 0.25 : 0));
      const south = tubeStream(open(W, H), [column], [pressing((_, y) => [-2 * y, 0, 0, 0])]);
      expect(at(south, 12, 5)).toEqual([0, 0.5]);
    });

    it('takes the lane with the largest flux, and no speed above 1', () => {
      // One lane to the east with a flux of 0.5, one to the west with a flux of 1.25: the second one counts. Its speed
      // of 1.25 is cut to 1.
      const both = tubeStream(open(W, H), [row], [pressing((x) => [5 * x, 0, -2 * x, 0])]);
      expect(at(both, 10, 6)).toEqual([-1, 0]);
    });

    it('takes the strain with the fastest flow, and no strain without a tube', () => {
      const pressures = [pressing((x) => [-x, 0, 0, 0]), pressing((x) => [2 * x, 0, 0, 0])];
      // Strain A flows to the east at 0.25, strain B to the west at 0.5.
      expect(at(tubeStream(open(W, H), [row, row], pressures), 10, 6)).toEqual([-0.5, 0]);
      // A body below the least one is no tube, also with a conductivity.
      const thin = row.slice();
      for (let c = 0; c < W * H; c++) thin[c * 4 + 1] = 0.9 * FLOW.bodyLow;
      expect(at(tubeStream(open(W, H), [row, thin], pressures), 10, 6)).toEqual([0.25, 0]);
    });

    it('wraps on the periodic grid, and ends at the edge of a box', () => {
      const whole = conducting((_, y) => (y === 6 ? 0.25 : 0));
      // The pressure falls by 2 per cell to the east, with a step back at the seam.
      const fall = pressing((x) => [-2 * x, 0, 0, 0]);
      // In a box the cell at the edge has one edge.
      expect(at(tubeStream(open(W, H), [whole], [fall]), 0, 6)).toEqual([0.25, 0]);
      // On the periodic grid it has the cell across the seam too, where the pressure is 46 lower: the flux of that
      // edge is 0.25 × 46, to the west, and the speed is cut to 1.
      expect(at(tubeStream(open(W, H, 'wrap'), [whole], [fall]), 0, 6)).toEqual([-1, 0]);
    });
  });
});
