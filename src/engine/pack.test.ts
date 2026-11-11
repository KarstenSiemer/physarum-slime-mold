import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, strainSpec } from '../model/params';
import {
  AgentToolKind,
  CLEAR_TILE,
  inoculateRate,
  packParams,
  PARAM_SLOTS,
  PARAMS_BYTES,
  START_ROUNDS,
  startRounds,
  STEP_OFFSET,
  stepChance,
  strainAgents,
  strainEnds,
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
    expect(PARAMS_BYTES).toBe(20 * 16);
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
      ...new Uint32Array(packParams(s, { width: 8, height: 8, agents: 1, step: 0, ...more })).slice(19 * 4),
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
