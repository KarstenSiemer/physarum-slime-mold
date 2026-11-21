// The prototype of stage 4 (README.md of this folder) must keep the rules of the app when its own rules are off, and
// its measures must keep working. These runs are short: the long runs of the story are commands of the README.
// CI runs them about five times slower than a laptop, and a unit test has 5 s: keep each one below 0.5 s here.
import { describe, expect, it } from 'vitest';
import { FLOW, FLOW_EIGHT, FLOW_ITERATIONS, FLOW_SITES, packFlow, pcg } from '../../src/engine/flow';
import { flowFlux, flowPressure, type FlowGrid } from '../../src/engine/flow-reference';
import { freshReachOf, slimeWeightOf } from '../../src/engine/sinks';
import { tubeOut, type SinkInput } from '../../src/engine/sinks-reference';
import { flowSites, type FoodStroke } from '../../src/engine/sites';
import { defaultSettings } from '../../src/model/params';
import { box, dish, yMazeLayout } from './layouts';
import { alignment, crown, murray, ridgeCells, rows, veinDelay, type CrownFields } from './measure';
import {
  GPU_FORMS,
  STENCIL8,
  Sim,
  bodyLevel,
  fillScale,
  frontFrom,
  noFront,
  params,
  rankKey,
  sinkSpread,
  supplyLevel,
  type Front,
} from './sim';
import { veinAxis } from './still';
import { runY, slimedOf } from './ymaze';

/** The rule set of ADR 0065 (README.md, step 6) with the drift 1.5, and the forms of a GPU of ADR 0067. */
const RULES = {
  speed: '0.004',
  speedOn: 'push',
  paid: '20',
  norm: '2',
  reach: '6',
  rim: '1',
  colony: '1',
  slimeWeight: '0.025',
  paidOn: 'sinks',
  sinkAt: 'edge',
  solver: 'app',
  drift: '1.5',
};
const gpuRules = (more: Record<string, string> = {}): Front => frontFrom({ ...RULES, ...GPU_FORMS, ...more });

/**
 * A dish of 60 cells with one food in the middle: small and fast. `slime`: on the open cells left of x 30 ('left'), or
 * on every open cell ('all').
 */
function smallDish(front: Front, seed = 1, slime: 'left' | 'all' | 'none' = 'none') {
  const layout = dish(60, [[30, 30, 3]]);
  if (slime !== 'none') layout.slime = layout.open.map((o, c) => (o && (slime === 'all' || c % 60 < 30) ? 1 : 0));
  return new Sim(layout, params({ seed, startStep: 18000, front }));
}

/**
 * The open cells whose square of side 2r + 1 holds an open cell that no path of r steps over open cells reaches
 * (8 neighbours, no diagonal step between two walls). None: the square of a test of a sink sees through no wall.
 */
function seenThroughWalls({ w, h, open }: { w: number; h: number; open: Uint8Array }, r: number): number {
  const isOpen = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && open[y * w + x] === 1;
  const stamp = new Int32Array(w * h).fill(-1);
  let bad = 0;
  for (let c = 0; c < w * h; c++) {
    if (!open[c]) continue;
    stamp[c] = c;
    let wave = [c];
    for (let d = 0; d < r; d++) {
      const next: number[] = [];
      for (const s of wave) {
        const [x, y] = [s % w, Math.floor(s / w)];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dy === 0) || !isOpen(x + dx, y + dy)) continue;
            if (dx !== 0 && dy !== 0 && !isOpen(x + dx, y) && !isOpen(x, y + dy)) continue;
            const t = (y + dy) * w + x + dx;
            if (stamp[t] !== c) {
              stamp[t] = c;
              next.push(t);
            }
          }
      }
      wave = next;
    }
    const [x0, y0] = [c % w, Math.floor(c / w)];
    let through = false;
    for (let y = y0 - r; y <= y0 + r && !through; y++)
      for (let x = x0 - r; x <= x0 + r && !through; x++) through = isOpen(x, y) && stamp[y * w + x] !== c;
    if (through) bad++;
  }
  return bad;
}

