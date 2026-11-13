import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain } from '../model/params';
import {
  FLOW,
  FLOW_BYTES,
  FLOW_CONSTANT_SLOTS,
  FLOW_HOLD,
  FLOW_ITERATIONS,
  FLOW_LANES,
  FLOW_SITES,
  FLOW_SLOTS,
  flowOn,
  flowRoles,
  flowSites,
  packFlow,
  STEPS_PER_MINUTE,
} from './flow';
import { flowStart, flowStep, roleSigns, type FlowGrid } from './flow-reference';

describe('flowOn', () => {
  it('runs the flow only with the switch on and in the extended model', () => {
    expect(flowOn({ flow: true, model: 'extended' })).toBe(true);
    expect(flowOn({ flow: false, model: 'extended' })).toBe(false);
    expect(flowOn({ flow: true, model: 'jones' })).toBe(false);
    expect(flowOn(defaultSettings())).toBe(false);
  });
});

describe('the time scale (ADR 0029)', () => {
  const minutes = (steps: number) => steps / STEPS_PER_MINUTE;

  it('gives the times of the organism for the constants of the rule', () => {
    expect(STEPS_PER_MINUTE).toBe(30);
    // The tube body follows the trail in 1.7 min: the delay of 1 to 3 min in Marbach et al. 2023.
    expect(minutes(1 / FLOW.bodyRate)).toBeCloseTo(1.67, 2);
    // A tube adapts in 11 min: the 10 to 100 min in Marbach et al. 2023.
    expect(minutes(1 / FLOW.rate)).toBeCloseTo(11.1, 1);
    // A tube without flux falls from the fresh memory to the level of starvation in 33 min: veins vanish in 15 to 40.
    const starve = Math.log(FLOW.fresh / FLOW.half) / FLOW.rate;
    expect(minutes(starve)).toBeGreaterThan(15);
    expect(minutes(starve)).toBeLessThan(40);
    // The foods keep their roles for 10 min.
    expect(minutes(FLOW_HOLD)).toBe(10);
    // Starved ground is fresh again after about 18 h.
    const fresh = Math.log(FLOW.fresh / FLOW.floor) / Math.log(1 + FLOW.recover);
    expect(minutes(fresh) / 60).toBeGreaterThan(17);
    expect(minutes(fresh) / 60).toBeLessThan(19);
  });

  it('keeps the levels of the memory in order', () => {
    expect(FLOW.floor).toBeLessThan(FLOW.half);
    expect(FLOW.half).toBeLessThan(FLOW.fresh);
    expect(FLOW.fresh).toBeLessThan(FLOW.birthFrom);
    expect(FLOW.birthFrom).toBeLessThan(1);
    expect(FLOW.trailLow).toBeLessThan(FLOW.trailFull);
    expect(FLOW.ghost).toBeLessThan(FLOW.base * FLOW.bodyLow);
  });
});

describe('flowSites', () => {
  it('takes the cell of each centre once, in the order of the list', () => {
    const sites = flowSites(
      [
        [3.5, 4.5],
        [10.99, 0],
        [3.2, 4.9],
        [7, 7],
      ],
      16,
      8,
    );
    expect(sites).toEqual([
      [3, 4],
      [10, 0],
      [7, 7],
    ]);
  });

  it('drops a centre outside the grid', () => {
    expect(
      flowSites(
        [
          [-0.5, 2],
          [16, 2],
          [2, 8],
          [2, -1],
          [15.9, 7.9],
        ],
        16,
        8,
      ),
    ).toEqual([[15, 7]]);
  });

  it('spreads the sites evenly over a longer list, the first one always among them', () => {
    const centres = Array.from({ length: 200 }, (_, i): [number, number] => [i, 0]);
    const sites = flowSites(centres, 256, 4);
    expect(sites.length).toBe(FLOW_SITES);
    expect(sites[0]).toEqual([0, 0]);
    const xs = sites.map((s) => s[0]);
    expect(new Set(xs).size).toBe(FLOW_SITES);
    for (let i = 1; i < xs.length; i++) {
      const gap = (xs[i] ?? 0) - (xs[i - 1] ?? 0);
      expect(gap === 3 || gap === 4, String(gap)).toBe(true);
    }
  });
});

