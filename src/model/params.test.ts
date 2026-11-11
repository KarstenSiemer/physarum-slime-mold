import { describe, expect, it } from 'vitest';
import {
  attractionSpec,
  constrain,
  defaultSettings,
  defaultStrain,
  fieldText,
  globalSpec,
  jonesFits,
  MAX_STRAINS,
  sanitize,
  snap,
  strainLike,
  strainSpec,
  toJones,
  type Settings,
  type Spec,
  type Strain,
} from './params';
import { presetById, PRESETS } from './presets';

const inRange = (v: number, s: Spec) => v >= s.min && v <= s.max;

describe('defaults', () => {
  it('are inside every spec range', () => {
    const d = defaultSettings();
    for (const [k, s] of Object.entries(globalSpec)) expect(inRange(d[k as keyof typeof globalSpec], s), k).toBe(true);
    for (const st of d.strains) {
      for (const [k, s] of Object.entries(strainSpec))
        expect(inRange(st[k as keyof typeof strainSpec], s), k).toBe(true);
      for (const a of st.attraction) expect(inRange(a, attractionSpec)).toBe(true);
    }
  });

  it('survive sanitize unchanged', () => {
    expect(sanitize(defaultSettings())).toEqual(defaultSettings());
  });
});

describe('sanitize (untrusted input)', () => {
  it('falls back to defaults for garbage', () => {
    for (const junk of [null, undefined, 42, 'x', [], [1, 2], { strains: 'no' }, { strains: [null, 7] }]) {
      const s = sanitize(junk);
      expect(s.strains.length).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(s.density)).toBe(true);
    }
  });

  it('clamps numbers and rejects non-finite values', () => {
    const s = sanitize({
      density: 1e12,
      speed: -5,
      shrink: Number.NaN,
      diffusion: 2.6,
      strains: [{ sensorAngle: Infinity, decay: -1, sensorOffset: 1e9 }],
    });
    expect(s.density).toBe(globalSpec.density.max);
    expect(s.speed).toBe(globalSpec.speed.min);
    expect(s.shrink).toBe(defaultSettings().shrink);
    expect(s.diffusion).toBe(3);
    expect(s.strains[0]?.sensorAngle).toBe(22.5);
    expect(s.strains[0]?.decay).toBe(strainSpec.decay.min);
    expect(s.strains[0]?.sensorOffset).toBe(strainSpec.sensorOffset.max);
  });

  it('accepts only known enum values, colors and resolutions', () => {
    const s = sanitize({
      layout: 'evil',
      boundary: 'dish',
      style: 'paper',
      resolution: 999,
      strains: [{ color: 'red' }, { color: '#ABCDEF' }],
    });
    expect(s.layout).toBe('mixed');
    expect(s.boundary).toBe('dish');
    expect(s.style).toBe('paper');
    expect(s.resolution).toBe(1536);
    expect(s.strains[0]?.color).toBe('#f2c14e');
    expect(s.strains[1]?.color).toBe('#abcdef');
  });

  it('limits strains and matrix rows to MAX_STRAINS', () => {
    const s = sanitize({ strains: Array.from({ length: 9 }, () => ({ attraction: Array(9).fill(5) })) });
    expect(s.strains).toHaveLength(MAX_STRAINS);
    for (const st of s.strains) expect(st.attraction).toEqual(Array(MAX_STRAINS).fill(attractionSpec.max));
  });

  it('takes the model, covered food and trail saturation', () => {
    const s = sanitize({ model: 'extended', coveredFood: true, trailSaturation: 40 });
    expect([s.model, s.coveredFood, s.trailSaturation]).toEqual(['extended', true, 40]);
    const bad = sanitize({ model: 'Extended', coveredFood: 'yes', trailSaturation: -3 });
    expect([bad.model, bad.coveredFood, bad.trailSaturation]).toEqual(['extended', false, 0]);
    expect(sanitize({ model: 'extended', trailSaturation: 1e9 }).trailSaturation).toBe(globalSpec.trailSaturation.max);
  });

  // K has steps of 1. A K of 1e-300 passed the clamp, picked the saturating passes and packed as 0 in f32, so
  // t / (1 + t / 0) gave NaN in every lane with t = 0 and no agent turned, while the panel showed K = 0.
  it('rounds trail saturation to its whole steps', () => {
    for (const [k, want] of [
      [1e-300, 0],
      [0.4, 0],
      [0.6, 1],
      [29.5, 30],
    ] as const)
      expect(sanitize({ model: 'extended', trailSaturation: k }).trailSaturation, `${k}`).toBe(want);
  });

  it('caps density at one agent per cell in collision mode', () => {
    expect(sanitize({ collisions: true, density: 4 }).density).toBe(1);
  });

  it('ignores prototype keys', () => {
    const s: Settings = sanitize(JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(s)).not.toContain('constructor');
  });

  // CPU-bound: the default 5 s limit fails on a heavily loaded machine.
  it('never throws on random input', { timeout: 30_000 }, () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 0.5;
    const value = (depth: number): unknown => {
      const r = rnd();
      if (depth > 1 || r < 0.2) return [rnd() * 1e6, 'x', null, true, Number.NaN][Math.floor(Math.abs(r) * 5) % 5];
      if (r < 0.5) return Array.from({ length: 5 }, () => value(depth + 1));
      const keys = [
        ...Object.keys(globalSpec),
        ...Object.keys(strainSpec),
        ...['strains', 'attraction', 'color', 'seed', 'model', 'coveredFood'],
      ];
      return Object.fromEntries(keys.map((k) => [k, value(depth + 1)]));
    };
    for (let i = 0; i < 500; i++) expect(() => sanitize(value(0))).not.toThrow();
  });
});

