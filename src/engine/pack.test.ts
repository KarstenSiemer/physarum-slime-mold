import { readFileSync } from 'node:fs';
import { dishRadius, DISH_FILL } from './brush';
import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, emissionScale, strainSpec, type Settings } from '../model/params';
import {
  AgentToolKind,
  CLEAR_TILE,
  growthTests,
  inoculateRate,
  packParams,
  PARAM_SLOTS,
  PARAMS_BYTES,
  pyramidLevels,
  START_ROUNDS,
  startEnds,
  startRounds,
  STEP_OFFSET,
  stepChance,
  strainAgents,
  strainEnds,
  trailSaturation,
  type AgentTool,
} from './pack';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const wgsl = read('./shaders/common.wgsl');

describe('Params layout', () => {
  it('matches the WGSL struct member order', () => {
    const body = /struct Params \{([\s\S]*?)\n\}/.exec(wgsl)?.[1] ?? '';
    const members = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
    expect(members).toEqual([...PARAM_SLOTS]);
  });

  it('uses only 16-byte members, so the size is slots × 16', () => {
    const body = /struct Params \{([\s\S]*?)\n\}/.exec(wgsl)?.[1] ?? '';
    const types = [...body.matchAll(/:\s*([\w<>, ]+?),\s*(?:\/\/|$)/gm)].map((m) => m[1]);
    expect(types.every((t) => /^vec4[uf]$|^array<vec4f, 4>$/.test(t ?? ''))).toBe(true);
    expect(PARAMS_BYTES).toBe(24 * 16);
  });

  it('packs grid, config and strain lanes at the right offsets', () => {
    const s = defaultSettings();
    s.strains = [defaultStrain(0, 2), { ...defaultStrain(1, 2), sensorOffset: 20 }];
    const buf = packParams(s, { width: 64, height: 32, agents: 1000, step: 7 });
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    expect([...u.slice(0, 4)]).toEqual([64, 32, 1000, 7]);
    expect(u[STEP_OFFSET / 4]).toBe(7);
    expect([...u.slice(4, 8)]).toEqual([s.seed, 2, 0, 0]);
    expect(f[2 * 4]).toBeCloseTo((22.5 * Math.PI) / 180);
    expect([...f.slice(3 * 4, 3 * 4 + 2)]).toEqual([9, 20]);
    expect(f[7 * 4]).toBeCloseTo(0.9); // keep = 1 - decay
    expect([...f.slice(11 * 4, 11 * 4 + 4)]).toEqual([1, -1, 0, 0]); // attraction row 0, unused lanes 0
    expect([...f.slice(12 * 4, 12 * 4 + 4)]).toEqual([-1, 1, 0, 0]);
  });

  it('packs the layout, the walls flag and the start claim round into extra', () => {
    const s = { ...defaultSettings(), layout: 'ring' as const };
    const extra = (more: { walls?: boolean; round?: number }) => [
      ...new Uint32Array(packParams(s, { width: 8, height: 8, agents: 1, step: 0, ...more })).slice(19 * 4, 20 * 4),
    ];
    expect(extra({})).toEqual([4, 0, 0, 0]);
    expect(extra({ walls: true, round: 7 })).toEqual([4, 1, 7, 0]);
  });
});