describe('flowRoles', () => {
  const lane = (codes: number[], k: number) => codes.map((c) => roleSigns(c)[k] ?? 0);
  const all = (n: number) => new Array<boolean>(n).fill(true);

  it('gives no roles while the plasmodium covers fewer than two sites', () => {
    expect(flowRoles([], 5, 1)).toEqual([]);
    expect(flowRoles([true], 5, 1)).toEqual([0]);
    expect(flowRoles([false, true, false], 5, 1)).toEqual([0, 0, 0]);
    expect(flowRoles([false, false], 5, 1)).toEqual([0, 0]);
  });

  it('lets the first of two covered sites give and the other take, in every lane and at every step', () => {
    for (const step of [0, 1, 299, 300, 5000, 99_999])
      for (const seed of [1, 2, 77]) {
        expect(flowRoles([true, true], step, seed)).toEqual([40, 80]);
        // The two covered sites of a longer list: the others have no role.
        expect(flowRoles([false, true, false, false, true], step, seed)).toEqual([0, 40, 0, 0, 80]);
      }
  });

  it('lets as many covered sites give as take in every lane; with an odd count one site does neither', () => {
    for (const count of [3, 4, 7, 42, 64])
      for (const step of [0, 299, 300, 12_345]) {
        const codes = flowRoles(all(count), step, 9);
        for (let k = 0; k < FLOW_LANES; k++) {
          const signs = lane(codes, k);
          const [gives, takes] = [signs.filter((s) => s > 0).length, signs.filter((s) => s < 0).length];
          expect(gives, `${String(count)} sites, lane ${String(k)}`).toBe(Math.floor(count / 2));
          expect(takes, `${String(count)} sites, lane ${String(k)}`).toBe(Math.floor(count / 2));
        }
      }
  });

  it('draws the roles among the covered sites only: the same balance for every part of the list', () => {
    // 5 of 9 sites covered: 2 give, 2 take, 1 does neither; the 4 others have no role.
    const covered = [true, false, true, true, false, false, true, false, true];
    for (const step of [0, 300, 4321]) {
      const codes = flowRoles(covered, step, 5);
      covered.forEach((c, i) => {
        if (!c) expect(codes[i]).toBe(0);
      });
      for (let k = 0; k < FLOW_LANES; k++) {
        const signs = lane(codes, k);
        expect(signs.filter((s) => s > 0).length).toBe(2);
        expect(signs.filter((s) => s < 0).length).toBe(2);
      }
    }
  });

  it('holds the roles of a lane for FLOW_HOLD steps and draws the lanes at different steps', () => {
    const at = (step: number) => flowRoles(all(42), step, 7);
    // Lane 0 draws anew at multiples of FLOW_HOLD, lane k a quarter of FLOW_HOLD earlier per lane.
    for (let k = 0; k < FLOW_LANES; k++) {
      const draw = FLOW_HOLD - Math.floor((k * FLOW_HOLD) / FLOW_LANES);
      expect(lane(at(draw - 1), k), `lane ${String(k)}`).toEqual(lane(at(draw === FLOW_HOLD ? 0 : draw - 40), k));
      expect(lane(at(draw), k), `lane ${String(k)}`).not.toEqual(lane(at(draw - 1), k));
      expect(lane(at(draw + FLOW_HOLD - 1), k)).toEqual(lane(at(draw), k));
    }
  });

  it('is the same for the same seed and step, and another draw for another seed', () => {
    expect(flowRoles(all(42), 1234, 5)).toEqual(flowRoles(all(42), 1234, 5));
    expect(flowRoles(all(42), 1234, 6)).not.toEqual(flowRoles(all(42), 1234, 5));
  });

  it('lets every site give in about half of the draws, the first one too', () => {
    const gives = new Array<number>(42).fill(0);
    const draws = 400;
    for (let e = 0; e < draws; e++)
      lane(flowRoles(all(42), e * FLOW_HOLD, 11), 0).forEach((s, i) => (gives[i] = (gives[i] ?? 0) + (s > 0 ? 1 : 0)));
    // 21 of 42 sites give: half of the draws, within 5 standard deviations of 400 draws.
    for (const g of gives) expect(Math.abs(g / draws - 0.5)).toBeLessThan(5 * Math.sqrt(0.25 / draws));
  });

  it('lets each of three sites give, take and rest over time, so every pair exchanges a flux', () => {
    const seen = new Set<string>();
    for (let e = 0; e < 60; e++) seen.add(lane(flowRoles(all(3), e * FLOW_HOLD, 3), 0).join(','));
    // The six orders of one that gives, one that takes and one that rests.
    expect(seen.size).toBe(6);
  });
});

