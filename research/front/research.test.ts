// The prototype of stage 4 (README.md of this folder) must keep the rules of the app when its own rules are off, and
// its measures must keep working. These runs are short: the long runs of the story are commands of the README.
import { describe, expect, it } from 'vitest';
import { yMazeLayout } from './layouts';
import { alignment, crown, murray, rows, veinDelay } from './measure';
import { Sim, frontFrom, noFront, params } from './sim';
import { runY, slimedOf } from './ymaze';

describe('the CPU prototype of stage 4', () => {
  it('runs the Y-maze as the app does: the first food after about 65 steps (ADR 0056)', () => {
    const firsts = [1, 2, 3].map((seed) => runY(seed, ['left'], noFront(), 400, 50).first);
    for (const f of firsts) expect(f).toBeGreaterThanOrEqual(55);
    for (const f of firsts) expect(f).toBeLessThanOrEqual(75);
  });

  it('keeps the colony on its territory, which grows from the disc of the start', () => {
    const { layout } = yMazeLayout([]);
    const front = { ...noFront(), speed: 0.004, speedOn: 'push' as const, paid: 20, norm: 2, reach: 6, rim: true };
    const sim = new Sim(layout, params({ seed: 1, startStep: 18000, front: { ...front, colony: true, drift: 5 } }));
    const start = sim.territory.reduce((a, b) => a + b, 0);
    for (let k = 0; k < 600; k++) sim.advance();
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
