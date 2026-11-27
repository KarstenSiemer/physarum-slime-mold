// The flow takes the sinks of each strain (ADR 0070): the CPU copy of what the sinks take and the sources give
// (flow-reference.ts sinksAndSources()), of what the sink of a cell takes over its conductivity (takesOf(), ADR 0075),
// and of the drift in a sensor (groundOf(), drifted()), on cases made by hand. sinks.gpu.test.ts and
// flow-sinks.gpu.test.ts compare both backends with the CPU copy.
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { FLOW_SITES, packFlow } from './flow';
import { drifted, groundOf, meanPressure, sinksAndSources, takesOf } from './flow-reference';
import { NO_SITES } from './sites';
import { RATE_ONE, SINKS, SUM_ONE } from './sinks';
import { sinkState, sumOf } from './sinks-reference';
import { packTerritory } from './territory';

/** A random number generator for the cases. */
function random(seed: number) {
  let r = seed >>> 0;
  return () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

const on: Settings = { ...defaultSettings(), territory: true, flow: true, growth: true, collisions: true };

/**
 * A case of `n` cells: a tube on each cell with the chance `tubes`, a rate in steps of 2^-24 from `rate` on each cell
 * (with a minus sign for a sink with the chance 0.1), and `ports` covered ports on cells with a tube. Returns the block,
 * the memory, the ports, the rates, and the sums and the state as the passes of the sinks give them.
 */
function sinkCase(n: number, tubes: number, rate: (rnd: () => number) => number, ports: number, seed: number) {
  const rnd = random(seed);
  const u = new Float32Array(packTerritory(packFlow(on, NO_SITES), on));
  // The sites that the ports belong to: the passes read the count of the block.
  u[15] = ports;
  const memory = new Float32Array(n * 4);
  const rates = new Float32Array(n);
  let [r, count, cells] = [0, 0, 0];
  for (let c = 0; c < n; c++) {
    const tube = rnd() < tubes;
    const steps = rate(rnd);
    const sink = tube && rnd() < 0.1;
    memory[c * 4 + 2] = tube ? 0.5 : 0;
    rates[c] = ((sink ? -1 : 1) * steps) / RATE_ONE;
    if (tube) {
      r += sumOf(steps);
      cells++;
    }
    if (sink) count++;
  }
  const list = new Int32Array(FLOW_SITES * 2).fill(-1);
  for (let i = 0, c = 0; i < ports; c++) if ((memory[c * 4 + 2] ?? 0) > 0) list[2 * i++] = c;
  const sums = [r % 2 ** 32, Math.floor(r / 2 ** 32), cells, count];
  return { u, memory, list, rates, sums, state: sinkState(sums, ports) };
}

/** The sum over the cells, in float64, of what the sinks take and the sources give. */
const net = (extra: Float32Array) => extra.reduce((a, v) => a + v, 0);

describe('the flow takes the sinks (ADR 0070)', () => {
  const S = SINKS.take * on.flowStrength;

  it('lets the sinks take exactly what the sources give, with the rates as R counted them', () => {
    // Every rate a whole number of steps of the sums and 127 or 128 steps of 2^-24 more: R rounds each one down or up
    // by half a step of the sums. A sink that took its share with its own rate would miss S by that.
    const rate = (rnd: () => number) => Math.floor(rnd() * 600) * 256 + (rnd() < 0.8 ? 127 : 128);
    for (const ports of [0, 1, 3]) {
      const { u, memory, list, rates, sums, state } = sinkCase(4000, 0.7, rate, ports, 11 + ports);
      expect(state[4], 'the front takes flux').toBe(1);
      const extra = sinksAndSources(u, memory, list, rates, state);
      // Up to the rounding of float32: each share rounds twice, and R once.
      expect(Math.abs(net(extra)), `${String(ports)} ports`).toBeLessThan(1e-6 * S);
      // What the sinks take alone is S, and the sources give the rest.
      let taken = 0;
      let own = 0;
      for (let c = 0; c < rates.length; c++) {
        if (!((memory[c * 4 + 2] ?? 0) > 0)) continue;
        const steps = Math.trunc(Math.abs(rates[c] ?? 0) * RATE_ONE);
        taken += (S * (sumOf(steps) / SUM_ONE)) / (state[0] ?? 1);
        own += (S * (steps / RATE_ONE)) / (state[0] ?? 1);
      }
      expect(taken / S).toBeCloseTo(1, 6);
      // With its own rate the sinks would take less than S: here by more than a hundred times the rounding above.
      expect(Math.abs(own - S)).toBeGreaterThan(1e-4 * S);
      expect(sums[2]).toBeGreaterThan(2500);
    }
  });

  it('lets the sinks take exactly what the sources give also when R is large: its low word wraps', () => {
    // 131,072 tube cells with a rate near 1: R passes 2^32 steps of 2^-16, so the state holds it from both words.
    const rate = (rnd: () => number) => RATE_ONE - Math.floor(rnd() * 400_000);
    for (const ports of [0, 2]) {
      const { u, memory, list, rates, sums, state } = sinkCase(512 * 256, 1, rate, ports, 23 + ports);
      expect(sums[1]).toBeGreaterThan(0);
      expect(state[0]).toBeGreaterThan(65_536);
      expect(state[4]).toBe(1);
      expect(Math.abs(net(sinksAndSources(u, memory, list, rates, state)))).toBeLessThan(1e-6 * S);
      // R of the low word alone would give every sink 1.5 times or more its share.
      const low = (sums[0] ?? 0) / SUM_ONE;
      expect((state[0] ?? 0) / low).toBeGreaterThan(1.5);
    }
  });

  it('gives the colony the share S / C at each tube cell without a covered port, and S at each of P covered ports', () => {
    // Every tube cell with the same rate: the colony gives each one what it takes, so nothing is left at any cell.
    const same = () => 3 * 256;
    const colony = sinkCase(1000, 0.5, same, 0, 31);
    const extra = sinksAndSources(colony.u, colony.memory, colony.list, colony.rates, colony.state);
    expect(extra.every((v) => Math.abs(v) < 1e-9 * S)).toBe(true);
    // With two covered ports the sinks take 2 S (ADR 0100; ADR 0093, `feed=flux`): each port gives S, and every tube
    // cell takes 2 S / C.
    const fed = sinkCase(1000, 0.5, same, 2, 37);
    const at = sinksAndSources(fed.u, fed.memory, fed.list, fed.rates, fed.state);
    const C = fed.state[1] ?? 1;
    for (let c = 0; c < 1000; c++) {
      const tube = (fed.memory[c * 4 + 2] ?? 0) > 0;
      const port = c === fed.list[0] || c === fed.list[2];
      const want = (tube ? (-2 * S) / C : 0) + (port ? S : 0);
      expect(at[c], `cell ${String(c)}`).toBeCloseTo(want, 6);
    }
  });

  it('takes nothing while the front takes no flux, and nothing at a cell without a tube', () => {
    const { u, memory, list, rates, state } = sinkCase(500, 0.5, () => 5000, 1, 41);
    const idle = [...state];
    idle[4] = 0;
    expect(sinksAndSources(u, memory, list, rates, idle).every((v) => v === 0)).toBe(true);
    const extra = sinksAndSources(u, memory, list, rates, state);
    for (let c = 0; c < 500; c++)
      if (!((memory[c * 4 + 2] ?? 0) > 0) && c !== list[0]) expect(extra[c], `cell ${String(c)}`).toBe(0);
  });

  it('gives each tube cell what its sink takes over its conductivity, while the front takes flux (ADR 0075)', () => {
    const { u, memory, list, rates, state } = sinkCase(500, 0.5, (rnd) => Math.floor(rnd() * 2 ** 20), 1, 43);
    const takes = takesOf(u, memory, rates, state);
    // What the sinks take at each cell, over the conductivity 0.5 of every tube cell: twice the sink of sinksAndSources()
    // without the share of the port.
    const extra = sinksAndSources(u, memory, list.fill(-1), rates, [...state.slice(0, 3), 0, ...state.slice(4)]);
    const C = state[1] ?? 1;
    let taking = 0;
    for (let c = 0; c < 500; c++) {
      const g = memory[c * 4 + 2] ?? 0;
      if (!(g > 0)) {
        expect(takes[c], `cell ${String(c)}`).toBe(0);
        continue;
      }
      // sinksAndSources() gives what the colony gives, S / C, less what the sink takes.
      expect(takes[c], `cell ${String(c)}`).toBeCloseTo((S / C - (extra[c] ?? 0)) / g, 4);
      if ((takes[c] ?? 0) > 0) taking++;
    }
    expect(taking).toBeGreaterThan(100);
    // As the passes compute it, in float32: S · r / R, then over G.
    const c = (memory.findIndex((v, i) => i % 4 === 2 && v > 0) - 2) / 4;
    const r = sumOf(Math.trunc(Math.abs(rates[c] ?? 0) * RATE_ONE)) / SUM_ONE;
    const want = Math.fround(Math.fround(Math.fround(Math.fround(S) * r) / (state[0] ?? 1)) / 0.5);
    expect(takes[c]).toBe(want);
    // Nothing while the front takes no flux.
    const idle = [...state];
    idle[4] = 0;
    expect(takesOf(u, memory, rates, idle).every((v) => v === 0)).toBe(true);
  });

  it('reads the pressure on the tubes and the ground of the agent off them, times the drift (ADR 0075)', () => {
    expect(meanPressure([1, 2, 3, 6])).toBe(3);
    // The ground of a tube cell: its mean pressure less the sensor offset times take / G; none off the tubes.
    expect(groundOf(true, [1, 2, 3, 6], 0.25, 9)).toBe(0.75);
    expect(groundOf(false, [1, 2, 3, 6], 0.25, 9)).toBeUndefined();
    // A sensor on a tube reads the mean pressure of its cell, one off the tubes the ground of the agent's cell.
    expect(drifted(0, 1.5, 0.75, true, [1, 2, 3, 6])).toBe(-4.5);
    expect(drifted(0, 1.5, 0.75, false, [1e6, 2, 3, 4])).toBe(-1.125);
    expect(drifted(10, 0, 0.75, true, [1e6, 2, 3, 4])).toBe(10);
    expect(drifted(2, 2, -1, false, [7, 7, 7, 7])).toBe(4);
    // An agent off the tubes reads no drift.
    expect(drifted(2, 1.5, undefined, true, [1, 2, 3, 6])).toBe(2);
    // A shift of the pressure of every tube cell shifts every value that an agent on a tube reads alike.
    const shift = (v: number) => v + 200;
    const ground = groundOf(true, [1, 2, 3, 6].map(shift), 0.25, 9);
    expect(drifted(0, 1.5, ground, false, [0, 0, 0, 0]) - drifted(0, 1.5, 0.75, false, [0, 0, 0, 0])).toBe(-300);
    // In float32, as the passes compute it.
    const f = Math.fround;
    expect(drifted(0.1, 1.5, 0, true, [0.1, 0.2, 0.3, 0.4])).toBe(f(0.1 - f(1.5 * meanPressure([0.1, 0.2, 0.3, 0.4]))));
    expect(groundOf(true, [0.1, 0.2, 0.3, 0.4], 0.3, 9)).toBe(f(meanPressure([0.1, 0.2, 0.3, 0.4]) - f(9 * 0.3)));
  });
});