describe('packFlow', () => {
  const settings = { ...defaultSettings(), flowStrength: 6, seed: 77 };
  const sites: [number, number][] = [
    [8, 9],
    [100, 20],
    [31, 2],
  ];

  it('has the size of the uniform block of the passes', () => {
    expect(FLOW_CONSTANT_SLOTS).toBe(7);
    expect(FLOW_SLOTS).toBe(FLOW_CONSTANT_SLOTS + FLOW_SITES);
    expect(FLOW_BYTES).toBe(FLOW_SLOTS * 16);
    expect(packFlow(settings, sites).byteLength).toBe(FLOW_BYTES);
    expect(FLOW_ITERATIONS).toBe(16);
  });

  it('writes the constants where flow.wgsl and flow.frag read them', () => {
    const f = new Float32Array(packFlow(settings, sites));
    const near = (i: number, v: number) => {
      expect(f[i], `slot value ${String(i)}`).toBeCloseTo(v, 6);
    };
    near(0, 6);
    near(1, FLOW.gamma);
    near(2, FLOW.rate);
    near(3, FLOW.recover);
    near(4, FLOW.base);
    near(5, FLOW.food);
    near(6, FLOW.ghost);
    // The acceleration of the iteration for the spectral radius: omega = 2 / (1 + sqrt(1 − r²)).
    near(7, 2 / (1 + Math.sqrt(1 - FLOW.radius ** 2)));
    expect(f[7]).toBeGreaterThan(1.98);
    expect(f[7]).toBeLessThan(2);
    near(8, FLOW.weight);
    near(9, FLOW.bodyRate);
    near(10, FLOW.bodyLow);
    near(11, FLOW.fresh);
    near(12, FLOW.floor);
    near(15, 3);
    near(16, FLOW.death);
    near(17, FLOW.half ** 2);
    near(18, FLOW.birth);
    near(19, FLOW.birthFrom);
    near(24, FLOW_HOLD);
  });

  it('sets the pressure limit of a site by its flux', () => {
    for (const flowStrength of [0.1, 1, 8, 32]) {
      const f = new Float32Array(packFlow({ ...settings, flowStrength }, sites));
      const limit = FLOW.head * flowStrength;
      expect(f[25]).toBeCloseTo(limit, 2);
      // The flux of a site falls to nothing over the last quarter below the limit.
      expect((f[26] ?? 0) * FLOW.headSoft * limit).toBeCloseTo(1, 5);
    }
  });

  it('measures the trail in deposits of strain A', () => {
    const of = (deposit: number) =>
      new Float32Array(packFlow({ ...settings, strains: [{ ...defaultStrain(0), deposit }] }, sites));
    const five = of(5);
    expect(five[13]).toBeCloseTo(FLOW.trailLow * 5, 6);
    expect(five[14]).toBeCloseTo(1 / ((FLOW.trailFull - FLOW.trailLow) * 5), 6);
    const two = of(2);
    expect(two[13]).toBeCloseTo(FLOW.trailLow * 2, 6);
    // A deposit of 0 gives finite thresholds.
    const none = of(0);
    expect(Number.isFinite(none[14] ?? NaN)).toBe(true);
  });

  it('writes the sites after the constants, and the first site as the cell of reference', () => {
    const f = new Float32Array(packFlow(settings, sites));
    expect([...f.subarray(20, 24)]).toEqual([8, 9, 0, 0]);
    const at = FLOW_CONSTANT_SLOTS * 4;
    sites.forEach(([x, y], i) => {
      expect([...f.subarray(at + i * 4, at + i * 4 + 4)]).toEqual([x, y, 0, 0]);
    });
    // Nothing after the last site.
    expect(f.subarray(at + sites.length * 4).every((v) => v === 0)).toBe(true);
  });

  it('writes at most FLOW_SITES sites, and clears a buffer that it gets', () => {
    const many = Array.from({ length: 80 }, (_, i): [number, number] => [i, 1]);
    const buf = new ArrayBuffer(FLOW_BYTES);
    new Float32Array(buf).fill(9);
    const f = new Float32Array(packFlow(settings, many, buf));
    expect(f[15]).toBe(FLOW_SITES);
    expect(f.length).toBe(FLOW_SLOTS * 4);
    const none = new Float32Array(packFlow(settings, [], buf));
    expect(none[15]).toBe(0);
    expect(none.subarray(28).every((v) => v === 0)).toBe(true);
  });
});

