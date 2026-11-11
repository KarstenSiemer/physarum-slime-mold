import { describe, expect, it } from 'vitest';
import { presetById } from './presets';
import { fmt, modelChanged, relations, strainNumbers } from './scene';

const settingsOf = (id: string) => {
  const p = presetById(id);
  if (!p) throw new Error(`no preset ${id}`);
  return { s: p.settings(), env: p.env ?? [] };
};

describe('fmt', () => {
  it('writes at most 3 significant digits, one decimal from 100 on, no trailing zeros', () => {
    expect([22.5, 45, 9, 1, 0.1, 112.5, 0.0001].map(fmt)).toEqual(['22.5', '45', '9', '1', '0.1', '112.5', '0.0001']);
    // Fogleman's values (presets.ts): radians in degrees, decay = 1 − kept.
    expect(fmt((0.87946403 * 180) / Math.PI)).toBe('50.4');
    expect(fmt((1.9704952 * 180) / Math.PI)).toBe('112.9');
    expect(fmt(1 - 0.22549233)).toBe('0.775');
    expect(fmt(-0.0026361942)).toBe('-0.00264');
    expect(fmt(-0)).toBe('0');
  });
});

describe('strain lines', () => {
  it('say whom a strain follows and flees, grouped by weight', () => {
    const { s } = settingsOf('three-strains');
    expect(relations(s, 0)).toBe('follows A (+1), flees B and C (−0.7)');
    expect(relations(s, 1)).toBe('follows B (+1), flees A and C (−0.7)');
    expect(relations(settingsOf('network').s, 0)).toBe('follows its own trail (+1)');
    expect(relations(settingsOf('spots').s, 0)).toBe('flees its own trail (−1)');
    expect(relations(settingsOf('cyclones').s, 1)).toBe('follows B (+1), flees A (−0.462)');
  });

  it('name zero weights as ignored', () => {
    const { s } = settingsOf('two-strains');
    const a = s.strains[0];
    if (!a) throw new Error('no strain');
    s.strains.push({ ...a, color: '#f25f5c', attraction: [0, 0, 1, 0] });
    expect(relations(s, 2)).toBe('follows C (+1), ignores A and B');
    expect(relations(s, 0)).toBe('follows A (+1), flees B (−0.6), ignores C');
  });

  it('take the numbers from the settings, with food and light only where the scene has them', () => {
    const net = settingsOf('network');
    expect(strainNumbers(net.s, 0, net.env)).toBe(
      'sensor angle 22.5°, rotation 45°, sensor distance 9, step 1, decay 0.1, follows its own trail (+1)',
    );
    const path = settingsOf('shortest-path');
    expect(strainNumbers(path.s, 0, path.env)).toMatch(/sensor angle 45°, rotation 45°, .*, food \+1$/);
    const light = settingsOf('light');
    expect(strainNumbers(light.s, 0, light.env)).toMatch(/, light avoidance \+1$/);
    // Live values: the line follows an edit.
    const strain = net.s.strains[0];
    if (!strain) throw new Error('no strain');
    strain.sensorAngle = 30;
    strain.randomTurn = 0.05;
    expect(strainNumbers(net.s, 0)).toMatch(/^sensor angle 30°, .*, random turn 0\.05, /);
  });
});

describe('modelChanged', () => {
  it('ignores the seed, the look, the speed and strain colors', () => {
    const { s } = settingsOf('three-strains');
    const again = settingsOf('three-strains').s; // settings() draws a new seed every time
    expect(again.seed === s.seed).toBe(false);
    expect(modelChanged(again, s)).toBe(false);
    const looks = { ...again, style: 'paper' as const, exposure: 1, bloom: 0.2, speed: 30 };
    looks.strains = again.strains.map((st) => ({ ...st, color: '#ffffff' }));
    expect(modelChanged(looks, s)).toBe(false);
  });

  it('notices every model parameter', () => {
    const { s: base } = settingsOf('network');
    const changed = (patch: (s: typeof base, a: (typeof base.strains)[number]) => void) => {
      const s = structuredClone(base);
      const a = s.strains[0];
      if (!a) throw new Error('no strain');
      patch(s, a);
      return modelChanged(s, base);
    };
    expect(changed(() => undefined)).toBe(false);
    expect(changed((s) => (s.density = 0.2))).toBe(true);
    expect(changed((s) => (s.collisions = false))).toBe(true);
    // The lattice sets the grid of a scene of Jones (ADR 0026): another lattice or a grid shaped like the screen is a
    // change, and the resolution on a lattice is not.
    expect(changed((s) => (s.lattice = null))).toBe(true);
    expect(changed((s) => (s.lattice = [300, 300]))).toBe(true);
    expect(changed((s) => (s.lattice = [200, 300]))).toBe(true);
    expect(changed((s) => (s.resolution = 1024))).toBe(false);
    expect(modelChanged({ ...base, lattice: null, resolution: 1024 }, { ...base, lattice: null })).toBe(true);
    expect(changed((s) => (s.boundary = 'box'))).toBe(true);
    expect(changed((s) => (s.diffusion = 2))).toBe(true);
    expect(changed((s) => (s.scentDecay = 0.01))).toBe(true);
    expect(changed((_, a) => (a.sensorOffset = 10))).toBe(true);
    expect(changed((_, a) => (a.attraction = [0.5, -1, -1, -1]))).toBe(true);
    expect(changed((s, a) => s.strains.push(structuredClone(a)))).toBe(true);
  });

  it('ignores weights on the trails of strains that do not exist, as the GPU never gets them', () => {
    const { s: base } = settingsOf('three-strains');
    const s = structuredClone(base);
    for (const st of s.strains) st.attraction[3] = -1; // Remove strain writes this into the freed slot
    expect(modelChanged(s, base)).toBe(false);
    const a = s.strains[0];
    if (!a) throw new Error('no strain');
    a.attraction[2] = 0;
    expect(modelChanged(s, base)).toBe(true);
  });
});
