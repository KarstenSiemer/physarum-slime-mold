import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, globalSpec, strainSpec, type Settings } from '../model/params';
import { FLOW, packFlow, STEPS_PER_MINUTE, trailLevels } from './flow';
import { PARAM_SLOTS, packParams } from './pack';
import { NO_SITES } from './sites';
import {
  NO_STAMP,
  PLASM_SPAN,
  plasmLevels,
  SLIME_FULL,
  SLIME_RIM,
  slimeModel,
  slimeShown,
  slimeSteps,
  stampOf,
  STEPS_PER_HOUR,
} from './slime';
import { SLIME_BEADS, SLIME_RIPPLE, SLIME_WAVES } from './slime-reference';

// ADR 0055: the slime field. One field for all strains, with the stamp of each cell.
describe('the slime field (ADR 0055)', () => {
  const two = [
    { ...defaultStrain(0, 2), deposit: 5, decay: 0.1 },
    { ...defaultStrain(1, 2), deposit: 2, decay: 0.6 },
  ];

  it('counts an hour of model time as 1,800 steps, with the flow and without it', () => {
    expect(STEPS_PER_MINUTE).toBe(30);
    expect(STEPS_PER_HOUR).toBe(1800);
  });

  it('has a life time in steps in the extended model, and none in the Jones model or at 0', () => {
    const d = defaultSettings();
    expect([d.model, d.slimeLife]).toEqual(['extended', 144]);
    // 6 days of 24 hours of 1,800 steps.
    expect(slimeSteps(d)).toBe(259_200);
    expect(slimeSteps({ ...d, slimeLife: 18 })).toBe(32_400);
    expect(slimeSteps({ ...d, slimeLife: globalSpec.slimeLife.max })).toBe(432_000);
    expect(slimeSteps({ ...d, slimeLife: 1 })).toBe(1800);
    expect(slimeSteps({ ...d, slimeLife: 0 })).toBe(0);
    expect(slimeSteps({ ...d, model: 'jones' })).toBe(0);
    // A whole number of steps for a time that is no whole number of hours, as a test or a link past sanitize() has it.
    expect(slimeSteps({ ...d, slimeLife: 0.5 })).toBe(900);
    expect(slimeSteps({ ...d, slimeLife: 3 / 1800 })).toBe(3);
    expect(slimeSteps({ ...d, slimeLife: -5 })).toBe(0);
  });

  it('is a field of the extended model, with a life time above 0 or with 0', () => {
    expect(slimeModel({ model: 'extended' })).toBe(true);
    expect(slimeModel({ model: 'jones' })).toBe(false);
    const none: Settings = { ...defaultSettings(), slimeLife: 0 };
    expect(slimeModel(none)).toBe(true);
  });

  // Decision 8: the view draws the slime while the model has slime and the switch is on. The scent view draws none.
  it('is drawn in every style while the model has slime and Show slime is on, and never below the scent view', () => {
    const d = defaultSettings();
    expect([d.showSlime, d.showScent]).toEqual([true, false]);
    const shown = (patch: Partial<Settings>) => slimeShown({ ...d, ...patch });
    for (const style of ['glow', 'gel', 'paper', 'agents'] as const) expect(shown({ style })).toBe(true);
    expect(slimeShown({ ...d, showSlime: false })).toBe(false);
    expect(slimeShown({ ...d, slimeLife: 0 })).toBe(false);
    expect(slimeShown({ ...d, model: 'jones' })).toBe(false);
    expect(slimeShown({ ...d, showScent: true })).toBe(false);
    // The flow is no part of it: the slime does not need the flow.
    expect([shown({ flow: true }), shown({ flow: false })]).toEqual([true, true]);
  });

  it('holds 0 for a cell without a stamp, and the number of the step plus 1 for a stamp', () => {
    expect(NO_STAMP).toBe(0);
    // The first step of a run has the number 0: its stamp is not the value of a cell without one.
    expect(stampOf(0)).toBe(1);
    expect(stampOf(259_199)).toBe(259_200);
    expect(stampOf(2 ** 32 - 2)).toBe(2 ** 32 - 1);
  });

  it('takes the low level of the trail of each strain as the level from which a cell holds plasm', () => {
    for (const stepOrder of ['sense-first', 'move-first'] as const) {
      const levels = plasmLevels({ strains: two, stepOrder });
      expect(levels).toEqual(two.map((strain) => trailLevels(strain, stepOrder)[0]));
      expect(levels.length).toBe(2);
    }
    // At Jones' decay of 0.1 the level is 0.2 deposits; the trail of a strain that decays faster stays weaker.
    const [a, b] = plasmLevels({ strains: two, stepOrder: 'sense-first' });
    expect(a).toBeCloseTo(FLOW.trailLow * 5, 12);
    expect(b).toBeCloseTo((FLOW.trailLow * 2 * (0.4 / 0.6)) / 9, 12);
    // At most the four strains that a simulation runs.
    const many = Array.from({ length: 6 }, (_, i) => defaultStrain(i));
    expect(plasmLevels({ strains: many, stepOrder: 'sense-first' }).length).toBe(4);
  });

  it('keeps every level above 0 as a 32-bit float, so a cell without trail never holds plasm', () => {
    // The pass has no test of its own for a wall and for a cell outside the arena: the diffusion leaves a trail of 0
    // there (slime.wgsl). The lowest level: no deposit, and the fastest decay.
    for (const stepOrder of ['sense-first', 'move-first'] as const)
      for (const deposit of [strainSpec.deposit.min, 0.5, strainSpec.deposit.max])
        for (const decay of [0, strainSpec.decay.min, 0.1, strainSpec.decay.max, 1]) {
          const [level] = plasmLevels({ strains: [{ ...defaultStrain(0), deposit, decay }], stepOrder });
          expect(Math.fround(level ?? 0), `${stepOrder}, deposit ${deposit}, decay ${decay}`).toBeGreaterThan(0);
        }
  });
});