describe('covered food (Adamatzky and Jones 2010, ADR 0022)', () => {
  it('multiplies the source of a covered food cell by Jones’ 0.001 unless a scene sets its paper’s factor', () => {
    expect(defaultSettings().coveredFoodFactor).toBe(0.001);
    expect(sanitize({ coveredFoodFactor: 0.01 }).coveredFoodFactor).toBe(0.01); // Jones and Adamatzky 2014
    expect(sanitize({ coveredFoodFactor: 0 }).coveredFoodFactor).toBe(globalSpec.coveredFoodFactor.min);
    expect(sanitize({ coveredFoodFactor: 'x' }).coveredFoodFactor).toBe(0.001);
  });
});

// Owner decision 2026-11-11 (ADR 0022): the Jones model holds only Jones' published rules.
describe('the Jones model', () => {
  const one = (patch: Partial<Strain> = {}) => [{ ...defaultStrain(0), ...patch }];
  const jonesLink = (patch: Record<string, unknown> = {}) =>
    sanitize({ model: 'jones', collisions: true, density: 0.15, strains: one(), ...patch });

  it('loads a link that fits Jones’ rules as Jones, and any other as extended', () => {
    expect(jonesLink().model).toBe('jones');
    expect(jonesLink({ strains: one({ attraction: [-1, 0, 0, 0] }) }).model).toBe('jones'); // chemorepulsion
    for (const [what, patch] of [
      ['two strains', { strains: [defaultStrain(0), defaultStrain(1)] }],
      ['no rule', { collisions: false }],
      ['two diffusion passes', { diffusion: 2 }],
      ['no diffusion', { diffusion: 0 }],
      ['own weight 0.5', { strains: one({ attraction: [0.5, 0, 0, 0] }) }],
    ] as const)
      expect(jonesLink(patch).model, what).toBe('extended');
  });

  it('opens a link from before the model switch as Jones when its values fit, else as extended', () => {
    const network = presetById('network')?.settings();
    if (!network) throw new Error('no preset network');
    const { model: _, ...old } = network;
    expect(sanitize(old).model).toBe('jones');
    const { model: __, ...defaults } = defaultSettings();
    expect(sanitize(defaults).model).toBe('extended');
  });

  it('drops the values that Jones does not have, and binds the scent to the trail', () => {
    const s = jonesLink({
      trailSaturation: 30,
      lightStrength: 0.3,
      scentDecay: 0.01,
      strains: one({ decay: 0.05, food: 0.4, light: 2, attraction: [-1, 0, 0, 0] }),
    });
    expect(s.model).toBe('jones');
    expect([s.trailSaturation, s.lightStrength, s.scentDecay]).toEqual([0, defaultSettings().lightStrength, 0.05]);
    expect([s.strains[0]?.food, s.strains[0]?.light]).toEqual([-1, defaultStrain(0).light]);
    // The extended model keeps them.
    const e = sanitize({ ...s, model: 'extended', trailSaturation: 30, scentDecay: 0.01 });
    expect([e.trailSaturation, e.scentDecay]).toEqual([30, 0.01]);
  });

  it('stays the same through constrain() once bound, so the panel and the link agree', () => {
    const s = jonesLink({ trailSaturation: 30 });
    expect(constrain(s)).toBe(s);
    for (const p of PRESETS) {
      const t = p.settings();
      expect(constrain(t), p.id).toBe(t);
    }
  });

  it('switches to Jones with strain A, the rule and one diffusion pass (toJones)', () => {
    const three = presetById('three-strains')?.settings();
    if (!three) throw new Error('no preset three-strains');
    const s = toJones({ ...three, trailSaturation: 30, scentDecay: 0.01 });
    expect(jonesFits(s)).toBe(true);
    expect(s.model).toBe('jones');
    expect([s.strains.length, s.collisions, s.diffusion, s.trailSaturation]).toEqual([1, true, 1, 0]);
    expect(s.density).toBeLessThanOrEqual(1);
    expect(s.scentDecay).toBe(three.strains[0]?.decay);
    expect(s.strains[0]?.attraction[0]).toBe(1);
    expect(toJones({ ...three, strains: one({ attraction: [-0.7, 1, 0, 0] }) }).strains[0]?.attraction[0]).toBe(-1);
  });

  it('turns a Jones model without the rule into the extended model', () => {
    const s = jonesLink();
    expect(constrain({ ...s, collisions: false }).model).toBe('extended');
  });
});

