// The order of the births (place() in growth.wgsl and growth.glsl; the CPU copy equals both, bit for bit, by the
// CPU-copy test in sim.gpu.test.ts). ADR 0025, decision 9. And the cell of a child at the corner of a wall (ADR 0025,
// decision 35), and on starved ground (ADR 0053).
import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { FLOW } from './flow';
import { growthStep, place } from './growth-reference';

describe('place(): the order of the births', () => {
  const sizes: [number, number][] = [
    [16, 16],
    [17, 16],
    [64, 48],
    [513, 287],
    [256, 160],
    [512, 288],
    [1023, 17],
    [16, 4096],
  ];

  it.each(sizes)('is a bijection of the cells of %i × %i, new for every step', (w, h) => {
    for (const step of [0, 3, 1001]) {
      const seen = new Uint8Array(w * h);
      let fault = '';
      for (let c = 0; c < w * h && !fault; c++) {
        const p = place(c, w, h, step, 7);
        if (!(p >= 0 && p < w * h)) fault = `${c} → ${p}: outside the grid`;
        else if (seen[p]) fault = `${c} → ${p}: taken twice`;
        else seen[p] = 1;
      }
      // One expect per step: one per cell took 1.8 s of the 5 s limit on 512 × 288 (ADR 0010).
      expect(fault, `step ${step}`).toBe('');
    }
    expect(place(5, w, h, 0, 7)).not.toBe(place(5, w, h, 3, 7));
  });

  // When the dead agents run out, the births of the first positions get them: those must lie all over the grid, not in
  // the rows from the top.
  it.each(sizes.filter(([w, h]) => w >= 64 && h >= 64))('spreads the first tenth of %i × %i over the grid', (w, h) => {
    for (const step of [0, 9]) {
      const first = Array.from({ length: w * h }, (_, c) => c).filter((c) => place(c, w, h, step, 7) < (w * h) / 10);
      for (const [axis, side] of [
        [(c: number) => Math.floor(c / w), h],
        [(c: number) => c % w, w],
      ] as const) {
        const quarters = [0, 0, 0, 0];
        for (const c of first) {
          const q = Math.min(3, Math.floor((4 * axis(c)) / side));
          quarters[q] = (quarters[q] ?? 0) + 1;
        }
        for (const q of quarters) expect(q / first.length).toBeGreaterThan(0.2);
      }
    }
  });
});

// Decision 35 of ADR 0025: a child may go to a diagonal cell past the corner of one wall cell, as a move from its
// parent's cell can, but not between two wall cells that touch at that corner. One parent in cell (5, 5) that moved
// in this step, agents on six of its neighbours and a wall on a seventh, so that (6, 6) is its only free cell, unless
// (5, 6) is a wall too. The sim.gpu.test.ts test of the CPU copy holds both backends to this copy.
describe('growthStep(): the child at the corner of a wall', () => {
  const [w, h] = [16, 16];
  const s: Settings = {
    ...defaultSettings(),
    layout: 'empty',
    boundary: 'box',
    model: 'extended',
    strains: [defaultStrain(0)],
    collisions: true,
    growth: true,
    growthEvery: 1,
    growthWindow: 3,
    growthMin: 1,
    growthMax: 9,
    shrinkEvery: 0,
  };
  const at = (x: number, y: number) => ({ x: x + 0.5, y: y + 0.5, heading: 0, bits: 4 });
  const neighbours: [number, number][] = [
    [4, 4],
    [5, 4],
    [6, 4],
    [4, 5],
    [4, 6],
  ];

  function child(walls: [number, number][], filled: [number, number][]) {
    const env = new Uint8Array(w * h * 4);
    for (const [x, y] of walls) env[(y * w + x) * 4] = 255;
    const agents = [at(5, 5), ...filled.map(([x, y]) => at(x, y)), ...Array.from({ length: 3 }, () => at(0, 0))];
    // The last three are dead.
    for (let k = agents.length - 3; k < agents.length; k++) agents[k] = { ...at(0, 0), bits: 0 };
    const counts = new Float32Array(w * h * 4);
    counts[(5 * w + 5) * 4] = 1; // the parent moved into its cell in this step
    const out = growthStep({ kind: 'webgpu', settings: s, w, h, env, step: 0, agents, counts }).agents;
    const born = out.filter((a, id) => a.bits & 4 && !((agents[id]?.bits ?? 0) & 4));
    return born.map((a) => [Math.floor(a.x), Math.floor(a.y)]);
  }

  it('goes past the corner of one wall cell', () => {
    expect(child([[6, 5]], [...neighbours, [5, 6]])).toEqual([[6, 6]]);
    expect(child([[5, 6]], [...neighbours, [6, 5]])).toEqual([[6, 6]]);
  });

  it('does not go between two wall cells that touch at the corner', () => {
    expect(
      child(
        [
          [6, 5],
          [5, 6],
        ],
        neighbours,
      ),
    ).toEqual([]);
  });

  it('goes to its only free cell without walls', () => {
    expect(child([], [...neighbours, [6, 5], [5, 6]])).toEqual([[6, 6]]);
  });
});