// The parameters of the passes (pack.ts packParams()): the two slots of the slime field.
describe('the slime field in the parameters of the passes', () => {
  const rt = { width: 8, height: 8, agents: 1, step: 7 };
  const lane = (name: (typeof PARAM_SLOTS)[number]) => {
    const i = PARAM_SLOTS.indexOf(name);
    return (i > PARAM_SLOTS.indexOf('attraction') ? i + 3 : i) * 4;
  };
  const low = (s: Settings) => [...new Float32Array(packParams(s, rt)).slice(lane('slimeLow'), lane('slimeLow') + 4)];
  const life = (s: Settings) => [...new Uint32Array(packParams(s, rt)).slice(lane('slime'), lane('slime') + 4)];
  const two = (stepOrder: Settings['stepOrder']): Settings => ({
    ...defaultSettings(),
    stepOrder,
    strains: [
      { ...defaultStrain(0, 2), deposit: 5, decay: 0.1 },
      { ...defaultStrain(1, 2), deposit: 2, decay: 0.6 },
    ],
  });

  it('come after every slot of the code before, so no pass of the code before reads another value', () => {
    expect(PARAM_SLOTS.slice(-3)).toEqual(['electrode', 'slimeLow', 'slime']);
    expect([lane('electrode'), lane('slimeLow'), lane('slime')]).toEqual([24 * 4, 25 * 4, 26 * 4]);
  });

  it('hold the level of each strain of the settings, and 0 for a strain that they do not hold', () => {
    for (const stepOrder of ['sense-first', 'move-first'] as const) {
      const s = two(stepOrder);
      const levels = s.strains.map((strain) => Math.fround(trailLevels(strain, stepOrder)[0]));
      expect(low(s)).toEqual([...levels, 0, 0]);
      // The level from which the tube body of the strain grows: the passes of the flow get the same number.
      s.strains.forEach((_, strain) => {
        expect(low(s)[strain]).toBe(new Float32Array(packFlow(s, NO_SITES, undefined, strain))[13]);
      });
    }
    expect(low(two('sense-first'))).not.toEqual(low(two('move-first')));
    // Jones' agent of the default settings: 0.2 of its deposit of 5.
    expect(low(defaultSettings())).toEqual([1, 0, 0, 0]);
  });

  it('hold the life time in steps, and 0 in the Jones model and for a life time of 0', () => {
    const d = defaultSettings();
    expect(life(d)).toEqual([259_200, 0, 0, 0]);
    expect(life({ ...d, slimeLife: 18 })).toEqual([32_400, 0, 0, 0]);
    expect(life({ ...d, slimeLife: 0 })).toEqual([0, 0, 0, 0]);
    expect(life({ ...d, model: 'jones', collisions: true })).toEqual([0, 0, 0, 0]);
  });

  it('leave every other value of the parameters as it is', () => {
    const d = defaultSettings();
    const bytes = (s: Settings) => new Uint8Array(packParams(s, rt)).slice(0, lane('slimeLow') * 4);
    expect(bytes({ ...d, slimeLife: 0 })).toEqual(bytes(d));
    expect(bytes({ ...d, slimeLife: 18 })).toEqual(bytes(d));
  });
});