describe('agent tools (ADR 0023)', () => {
  it('packs the tool: position, radius and kind, then strain and the chance per step, nothing for living agents', () => {
    const tool = { kind: AgentToolKind.inoculate, x: 3.5, y: 4.25, radius: 6, strain: 1, revive: 0.125 };
    const f = new Float32Array(packParams(defaultSettings(), { width: 8, height: 8, agents: 1, step: 0, tool }));
    expect([...f.slice(16 * 4, 18 * 4)]).toEqual([3.5, 4.25, 6, 1, 1, 0.125, 0, 0]);
  });

  it('gives a dead agent the same chance over a second, however frames and steps cut it up', () => {
    const rate = 0.7;
    const stays = (parts: number[]) => parts.reduce((p, t) => p * (1 - stepChance(rate, t)), 1);
    const second = 1 - stepChance(rate, 1);
    expect(second).toBeCloseTo(Math.exp(-rate), 15);
    for (const [frames, steps] of [
      [60, 2],
      [120, 1],
      [144, 1],
      [30, 4],
    ] as const)
      expect(stays(Array.from({ length: frames * steps }, () => 1 / frames / steps))).toBeCloseTo(second, 12);
    expect(stays([0.25, 0.05, 0.7])).toBeCloseTo(second, 12);
    expect([stepChance(rate, 0), stepChance(0, 1), stepChance(Infinity, 0.01)]).toEqual([0, 0, 1]);
  });

  it('places in a second what 60 frames placed before: half the brush area times the density in each', () => {
    const s = { ...defaultSettings(), density: 0.12, strains: [defaultStrain(0), { ...defaultStrain(1), share: 3 }] };
    const [agents, radius] = [19_661, 6.1];
    for (const strain of [0, 1]) {
      const share = strain === 0 ? 0.25 : 0.75;
      const old = (Math.PI * radius * radius * 0.25) / (2 * agents * share); // App.svelte before, per frame
      const rate = inoculateRate(radius, s, agents, strain);
      expect(rate / 60).toBeCloseTo(old, 12);
      // One frame at 60 Hz gets 1 − e^(−old) ≈ old · (1 − old / 2).
      expect(Math.abs(stepChance(rate, 1 / 60) / old - 1)).toBeLessThan(old);
    }
  });

  it('counts the agents of each strain as strainEnds() splits them', () => {
    const s = [defaultStrain(0), { ...defaultStrain(1), share: 3 }, defaultStrain(2)];
    expect(strainAgents(s, 1000)).toEqual([200, 600, 200]);
    expect(strainAgents([defaultStrain(0)], 7)).toEqual([7]);
  });
});