// ADR 0053: with the flow, no child is born onto starved ground, and no agent divides on a starved cell (ADR 0029,
// decision 9). One parent in cell (5, 5) that moved in this step, alone on fresh ground but for the cells named. The
// flow.gpu.test.ts test of the CPU copy holds both backends to this copy.
describe('growthStep(): a child and starved ground', () => {
  const [w, h] = [16, 16];
  const s: Settings = {
    ...defaultSettings(),
    layout: 'empty',
    boundary: 'box',
    model: 'extended',
    flow: true,
    strains: [defaultStrain(0), defaultStrain(1)],
    collisions: true,
    growth: true,
    growthEvery: 1,
    growthWindow: 3,
    growthMin: 1,
    growthMax: 9,
    shrinkEvery: 0,
  };
  const around: [number, number][] = [-1, 0, 1].flatMap((dy) =>
    [-1, 0, 1].filter((dx) => dx !== 0 || dy !== 0).map((dx): [number, number] => [5 + dx, 5 + dy]),
  );

  /**
   * The cells of the children of one parent of strain `strain` in (5, 5), over 40 seeds. `ground` gives the flow
   * memory of the cells of the first strain; the ground of the second strain is `other`.
   */
  function children(
    ground: (x: number, y: number) => number,
    patch: { strain?: number; other?: number; starvedCells?: 'both' | 'parent' | 'child'; flow?: boolean } = {},
  ) {
    const strain = patch.strain ?? 0;
    const agents = [
      { x: 5.5, y: 5.5, heading: 0, bits: strain | 4 },
      { x: 0.5, y: 0.5, heading: 0, bits: 0 },
      { x: 0.5, y: 0.5, heading: 0, bits: 1 },
    ];
    const counts = new Float32Array(w * h * 4);
    counts[(5 * w + 5) * 4 + strain] = 1; // the parent moved into its cell in this step
    const first = new Float32Array(w * h * 4);
    for (let c = 0; c < w * h; c++) first[c * 4] = ground(c % w, Math.floor(c / w));
    const second = new Float32Array(w * h * 4).fill(patch.other ?? FLOW.fresh);
    const memory = patch.flow === false ? undefined : [first, second];
    const cells = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const input = { kind: 'webgpu' as const, settings: { ...s, seed }, w, h, env: new Uint8Array(w * h * 4) };
      const rule = patch.starvedCells === undefined ? {} : { starvedCells: patch.starvedCells };
      const out = growthStep({ ...input, step: 0, agents, counts, ...(memory ? { memory } : {}), ...rule }).agents;
      for (const [id, a] of out.entries())
        if (a.bits & 4 && !((agents[id]?.bits ?? 0) & 4)) cells.add(`${Math.floor(a.x)},${Math.floor(a.y)}`);
    }
    return [...cells].sort();
  }
  const all = around.map(([x, y]) => `${x},${y}`).sort();
  const beside = (x: number, y: number) => Math.max(Math.abs(x - 5), Math.abs(y - 5)) === 1;

  it('is born on any free neighbour on fresh ground, and without the flow on any ground', () => {
    expect(children(() => FLOW.fresh)).toEqual(all);
    expect(children(() => FLOW.floor, { flow: false })).toEqual(all);
  });

  it('is not born onto a starved neighbour: the parent picks among the others', () => {
    // Only (6, 6) is not starved: every child goes there. One more cell just above the level: the two of them.
    expect(children((x, y) => (beside(x, y) && !(x === 6 && y === 6) ? FLOW.floor : FLOW.fresh))).toEqual(['6,6']);
    const two = (x: number, y: number) =>
      x === 6 && y === 6 ? FLOW.fresh : x === 4 && y === 5 ? FLOW.half * 1.01 : beside(x, y) ? FLOW.half * 0.99 : 0.2;
    expect(children(two)).toEqual(['4,5', '6,6']);
  });

  it('is not born when every free neighbour is starved, and not when the cell of the parent is', () => {
    expect(children((x, y) => (beside(x, y) ? FLOW.half * 0.99 : FLOW.fresh))).toEqual([]);
    expect(children((x, y) => (x === 5 && y === 5 ? FLOW.half * 0.99 : FLOW.fresh))).toEqual([]);
  });

  it('reads the flow memory of the strain of the parent', () => {
    // The ground of the first strain starved around the parent, the ground of the second strain fresh, and the other
    // way round.
    const ring = (x: number, y: number) => (beside(x, y) ? FLOW.floor : FLOW.fresh);
    expect(children(ring, { strain: 1 })).toEqual(all);
    expect(children(() => FLOW.fresh, { strain: 1, other: FLOW.floor })).toEqual([]);
  });

  it('has two halves: the copy that reads one cell alone gives the births that the other half stops', () => {
    const ring = (x: number, y: number) => (beside(x, y) ? FLOW.floor : FLOW.fresh);
    expect(children(ring, { starvedCells: 'parent' })).toEqual(all);
    const centre = (x: number, y: number) => (x === 5 && y === 5 ? FLOW.floor : FLOW.fresh);
    expect(children(centre, { starvedCells: 'child' })).toEqual(all);
  });
});
