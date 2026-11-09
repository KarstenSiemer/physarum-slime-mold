import { describe, expect, it } from 'vitest';
import {
  attractionSpec,
  defaultSettings,
  globalSpec,
  MAX_STRAINS,
  sanitize,
  strainLike,
  strainSpec,
  type Settings,
  type Spec,
} from './params';
import { presetById } from './presets';

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
      const keys = [...Object.keys(globalSpec), ...Object.keys(strainSpec), 'strains', 'attraction', 'color', 'seed'];
      return Object.fromEntries(keys.map((k) => [k, value(depth + 1)]));
    };
    for (let i = 0; i < 500; i++) expect(() => sanitize(value(0))).not.toThrow();
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
