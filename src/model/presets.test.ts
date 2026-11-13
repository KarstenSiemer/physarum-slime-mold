import { describe, expect, it } from 'vitest';
import { constrain, defaultSettings, jonesFits, MAX_STRAINS, sanitize, type Settings } from './params';
import {
  GROUPS,
  latticeLostNotice,
  latticeNotice,
  latticeText,
  PRESETS,
  presetById,
  RULE_MISSING_NOTICE,
  ruleOffNotice,
  sourceKind,
  sourceText,
  START,
  stepOrderOf,
  usesRule,
  type Preset,
} from './presets';

const preset = (id: string): Preset => {
  const p = presetById(id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
};
const settingsOf = (id: string): Settings => preset(id).settings();
const texts = (p: Preset) => [p.summary, p.about, p.why, p.watch ?? '', ...p.strainRoles, sourceText(p)];
const rad = (deg: number) => (deg * Math.PI) / 180;

describe('presets', () => {
  it('have unique ids and names', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s survives sanitize() unchanged', (_, p) => {
    const s = p.settings();
    expect(sanitize(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(constrain(s)).toBe(s);
  });

  // Owner decision 2026-11-11 (ADR 0022): a scene from one of Jones' papers runs on the Jones model, every other scene
  // on the extended model. Every scene keeps the bytes of the code before the model switch: covered food off, no
  // trail saturation and scent decay 0.1, where the extended model releases the scent of the Jones model.
  it('run on the Jones model if they come from Jones’ papers, else on the extended model', () => {
    const fromJones = ['network', 'hexagons', 'spots', 'stripes', 'shortest-path', 'steiner', 'shrinking', 'wound'];
    for (const p of PRESETS) {
      const s = p.settings();
      const jones = fromJones.includes(p.id);
      expect(p.source.startsWith('Jones'), p.id).toBe(jones);
      expect(s.model, p.id).toBe(jones ? 'jones' : 'extended');
      if (jones) expect(jonesFits(s), p.id).toBe(true);
      // No scene of Jones paints light: his papers have no light that releases a repellent.
      if (jones) expect(p.env?.some((e) => e.kind === 'light') ?? false, p.id).toBe(false);
      expect([s.coveredFood, s.trailSaturation, s.scentDecay], p.id).toEqual([false, 0, 0.1]);
    }
    expect(defaultSettings().model).toBe('extended');
  });

  it('sit in the four groups, in group order, with the start scene under Start here', () => {
    const order = GROUPS.map((g) => g.id);
    for (const g of order)
      expect(
        PRESETS.some((p) => p.group === g),
        g,
      ).toBe(true);
    const ranks = PRESETS.map((p) => order.indexOf(p.group));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(preset(START).group).toBe('start');
    for (const p of PRESETS.filter((x) => x.group === 'jones')) expect(p.source).toMatch(/^Jones 2010, Fig\. /);
    for (const p of PRESETS.filter((x) => x.group === 'fogleman')) expect(p.source).toBe('Fogleman 2020');
  });

  it('Jones scenes run with one agent per cell and a density of at most 1', () => {
    const jones = PRESETS.filter((p) => sourceKind(p) === 'jones');
    expect(jones.map((p) => p.id)).toEqual([
      'network',
      'hexagons',
      'spots',
      'stripes',
      'shortest-path',
      'steiner',
      'shrinking',
      'wound',
    ]);
    for (const p of jones) {
      const s = p.settings();
      expect(s.collisions, p.id).toBe(true);
      expect(s.density, p.id).toBeLessThanOrEqual(1);
    }
    // Fleeing light, the mazes and Tokyo use Jones' agents too; usesRule() marks every scene made for the rule.
    expect(PRESETS.filter(usesRule).map((p) => p.id)).toEqual([
      ...jones.map((p) => p.id),
      'light',
      'maze',
      'foraging-maze',
      'tokyo',
    ]);
  });

  it('keep the parameters of Jones 2010 (Table 1 p. 134, Fig. 4 p. 135 to Fig. 22 p. 148)', () => {
    // Shared by every figure: depT 5, decayT 0.1, SS 1, pCD 0, one diffusion pass.
    for (const p of PRESETS.filter((x) => sourceKind(x) === 'jones')) {
      const s = p.settings();
      const a = s.strains[0];
      expect(s.strains, p.id).toHaveLength(1);
      expect([a?.deposit, a?.decay, a?.stepSize, a?.randomTurn, s.diffusion], p.id).toEqual([5, 0.1, 1, 0, 1]);
    }
    const expected: Record<string, [sa: number, ra: number, so: number, pct: number, self: number]> = {
      network: [22.5, 45, 9, 15, 1], // Fig. 4
      hexagons: [45, 45, 9, 15, 1], // Fig. 5
      spots: [45, 45, 40, 20, -1], // Fig. 16 top
      stripes: [112.5, 67.5, 13, 20, -1], // Fig. 16 bottom
      'shortest-path': [45, 45, 9, 2, 1], // Fig. 18
      steiner: [45, 45, 9, 2, 1], // Fig. 19
      shrinking: [45, 45, 9, 50, 1], // Fig. 21
      wound: [45, 45, 27, 10, -1], // Fig. 22
    };
    for (const [id, [sa, ra, so, pct, self]] of Object.entries(expected)) {
      const s = settingsOf(id);
      const a = s.strains[0];
      expect([a?.sensorAngle, a?.rotationAngle, a?.sensorOffset, a?.attraction[0]], id).toEqual([sa, ra, so, self]);
      expect(s.density * 100, id).toBeCloseTo(pct, 9);
    }
    expect(settingsOf('shortest-path').foodStrength).toBe(0.01); // wProj, Fig. 18
    expect(settingsOf('steiner').foodStrength).toBe(0.01); // Fig. 19
    expect(settingsOf('shrinking').shrink).toBe(0.00025); // p. 147
    for (const id of ['shortest-path', 'steiner', 'shrinking']) expect(settingsOf(id).boundary).toBe('dish');
    for (const id of ['network', 'hexagons', 'spots', 'stripes', 'wound']) expect(settingsOf(id).boundary).toBe('wrap');
  });

  // Owner decision 2026-11-11 (ADR 0024 decision 3, ADR 0026): a scene of Jones' papers runs on the lattice of its
  // figure, the app's scenes on a grid shaped like the screen. The lattices are in the captions of Jones 2010. The map
  // of Tokyo runs on a square lattice: a grid shaped like a tall screen would turn it, and north stays up (ADR 0024
  // decision 4, ADR 0029).
  it('run each scene of Jones on the lattice of its figure, and the app’s scenes on a grid shaped like the screen', () => {
    const lattices: Record<string, [number, number]> = {
      tokyo: [512, 512], // this app's choice (ADR 0029)
      network: [200, 200], // Fig. 4, p. 135
      hexagons: [200, 200], // Fig. 5, p. 136
      spots: [200, 200], // Fig. 16 top, p. 144
      stripes: [200, 200], // Fig. 16 bottom, p. 144
      'shortest-path': [200, 200], // Fig. 18, p. 145
      steiner: [200, 200], // Fig. 19, p. 146
      shrinking: [300, 300], // Fig. 21, p. 147
      wound: [300, 300], // Fig. 22, p. 148
    };
    for (const p of PRESETS) expect(p.settings().lattice, p.id).toEqual(lattices[p.id] ?? null);
    expect(defaultSettings().lattice).toBeNull();
    // Each call gives its own array: a change to the settings of one load cannot reach the next.
    expect(settingsOf('network').lattice).not.toBe(settingsOf('network').lattice);
    // On a device that cannot hold the lattice, a scene of Jones gets 512 cells on the long side (Engine.fit()).
    for (const id of Object.keys(lattices)) expect(settingsOf(id).resolution, id).toBe(512);
    // Without glow the holes of the networks stay dark (decided 2026-11-09).
    for (const id of ['network', 'hexagons']) expect(settingsOf(id).bloom, id).toBe(0);
    for (const id of ['spots', 'stripes', 'shrinking', 'wound', 'light', 'maze']) {
      expect(settingsOf(id).resolution, id).toBe(512);
      expect(settingsOf(id).bloom, id).toBe(1);
    }
    // Jones' %p 50 on 300 × 300 is 45,000 agents (p. 147); the dish counts the square around it (sizing.ts).
    const sh = settingsOf('shrinking');
    expect(Math.round(sh.density * (sh.lattice?.[0] ?? 0) * (sh.lattice?.[1] ?? 0))).toBe(45_000);
  });

  it('name the grid and Jones’ lattice in the hint below the grid, with the words of the owner’s rule', () => {
    const nb = (t: string) => t.replaceAll(' ', '\u00a0');
    const text = latticeNotice([300, 300], { lattice: null, resolution: 512 });
    expect(text).toContain('This grid has 512 cells on the long side.');
    expect(text).toContain(`For this figure, Jones used ${nb('300 × 300')} cells.`);
    expect(text).toContain('lengths in cells');
    // The panel's names, and what another grid does: the pattern keeps its size in cells (ADR 0026, measurements).
    expect(text).toContain('Sensor distance and Step size');
    expect(text).toContain('the pattern keeps its size in cells');
    expect(text).toContain('different from the paper');
    expect(text).not.toMatch(/scale|changed/);
    expect(latticeNotice([200, 200], { lattice: [300, 300], resolution: 512 })).toContain(
      `This grid has ${nb('300 × 300')} cells.`,
    );
    // No-break spaces keep "200 × 200" on one line.
    expect(latticeText([200, 200])).toBe(`${nb('200 × 200')} cells`);
    expect(latticeLostNotice([300, 300], { lattice: null, resolution: 256 })).toBe(
      `This device cannot hold Jones’ grid of ${nb('300 × 300')} cells for this figure. The scene runs on a grid of 256 cells on the long side, so the result can be different from the paper.`,
    );
    // ASD-STE100: at most 20 words in a sentence of a procedure, 25 in a description.
    for (const sentence of text.split(/(?<=\.)\s+/))
      expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
    expect(text).not.toMatch(/—/);
  });

  // ADR 0027 (owner, 2026-11-12, "Ja, je Paper"): each scene runs the order of a step of its paper.
  it('run the scenes of Jones 2010 moving first, and every other scene sensing first', () => {
    const jones2010 = ['network', 'hexagons', 'spots', 'stripes', 'shortest-path', 'steiner', 'shrinking', 'wound'];
    expect(PRESETS.filter((p) => p.source.startsWith('Jones 2010')).map((p) => p.id)).toEqual(jones2010);
    for (const p of PRESETS) {
      const order = jones2010.includes(p.id) ? 'move-first' : 'sense-first';
      expect(p.settings().stepOrder, p.id).toBe(order);
      expect(stepOrderOf(p.id), p.id).toBe(order);
    }
    expect(stepOrderOf('')).toBe('sense-first');
    expect(stepOrderOf('no-such-scene')).toBe('sense-first');
    expect(stepOrderOf(undefined)).toBe('sense-first');
  });

  it('copy the Fogleman presets exactly (cmd/viewer/main.go:31–42, commit 62342a2)', () => {
    // Rows as printed by his PrintConfigs: agents per cell per species, SA (rad), SD, RA (rad), step,
    // deposit, kept fraction, repulsion factor. Written out here because his repository is not in CI.
    const main: Record<string, number[][]> = {
      cyclones: [
        [4, 0.87946403, 42.838207, 0.97047323, 2.8447638, 5, 0.29681, 1.4512],
        [4, 1.7357124, 17.430664, 0.30490428, 2.1706762, 5, 0.27878627, 0.46232897],
      ],
      dunes: [
        [2, 0.99931663, 44.21652, 1.9704952, 1.4215798, 5, 0.1580779, 0.7574965],
        [2, 1.9694986, 1.294038, 0.5384646, 1.1613986, 5, 0.21102181, 1.5123861],
      ],
      'dot-grid': [
        [1.3333334, 1.3433642, 49.39263, 0.91616887, 0.69644034, 5, 0.17888786, 0.2036435],
        [1.3333334, 0.0856143, 1.6695175, 1.8827246, 2.3155663, 5, 0.14249614, 0.0026361942],
        [1.3333334, 0.7959472, 33.977413, 0.5246451, 2.2891424, 5, 0.22549233, 1.4248871],
      ],
    };
    for (const [id, rows] of Object.entries(main)) {
      const s = settingsOf(id);
      expect([s.diffusion, s.layout, s.collisions, s.resolution], id).toEqual([2, 'mixed', false, 1024]);
      expect(s.strains, id).toHaveLength(rows.length);
      expect(s.density, id).toBeCloseTo(
        rows.reduce((a, r) => a + (r[0] ?? 0), 0),
        6,
      );
      rows.forEach(([, sa = 0, sd = 0, ra = 0, step = 0, deposit = 0, keep = 0, r = 0], i) => {
        const st = s.strains[i];
        if (!st) throw new Error(`${id}: no strain ${i}`);
        expect(rad(st.sensorAngle), `${id} ${i} SA`).toBeCloseTo(sa, 9);
        expect(st.sensorOffset, `${id} ${i} SD`).toBe(sd);
        expect(rad(st.rotationAngle), `${id} ${i} RA`).toBeCloseTo(ra, 9);
        expect(st.stepSize, `${id} ${i} step`).toBe(step);
        expect(st.deposit, `${id} ${i} deposit`).toBe(deposit);
        expect(st.decay, `${id} ${i} decay`).toBeCloseTo(1 - keep, 9);
        expect(st.attraction, `${id} ${i} row`).toEqual(
          Array.from({ length: MAX_STRAINS }, (_, j) => (j === i ? 1 : -r)),
        );
      });
    }
  });

  it('give Steiner Jones’ population and four food sources at the corners of a square', () => {
    const p = preset('steiner');
    // Agents for 2 % of the square around the dish (sizing.ts agentCount), as Jones counts %p (Fig. 19, p. 146).
    expect(p.settings().density).toBe(0.02);
    const foods = p.env?.filter((e) => e.kind === 'food') ?? [];
    expect(foods).toHaveLength(4);
    // In the canonical frame (engine/environment.ts), so a square on every screen.
    const side = Math.abs(foods[0]?.at[0] ?? 0);
    for (const f of foods) expect(f.at.map(Math.abs)).toEqual([side, side]);
    expect(p.about).toMatch(/corners of a square/);
    // The foods of Fig. 19 (ADR 0027): a square of 60 cells on 200 × 200, foods of 2.7 cells. On Jones' lattice the
    // network ends as a tree in 20 of 20 runs from step 6,000, as in the figure.
    for (const f of foods) expect([...f.at.map(Math.abs), f.r * 200]).toEqual([0.15, 0.15, 2.7]);
    expect(p.watch).toMatch(
      /a tree through the middle of the square: two three-way junctions joined by a short bridge/,
    );
    expect(p.watch).not.toMatch(/ring/);
  });

  it('have one strain role per strain', () => {
    for (const p of PRESETS) expect(p.strainRoles, p.id).toHaveLength(p.settings().strains.length);
  });

  it('keep their texts short and in the repository style', () => {
    for (const p of PRESETS) {
      expect(p.name.length, p.id).toBeLessThanOrEqual(20); // fits the scene name over the canvas
      expect(p.summary.length, p.id).toBeLessThanOrEqual(90);
      expect(p.about.length, p.id).toBeLessThanOrEqual(420);
      expect(p.why.length, p.id).toBeLessThanOrEqual(420);
      expect((p.watch ?? '').length, p.id).toBeLessThanOrEqual(300);
      expect(sourceText(p).length, p.id).toBeLessThanOrEqual(400);
      for (const r of p.strainRoles) expect(r.length, p.id).toBeLessThanOrEqual(60);
      const sentences = p.about.split(/(?<=[.!?])\s+(?=[A-Z“])/).length;
      expect(sentences, `${p.id}: sentences in about`).toBeGreaterThanOrEqual(2);
      expect(sentences, `${p.id}: sentences in about`).toBeLessThanOrEqual(4);
      expect(p.watch !== undefined, p.id).toBe(p.group === 'experiments');
      for (const t of [...texts(p), ruleOffNotice(p)]) expect(t, p.id).not.toMatch(/—/);
    }
    expect(RULE_MISSING_NOTICE).not.toMatch(/—/);
  });

  it('only mention numbers that match the settings', () => {
    const num = (s: string) => Number(s.replaceAll(',', ''));
    const words: Record<string, number> = { one: 1, two: 2, three: 3 };
    for (const p of PRESETS) {
      const s = p.settings();
      const text = texts(p).join(' ');
      const all = (re: RegExp) => [...text.matchAll(re)].map((m) => m[1] ?? '');
      const strains = (key: 'sensorOffset' | 'decay') => s.strains.map((st) => st[key]);
      for (const v of all(/(\d+(?:\.\d+)?) % of cells hold/g)) expect(num(v) / 100, p.id).toBeCloseTo(s.density, 9);
      for (const v of all(/as many agents as (\d+(?:\.\d+)?) % of the square around the dish/g)) {
        expect(num(v) / 100, p.id).toBeCloseTo(s.density, 9);
        expect(s.boundary, p.id).toBe('dish');
      }
      for (const v of all(/(\d+(?:\.\d+)?) agents per cell(?! per strain)/g)) expect(num(v), p.id).toBe(s.density);
      for (const v of all(/(\d+(?:\.\d+)?) agents per cell per strain/g))
        expect(num(v), p.id).toBeCloseTo(s.density / s.strains.length, 2);
      for (const v of all(/\b(one|two|three) blur pass/g)) expect(words[v], p.id).toBe(s.diffusion);
      for (const v of all(/[Ff]ood weight (\d+(?:\.\d+)?)/g)) expect(num(v), p.id).toBe(s.foodStrength);
      for (const v of all(/(?:removal chance|shrinkage) of (\d+(?:\.\d+)?)/g)) expect(num(v), p.id).toBe(s.shrink);
      for (const v of all(/repellent with strength (\d+(?:\.\d+)?)/g)) expect(num(v), p.id).toBe(s.lightStrength);
      for (const v of all(/[Ss]ensor distance (\d+(?:\.\d+)?)/g))
        expect(strains('sensorOffset'), p.id).toContain(num(v));
      for (const v of all(/[Dd]ecay (\d+(?:\.\d+)?)/g)) expect(strains('decay'), p.id).toContain(num(v));
      for (const v of all(/[Gg]rid (\d+)\b(?! ×)/g)) expect(num(v), p.id).toBe(s.resolution);
      for (const [, w = '', h = ''] of text.matchAll(/(\d+)\s×\s(\d+) cells/g))
        expect([num(w), num(h)], p.id).toEqual(s.lattice);
      for (const v of all(/weight of −(\d+(?:\.\d+)?) on the other strain/g))
        expect(s.strains[0]?.attraction[1], p.id).toBe(-num(v));
      for (const v of all(/sensor and rotation angle (\d+(?:\.\d+)?)°/g)) {
        expect(s.strains[0]?.sensorAngle, p.id).toBe(num(v));
        expect(s.strains[0]?.rotationAngle, p.id).toBe(num(v));
      }
      for (const v of all(/sensor angle raised to (\d+(?:\.\d+)?)°, equal to the rotation angle/g)) {
        expect(s.strains[0]?.sensorAngle, p.id).toBe(num(v));
        expect(s.strains[0]?.rotationAngle, p.id).toBe(num(v));
      }
      // Half-life of the population under shrinkage, rounded to 100 steps.
      for (const v of all(/half of them within about ([\d,]+) steps/g))
        expect(num(v), p.id).toBe(Math.round(Math.log(0.5) / Math.log(1 - s.shrink) / 100) * 100);
    }
  });

  it('name the figure of the paper in the Jones source text', () => {
    expect(sourceText(preset('network'))).toContain('Fig. 4 of the paper');
    expect(sourceText(preset('spots'))).toContain('Fig. 16 (top) of the paper');
    expect(sourceKind(preset('maze'))).toBe('nakagaki');
    expect(sourceKind(preset('light'))).toBe('app');
    expect(sourceKind(preset('dunes'))).toBe('fogleman');
  });

  it('warn about the collapse only where the strain follows its own trail', () => {
    expect(ruleOffNotice(preset('network'))).toMatch(/straight lines/);
    expect(ruleOffNotice(preset('steiner'))).toMatch(/straight lines/);
    for (const id of ['spots', 'stripes', 'wound']) expect(ruleOffNotice(preset(id)), id).not.toMatch(/lines/);
  });
});