// ADR 0057: the passes of the amount of slime and of its film hold the numbers of slime.ts as constants of their own,
// and the two backends hold the same numbers of the film.
describe('the numbers of the slime in the passes', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  /** The constant `name` of a pass: `const NAME = 4.0;` in WGSL, `const float NAME = 4.0;` in GLSL. */
  const constant = (path: string, name: string) => {
    const found = [...read(path).matchAll(new RegExp(`^const (?:float |uint )?${name} = ([0-9.]+)u?;`, 'gm'))];
    if (found.length !== 1) throw new Error(`Not one constant ${name} in ${path}`);
    return Number(found[0]?.[1]);
  };
  /** The text of the function `name` of a pass, from its first line to its closing brace. */
  const body = (path: string, name: string) => {
    const start = `^(?:fn |\\w+ )${name}\\([^\\n]*\\{`;
    const found = new RegExp(`${start}(?:[^\\n]*\\}\\n|\\n[\\s\\S]*?\\n\\}\\n)`, 'm').exec(read(path));
    if (!found) throw new Error(`No function ${name} in ${path}`);
    return found[0];
  };
  /** The numbers in a text without its comments, in their order; not the digits in names such as vec3f and k1. */
  const numbers = (text: string) =>
    [...text.replace(/\/\/[^\n]*/g, '').matchAll(/(?<![\w.])(0x[0-9a-f]+|\d+(?:\.\d+)?)u?(?![\w.])/g)].map((m) =>
      Number(m[1]),
    );

  it('hold the full amount of slime of a cell: 4,095', () => {
    for (const path of ['./shaders/amount.wgsl', './gl/glsl/amount.glsl'])
      expect(constant(path, 'FULL'), path).toBe(SLIME_FULL);
    for (const path of ['./shaders/render.wgsl', './gl/glsl/slime-film.frag'])
      expect(constant(path, 'SLIME_FULL'), path).toBe(SLIME_FULL);
    expect(SLIME_FULL).toBe(4095);
  });

  it('hold the trail above the low level of a strain at which the plasm of a cell is full: 4 low levels', () => {
    for (const path of ['./shaders/slime.wgsl', './gl/glsl/slime.frag'])
      expect(constant(path, 'SPAN'), path).toBeCloseTo(PLASM_SPAN, 12);
    // The full level of the tube body over its low level, less 1: 1 / 0.2 − 1.
    expect(PLASM_SPAN).toBeCloseTo(FLOW.trailFull / FLOW.trailLow - 1, 12);
    expect(PLASM_SPAN).toBeCloseTo(4, 12);
  });

  it('hold the rim of a stroke of the Slime tool: 4 cells', () => {
    for (const path of ['./shaders/slime-paint.wgsl', './gl/glsl/slime-paint.frag'])
      expect(constant(path, 'RIM'), path).toBe(SLIME_RIM);
    expect(SLIME_RIM).toBe(4);
  });

  it('hold the same steps of the waves and of the beads and the same ripple on both backends', () => {
    for (const [name, value] of [
      ['SLIME_WAVES', SLIME_WAVES],
      ['SLIME_BEADS', SLIME_BEADS],
      ['SLIME_RIPPLE', SLIME_RIPPLE],
    ] as const) {
      const [wgsl, glsl] = [constant('./shaders/render.wgsl', name), constant('./gl/glsl/render.frag', name)];
      expect(wgsl, name).toBe(glsl);
      // The CPU reference holds them too (slime-reference.ts).
      expect(wgsl, name).toBe(value);
    }
    // A step of a lattice is a whole number of cells: the passes count the steps of a side in whole numbers.
    expect([SLIME_WAVES, SLIME_BEADS].every(Number.isInteger)).toBe(true);
  });

  // The rules of the film are written twice, in WGSL and in GLSL. The numbers in each rule are the same, in the same
  // order: the GPU tests compare the pictures, and this names the rule when a number of one backend changes alone.
  // Not for `filmOf` and `filmAt`: they hold no numbers of the look, and the two languages write them apart.
  it.each([
    'slimeOf',
    'patternSteps',
    'noiseSlope',
    'slimeWaves',
    'slimeBeads',
    'wetShine',
    'slimed',
    'lattice',
    'spline',
    'splineSlope',
  ])('have the same numbers in %s on both backends', (name) => {
    const glsl = name === 'slimeOf' ? './gl/glsl/slime-film.frag' : './gl/glsl/render.frag';
    const [a, b] = [numbers(body('./shaders/render.wgsl', name)), numbers(body(glsl, name))];
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('reads the numbers of a rule: those of the hash of the patterns, and of the light', () => {
    expect(numbers(body('./shaders/render.wgsl', 'lattice'))).toEqual([
      1664525, 1013904223, 16, 0x7feb352d, 15, 0x846ca68b, 16, 8, 1, 16777216,
    ]);
    expect(numbers(body('./gl/glsl/render.frag', 'wetShine'))).toEqual([0, 0, 1, 0, 110, 10, 10]);
  });
});