// The model slot and the sources (ADR 0022): the Jones model packs Jones' one trail map whatever the settings hold,
// and the extended model at scent decay 0.1 packs the sources of the Jones model.
describe('model slot and sources', () => {
  const rt = { width: 8, height: 8, agents: 1, step: 0 };
  const floats = (s: Settings, tool?: AgentTool) => new Float32Array(packParams(s, { ...rt, tool }));
  const scent = (s: Settings) => [...floats(s).slice(15 * 4, 16 * 4)];
  const model = (s: Settings) => [...floats(s).slice(20 * 4, 21 * 4)];
  const jones = (patch: Partial<Settings> = {}): Settings => ({
    ...defaultSettings(),
    model: 'jones',
    collisions: true,
    density: 0.15,
    ...patch,
  });

  it('packs no saturation in the Jones model whatever K says, and a K below 1 as none', () => {
    const s = { ...defaultSettings(), trailSaturation: 50 };
    expect(s.model).toBe('extended');
    expect(model(s)).toEqual([50, 1, 0, 0]);
    expect(model({ ...s, model: 'jones' })).toEqual([0, 1, 1, 0]);
    // A link's 1e-300 would pack as 0 in f32 and divide every lane by 0 (sanitize() rounds it too).
    for (const K of [1e-300, 0.5, 0.999]) {
      expect(trailSaturation({ model: 'extended', trailSaturation: K }), `${K}`).toBe(0);
      expect(model({ ...s, trailSaturation: K }), `${K}`).toEqual([0, 1, 0, 0]);
    }
    expect(trailSaturation({ model: 'extended', trailSaturation: 1 })).toBe(1);
    expect(model({ ...s, coveredFood: true })).toEqual([50, Math.fround(0.001), 0, 0]);
    expect(model({ ...s, coveredFood: true, coveredFoodFactor: 0.01 })).toEqual([50, Math.fround(0.01), 0, 0]);
    expect(model({ ...s, coveredFoodFactor: 0.01 })).toEqual([50, 1, 0, 0]);
  });

  // Jones' lattice diffuses at every site, walls too; the extended model's walls are sinks (ADR 0027).
  it('packs whether walls diffuse: 1 in the Jones model, 0 in the extended model', () => {
    expect(model(jones())[2]).toBe(1);
    expect(model({ ...jones(), model: 'extended' })[2]).toBe(0);
    expect(model(defaultSettings())[2]).toBe(0);
  });

  // Jones 2010, p. 144: food goes into the trail map, which decays with decayT, and the strain weighs it as its trail.
  it('packs Jones’ one trail map in the Jones model: the scent bound to the trail, and no light', () => {
    const strain = { ...defaultStrain(0), decay: 0.05, food: 0.3, light: 2, attraction: [-1, 0, 0, 0] };
    const s = jones({ strains: [strain], scentDecay: 0.2, lightStrength: 0.4, foodStrength: 0.02 });
    const f = floats(s);
    expect([f[9 * 4], f[10 * 4]]).toEqual([-1, 0]); // food weight = own trail weight, light weight 0
    expect(scent(s)).toEqual([Math.fround(255 * 0.02), 0, Math.fround(1 - 0.05), 0]);
    const e = floats({ ...s, model: 'extended' });
    expect([e[9 * 4], e[10 * 4]]).toEqual([Math.fround(0.3), 2]);
    const g = emissionScale(0.2);
    expect(scent({ ...s, model: 'extended' })).toEqual(
      [255 * 0.02 * g, 255 * 0.4 * g, 1 - 0.2, 0].map((v) => Math.fround(v)),
    );
  });

  // Jones 2010, p. 148: the wound loses its agents, which go elsewhere; this app also clears its chemicals.
  it('keeps the chemicals of a cut in the Jones model only (tool2.z)', () => {
    const cut = { kind: AgentToolKind.cut, x: 3, y: 4, radius: 2, strain: 0, revive: 0 };
    const tool2 = (s: Settings, t: AgentTool) => [...floats(s, t).slice(17 * 4, 18 * 4)];
    expect(tool2(jones(), cut)).toEqual([0, 0, 1, 0]);
    expect(tool2(defaultSettings(), cut)).toEqual([0, 0, 0, 0]);
    const inoculate = { ...cut, kind: AgentToolKind.inoculate, revive: 0.5 };
    expect(tool2(jones(), inoculate)).toEqual([0, 0.5, 0, 0]);
  });

  it('scales the sources by emissionScale() only in the extended model, by exactly 1 at decay 0.1', () => {
    expect(emissionScale(0.1)).toBe(1);
    const s = jones({ foodStrength: 0.05 });
    const ext = { ...defaultSettings(), foodStrength: 0.05, lightStrength: 0.2 };
    // At decay 0.1 the extended model releases the food of the Jones model.
    expect(scent(ext)[0]).toBe(scent(s)[0]);
    expect(scent(ext)[1]).toBe(Math.fround(255 * 0.2));
    const [food = 0, light = 0] = scent({ ...ext, scentDecay: 0.001 });
    expect(food).toBeCloseTo(255 * 0.05 * (0.001 / 0.1), 4);
    expect(light).toBeCloseTo(255 * 0.2 * (0.001 / 0.1), 4);
    // The Jones model releases 255 · wProj at every decay of the strain.
    const low = jones({ foodStrength: 0.05, strains: [{ ...defaultStrain(0), decay: 0.001 }], scentDecay: 0.001 });
    expect(scent(low).slice(0, 3)).toEqual([Math.fround(255 * 0.05), 0, Math.fround(0.999)]);
  });

  // The agents sense the map after the step's sources, before its diffusion (Jones' order, ADR 0027).
  it('keeps the plateau of a large food at every scent decay: source / d', () => {
    const plateau = (d: number) => (255 * 0.05 * emissionScale(d)) / d;
    for (const d of [0.001, 0.003, 0.01, 0.03, 0.3, 0.9]) expect(plateau(d) / plateau(0.1)).toBeCloseTo(1, 12);
  });
});

describe('startRounds', () => {
  it('is one round where the grid permutation gives every agent a free cell, all rounds elsewhere', () => {
    expect(startRounds({ layout: 'mixed', boundary: 'wrap' }, false)).toBe(1);
    expect(startRounds({ layout: 'mixed', boundary: 'box' }, false)).toBe(1);
    expect(startRounds({ layout: 'mixed', boundary: 'dish' }, false)).toBe(START_ROUNDS);
    expect(startRounds({ layout: 'mixed', boundary: 'wrap' }, true)).toBe(START_ROUNDS);
    expect(startRounds({ layout: 'center', boundary: 'wrap' }, false)).toBe(START_ROUNDS);
  });
});