describe('strainLike (Add strain)', () => {
  const first = (id: string) => {
    const a = presetById(id)?.settings().strains[0];
    if (!a) throw new Error(`no preset ${id}`);
    return a;
  };

  it('copies the numbers of strain A and takes the color of its slot', () => {
    const a = first('three-strains');
    const d = strainLike(a, 3);
    expect({ ...d, color: a.color, attraction: a.attraction }).toEqual(a);
    expect(d.color).toBe('#9b7fe6');
  });

  it('weighs the trails as strain A does, while the other strains keep their weight for its slot', () => {
    // A follows itself and flees the others with −0.7; the new strain does the same.
    expect(strainLike(first('three-strains'), 3).attraction).toEqual([-0.7, -0.7, -0.7, 1]);
    // Two strains: A ignores slot 2, so a third strain ignores A and B and follows itself.
    expect(strainLike(first('two-strains'), 2).attraction).toEqual([0, 0, 1, 0]);
    // Jones' single strain: A flees every other slot (−1), as a new strain then flees A.
    expect(strainLike(first('network'), 1).attraction).toEqual([-1, 1, -1, -1]);
    // Chemorepulsion: a new strain flees its own trail too and ignores A, as A ignores it.
    expect(strainLike(first('spots'), 1).attraction).toEqual([0, -1, 0, 0]);
    // Fogleman: each strain flees all others with its own factor. A third strain copies A's factor 1.45,
    // while B keeps fleeing it with its own 0.46.
    expect(strainLike(first('cyclones'), 2).attraction).toEqual([-1.4512, -1.4512, 1, -1.4512]);
    expect(presetById('cyclones')?.settings().strains[1]?.attraction[2]).toBe(-0.46232897);
  });
});

describe('snap and fieldText (sliders and their number fields)', () => {
  const { density, decay, speed } = { ...globalSpec, ...strainSpec };

  it('keep 3 significant digits on a log range, so small values stay what they are', () => {
    expect(snap(0.012, density)).toBe(0.012); // the step of 0.01 would give 0.01
    expect(fieldText(0.012, density)).toBe('0.012');
    expect(snap(0.012345, density)).toBe(0.0123);
    expect([3, 0.15, 8].map((v) => fieldText(v, density))).toEqual(['3', '0.15', '8']);
    expect(snap(0.00012345, decay)).toBe(0.000123);
    expect(fieldText(1 - 0.29681, decay)).toBe('0.703');
    expect(snap(123.4, speed)).toBe(123);
    // Clamped to the range.
    expect(snap(0.001, density)).toBe(density.min);
    expect(snap(20, density)).toBe(density.max);
  });

  it('snap to the step on a linear range', () => {
    expect(snap(1.234, strainSpec.stepSize)).toBe(1.25);
    expect(fieldText(1, strainSpec.stepSize)).toBe('1.00');
    expect(snap(22.4, strainSpec.sensorAngle)).toBe(22.5);
    expect(fieldText(22.5, strainSpec.sensorAngle)).toBe('22.5');
  });

  it('show every preset value on a log range within rounding to 3 digits', () => {
    for (const p of PRESETS) {
      const s = p.settings();
      const pairs: [number, Spec][] = [
        [s.density, density],
        [s.scentDecay, globalSpec.scentDecay],
        [s.speed, speed],
        ...s.strains.map((st): [number, Spec] => [st.decay, decay]),
      ];
      for (const [v, spec] of pairs) {
        expect(Math.abs(Number(fieldText(v, spec)) - v) / v, `${p.id} ${spec.label}`).toBeLessThan(0.005);
        expect(snap(snap(v, spec), spec), `${p.id} ${spec.label}`).toBe(snap(v, spec));
      }
    }
  });
});
