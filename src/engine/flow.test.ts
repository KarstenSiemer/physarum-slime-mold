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
  heldTrail,
  JONES_DECAY,
  packFlow,
  recoverShare,
  STEPS_PER_MINUTE,
  trailLevels,
} from './flow';
import { flowStart, flowStep, roleSigns, type FlowGrid } from './flow-reference';
import { flowSites, NO_SITES, type FlowSites } from './sites';

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
    // Starved ground is fresh again after about 6 days, and open for births again after 3.7 days (ADR 0054): slime
    // from a large culture is avoided for up to 6 days (Reid et al. 2013, as Tröger et al. 2024 cite it, p. 3).
    const fresh = Math.log(FLOW.fresh / FLOW.floor) / Math.log(1 + FLOW.recover);
    expect(minutes(fresh) / 60 / 24).toBeGreaterThan(6);
    expect(minutes(fresh) / 60 / 24).toBeLessThan(6.2);
    const open = Math.log(FLOW.half / FLOW.floor) / Math.log(1 + FLOW.recover);
    expect(minutes(open) / 60 / 24).toBeCloseTo(3.7, 1);
  });

  it('lets few agents starve on fresh ground: half of a colony without a flux in about 8 hours', () => {
    // While no flux runs, the memory keeps its values (flow.wgsl fed()), and the agents follow it: the chance of
    // agents.wgsl starved() at the memory of fresh ground. The help of the setting and ADR 0029 name these numbers.
    const chance = (FLOW.death * FLOW.half ** 2) / (FLOW.fresh ** 2 + FLOW.half ** 2);
    expect(chance * 20_000).toBeCloseTo(1, 2);
    const half = Math.log(2) / chance;
    expect(Math.round(half / 100) * 100).toBe(13_900);
    expect(half / STEPS_PER_MINUTE / 60).toBeCloseTo(7.7, 1);
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
  const sites: FlowSites = {
    list: [
      { x: 8, y: 9, offset: 0, count: 5, stroke: 0 },
      { x: 100, y: 20, offset: 64, count: 1, stroke: 1 },
      { x: 31, y: 2, offset: 128, count: 70, stroke: 3 },
    ],
    cells: new Uint32Array(256),
  };

  it('has the size of the uniform block of the passes', () => {
    expect(FLOW_CONSTANT_SLOTS).toBe(7);
    // Two slots of the constants of stage 4 after the sites (territory.ts packTerritory(), ADR 0068).
    expect(FLOW_SLOTS).toBe(FLOW_CONSTANT_SLOTS + FLOW_SITES + 2);
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

  it('measures the trail of a strain in deposits of that strain', () => {
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
    // Every strain has a block of its own (ADR 0031): the levels of the trail are in deposits of the block's strain.
    const strains = [5, 2, 8].map((deposit, i) => ({ ...defaultStrain(i), deposit }));
    [5, 2, 8].forEach((deposit, strain) => {
      const f = new Float32Array(packFlow({ ...settings, strains }, sites, undefined, strain));
      expect(f[13], `strain ${String(strain)}`).toBeCloseTo(FLOW.trailLow * deposit, 6);
      expect(f[14], `strain ${String(strain)}`).toBeCloseTo(1 / ((FLOW.trailFull - FLOW.trailLow) * deposit), 6);
    });
  });

  it('names the strain of the block, and gives every strain the same constants and sites', () => {
    const strains = [0, 1, 2, 3].map((i) => defaultStrain(i));
    const blocks = strains.map(
      (_, strain) => new Float32Array(packFlow({ ...settings, strains }, sites, undefined, strain)),
    );
    const [first] = blocks;
    if (!first) throw new Error('no block');
    blocks.forEach((f, strain) => {
      // Slot 22 is U.f.z of flow.wgsl and flow.frag: the lane of the trail that the passes of the strain read.
      expect(f[22]).toBe(strain);
      f.forEach((v, i) => {
        if (i !== 22) expect(v, `value ${String(i)} of strain ${String(strain)}`).toBe(first[i]);
      });
    });
    // The first strain by default.
    expect(new Float32Array(packFlow(settings, sites))[22]).toBe(0);
  });

  it('writes the sites after the constants, and the first cell of the first site as the cell of reference', () => {
    const f = new Float32Array(packFlow(settings, sites));
    // The blocks of 64 entries of the list of cells (flow.wgsl `blocks`) in the last slot.
    expect([...f.subarray(20, 24)]).toEqual([8, 9, 0, 4]);
    const at = FLOW_CONSTANT_SLOTS * 4;
    // Per site its first cell and its run in the list of cells (flow.wgsl `sites`).
    sites.list.forEach(({ x, y, offset, count }, i) => {
      expect([...f.subarray(at + i * 4, at + i * 4 + 4)]).toEqual([x, y, offset, count]);
    });
    // Nothing after the last site.
    expect(f.subarray(at + sites.list.length * 4).every((v) => v === 0)).toBe(true);
    // The runs of a grid of 4096 × 4096 cells are whole numbers in 32-bit floats: the shaders read them exactly.
    expect(Math.fround(4096 * 4096)).toBe(4096 * 4096);
    expect(Math.fround(4096 * 4096 - 1)).toBe(4096 * 4096 - 1);
  });

  it('writes at most FLOW_SITES sites, and clears a buffer that it gets', () => {
    const many: FlowSites = {
      list: Array.from({ length: 80 }, (_, i) => ({ x: i, y: 1, offset: i, count: 1, stroke: i })),
      cells: new Uint32Array(80),
    };
    const buf = new ArrayBuffer(FLOW_BYTES);
    new Float32Array(buf).fill(9);
    const f = new Float32Array(packFlow(settings, many, buf));
    expect(f[15]).toBe(FLOW_SITES);
    expect(f.length).toBe(FLOW_SLOTS * 4);
    const none = new Float32Array(packFlow(settings, NO_SITES, buf));
    expect(none[15]).toBe(0);
    expect(none.subarray(28).every((v) => v === 0)).toBe(true);
  });
});

// ADR 0055, decision 5: the setting Slime life time gives the mark of starved ground its time.
describe('the time of the mark of starved ground (ADR 0055)', () => {
  const settings = { ...defaultSettings(), flowStrength: 6, seed: 77 };
  /** The share that the passes get: the fourth value of the uniform block (flow.wgsl U.a.w). */
  const packed = (slimeLife: number) => new Float32Array(packFlow({ ...settings, slimeLife }, NO_SITES))[3];
  /** Hours of model time from the floor of the flow memory up to `level`, at the share of a life time. */
  const hours = (slimeLife: number, level: number) =>
    Math.log(level / FLOW.floor) / Math.log(1 + recoverShare({ slimeLife })) / STEPS_PER_MINUTE / 60;

  it('keeps the share of ADR 0054 at the default of 144 hours, bit for bit', () => {
    expect(defaultSettings().slimeLife).toBe(144);
    expect(recoverShare({ slimeLife: 144 })).toBe(FLOW.recover);
    expect(recoverShare(defaultSettings())).toBe(0.00002875);
    expect(packed(144)).toBe(Math.fround(FLOW.recover));
    // Every byte of the uniform block is the one of the code before, which packed FLOW.recover.
    const block = new Float32Array(packFlow(settings, NO_SITES));
    const before = block.slice();
    before[3] = FLOW.recover;
    expect(new Uint8Array(block.buffer)).toEqual(new Uint8Array(before.buffer));
  });

  it('gives the share of ADR 0029 at 18 hours: eight times the share of 144 hours', () => {
    expect(recoverShare({ slimeLife: 18 })).toBe(0.00023);
    expect(recoverShare({ slimeLife: 18 })).toBe(FLOW.recover * 8);
    expect(packed(18)).toBe(Math.fround(0.00023));
  });

  it('keeps the share of ADR 0054 without slime, at a life time of 0', () => {
    expect(recoverShare({ slimeLife: 0 })).toBe(FLOW.recover);
    expect(packed(0)).toBe(Math.fround(FLOW.recover));
    expect(packed(0)).toBe(packed(144));
  });

  it('lets the mark fade in about the life time, and opens the ground for births after about six tenths of it', () => {
    for (const slimeLife of [1, 18, 72, 144, 240]) {
      // From the floor to fresh ground, and to the level from which a child is born onto the ground.
      expect(hours(slimeLife, FLOW.fresh) / slimeLife, `${slimeLife} h`).toBeCloseTo(1.02, 2);
      expect(hours(slimeLife, FLOW.half) / slimeLife, `${slimeLife} h`).toBeCloseTo(0.618, 2);
    }
    // 6 days and 3.7 days at the default, as the help of the setting says.
    expect(hours(144, FLOW.fresh) / 24).toBeCloseTo(6.12, 2);
    expect(hours(144, FLOW.half) / 24).toBeCloseTo(3.71, 2);
    // A shorter life time gives a larger share, in the inverse ratio.
    expect(recoverShare({ slimeLife: 72 })).toBe(2 * FLOW.recover);
    expect(recoverShare({ slimeLife: 240 })).toBeCloseTo(0.6 * FLOW.recover, 15);
    expect(recoverShare({ slimeLife: 240 })).toBeLessThan(recoverShare({ slimeLife: 144 }));
  });

  it('changes no other value of the uniform block', () => {
    const [a, b] = [144, 18].map((slimeLife) => new Float32Array(packFlow({ ...settings, slimeLife }, NO_SITES)));
    const differing = [...(a ?? [])].flatMap((v, i) => (v === b?.[i] ? [] : [i]));
    expect(differing).toEqual([3]);
  });
});

describe('the levels of the trail of a tube (ADR 0032)', () => {
  it('holds the trail of a cell that an agent enters at every step, for each order of a step', () => {
    // Sensing first: T ← (T + 1) · (1 − decay). Moving first: T ← T · (1 − decay) + 1 (diffuse.wgsl).
    for (const decay of [0.02, 0.1, 0.3, 0.6, 0.9]) {
      let [senseFirst, moveFirst] = [0, 0];
      for (let step = 0; step < 2000; step++) {
        senseFirst = (senseFirst + 1) * (1 - decay);
        moveFirst = moveFirst * (1 - decay) + 1;
      }
      expect(heldTrail(decay, 'sense-first'), String(decay)).toBeCloseTo(senseFirst, 6);
      expect(heldTrail(decay, 'move-first'), String(decay)).toBeCloseTo(moveFirst, 6);
    }
    // The decay stays inside the range of its slider: no division by 0, and no level of 0.
    expect(heldTrail(0, 'sense-first')).toBe(heldTrail(1e-4, 'sense-first'));
    expect(heldTrail(1, 'sense-first')).toBe(heldTrail(0.9, 'sense-first'));
    expect(heldTrail(1, 'sense-first')).toBeGreaterThan(0);
  });

  it('gives the levels of ADR 0029 at Jones’ decay, bit for bit, in either order of a step', () => {
    expect(JONES_DECAY).toBe(0.1);
    for (const order of ['sense-first', 'move-first'] as const)
      for (const deposit of [0.5, 2, 5, 50]) {
        const [low, full] = trailLevels({ deposit, decay: 0.1 }, order);
        expect(low, `${order} ${String(deposit)}`).toBe(FLOW.trailLow * deposit);
        expect(full, `${order} ${String(deposit)}`).toBe(FLOW.trailFull * deposit);
      }
    // So the block of a scene with that decay holds the numbers of before: the scenes with the flow keep their bytes.
    const settings = { ...defaultSettings(), flowStrength: 8 };
    expect(settings.strains[0]?.decay).toBe(0.1);
    const f = new Float32Array(packFlow(settings, NO_SITES));
    expect(f[13]).toBe(Math.fround(FLOW.trailLow * 5));
    expect(f[14]).toBe(Math.fround(1 / (FLOW.trailFull * 5 - FLOW.trailLow * 5)));
  });

  it('lowers the levels in the ratio of the trail that a cell holds at the decay of the strain', () => {
    // A decay of 0.6 leaves (1 − 0.6) / 0.6 = 0.67 deposits where a decay of 0.1 leaves 9: a thirteenth.
    const [low, full] = trailLevels({ deposit: 5, decay: 0.6 }, 'sense-first');
    expect(low).toBeCloseTo((FLOW.trailLow * 5 * (0.4 / 0.6)) / 9, 9);
    expect(full / low).toBeCloseTo(FLOW.trailFull / FLOW.trailLow, 9);
    // Moving first, a cell holds 1 / decay deposits.
    expect(trailLevels({ deposit: 5, decay: 0.6 }, 'move-first')[0]).toBeCloseTo(FLOW.trailLow * 5 * (0.1 / 0.6), 9);
    // A trail that stays longer is stronger, and its levels are higher.
    expect(trailLevels({ deposit: 5, decay: 0.02 }, 'sense-first')[0]).toBeGreaterThan(FLOW.trailLow * 5);
    // The block of each strain has the levels of that strain; a deposit of 0 gives finite levels.
    const strains = [0.1, 0.6].map((decay, i) => ({ ...defaultStrain(i), decay }));
    const settings = { ...defaultSettings(), strains };
    const second = new Float32Array(packFlow(settings, NO_SITES, undefined, 1));
    expect(second[13]).toBe(Math.fround(low));
    const none = new Float32Array(
      packFlow({ ...settings, strains: [{ ...defaultStrain(0), deposit: 0, decay: 0.6 }] }, NO_SITES),
    );
    expect(Number.isFinite(none[14] ?? NaN)).toBe(true);
  });
});

describe('the flow of a strain in the CPU copy of the passes (ADR 0031)', () => {
  it('builds the tube body from the trail of the strain of the block alone', () => {
    const n = 16;
    const grid: FlowGrid = { width: n, height: n, boundary: 'box', env: new Uint8Array(n * n * 4) };
    const strains = [0, 1].map((i) => defaultStrain(i));
    const settings = { ...defaultSettings(), strains };
    // A full trail of the second strain on one cell, and of the first strain on another.
    const [mine, other] = [5 * n + 5, 9 * n + 9];
    const trail = new Float32Array(n * n * 4);
    trail[mine * 4 + 1] = 10;
    trail[other * 4] = 10;
    const u = new Float32Array(packFlow(settings, NO_SITES, undefined, 1));
    const fields = flowStep(grid, u, flowStart(grid, FLOW.fresh), trail, 0, settings.seed, NO_SITES.cells);
    expect(fields.memory[mine * 4 + 1]).toBeCloseTo(FLOW.bodyRate, 6);
    expect(fields.memory[other * 4 + 1]).toBe(0);
  });
});

describe('the pressure of the CPU copy of the passes (ADR 0029, decision 6)', () => {
  // The case in which the first version of the app let the pressure run away. A mesh of tubes grows out from a food
  // as a disc and reaches three more foods, and its cells flicker: in each step a cell of the disc changes between
  // tube and no tube with a chance of 5 %, so cells cross the level of the tube body again and again, the centre
  // cells of the foods too. With the momentum of the iteration on every cell this run reaches a pressure of 1.9 · 10⁹
  // by step 150 and 3.2 · 10¹² by step 200 (2026-11-15; 1.3 · 10⁹ by step 150 on 2026-11-13, with the food sites of
  // before decision 17). With the rule that only a cell that conducts takes the momentum, the largest pressure in 200
  // steps is 435, about a ninth of the pressure limit of a site (4,096 for a flux of 1). The momentum tuned for a larger
  // spectral radius lets the pressure swing longer: with 0.999998 and 0.999999 it reaches 1,987 and 4,706 by step 200,
  // more than a quarter of the limit (ADR 0029, decision 18; research/flow/bounded.ts scene=mesh).
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
    // Each food is a dab that paints its 3 × 3 cells: a site of nine cells (ADR 0029, decision 17).
    const sites = flowSites(
      foods.map((at) => [{ kind: 'food', from: at, to: at, radius: 1.5 }]),
      n,
      n,
      'box',
    );
    expect(sites.list.map((s) => s.count)).toEqual([9, 9, 9, 9]);
    const u = new Float32Array(packFlow(settings, sites));
    let fields = flowStart(grid, FLOW.fresh);
    let rng = 12345;
    let top = 0;
    let most = 0;
    for (let step = 0; step < 200; step++) {
      // The disc grows by a quarter of a cell per step; its tubes lie 6 cells apart. It fills the grid at about step
      // 100; from then on only the flicker changes the network.
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
      fields = flowStep(grid, u, fields, trail, step, settings.seed, sites.cells);
      top = fields.pressure.reduce((a, v) => Math.max(a, Math.abs(v)), top);
      most = Math.max(most, fields.memory.filter((v, i) => i % 4 === 3 && v !== 0).length);
    }
    // All four foods gave or took in some step, and a pressure built up: the run is the case above.
    expect(most).toBe(4);
    expect(top).toBeGreaterThan(5);
    expect(top).toBeLessThan((FLOW.head * settings.flowStrength) / 4);
  }, 60_000);
});