describe('strainEnds', () => {
  it('splits agents by share and ends with the total', () => {
    const s = [defaultStrain(0), { ...defaultStrain(1), share: 3 }];
    expect(strainEnds(s, 1000)).toEqual([250, 1000, 1000, 1000]);
    expect(strainEnds([defaultStrain(0)], 7)).toEqual([7, 7, 7, 7]);
  });
});

// Jones' dish, 0.945 of the grid's short side (Jones 2010, Fig. 18 and 19; ADR 0027): one value in every shader.
describe('the dish', () => {
  it('has the same share of the short side in every shader and in brush.ts', () => {
    expect(DISH_FILL).toBe(0.945);
    expect(dishRadius(300, 300)).toBe(141.75);
    expect(dishRadius(512, 288)).toBe(0.945 * 144);
    for (const path of [
      './shaders/common.wgsl',
      './shaders/render.wgsl',
      './gl/glsl/common.glsl',
      './gl/glsl/view.glsl',
    ]) {
      const values = [...read(path).matchAll(/const (?:float )?DISH_FILL = ([\d.]+);/g)].map((m) => Number(m[1]));
      expect(values, path).toEqual([DISH_FILL]);
    }
    // Every rim of the shaders is DISH_FILL times half the short side: no other formula is left.
    for (const path of [
      './shaders/common.wgsl',
      './shaders/render.wgsl',
      './gl/glsl/common.glsl',
      './gl/glsl/view.glsl',
      './gl/glsl/render.frag',
    ])
      expect(read(path), path).not.toMatch(/0\.5 \* (?:f32|float)?\(?min\([^)]*\)\)? - 1\.0/);
  });
});

// The walk of agents.wgsl and agents.frag (clearPath) and the clearance of walls.wgsl and walls.frag (ADR 0020).
describe('wall walks and clearance', () => {
  const constant = (path: string, name: string) => {
    const m = new RegExp(`const (?:int )?${name} = (\\d+);`).exec(read(path));
    if (!m) throw new Error(`${name} not in ${path}`);
    return Number(m[1]);
  };

  it('walks every cell of the longest sensor and of the longest step, alike on both backends', () => {
    const walk = constant('./shaders/agents.wgsl', 'WALK');
    expect(constant('./gl/glsl/agents.frag', 'WALK')).toBe(walk);
    // A segment of length L enters fewer than |dx| + |dy| + 2 ≤ L · √2 + 2 cells.
    for (const max of [strainSpec.sensorOffset.max, strainSpec.stepSize.max])
      expect(walk).toBeGreaterThanOrEqual(Math.floor(max * Math.SQRT2) + 2);
    expect(walk).toBe(92);
  });

  it('uses one tile size and a search that is exact up to FAR, which the longest walk stays below', () => {
    expect(constant('./shaders/common.wgsl', 'CLEAR_TILE')).toBe(CLEAR_TILE);
    expect(constant('./gl/glsl/common.glsl', 'CLEAR_TILE')).toBe(CLEAR_TILE);
    const [search, far] = [constant('./shaders/walls.wgsl', 'SEARCH'), constant('./shaders/walls.wgsl', 'FAR')];
    expect([constant('./gl/glsl/walls.frag', 'WALL_SEARCH'), constant('./gl/glsl/walls.frag', 'WALL_FAR')]).toEqual([
      search,
      far,
    ]);
    // A tile more than SEARCH tiles away lies at least (SEARCH − 1) · CLEAR_TILE + 2 cells away (walls.wgsl).
    expect(far).toBeLessThanOrEqual((search - 1) * CLEAR_TILE + 2);
    // A walk of a sensor 64 cells away spans up to 65 cells along an axis; it can skip only below the clearance.
    expect(far).toBeGreaterThan(Math.floor(strainSpec.sensorOffset.max) + 1);
  });
});