describe('the CPU prototype of stage 4', () => {
  it('runs the Y-maze as the app does: the first food after about 65 steps (ADR 0056)', () => {
    const firsts = [1, 2, 3].map((seed) => runY(seed, ['left'], noFront(), 400, 0).first);
    for (const f of firsts) expect(f).toBeGreaterThanOrEqual(55);
    for (const f of firsts) expect(f).toBeLessThanOrEqual(75);
  });

  it('keeps the colony on its territory, which grows from the disc of the start', () => {
    const { layout } = yMazeLayout([]);
    const front = { ...noFront(), speed: 0.004, speedOn: 'push' as const, paid: 20, norm: 2, reach: 6, rim: true };
    const sim = new Sim(layout, params({ seed: 1, startStep: 18000, front: { ...front, colony: true, drift: 5 } }));
    const start = sim.territory.reduce((a, b) => a + b, 0);
    for (let k = 0; k < 150; k++) sim.advance();
    // One expect for all cells: an expect per cell made the test slow on CI.
    const outside = [...sim.occ.keys()].filter((c) => sim.occ[c] && sim.territory[c] !== 1);
    expect(outside).toEqual([]);
    expect(sim.territory.reduce((a, b) => a + b, 0)).toBeGreaterThan(start);
  });

  it('lays slime on every open cell in the case all, and only on the arms in the case both (ADR 0056, target 3)', () => {
    const all = yMazeLayout(slimedOf('all', 1), 19, true).layout;
    const both = yMazeLayout(slimedOf('both', 1)).layout;
    expect(slimedOf('all', 1)).toEqual(['left', 'right']);
    expect(Array.from(all.slime ?? []).every((s, c) => s === all.open[c])).toBe(true);
    const sum = (v?: Uint8Array) => (v ?? new Uint8Array()).reduce((a, b) => a + b, 0);
    expect(sum(both.slime)).toBeGreaterThan(0);
    expect(sum(both.slime)).toBeLessThan(sum(all.slime));
  });

  it('reads the rules from a command line and stops on a word that it does not know', () => {
    const front = frontFrom({ speed: '0.004', speedOn: 'push', rim: '1', case: 'one' }, ['case']);
    expect(front).toMatchObject({ speed: 0.004, speedOn: 'push', rim: true, paidOn: 'fresh' });
    expect(() => frontFrom({ speed: '0.004 speedOn=push' })).toThrow(/no number/);
    expect(() => frontFrom({ sped: '1' })).toThrow(/unknown key/);
    expect(() => frontFrom({ paidOn: 'slime' })).toThrow(/takes/);
  });

  it('puts every sink at the edge of the territory: on slime everywhere as before (ADR 0065, decision 8)', () => {
    const run = (sinkAt: string, kind: 'all' | 'none') => {
      const { layout } = yMazeLayout(slimedOf(kind, 1), 19, kind === 'all');
      const rules = { speed: '0.004', speedOn: 'push', paid: '20', norm: '2', reach: '6', rim: '1', colony: '1' };
      const front = frontFrom({ ...rules, drift: '1.5', slimeWeight: '0.025', paidOn: 'sinks', sinkAt });
      const sim = new Sim(layout, params({ seed: 1, startStep: 18000, front }));
      for (let k = 0; k < 30; k++) sim.advance();
      return Array.from(sim.occ).join('');
    };
    expect(run('edge', 'all')).toBe(run('fresh', 'all'));
    expect(run('edge', 'none')).not.toBe(run('fresh', 'none'));
  });

  it('finds ground without slime within 6 cells by the box as by the distance field (ADR 0067)', () => {
    // Slime on every open cell of the Y-maze but one in 300: the distances to ground without slime run from 0 to far
    // above 6. The two forms must agree on every open cell.
    const { layout } = yMazeLayout([], 19, true);
    const slime = layout.slime!;
    layout.open.forEach((o, c) => {
      if (o && pcg(c ^ 0x5eed) % 300 === 0) slime[c] = 0;
    });
    const sim = new Sim(layout, params({ seed: 1, startStep: 18000, front: gpuRules() }));
    const k = sim.step;
    const field = sim.freshField(k);
    let [near, far] = [0, 0];
    const differ: number[] = [];
    for (let c = 0; c < sim.cells; c++) {
      if (!layout.open[c]) continue;
      if (sim.freshNear(c, k) !== field[c]! <= 6) differ.push(c);
      if (field[c]! <= 6) near++;
      else far++;
    }
    expect(differ).toEqual([]);
    expect(near).toBeGreaterThan(500);
    expect(far).toBeGreaterThan(500);
    // A run with slime on one half of a dish: its rim lies near the edge of the slime, and both forms give the same
    // run.
    const run = (fresh: string) => {
      const s = smallDish(gpuRules({ fresh }), 3, 'left');
      for (let j = 0; j < 45; j++) s.advance();
      return `${Array.from(s.occ).join('')} ${Array.from(s.sinkRate).join(',')}`;
    };
    expect(run('box')).toBe(run('chamfer'));
  });

  it('marks in the second form a payable cell with the chance min(1, B · r / P) (ADR 0067)', () => {
    const sim = smallDish(gpuRules({ paidBy: 'ahead' }));
    const open = Array.from(sim.layout.open.keys()).filter((c) => sim.layout.open[c]);
    const [low, high] = [open.slice(0, 600), open.slice(600, 1200)];
    for (const c of low) sim.sinkRate[c] = 0.5;
    for (const c of high) sim.sinkRate[c] = 1;
    for (const c of open.slice(1200)) sim.sinkRate[c] = 1;
    sim.payable.length = 0;
    sim.payable.push(...low, ...high);
    sim.sinkPayable = 900;
    const share = (budget: number, cells: number[], draws = 20) => {
      sim.budget = budget;
      let marked = 0;
      let others = 0;
      for (let j = 0; j < draws; j++) {
        sim.step = 18002 + 3 * j;
        sim.markPaid();
        for (const c of cells) marked += sim.marks[c]!;
        for (const c of open.slice(1200)) others += sim.marks[c]!;
      }
      expect(others).toBe(0);
      return marked / (draws * cells.length);
    };
    // B = 450: the chance 0.25 on a cell of the rate 0.5, and 0.5 on one of the rate 1.
    expect(Math.abs(share(450, low) - 0.25)).toBeLessThan(0.02);
    expect(Math.abs(share(450, high) - 0.5)).toBeLessThan(0.02);
    // A chance above 1 marks every such cell, and a budget of 0 or less marks none.
    expect(share(2000, low, 2)).toBe(1);
    expect(share(0, high, 2)).toBe(0);
    expect(share(-3, high, 2)).toBe(0);
  });

  it.each(['chance', 'fill'])(
    'lets each agent of the front that can claim a child claim one with its chance, paidBy=%s (ADR 0067)',
    (paidBy) => {
      const sim = smallDish(gpuRules({ paidBy }), 7);
      const { w, h } = sim;
      const { open } = sim.layout;
      // Before the paid births of a growth step: the agents of the front after the moves, at the rim and no parent of
      // Jones' rule in this step, and those of them with a free cell of the territory beside them. The scale λ of the
      // chances min(1, λ · r): B / P, or with 'fill' the one that lets them add up to min(B, these agents).
      let [P, front, chances, lambda] = [NaN, 0, 0, 0];
      sim.onPaid = () => {
        const able: number[] = [];
        front = 0;
        for (let i = 0; i < sim.cap; i++) {
          if (!sim.alive[i] || sim.want[i]! >= 0) continue;
          const c = sim.cellOf(sim.ax[i]!, sim.ay[i]!);
          if (sim.sinkRate[c]! <= 0 || sim.D[c]! < FLOW.half) continue;
          const [x, y] = [c % w, Math.floor(c / w)];
          let [rim, room] = [false, false];
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const [xx, yy] = [x + dx, y + dy];
              if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const t = yy * w + xx;
              if (!open[t] || sim.occNext[t]) continue;
              if (sim.B[t]! < FLOW.bodyLow) rim = true;
              if (sim.D[t]! >= FLOW.half && sim.territory[t]) room = true;
            }
          if (!rim) continue;
          front++;
          if (room) able.push(sim.sinkRate[c]!);
        }
        P = able.reduce((s, r) => s + Math.round(r * 2 ** 16), 0) / 2 ** 16;
        const B = sim.budget;
        lambda = paidBy === 'fill' ? fillScale(able, Math.min(B, able.length), true) : B / P;
        chances = P > 0 && B > 0 ? able.reduce((s, r) => s + Math.min(1, lambda * r), 0) : 0;
      };
      let [steps, claims, expected] = [0, 0, 0];
      for (let j = 0; j < 180; j++) {
        P = NaN;
        sim.advance();
        if (Number.isNaN(P)) continue;
        expect(sim.sinkPayable).toBe(P);
        expect(sim.frontAgents).toBe(front);
        if (P > 0) expect(sim.paidScale).toBe(lambda);
        claims += sim.paidClaims;
        expected += chances;
        if (P > 0) steps++;
      }
      // The claims follow the chances: within three times the spread of a sum of draws.
      expect(steps).toBeGreaterThan(20);
      expect(expected).toBeGreaterThan(20);
      expect(Math.abs(claims - expected)).toBeLessThan(3 * Math.sqrt(expected) + 1);
    },
  );

  it('gives the whole part of the budget to the agents of the front with the least keys, as the order (ADR 0067)', () => {
    // The key −ln(1 − u) / r: half of the draws give a key below ln 2 / r, and a larger rate a smaller key.
    expect(rankKey(0.5, 0.25)).toBeCloseTo(Math.LN2 / 0.25, 12);
    expect(rankKey(0, 0.5)).toBeCloseTo(0, 12);
    expect(rankKey(0.9, 1)).toBeLessThan(rankKey(0.9, 0.1));
    const sim = smallDish(gpuRules({ paidBy: 'rank' }), 9);
    let [jones, budget] = [new Set<number>(), 0];
    sim.onPaid = () => {
      jones = new Set(Array.from(sim.want.keys()).filter((i) => sim.want[i]! >= 0));
      budget = sim.budget;
    };
    let [steps, births] = [0, 0];
    for (let j = 0; j < 150; j++) {
      jones = new Set([-1]);
      sim.advance();
      if (jones.has(-1)) continue;
      const parents = Array.from(sim.want.keys()).filter((i) => sim.want[i]! >= 0 && !jones.has(i));
      const ranked = [...sim.paidKeys].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
      const m = budget >= 1 ? Math.min(Math.floor(budget), ranked.length) : 0;
      expect(parents.sort((a, b) => a - b)).toEqual(ranked.slice(0, m).sort((a, b) => a - b));
      expect(sim.paidClaims).toBe(m);
      if (m > 0) steps++;
      births += m;
    }
    expect(steps).toBeGreaterThan(20);
    expect(births).toBeGreaterThan(40);
  });

  it('fills the chances min(1, λ · r) up to the budget or the number of agents (ADR 0067)', () => {
    const chances = (rates: number[], target: number, fixed = false) => {
      const lambda = fillScale(rates, target, fixed);
      return rates.map((r) => Math.min(1, lambda * r));
    };
    const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
    // One strong agent and two weak ones: the strong one gets the chance 1, the others share the rest.
    const strong = chances([0.8, 0.1, 0.1], 2.4);
    expect(strong[0]).toBe(1);
    expect(strong[1]).toBeCloseTo(0.7, 12);
    expect(strong[2]).toBeCloseTo(0.7, 12);
    // No chance reaches 1: λ = B / P, as with `paidBy` 'chance'.
    expect(fillScale([0.25, 0.25, 0.25, 0.25], 2)).toBeCloseTo(2, 12);
    // A target of at least the number of agents gives each of them the chance 1, and none gives none.
    expect(chances([0.5, 0.3, 0.2], 3)).toEqual([1, 1, 1]);
    expect(fillScale([0.5, 0.3], 0)).toBe(0);
    expect(fillScale([], 2)).toBe(0);
    // Random rates of a few agents: the chances add up to the target, also with the sums in steps of 2^-16.
    let s = 7;
    const next = () => (s = pcg(s)) / 2 ** 32;
    for (let round = 0; round < 200; round++) {
      const rates = Array.from({ length: 1 + Math.floor(next() * 12) }, () => next() ** 3);
      const target = next() * rates.length;
      expect(sum(chances(rates, target))).toBeCloseTo(target, 9);
      const fixed = rates.map((r) => Math.round(r * 2 ** 16) / 2 ** 16).filter((r) => r > 0);
      if (fixed.length === rates.length) expect(sum(chances(fixed, target, true))).toBeCloseTo(target, 6);
    }
  });

  it('lets the sinks of shareOn=supply drain into one level that reads only differences of the pressure (ADR 0077)', () => {
    const takes = (a: number[], p: number[], S: number) => {
      const level = supplyLevel(a, p, S);
      return a.map((g, i) => g * Math.max(0, p[i]! - level));
    };
    const sum = (v: number[]) => v.reduce((x, y) => x + y, 0);
    // Two sinks of one conductance at the pressures 3 and 1: a small total goes to the higher one alone.
    expect(supplyLevel([1, 1], [3, 1], 1)).toBeCloseTo(2, 12);
    expect(takes([1, 1], [3, 1], 1)).toEqual([1, 0]);
    // A larger total reaches both: the level 0, the takes 3 and 1.
    expect(supplyLevel([1, 1], [3, 1], 4)).toBeCloseTo(0, 12);
    // At one pressure every sink takes in its conductance.
    const even = takes([1, 2, 1], [5, 5, 5], 8);
    [2, 4, 2].forEach((v, i) => {
      expect(even[i]).toBeCloseTo(v, 12);
    });
    expect(supplyLevel([1], [1], 0)).toBeNaN();
    expect(supplyLevel([0, 0], [1, 2], 1)).toBeNaN();
    // Random sinks: the takes add up to the total, and a constant added to every pressure changes no take.
    let s = 11;
    const next = () => (s = pcg(s)) / 2 ** 32;
    for (let round = 0; round < 200; round++) {
      const n = 1 + Math.floor(next() * 12);
      const a = Array.from({ length: n }, () => next() ** 2);
      const p = Array.from({ length: n }, () => 10 * next() - 5);
      const S = 3 * next() + 1e-3;
      const was = takes(a, p, S);
      expect(sum(was)).toBeCloseTo(S, 9);
      const now = takes(
        a,
        p.map((v) => v + 200),
        S,
      );
      now.forEach((v, i) => {
        expect(v).toBeCloseTo(was[i]!, 9);
      });
    }
  });

  it('gives bodyOn=cube the cube of the share of agents, and a spread of the sinks that reads no level (ADR 0078)', () => {
    // The cube: full at s = 1, an eighth at s = 1/2, 1/27 at 3 of 9 cells; 'agents' stays s / full, at most 1.
    expect(bodyLevel('cube', 1, 0.4)).toBe(1);
    expect(bodyLevel('cube', 0.5, 0.4)).toBe(0.125);
    expect(bodyLevel('cube', 3 / 9, 0.4)).toBeCloseTo(1 / 27, 15);
    expect(bodyLevel('agents', 0.2, 0.4)).toBe(0.5);
    expect(bodyLevel('agents', 0.6, 0.4)).toBe(1);
    // Sinks at 0, 1, ..., 10 under a food at 15: the 10th to 90th percentile is 1 to 9, the drop 15 − 5.
    const sinks = Array.from({ length: 11 }, (_, i) => i);
    expect(sinkSpread(15, sinks)).toBeCloseTo(0.8, 12);
    // A constant on every pressure and a factor on every pressure change nothing; the order of the sinks neither.
    expect(
      sinkSpread(
        15 + 300,
        sinks.map((p) => p + 300),
      ),
    ).toBeCloseTo(0.8, 12);
    expect(
      sinkSpread(
        15 * 7,
        [...sinks].reverse().map((p) => p * 7),
      ),
    ).toBeCloseTo(0.8, 12);
    // One pressure at every sink: no spread. No sinks, or no drop: NaN.
    expect(sinkSpread(2, [1, 1, 1])).toBe(0);
    expect(sinkSpread(2, [])).toBeNaN();
    expect(sinkSpread(1, [1, 2])).toBeNaN();
  });

  it('marks in the second form only the cells whose agent could claim a child before the moves (ADR 0067)', () => {
    const sim = smallDish(gpuRules({ paidBy: 'ahead' }), 2);
    const { w, h } = sim;
    const { open } = sim.layout;
    let checked = 0;
    const wrong: [number, number][] = [];
    for (let j = 0; j < 75; j++) {
      // The flow pass of a step reads the territory of the step before: the push of the step comes after it.
      const territory = sim.territory.slice();
      sim.advance();
      // The flow pass of the step that just ended came before a growth step: it listed the payable cells.
      if (sim.step % 3 !== 0) continue;
      const listed = new Set(sim.payable);
      for (let c = 0; c < sim.cells; c++) {
        const [x, y] = [c % w, Math.floor(c / w)];
        const near = (test: (t: number, dx: number, dy: number) => boolean) => {
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const [xx, yy] = [x + dx, y + dy];
              if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && test(yy * w + xx, dx, dy)) return true;
            }
          return false;
        };
        const rim = near((t) => open[t] === 1 && !sim.occ[t] && sim.B[t]! < FLOW.bodyLow);
        const room = near((t) => open[t] === 1 && !sim.occ[t] && sim.D[t]! >= FLOW.half && territory[t] === 1);
        const payable = sim.occ[c] === 1 && sim.sinkRate[c]! > 0 && sim.D[c]! >= FLOW.half && rim && room;
        // One expect for all cells below: an expect per cell made the test slow on CI.
        if (listed.has(c) !== payable) wrong.push([sim.step, c]);
        if (payable) checked++;
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(20);
  });

  it.each(['rank', 'fill'])(
    'takes the paid claims off the budget, which never exceeds the front, and pays the flux in births, paidBy=%s (ADR 0067)',
    (paidBy) => {
      const sim = smallDish(gpuRules({ paidBy }), 4);
      const inflow = (2 * 8) / 20;
      let [claims, paid] = [0, 0];
      for (let j = 0; j < 180; j++) {
        // Once, a budget far above the number of agents of the front before a growth step: that step must cut it.
        if (j === 150) sim.budget = 1000;
        const start = sim.budget;
        // As with the order, a budget below 1 pays nothing with 'rank', and the growth step keeps it.
        const growth = sim.step % 3 === 0 && (paidBy !== 'rank' || start >= 1);
        sim.advance();
        const gain = sim.frontTotal > 0 ? inflow : 0;
        const after = growth ? Math.min(start - sim.paidClaims, sim.frontAgents) + gain : start + gain;
        expect(sim.budget).toBeCloseTo(after, 9);
        if (j === 150) expect(sim.budget).toBeLessThan(sim.frontAgents + 1);
        if (j >= 150) continue;
        if (growth) claims += sim.paidClaims;
        paid += gain;
      }
      // The paid claims of the first 150 steps match the flux that the sinks took, within the budget that is left.
      expect(paid).toBeGreaterThan(60);
      expect(claims).toBeGreaterThan(0.6 * paid);
      expect(claims).toBeLessThan(1.2 * paid);
    },
  );

  it('sums the sink rates in steps of 2^-16 as integers (ADR 0067)', () => {
    const sim = smallDish(gpuRules({ paidBy: 'ahead' }), 5);
    let seen = 0;
    for (let j = 0; j < 60; j++) {
      sim.advance();
      let [total, payable] = [0, 0];
      for (let c = 0; c < sim.cells; c++) if (sim.G[c]! > 0) total += Math.round(sim.sinkRate[c]! * 2 ** 16);
      for (const c of sim.payable) payable += Math.round(sim.sinkRate[c]! * 2 ** 16);
      expect(sim.sinkTotal).toBe(total / 2 ** 16);
      expect(sim.sinkPayable).toBe(payable / 2 ** 16);
      if (sim.payable.length > 0) seen++;
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('lets the sinks take exactly what the sources give, also with the integer sums on slime (ADR 0067)', () => {
    // With slime everywhere every sink has the weight 0.025, and its rate counts as few steps of 2^-16: a sink that took
    // its share with its own rate would miss S by the rounding of the sum.
    const S = 2 * 8;
    let active = 0;
    for (const sums of ['fixed', 'float']) {
      const sim = smallDish(gpuRules({ sums }), 8, 'all');
      for (let j = 0; j < 120; j++) {
        sim.advance();
        if (sim.frontTotal <= 0) continue;
        let given = 0;
        for (const v of sim.extra) given += v;
        expect(Math.abs(given)).toBeLessThan(1e-6 * S);
        active++;
      }
    }
    expect(active).toBeGreaterThan(100);
  });

  it('starts the territory on every open cell within 3 cells of a start agent with start=agents (ADR 0067)', () => {
    const sim = smallDish(gpuRules({ start: 'agents' }), 6);
    const { w } = sim;
    const agents: [number, number][] = [];
    for (let i = 0; i < sim.cap; i++) if (sim.alive[i]) agents.push([Math.floor(sim.ax[i]!), Math.floor(sim.ay[i]!)]);
    expect(agents.length).toBeGreaterThan(30);
    for (let c = 0; c < sim.cells; c++) {
      const [x, y] = [c % w, Math.floor(c / w)];
      const near = agents.some(([ax, ay]) => Math.max(Math.abs(ax - x), Math.abs(ay - y)) <= 3);
      expect(sim.territory[c]).toBe(sim.layout.open[c] && near ? 1 : 0);
    }
  });

  it('measures rows, veins, their direction, their delay and Murray exponents without failing', () => {
    const { layout } = yMazeLayout([]);
    const sim = new Sim(layout, params({ seed: 2, startStep: 18000 }));
    for (let k = 0; k < 200; k++) sim.advance();
    expect(rows(sim)).toHaveLength(sim.h);
    expect(crown(sim).front).toBeGreaterThan(0);
    expect(alignment(sim).cells).toBeGreaterThanOrEqual(0);
    expect(veinDelay(sim).cells).toBeGreaterThanOrEqual(0);
    expect(murray(sim).n.every((n) => n > 0)).toBe(true);
  });

  it('finds the tube of a sink as the CPU copy of the engine does, and starts without a scent with scentSteps 0 (ADR 0072)', () => {
    const sim = smallDish(gpuRules({ sinkTube: '1' }), 3);
    const { w, h } = sim;
    const inside = sim as unknown as { G: Float32Array; ports: Int32Array };
    // Tube on half of the open cells: many patches of 4-neighbours. A port at a cell of the tube.
    let r = 11;
    const rnd = () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
    for (let c = 0; c < sim.cells; c++) inside.G[c] = sim.layout.open[c] && rnd() < 0.5 ? 0.1 : 0;
    const port = Array.from(inside.G).findIndex((g, c) => g > 0 && c > 30 * w);
    inside.ports.fill(-1);
    inside.ports[0] = port;
    const env = new Uint8Array(sim.cells * 4);
    for (let c = 0; c < sim.cells; c++) env[c * 4] = sim.layout.open[c] ? 0 : 255;
    const memory = new Float32Array(sim.cells * 4);
    for (let c = 0; c < sim.cells; c++) memory[c * 4 + 2] = inside.G[c]!;
    const n = sim.cells;
    const input: SinkInput = {
      ...{ g: { w, h, boundary: 'box', env }, strain: 0, owners: new Uint8Array(n), territory: new Uint8Array(n) },
      ...{ stamps: new Uint32Array(n), life: 0, step: 0, memory, rates: new Float32Array(n), ports: [port] },
      ...{ slime: slimeWeightOf(defaultSettings()), reach: freshReachOf(defaultSettings()) },
    };
    let [cut, kept] = [0, 0];
    for (let c = 0; c < sim.cells; c++) {
      if (!(inside.G[c]! > 0)) continue;
      expect(sim.tubeOut(c)).toBe(tubeOut(input, c));
      if (sim.tubeOut(c)) kept++;
      else cut++;
    }
    expect(cut).toBeGreaterThan(50);
    expect(kept).toBeGreaterThan(50);
    // The start of the app: no food scent when the colony starts.
    const cold = new Sim(dish(60, [[30, 30, 3]]), params({ seed: 3, startStep: 18000, scentSteps: 0 }));
    expect(cold.scent.every((v) => v === 0)).toBe(true);
    expect(smallDish(noFront()).scent.some((v) => v > 0)).toBe(true);
  });

  it('reads no level of a network against its ground with the forms of the drift of part E2d (ADR 0074)', () => {
    interface Inside {
      driftPressure(px: number, py: number, qx: number, qy: number, c: number): number;
      afterSolve(): void;
      G: Float32Array;
      Pb: Float32Array[];
    }
    // One colony under `take`, and every form reads that one state, before and after a shift of every tube cell by 200.
    // A form reads only through driftPressure() and the level that afterSolve() sets for it, so one state is enough;
    // a colony per form, and a check per sensor, took more than the 5 s of a unit test on CI.
    const sim = smallDish(gpuRules({ sinkTube: '1', driftOn: 'take' }), 3);
    for (let k = 0; k < 200; k++) sim.advance();
    expect(sim.frontTotal).toBeGreaterThan(0);
    const inside = sim as unknown as Inside;
    const front = sim.p.front as { driftOn: string };
    /** What every sensor of every agent reads of the pressure with the form. */
    const read = (form: string) => {
      front.driftOn = form;
      inside.afterSolve();
      const out: number[] = [];
      const so = sim.p.sensorOffset;
      for (let i = 0; i < sim.cap; i++) {
        if (!sim.alive[i]) continue;
        const [px, py, h] = [sim.ax[i]!, sim.ay[i]!, sim.ah[i]!];
        for (const turn of [0, -Math.PI / 8, Math.PI / 8]) {
          const [qx, qy] = [px + so * Math.cos(h + turn), py + so * Math.sin(h + turn)];
          const c = sim.cellOf(qx, qy);
          if (c >= 0 && sim.layout.open[c]) out.push(inside.driftPressure(px, py, qx, qy, c));
        }
      }
      return out;
    };
    const forms = ['net', 'take', 'mirror', 'sinks', 'rim', 'all'];
    const before = new Map(forms.map((form) => [form, read(form)]));
    // A sensor compares what it reads with the other two of its agent: the pressure of the agent's cell, which the
    // forms subtract, does not change a turn.
    for (const P of [...sim.P, ...inside.Pb]) for (let c = 0; c < sim.cells; c++) if (inside.G[c]! > 0) P[c]! += 200;
    const after = new Map(forms.map((form) => [form, read(form)]));
    for (const form of forms.slice(0, -1)) {
      const [was, now] = [before.get(form) ?? [], after.get(form) ?? []];
      expect(was.length, form).toBeGreaterThan(100);
      // The sensors whose read moved by 0.005 or more: none.
      expect(
        was.flatMap((v, k) => (Math.abs((now[k] ?? NaN) - v) < 0.005 ? [] : [[k, v, now[k]]])),
        form,
      ).toEqual([]);
    }
    // The drift of ADR 0065 reads the pressure of the cell itself: the shift moves every sensor on a tube.
    const [was, now] = [before.get('all') ?? [], after.get('all') ?? []];
    expect(now.filter((v, k) => Math.abs(v - (was[k] ?? NaN) - 200) < 0.01).length).toBeGreaterThan(100);
    // `take`: a sensor off the tubes of an agent at a sink reads the drop of the flux of the sink over the sensor offset.
    front.driftOn = 'take';
    const wrong: number[][] = [];
    let checked = 0;
    for (let i = 0; i < sim.cap; i++) {
      const a = sim.cellOf(sim.ax[i]!, sim.ay[i]!);
      if (!sim.alive[i] || !(inside.G[a]! > 0) || !(sim.take[a]! > 0)) continue;
      const [qx, qy] = [sim.ax[i]! + 7 * Math.cos(sim.ah[i]!), sim.ay[i]! + 7 * Math.sin(sim.ah[i]!)];
      const c = sim.cellOf(qx, qy);
      if (c < 0 || !sim.layout.open[c] || inside.G[c]! > 0) continue;
      const got = inside.driftPressure(sim.ax[i]!, sim.ay[i]!, qx, qy, c);
      const want = (-7 * sim.take[a]!) / inside.G[a]!;
      if (!(Math.abs(got - want) < 5e-7)) wrong.push([i, got, want]);
      checked++;
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it('sees through no wall in the Y-maze and the dish, so the squares of a sink equal paths there (ADR 0067, decision 10)', () => {
    const layouts = [yMazeLayout([]).layout, dish(160, [[80, 80, 5]])];
    for (const layout of layouts) for (const r of [2, 6]) expect(seenThroughWalls(layout, r)).toBe(0);
    // A wall of one cell across a square of 5 × 5: each open cell beside the wall sees the far side of it.
    const open = new Uint8Array(25).fill(1);
    for (let y = 0; y < 5; y++) open[y * 5 + 2] = 0;
    expect(seenThroughWalls({ w: 5, h: 5, open }, 2)).toBe(10);
  });

  it('reads a uniform flow F at the angle θ as F · (|cos θ| + |sin θ|) with fluxOn=sum, and as F with norm (ADR 0080)', () => {
    // A uniform sheet, G = 1 on every cell; the pressure falls by F per cell along θ. The cell in the middle.
    const F = 0.3;
    const flux = (on: 'sum' | 'norm', pressure: (x: number, y: number) => number) => {
      const sim = new Sim(box(9, 9, []), params({ scentSteps: 0, startAgents: 0, front: frontFrom({ fluxOn: on }) }));
      for (let c = 0; c < sim.cells; c++) {
        sim.G[c] = 1;
        sim.P[0]![c] = pressure((c % 9) - 4, Math.floor(c / 9) - 4);
      }
      sim.fluxOfCells();
      return sim.Q[4 * 9 + 4]! / F;
    };
    // The measure as it is reads 1, 1.31 and 1.41 times F at 0°, 22.5° and 45°; the norm reads F.
    for (const [deg, sum] of [
      [0, 1],
      [22.5, 1.30656],
      [45, 1.41421],
    ] as const) {
      const t = (deg * Math.PI) / 180;
      const flow = (x: number, y: number) => -F * (x * Math.cos(t) + y * Math.sin(t));
      expect(flux('sum', flow)).toBeCloseTo(sum, 4);
      expect(flux('norm', flow)).toBeCloseTo(1, 4);
    }
    // A sink: the flow comes in from the east and from the west. The norm reads its throughput, as the sum does; the
    // mean of the signed fluxes would read 0.
    const sink = (x: number) => F * Math.abs(x);
    expect(flux('sum', sink)).toBeCloseTo(1, 4);
    expect(flux('norm', sink)).toBeCloseTo(1, 4);
  });

  it('reads a uniform flow F as F at 0° and 45° and 1.08 · F at 22.5° with stencil=8 (ADR 0081)', () => {
    const F = 0.3;
    const front = frontFrom({ stencil: '8' });
    for (const [deg, want] of [
      [0, 1],
      [22.5, 1.08239],
      [45, 1],
    ] as const) {
      const t = (deg * Math.PI) / 180;
      const sim = new Sim(box(9, 9, []), params({ scentSteps: 0, startAgents: 0, front }));
      for (let c = 0; c < sim.cells; c++) {
        const [x, y] = [(c % 9) - 4, Math.floor(c / 9) - 4];
        sim.G[c] = 1;
        sim.P[0]![c] = -F * (x * Math.cos(t) + y * Math.sin(t));
      }
      sim.fluxOfCells();
      expect(sim.Q[4 * 9 + 4]! / F).toBeCloseTo(want, 4);
    }
    expect(STENCIL8.axis + 2 * STENCIL8.diag).toBeCloseTo(1, 12);
    expect(() => new Sim(box(9, 9, []), params({ front: frontFrom({ stencil: '6' }) }))).toThrow();
    expect(() => new Sim(box(9, 9, []), params({ front: frontFrom({ stencil: '8', fluxOn: 'norm' }) }))).toThrow();
  });

  it('lets a vein of one cell along a diagonal read its flux and conduct as one along an axis with stencil=8 (ADR 0081)', () => {
    // Only the cells of the vein conduct; a source of 1 at one end, a sink at the other, the pressure solved exactly.
    const vein = (cells: [number, number][]) => {
      const sim = new Sim(
        box(14, 14, []),
        params({ scentSteps: 0, startAgents: 0, front: frontFrom({ stencil: '8' }) }),
      );
      for (const [x, y] of cells) sim.G[y * 14 + x] = 1;
      sim.extra[cells[0]![1] * 14 + cells[0]![0]] = 1;
      sim.extra[cells.at(-1)![1] * 14 + cells.at(-1)![0]] = -1;
      sim.solveExact();
      const [a, b] = [cells[3]!, cells[8]!];
      const fall = Math.abs(sim.P[0]![a[1] * 14 + a[0]]! - sim.P[0]![b[1] * 14 + b[0]]!);
      return { q: sim.Q[cells[5]![1] * 14 + cells[5]![0]]!, conduct: Math.hypot(b[0] - a[0], b[1] - a[1]) / fall };
    };
    const along = vein(Array.from({ length: 12 }, (_, i) => [1 + i, 6] as [number, number]));
    const diagonal = vein(Array.from({ length: 12 }, (_, i) => [1 + i, 1 + i] as [number, number]));
    expect(along.q).toBeCloseTo(1, 6);
    expect(diagonal.q).toBeCloseTo(1, 6);
    expect(along.conduct).toBeCloseTo(STENCIL8.axis, 6);
    expect(diagonal.conduct).toBeCloseTo(STENCIL8.axis, 6);
  });

  it('lets a diagonal edge of stencil=8 pass no corner of a wall (ADR 0081)', () => {
    // A square of 2 × 2 cells; a source of 1 at (0, 0), a sink at (1, 1), G = 1. With the wall at (1, 0) the flux
    // takes the two axis edges through (0, 1); without it the diagonal joins the two cells too.
    const drop = (wall: boolean) => {
      const layout = box(2, 2, []);
      if (wall) [layout.open[1], layout.wall[1]] = [0, 1];
      const sim = new Sim(layout, params({ scentSteps: 0, startAgents: 0, front: frontFrom({ stencil: '8' }) }));
      for (let c = 0; c < 4; c++) if (layout.open[c]) sim.G[c] = 1;
      [sim.extra[0], sim.extra[3]] = [1, -1];
      sim.solveExact();
      return { drop: sim.P[0]![0]! - sim.P[0]![3]!, q: sim.Q[2]! };
    };
    expect(drop(true).drop).toBeCloseTo(2 / STENCIL8.axis, 6);
    expect(drop(true).q).toBeCloseTo(1, 6);
    expect(drop(false).drop).toBeCloseTo(1 / (STENCIL8.axis + STENCIL8.diag), 6);
  });

  it('reads the axis of a straight vein at any angle to the grid within half a degree (ADR 0080)', () => {
    const [w, h] = [48, 48];
    const cells = w * h;
    for (const sigma of [1, 3])
      for (const deg of [0, 10, 22.5, 45, 60, 80, 100, 135, 170]) {
        const t = (deg * Math.PI) / 180;
        const D = new Float32Array(cells);
        for (let c = 0; c < cells; c++) {
          const [x, y] = [(c % w) + 0.5 - w / 2, Math.floor(c / w) + 0.5 - h / 2];
          const across = -x * Math.sin(t) + y * Math.cos(t);
          D[c] = 0.01 + 0.5 * Math.exp(-(across * across) / (2 * sigma * sigma));
        }
        const f: CrownFields = {
          w,
          h,
          cells,
          step: 0,
          layout: { open: new Uint8Array(cells).fill(1), start: [0, 0] },
          occ: new Uint8Array(cells),
          F: new Uint32Array(cells).fill(1),
          trail: new Float32Array(cells),
          B: new Float32Array(cells).fill(1),
          D,
          Q: new Float32Array(cells),
        };
        const axis = veinAxis(f, ridgeCells(f, 1.5, 4, 0.05));
        const off: number[] = [];
        for (let c = 0; c < cells; c++) {
          const [x, y] = [c % w, Math.floor(c / w)];
          if (x < 12 || y < 12 || x >= w - 12 || y >= h - 12 || !Number.isFinite(axis[c]!)) continue;
          off.push(Math.abs(((axis[c]! - deg + 270) % 180) - 90));
        }
        expect(off.length).toBeGreaterThan(20);
        expect(Math.max(...off)).toBeLessThan(0.5);
      }
  });

  // ADR 0086: the CPU copy of the flow of the engine (src/engine/flow-reference.ts) gives the numbers of the prototype
  // with `stencil=8 solver=app`: the flux Q of every cell from a pressure, and the pressure after the 16 iterations of a
  // step, from the same conductivities, roles, sinks and pressures, in a box with a thin diagonal wall and a wall of one
  // cell. Both hold their fields as float32; the prototype adds the 8 weighted edges of a cell one by one, the engine
  // the axis and the diagonal edges apart, so they agree to a float32 tolerance. With 4 edges as well.
  it('gives the pressures and the flux of the CPU copy of the engine over 8 neighbours (ADR 0086)', () => {
    interface Inside {
      lanes: number;
      ports: Int32Array;
      Pb: Float32Array[];
      pressure(i0: number): void;
    }
    const [w, h] = [14, 11];
    const cells = w * h;
    const i0 = 8;
    const walls = [5 + 3 * w, 6 + 4 * w, 7 + 5 * w, 10 + 7 * w];
    const [a, b] = [2 + 8 * w, 12 + 2 * w];
    let r = 7;
    const rnd = () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
    const g = Float32Array.from({ length: cells }, (_, c) =>
      walls.includes(c) ? 0 : c === a || c === b ? 4 : rnd() < 0.25 ? 0 : 0.02 + 1.5 * rnd() ** 2,
    );
    // Lane by lane: a gives, takes, gives and rests; b the other way round (flow.ts flowRoles(), digits in base 3).
    const role = Float32Array.from({ length: cells }, (_, c) =>
      c === a ? 1 + 2 * 3 + 9 : c === b ? 2 + 3 + 2 * 9 : 0,
    );
    // Sinks on three tube cells and a source that pays them, as the rules of stage 4 put them in.
    const extra = new Float32Array(cells);
    const tubeCells = Array.from(g, (v, c) => (v > 0 && c !== a && c !== b ? c : -1)).filter((c) => c >= 0);
    for (const c of tubeCells.slice(5, 8)) extra[c] = -0.75;
    extra[tubeCells[20] ?? 0] = 2.25;
    const lanes = [0, 1, 2, 3].map(() => Float32Array.from({ length: cells }, () => 100 * rnd() - 50));
    const before = [0, 1, 2, 3].map(() => Float32Array.from({ length: cells }, () => 100 * rnd() - 50));
    for (const stencil of [4, 8] as const) {
      // The prototype.
      const layout = box(w, h, []);
      for (const c of walls) [layout.open[c], layout.wall[c]] = [0, 1];
      const front = frontFrom({ stencil: String(stencil), solver: 'app' });
      const sim = new Sim(layout, params({ scentSteps: 0, startAgents: 0, flow: i0, front }));
      const inside = sim as unknown as Inside;
      inside.lanes = 4;
      inside.ports = Int32Array.from([a, b]);
      for (let c = 0; c < cells; c++) {
        if (!layout.open[c]) continue;
        [sim.G[c], sim.role[c], sim.extra[c]] = [g[c]!, role[c]!, extra[c]!];
        for (let l = 0; l < 4; l++) [sim.P[l]![c], inside.Pb[l]![c]] = [lanes[l]![c]!, before[l]![c]!];
      }
      sim.fluxOfCells();
      const q = Float32Array.from(sim.Q);
      inside.pressure(i0);
      // The engine: the same fields as Sim.readFlow() and Sim.readPressure() hold them, 4 values per cell.
      const env = new Uint8Array(cells * 4);
      for (const c of walls) env[c * 4] = 255;
      const grid: FlowGrid = { width: w, height: h, boundary: 'box', env };
      const dab = (c: number): FoodStroke => {
        const at: [number, number] = [(c % w) + 0.5, Math.floor(c / w) + 0.5];
        return [{ kind: 'food', from: at, to: at, radius: 0.5 }];
      };
      const sites = flowSites([dab(a), dab(b)], w, h, 'box');
      const u = new Float32Array(packFlow({ ...defaultSettings(), flowStrength: i0, flowEdges: stencil }, sites));
      const ports = new Int32Array(FLOW_SITES * 2).fill(-1);
      [ports[0], ports[2]] = [a, b];
      const memory = new Float32Array(cells * 4);
      const [pressure0, before0] = [new Float32Array(cells * 4), new Float32Array(cells * 4)];
      for (let c = 0; c < cells; c++) {
        if (!layout.open[c]) continue;
        memory.set([0.5, 1, g[c]!, role[c]!], c * 4);
        for (let l = 0; l < 4; l++) [pressure0[c * 4 + l], before0[c * 4 + l]] = [lanes[l]![c]!, before[l]![c]!];
      }
      const flux = flowFlux(grid, memory, pressure0, stencil === 8);
      let pressure: Float32Array = pressure0;
      let past: Float32Array = before0;
      for (let i = 0; i < FLOW_ITERATIONS; i++) {
        const next = flowPressure(grid, u, memory, pressure, past, i === 0 ? 1 : i === 1 ? 2 : 0, ports, extra);
        [past, pressure] = [pressure, next];
      }
      // Q, the mean of the 4 lanes, and the pressure of every lane on every open cell.
      let [top, off, qTop, qOff] = [0, 0, 0, 0];
      for (let c = 0; c < cells; c++) {
        if (!layout.open[c]) continue;
        const mean =
          ((flux[c * 4] ?? 0) + (flux[c * 4 + 1] ?? 0) + (flux[c * 4 + 2] ?? 0) + (flux[c * 4 + 3] ?? 0)) / 4;
        [qTop, qOff] = [Math.max(qTop, Math.abs(q[c]!)), Math.max(qOff, Math.abs(mean - q[c]!))];
        for (let l = 0; l < 4; l++) {
          const p = sim.P[l]![c]!;
          [top, off] = [Math.max(top, Math.abs(p)), Math.max(off, Math.abs((pressure[c * 4 + l] ?? 0) - p))];
        }
      }
      expect(qTop, `stencil ${String(stencil)}`).toBeGreaterThan(1);
      expect(qOff / qTop, `Q, stencil ${String(stencil)}`).toBeLessThan(1e-6);
      expect(top, `stencil ${String(stencil)}`).toBeGreaterThan(10);
      expect(off / top, `pressure, stencil ${String(stencil)}`).toBeLessThan(1e-5);
    }
    // The weights of the engine are those of the prototype.
    expect(FLOW_EIGHT).toEqual(STENCIL8);
  });
});
