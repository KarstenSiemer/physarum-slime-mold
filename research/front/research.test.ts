// The prototype of stage 4 (README.md of this folder) must keep the rules of the app when its own rules are off, and
// its measures must keep working. These runs are short: the long runs of the story are commands of the README.
// CI runs them about five times slower than a laptop, and a unit test has 5 s: keep each one below 0.5 s here.
import { describe, expect, it } from 'vitest';
import { FLOW, pcg } from '../../src/engine/flow';
import { dish, yMazeLayout } from './layouts';
import { alignment, crown, murray, rows, veinDelay } from './measure';
import { GPU_FORMS, Sim, fillScale, frontFrom, noFront, params, rankKey, type Front } from './sim';
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
    for (let c = 0; c < sim.cells; c++) if (sim.occ[c]) expect(sim.territory[c]).toBe(1);
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
    for (let c = 0; c < sim.cells; c++) {
      if (!layout.open[c]) continue;
      expect(sim.freshNear(c, k)).toBe(field[c]! <= 6);
      if (field[c]! <= 6) near++;
      else far++;
    }
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

  it('marks in the second form only the cells whose agent could claim a child before the moves (ADR 0067)', () => {
    const sim = smallDish(gpuRules({ paidBy: 'ahead' }), 2);
    const { w, h } = sim;
    const { open } = sim.layout;
    let checked = 0;
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
        expect(listed.has(c)).toBe(payable);
        if (payable) checked++;
      }
    }
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
});