describe('growth and shrinkage (ADR 0025)', () => {
  const rt = { width: 8, height: 8, agents: 100, step: 0 };
  const words = (s: Settings, start?: number) =>
    new Uint32Array(packParams(s, start === undefined ? rt : { ...rt, start }));
  const slotOf = (name: (typeof PARAM_SLOTS)[number]) => {
    const i = PARAM_SLOTS.indexOf(name);
    return (i > PARAM_SLOTS.indexOf('attraction') ? i + 3 : i) * 4;
  };
  const lanes = (s: Settings, name: (typeof PARAM_SLOTS)[number], start?: number) => [
    ...words(s, start).slice(slotOf(name), slotOf(name) + 4),
  ];

  it('packs the tests only while growth is on with the rule: an interval of 0 turns a test off', () => {
    const on = { ...defaultSettings(), collisions: true, growth: true };
    expect(lanes(on, 'growth')).toEqual([3, 9, 1, 10]);
    expect(lanes(on, 'shrinkage')).toEqual([3, 5, 0, 20]);
    expect(lanes({ ...on, growth: false }, 'growth')).toEqual([0, 9, 1, 10]);
    expect(lanes({ ...on, growth: false }, 'shrinkage')).toEqual([0, 5, 0, 20]);
    expect(lanes({ ...on, collisions: false }, 'growth')[0]).toBe(0);
    const tsp = { ...on, growthEvery: 5, shrinkEvery: 10, shrinkWindow: 9, shrinkMax: 80 };
    expect(lanes(tsp, 'shrinkage')).toEqual([10, 9, 0, 80]);
  });

  it('tests on the steps whose number is a multiple of the interval, from step 0', () => {
    const on = { ...defaultSettings(), collisions: true, growth: true, growthEvery: 3, shrinkEvery: 5 };
    const steps = (k: 'grow' | 'shrink') =>
      Array.from({ length: 16 }, (_, i) => i).filter((i) => growthTests(on, i)[k]);
    expect(steps('grow')).toEqual([0, 3, 6, 9, 12, 15]);
    expect(steps('shrink')).toEqual([0, 5, 10, 15]);
    expect(growthTests({ ...on, growthEvery: 0 }, 0).grow).toBe(false);
    expect(growthTests({ ...on, growth: false }, 0)).toEqual({ grow: false, shrink: false });
    expect(growthTests({ ...on, collisions: false }, 0)).toEqual({ grow: false, shrink: false });
  });

  it('starts the first agents of each strain: at the full start the start ends are the strain ends', () => {
    const strains = [defaultStrain(0, 3), { ...defaultStrain(1, 3), share: 0.5 }, defaultStrain(2, 3)];
    for (const n of [1, 7, 100, 1001]) expect(startEnds(strains, n), `${n}`).toEqual(strainEnds(strains, n));
    const s = { ...defaultSettings(), strains };
    expect(lanes(s, 'startEnd')).toEqual(strainEnds(strains, 100));
    // 100 agents: 40, 20 and 40 per strain; 30 alive at the start: 12, 6 and 12.
    expect(strainEnds(strains, 100)).toEqual([40, 60, 100, 100]);
    expect(startEnds(strains, 100, 30)).toEqual([12, 46, 72, 100]);
    expect(lanes(s, 'startEnd', 30)).toEqual([12, 46, 72, 100]);
    for (let n = 1; n < 60; n++)
      for (let m = 0; m <= n; m++) {
        const [ends, starts] = [strainEnds(strains, n), startEnds(strains, n, m)];
        starts.forEach((e, i) => {
          expect(e).toBeLessThanOrEqual(ends[i] ?? 0);
          expect(e).toBeGreaterThanOrEqual(i > 0 ? (ends[i - 1] ?? 0) : 0);
        });
      }
  });

  it('builds pyramids of sums with a fan-in of 4 down to one node', () => {
    expect(pyramidLevels(1)).toEqual([1]);
    expect(pyramidLevels(4)).toEqual([1]);
    expect(pyramidLevels(5)).toEqual([2, 1]);
    expect(pyramidLevels(512 * 288)).toEqual([36864, 9216, 2304, 576, 144, 36, 9, 3, 1]);
    // The largest grid has 13 levels with its cells: the arrays of 13 in growth.frag hold them.
    expect(pyramidLevels(4096 * 4096).length + 1).toBe(13);
  });
});