describe('the pressure of the CPU copy of the passes (ADR 0029, decision 6)', () => {
  // The case in which the first version of the app let the pressure run away. A mesh of tubes grows out from a food
  // as a disc and reaches three more foods, and its cells flicker: in each step a cell of the disc changes between
  // tube and no tube with a chance of 5 %, so cells cross the level of the tube body again and again, the centre
  // cells of the foods too. With the momentum of the iteration on every cell this run reaches a pressure of 8 · 10⁸
  // (measured 2026-11-13). With the rule that only a cell that conducts takes the momentum, the largest pressure is
  // 433: a food that gives into a piece of tube without a way out, below the pressure limit of a site.
  // flow.gpu.test.ts holds both backends to this copy, on cells with a tube and on cells without one.
  it('stays bounded while a mesh of tubes grows over the foods and flickers', () => {
    const n = 40;
    const env = new Uint8Array(n * n * 4);
    const foods: [number, number][] = [
      [20.5, 20.5],
      [5.5, 20.5],
      [32.5, 29.5],
      [23.5, 2.5],
    ];
    for (const [x, y] of foods)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) env[((Math.floor(y) + dy) * n + Math.floor(x) + dx) * 4 + 1] = 255;
    const grid: FlowGrid = { width: n, height: n, boundary: 'box', env };
    const settings = { ...defaultSettings(), flowStrength: 1, seed: 1 };
    const u = new Float32Array(packFlow(settings, flowSites(foods, n, n)));
    let fields = flowStart(grid, FLOW.fresh);
    let rng = 12345;
    let top = 0;
    let most = 0;
    for (let step = 0; step < 150; step++) {
      // The disc grows by a quarter of a cell per step; its tubes lie 6 cells apart.
      const radius = 3 + step * 0.25;
      const trail = new Float32Array(n * n * 4);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          if (Math.hypot(x - 20, y - 20) > radius) continue;
          let tube = x % 6 === 2 || y % 6 === 2;
          rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
          if (rng / 2 ** 32 < 0.05) tube = !tube;
          if (tube) trail[(y * n + x) * 4] = 10;
        }
      fields = flowStep(grid, u, fields, trail, step, settings.seed);
      top = fields.pressure.reduce((a, v) => Math.max(a, Math.abs(v)), top);
      most = Math.max(most, fields.memory.filter((v, i) => i % 4 === 3 && v !== 0).length);
    }
    // All four foods gave or took in some step, and a pressure built up: the run is the case above.
    expect(most).toBe(4);
    expect(top).toBeGreaterThan(5);
    expect(top).toBeLessThan(FLOW.head * settings.flowStrength);
  }, 60_000);
});
