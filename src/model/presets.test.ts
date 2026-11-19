import { describe, expect, it } from 'vitest';
import { dishRadius, lightByte } from '../engine/brush';
import { agentCount } from '../engine/sizing';
import { constrain, defaultSettings, jonesFits, MAX_STRAINS, meanWindowOf, sanitize, type Settings } from './params';
import {
  BAUMGARTEN_PDF,
  ELECTROTAXIS,
  GROUPS,
  figureLattice,
  JONES_PDF,
  latticeLostNotice,
  latticeNotice,
  latticeOrigin,
  latticeText,
  PRESETS,
  presetById,
  RULE_MISSING_NOTICE,
  ruleOffNotice,
  sourceKind,
  sourceText,
  START,
  stepOrderOf,
  TSUDA_PDF,
  usesRule,
  VORONOI_DOT_RADIUS,
  VORONOI_DOTS,
  VORONOI_PDF,
  VORONOI_RING,
  type Preset,
} from './presets';
import { yMaze } from './y-maze';

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
      expect(p.source.startsWith('Jones 2010'), p.id).toBe(jones);
      // The Coarsening network is the Jones model of Baumgarten, Jones and Hauser 2015 (ADR 0045), Electrotaxis that of
      // Tsuda, Jones et al. 2011 (ADR 0047), and the Voronoi diagram that of Jones and Adamatzky 2015 (ADR 0048).
      const jonesModel = jones || ['coarsening', 'electrotaxis', 'voronoi'].includes(p.id);
      expect(s.model, p.id).toBe(jonesModel ? 'jones' : 'extended');
      if (jonesModel) expect(jonesFits(s), p.id).toBe(true);
      // No scene of Jones 2010 paints a repellent: that paper has none. The Voronoi diagram paints the repellent
      // sources of Jones and Adamatzky 2015 (ADR 0044, ADR 0048).
      if (jones) expect(p.env?.some((e) => e.kind === 'light') ?? false, p.id).toBe(false);
      expect(p.env?.some((e) => e.kind === 'light') ?? false, p.id).toBe(
        ['light', 'tokyo-light', 'voronoi'].includes(p.id),
      );
      // Electrotaxis has the decay of its field, which the Jones model also gives the scent (ADR 0047).
      const decay = p.id === 'electrotaxis' ? 0.01 : 0.1;
      expect([s.coveredFood, s.trailSaturation, s.scentDecay], p.id).toEqual([false, 0, decay]);
    }
    expect(defaultSettings().model).toBe('extended');
  });

  it('sit in the five groups, in group order, with the start scene under Start here', () => {
    const order = GROUPS.map((g) => g.id);
    expect(order).toEqual(['start', 'experiments', 'jones', 'papers', 'shared']);
    for (const g of order)
      expect(
        PRESETS.some((p) => p.group === g),
        g,
      ).toBe(true);
    const ranks = PRESETS.map((p) => order.indexOf(p.group));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(preset(START).group).toBe('start');
    expect(PRESETS[0]?.id).toBe(START);
    for (const p of PRESETS.filter((x) => x.group === 'jones')) expect(p.source).toMatch(/^Jones 2010, Fig\. /);
    for (const p of PRESETS.filter((x) => sourceKind(x) === 'fogleman')) expect(p.group, p.id).toBe('shared');
  });

  // ADR 0064 (the owner's wish of 2026-11-19): the scenes of Start here and of Experiments run the same rule set, this
  // app's rules for the organism. A scene that follows the experiment of a paper keeps what its paper sets, in a group
  // of its own: the model and the values of a paper on Jones' model, and for the Maze the protocol of Nakagaki et al.
  // 2000. The scenes without the rule of one agent per cell have their group too.
  it('run each group on one rule set: the organism, the papers, or agents that share cells', () => {
    const ids = (group: string) => PRESETS.filter((p) => p.group === group).map((p) => p.id);
    expect(ids('start')).toEqual(['three-networks', 'two-networks']);
    expect(ids('experiments')).toEqual([
      'light',
      'foraging-maze',
      'snail-maze',
      'corn-maze',
      'tokyo',
      'tokyo-light',
      'food-ring',
      'rival-networks',
      'tokyo-rivals',
      'y-maze',
      'slime-everywhere',
    ]);
    expect(ids('jones')).toEqual(['network', 'hexagons', 'spots', 'stripes']);
    expect(ids('papers')).toEqual([
      'shortest-path',
      'steiner',
      'shrinking',
      'wound',
      'maze',
      'coarsening',
      'electrotaxis',
      'voronoi',
    ]);
    expect(ids('shared')).toEqual(['three-strains', 'two-strains', 'cyclones', 'dunes', 'dot-grid']);
    for (const p of PRESETS) {
      const s = p.settings();
      const organism = p.group === 'start' || p.group === 'experiments';
      // One agent per cell, growth and shrinkage, the flow in the tubes and the slime, in the extended model.
      const rules = [s.model, s.collisions, s.growth, s.flow, s.slimeLife > 0];
      if (organism) expect(rules, p.id).toEqual(['extended', true, true, true, true]);
      else expect(rules, p.id).not.toEqual(['extended', true, true, true, true]);
      if (organism) {
        // Jones' values of 2011 for growth and shrinkage, and room for the colony.
        expect([s.growthEvery, s.growthWindow, s.growthMin, s.growthMax], p.id).toEqual([3, 9, 1, 10]);
        expect([s.shrinkEvery, s.shrinkWindow, s.shrinkMin, s.shrinkMax, s.shrink], p.id).toEqual([3, 5, 0, 20, 0]);
        expect(s.capacity, p.id).toBe(0.25);
        // Jones' agent of this app's scenes: a step of 1 cell, 5 units per move, a decay of 0.1, sensors 7 cells away.
        for (const st of s.strains)
          expect([st.stepSize, st.deposit, st.decay, st.sensorOffset, st.rotationAngle], p.id).toEqual([
            1, 5, 0.1, 7, 45,
          ]);
        expect([s.diffusion, s.foodStrength], p.id).toEqual([1, 0.03]);
      }
      // The Maze follows an experiment on the organism, with this app's flow: the extended model.
      if (p.group === 'jones' || p.group === 'papers')
        expect(s.model, p.id).toBe(p.id === 'maze' ? 'extended' : 'jones');
      if (p.group === 'papers') expect(p.figure, p.id).toBeDefined();
      if (p.group === 'shared') expect([s.collisions, s.density >= 1], p.id).toEqual([false, true]);
    }
  });

  it('start with three and with two rival colonies, each on a food of its own (ADR 0064)', () => {
    const [three, two] = [preset('three-networks'), preset('two-networks')];
    for (const [p, strains, foods] of [
      [three, 3, 12],
      [two, 2, 9],
    ] as const) {
      const s = p.settings();
      expect(s.strains, p.id).toHaveLength(strains);
      expect([s.layout, s.flowStrength, s.density], p.id).toEqual(['food', 8, 0.01]);
      // Each strain follows its own trail and flees the trail of every other strain.
      s.strains.forEach((st, i) => {
        expect(st.attraction, `${p.id} ${String(i)}`).toEqual(
          Array.from({ length: MAX_STRAINS }, (_, j) => (j === i ? 1 : -1)),
        );
        expect([st.sensorAngle, st.food, st.light], p.id).toEqual([22.5, 1, 1]);
      });
      expect(p.env, p.id).toHaveLength(foods);
      expect(
        p.env?.every((e) => e.kind === 'food' && e.r === 0.014),
        p.id,
      ).toBe(true);
      expect(p.envHistory, p.id).toBeUndefined();
    }
    expect([three.settings().boundary, two.settings().boundary]).toEqual(['dish', 'box']);
    // Three strains: the first three foods are the starts, a triangle near the middle; nine more lie on a ring.
    const radius = (three.env ?? []).map((e) => Math.hypot(e.at[0], e.at[1]));
    for (const r of radius.slice(0, 3)) expect(r).toBeCloseTo(0.13, 3);
    for (const r of radius.slice(3)) expect(r).toBeCloseTo(0.33, 3);
    // The lower one is the start of strain A: the y axis points down.
    expect(three.env?.[0]?.at).toEqual([0, 0.13]);
    // Two strains: the starts are the foods at the left and at the right, and the others lie between them.
    expect((two.env ?? []).slice(0, 2).map((e) => e.at)).toEqual([
      [-0.6, 0],
      [0.6, 0],
    ]);
    for (const e of (two.env ?? []).slice(2)) expect(Math.abs(e.at[0])).toBeLessThan(0.6);
  });

  it('give Fleeing light and the Foraging maze the rules of the organism, and keep the Maze as it was (ADR 0064)', () => {
    // Fleeing light: six foods around the lamp, the start on the left one, and the lamp after the foods.
    const light = preset('light');
    expect(light.env?.map((e) => e.kind)).toEqual(['food', 'food', 'food', 'food', 'food', 'food', 'light']);
    expect(light.env?.[0]?.at).toEqual([-0.33, 0]);
    expect(light.env?.at(-1)).toEqual({ kind: 'light', at: [0, 0], r: 0.16 });
    // A link made before holds revision 0 of its shapes: the lamp alone.
    expect(light.envHistory).toEqual([[{ kind: 'light', at: [0, 0], r: 0.16 }]]);
    expect([light.settings().lightStrength, light.settings().lightGrowth, light.settings().flowStrength]).toEqual([
      0.2, 1, 2,
    ]);
    // The Maze keeps the protocol of Nakagaki et al. 2000 (ADR 0052): it starts full, with Jones' contracting agent,
    // and it does not grow. With growth its dead ends empty about eight times later (ADR 0064).
    const maze = settingsOf('maze');
    expect([maze.layout, maze.density, maze.strains[0]?.sensorAngle, maze.flowStrength]).toEqual([
      'mixed',
      0.12,
      45,
      8,
    ]);
    expect([maze.model, maze.collisions, maze.flow, maze.growth, maze.capacity, maze.shrink]).toEqual([
      'extended',
      true,
      true,
      false,
      0,
      0.0001,
    ]);
    expect(preset('maze').group).toBe('papers');
    // The Foraging maze starts as a small colony on a food, with Jones' foraging agent.
    const foraging = settingsOf('foraging-maze');
    expect([foraging.layout, foraging.density, foraging.strains[0]?.sensorAngle, foraging.flowStrength]).toEqual([
      'food',
      0.01,
      22.5,
      8,
    ]);
    // Both run in the same maze.
    const walls = (id: string) => preset(id).env?.filter((e) => e.kind === 'wall');
    expect(walls('foraging-maze')).toEqual(walls('maze'));
    expect(preset('maze').envHistory).toBeUndefined();
  });

  // ADR 0066 (the owner's wish of 2026-11-19): two scenes of Reid et al. 2012, the test beds of the avoidance of slime.
  // No rule of the app reads the slime yet (ADR 0056), and their texts say so.
  it('rebuild the Y-maze and the dish with slime everywhere of Reid et al. 2012 (ADR 0066)', () => {
    const [y, dish] = [preset('y-maze'), preset('slime-everywhere')];
    for (const p of [y, dish]) {
      expect([p.group, p.source, sourceKind(p)], p.id).toEqual(['experiments', 'Reid et al. 2012', 'reid']);
      expect([p.figure, p.envHistory], p.id).toEqual([undefined, undefined]);
      // One start spot, the first shape: the start layout Food places the colony there, not on a food.
      expect(
        p.env?.filter((e) => e.kind === 'start'),
        p.id,
      ).toHaveLength(1);
      expect([p.env?.[0]?.kind, p.env?.[0]?.r, p.settings().layout], p.id).toEqual(['start', 0, 'food']);
      expect(p.about, p.id).toMatch(/no rule yet that reads the slime/);
      expect(sourceText(p), p.id).toMatch(/No rule of the app reads the slime yet\.$/);
    }
    // The Y-maze: the settings of the Snail maze on the lattice of the layout of ADR 0056, as y-maze.gpu.test.ts ran it.
    const unseeded = (s: Settings) => ({ ...s, seed: 0, lattice: null });
    expect(unseeded(y.settings())).toEqual(unseeded(settingsOf('snail-maze')));
    expect(y.settings().lattice).toEqual([129, 90]);
    const maze = yMaze();
    expect(y.env).toEqual([maze.startShape, ...maze.shapes(['left']), ...maze.film(['left'])]);
    // The start spot is the middle of the base, on the axis of the Y; the slime lies on the left arm alone: its runs,
    // and one stroke for its film (y-maze.test.ts holds that the film stamps no other cell).
    expect(maze.startShape.at[0]).toBe(0);
    expect(maze.startShape.at[1] * 90 + 45).toBeCloseTo(maze.start[1], 9);
    const slime = y.env?.filter((e) => e.kind === 'slime') ?? [];
    expect(slime).toHaveLength(maze.slimeRuns(['left']).length + 1);
    for (const e of slime) expect(Math.max(e.at[0], e.to?.[0] ?? 0)).toBeLessThan(0);
    // The dish: 8.6 cm wide at 0.537 mm per cell, its start at the top and the well of glucose at the bottom, both 1 cm
    // inside the rim on the vertical axis, and slime on every cell.
    const s = dish.settings();
    expect([s.boundary, s.lattice, s.flowStrength]).toEqual(['dish', [169, 169], 8]);
    const mm = (cells: number) => cells * 0.537;
    expect(mm(2 * dishRadius(169, 169))).toBeCloseTo(86, 0);
    expect(dish.env?.map((e) => e.kind)).toEqual(['start', 'food', 'slime']);
    const [start, well, coat] = dish.env ?? [];
    expect(start?.at[0]).toBe(0);
    expect(start?.at[1]).toBeLessThan(0); // the y axis points down
    expect(well?.at).toEqual([0, -(start?.at[1] ?? NaN)]);
    expect(mm(dishRadius(169, 169) - Math.abs(start?.at[1] ?? 0) * 169)).toBeCloseTo(10, 1);
    expect(mm(2 * (well?.r ?? 0) * 169)).toBeCloseTo(5, 1);
    expect(coat).toEqual({ kind: 'slime', at: [0, 0], r: 0.5 });
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
    // The start scenes, Fleeing light, the mazes, Tokyo and the scenes of the flow (ADR 0032) use Jones' agents too;
    // usesRule() marks every scene made for the rule: all but the scenes where agents share cells.
    expect(PRESETS.filter(usesRule).map((p) => p.id)).toEqual([
      'three-networks',
      'two-networks',
      'light',
      'foraging-maze',
      'snail-maze',
      'corn-maze',
      'tokyo',
      'tokyo-light',
      'food-ring',
      'rival-networks',
      'tokyo-rivals',
      'y-maze',
      'slime-everywhere',
      ...jones.map((p) => p.id),
      'maze',
      'coarsening',
      'electrotaxis',
      'voronoi',
    ]);
    expect(PRESETS.filter((p) => !usesRule(p)).map((p) => p.group)).toEqual(Array<string>(5).fill('shared'));
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

  // ADR 0047: the values of the model of Tsuda, Jones et al. 2011 (p. 10 and 11). The lattice, the places of the
  // electrodes and the decay are this app's choice: the paper gives none of them.
  it('keep the model of Tsuda, Jones et al. 2011 (p. 10 and 11; ADR 0047)', () => {
    const s = settingsOf('electrotaxis');
    const a = s.strains[0];
    expect([s.model, s.collisions, s.boundary, s.stepOrder, s.layout]).toEqual([
      'jones',
      true,
      'box',
      'sense-first',
      'line',
    ]);
    expect([s.meanWindow, s.electrodeStrength, s.growth, s.shrink]).toEqual([15, 1, false, 0]);
    // The picture shows the agents, as Fig. 11 does: the trail of this scene is one wide hill.
    expect(s.style).toBe('agents');
    expect([a?.sensorAngle, a?.rotationAngle, a?.sensorOffset, a?.deposit, a?.stepSize]).toEqual([22.5, 45, 5, 5, 1]);
    expect([a?.decay, s.scentDecay]).toEqual([0.01, 0.01]);
    // 1,500 agents (p. 11), on the lattice of the scene.
    const [w, h] = s.lattice ?? [0, 0];
    expect([w, h]).toEqual([...ELECTROTAXIS.lattice]);
    expect(agentCount(s, w, h)).toBe(1500);
    // Five current sinks left of the line of agents and five current sources right of it, the sources nearer (Fig. 11).
    const env = preset('electrotaxis').env ?? [];
    const cells = (kind: string) =>
      env.filter((e) => e.kind === kind).map((e) => [(e.at[0] / 1.6) * w, e.at[1] * h, e.r * h]);
    const [cathodes, anodes] = [cells('cathode'), cells('anode')];
    expect([env.length, cathodes.length, anodes.length]).toEqual([10, 5, 5]);
    for (const [x, , r] of cathodes) expect([Math.round(x ?? 0), r]).toEqual([-100, 1.5]);
    for (const [x, , r] of anodes) expect([Math.round(x ?? 0), r]).toEqual([20, 1.5]);
    expect(cathodes.map(([, y]) => Math.round(y ?? 0))).toEqual([-62, -31, 0, 31, 62]);
    expect(anodes.map(([, y]) => y)).toEqual(cathodes.map(([, y]) => y));
  });

  it('keep the model of Baumgarten, Jones and Hauser 2015 (p. 1204 to 1206; ADR 0045)', () => {
    const s = settingsOf('coarsening');
    const a = s.strains[0];
    expect(sourceKind(preset('coarsening'))).toBe('coarsening');
    expect([s.model, s.collisions, s.boundary, s.stepOrder, s.diffusion]).toEqual([
      'jones',
      true,
      'dish',
      'sense-first',
      1,
    ]);
    // SA = RA = 67.5°, SO 5 (p. 1204, Fig. 2), a step of 1 cell, 5 units per move, the mean times 0.9 (p. 1205).
    expect([a?.sensorAngle, a?.rotationAngle, a?.sensorOffset]).toEqual([67.5, 67.5, 5]);
    expect([a?.stepSize, a?.deposit, a?.decay, a?.randomTurn, a?.attraction[0]]).toEqual([1, 5, 0.1, 0, 1]);
    // 25,000 agents on 400 × 400 cells (p. 1204), and room for a child in every cell: the paper has no limit.
    expect(s.density * 400 * 400).toBe(25_000);
    expect(s.capacity).toBe(1);
    // Gf = Sf = 5, 0 to 10 agents in 9 × 9 cells divide, 0 to 22 in 5 × 5 survive (p. 1205 to 1206).
    expect([s.growth, s.growthEvery, s.growthWindow, s.growthMin, s.growthMax]).toEqual([true, 5, 9, 0, 10]);
    expect([s.shrinkEvery, s.shrinkWindow, s.shrinkMin, s.shrinkMax, s.shrink]).toEqual([5, 5, 0, 22, 0]);
    expect(constrain(s)).toEqual(s);
  });

  it('keep the model of Jones and Adamatzky 2015 (p. 6 to 8; ADR 0048)', () => {
    const s = settingsOf('voronoi');
    const a = s.strains[0];
    expect(sourceKind(preset('voronoi'))).toBe('voronoi');
    expect([s.model, s.collisions, s.boundary, s.stepOrder, s.diffusion]).toEqual([
      'jones',
      true,
      'dish',
      'sense-first',
      1,
    ]);
    // SA = RA = 60°, SO 5, a step of 1 cell, 1 unit per move (p. 7); a 5 × 5 mean times 1 − 0.1 (Sec. 4.1, p. 7).
    expect([a?.sensorAngle, a?.rotationAngle, a?.sensorOffset]).toEqual([60, 60, 5]);
    expect([a?.stepSize, a?.deposit, a?.decay, a?.randomTurn, a?.attraction[0]]).toEqual([1, 1, 0.1, 0, 1]);
    expect(meanWindowOf(s)).toBe(5);
    // Growth and shrinkage every 3 steps: 1 to 10 agents in 9 × 9 cells divide, 0 to 24 in 5 × 5 survive (p. 7).
    expect([s.growth, s.growthEvery, s.growthWindow, s.growthMin, s.growthMax]).toEqual([true, 3, 9, 1, 10]);
    expect([s.shrinkEvery, s.shrinkWindow, s.shrinkMin, s.shrinkMax, s.shrink]).toEqual([3, 5, 0, 24, 0]);
    // This app's choices, the paper is silent: about 10,000 agents (read from Fig. 10a), room for a child in every
    // cell, and both strengths at the end of their range (research/voronoi/README.md).
    expect(Math.round(s.density * 239 * 239)).toBe(10_000);
    expect([s.capacity, s.foodStrength, s.lightStrength]).toEqual([1, 0.5, 0.5]);
    // The repellent is weighed as the own trail, and the food too: Jones' one map (ADR 0044).
    expect([a?.food, a?.light]).toEqual([1, 1]);
    expect(constrain(s)).toEqual(s);
  });

  it('draw the ring and the seven dots of Fig. 6a of Jones and Adamatzky 2015 (ADR 0048)', () => {
    const env = preset('voronoi').env ?? [];
    const ring = env.filter((e) => e.kind === 'food');
    const dots = env.filter((e) => e.kind === 'light');
    expect([ring.length, dots.length, env.length]).toEqual([VORONOI_RING.segments, 7, 79]);
    const cells = (v: number) => v * 239;
    // The ring: a closed chain of strokes, each corner 111 cells from the centre, 3 cells wide, inside the dish of
    // 0.945 × 239 / 2 = 112.9 cells.
    ring.forEach((e, i) => {
      expect(Math.hypot(cells(e.at[0]), cells(e.at[1])), String(i)).toBeCloseTo(111, 1);
      expect(e.to, String(i)).toEqual(ring[(i + 1) % ring.length]?.at);
      expect(cells(e.r) * 2).toBeCloseTo(3, 1);
    });
    expect(111 + 1.5).toBeLessThan((0.945 * 239) / 2);
    // The dots: on the centres of their cells (the centre of the lattice is the centre of cell 119), in the places
    // of the figure, with the radius whose smooth edge releases as much as the paper's 3 × 3 cells.
    dots.forEach((e, i) => {
      const [x, y] = VORONOI_DOTS[i] ?? [NaN, NaN];
      expect(cells(e.at[0])).toBeCloseTo(x, 2);
      expect(cells(e.at[1])).toBeCloseTo(y, 2);
      expect(cells(e.r)).toBeCloseTo(VORONOI_DOT_RADIUS, 2);
      expect(e.to).toBeUndefined();
    });
    let bytes = 0;
    for (let y = -4; y <= 4; y++)
      for (let x = -4; x <= 4; x++) bytes += lightByte(Math.hypot(x, y), VORONOI_DOT_RADIUS);
    expect(bytes).toBe(2243);
    expect(bytes / (9 * 255)).toBeCloseTo(0.977, 3);
    // Six dots around one: each of the six lies 40 to 48 cells from the middle one.
    const [mx, my] = VORONOI_DOTS[3] ?? [0, 0];
    for (const [x, y] of VORONOI_DOTS.filter((_, i) => i !== 3)) {
      expect(Math.hypot(x - mx, y - my)).toBeGreaterThan(40);
      expect(Math.hypot(x - mx, y - my)).toBeLessThan(48);
    }
  });

  // Owner decision 2026-11-11 (ADR 0024 decision 3, ADR 0026): a scene of Jones' papers runs on the lattice of its
  // figure, the app's scenes on a grid shaped like the screen. The lattices are in the captions of Jones 2010. The map
  // of Tokyo runs on a square lattice: a grid shaped like a tall screen would turn it, and north stays up (ADR 0024
  // decision 4, ADR 0029).
  it('run each scene of Jones on the lattice of its figure, and the app’s scenes on a grid shaped like the screen', () => {
    const lattices: Record<string, [number, number]> = {
      tokyo: [512, 512], // this app's choice (ADR 0029)
      'tokyo-light': [512, 512], // the map of the Tokyo scene
      coarsening: [400, 400], // Baumgarten, Jones and Hauser 2015, p. 1204 (ADR 0045)
      electrotaxis: [250, 240], // this app's choice: the paper gives no lattice (ADR 0047)
      voronoi: [239, 239], // the dish of Jones and Adamatzky 2015, Fig. 6a and 10: 225 cells across (ADR 0048)
      'food-ring': [384, 384], // this app's choice: the same dish on every screen (ADR 0032)
      'rival-networks': [384, 384],
      'snail-maze': [384, 384], // this app's choice: the rings stay round on every screen (ADR 0051)
      'corn-maze': [480, 320], // 12 × 8 rooms of 40 cells (ADR 0051)
      'tokyo-rivals': [512, 512], // the map of the Tokyo scene
      'three-networks': [384, 384], // this app's choice: the same dish on every screen (ADR 0064)
      'two-networks': [480, 320], // this app's choice: the same box on every screen (ADR 0064)
      light: [384, 384], // the dish of Food ring (ADR 0064)
      'y-maze': [129, 90], // the Y-maze of ADR 0056 at 0.537 mm per cell (ADR 0066)
      'slime-everywhere': [169, 169], // a dish 8.6 cm wide at 0.537 mm per cell (ADR 0066)
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
    for (const id of ['spots', 'stripes', 'shrinking', 'wound', 'light', 'maze', 'three-networks']) {
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

  // ADR 0064: a scene of this app with a lattice has a grid of its own, and no paper stands behind it. The texts about
  // the grid name Jones and his figure only for a scene of Jones 2010.
  it('name the grid of the scene, not a paper, where the lattice is the scene’s own', () => {
    const nb = (t: string) => t.replaceAll(' ', '\u00a0');
    expect(['network', 'shrinking'].map((id) => figureLattice(preset(id)))).toEqual([true, true]);
    for (const id of ['three-networks', 'tokyo', 'corn-maze', 'coarsening', 'electrotaxis'])
      expect(figureLattice(preset(id)), id).toBe(false);
    expect(figureLattice(undefined)).toBe(false);
    expect([latticeOrigin(true), latticeOrigin(false)]).toEqual([', as in the paper', ', the scene’s grid']);
    const text = latticeNotice([384, 384], { lattice: null, resolution: 512 }, false);
    expect(text).toContain('This grid has 512 cells on the long side.');
    expect(text).toContain(`The scene was made for ${nb('384 × 384')} cells.`);
    expect(text).toContain('Sensor distance and Step size');
    expect(text).toContain('the pattern keeps its size in cells');
    const lost = latticeLostNotice([384, 384], { lattice: null, resolution: 256 }, false);
    expect(lost).toBe(
      `This device cannot hold the scene’s grid of ${nb('384 × 384')} cells. The scene runs on a grid of 256 cells on the long side, so it can run differently.`,
    );
    for (const t of [text, lost]) {
      expect(t).not.toMatch(/Jones|paper|figure|—/);
      for (const sentence of t.split(/(?<=\.)\s+/))
        expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(22);
    }
    // The texts of a figure of Jones 2010 are those of before, also without the third argument.
    expect(latticeNotice([300, 300], { lattice: null, resolution: 512 }, true)).toBe(
      latticeNotice([300, 300], { lattice: null, resolution: 512 }),
    );
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
      // What to watch: for the scenes that change over a run, which are all but the patterns and the weaves.
      expect(p.watch !== undefined, p.id).toBe(['start', 'experiments', 'papers'].includes(p.group));
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
    expect(sourceText(preset('tokyo'))).toContain('This scene rebuilds the experiment of Fig. 1.');
    expect(sourceText(preset('tokyo-light'))).toContain('This scene rebuilds the runs with light of Fig. 2B.');
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

describe('the link to the figure of the paper (ADR 0037)', () => {
  // The page of each figure in the PDF of the repository, read from the PDF (page 1 is page 127 of the journal).
  const JONES_PAGES: Record<string, number> = { '4': 9, '5': 10, '16': 18, '18': 19, '19': 20, '21': 21, '22': 22 };

  it('opens the free PDF of Jones 2010 at the page of the figure that the scene names', () => {
    const jones = PRESETS.filter((p) => sourceKind(p) === 'jones');
    expect(jones).toHaveLength(8);
    for (const p of jones) {
      const fig = /Fig\. (\d+)/.exec(p.source)?.[1] ?? '';
      const page = JONES_PAGES[fig];
      expect(page, p.id).toBeDefined();
      expect(p.figure?.label.startsWith(`Fig. ${fig}`), p.id).toBe(true);
      expect(p.figure?.href, p.id).toBe(`${JONES_PDF}#page=${String(page)}`);
      expect(p.figure?.note, p.id).toBe(`page ${String(page)} of the free PDF`);
    }
  });

  it('links the maze and Tokyo to Fig. 1 of their papers, and Tokyo with light to Fig. 2B', () => {
    expect(preset('maze').figure?.href).toBe('https://www.nature.com/articles/35035159/figures/1');
    expect(preset('tokyo').figure?.href).toBe('https://doi.org/10.1126/science.1177894');
    // Fig. 2B shows the network under the mask of light (Tero et al. 2010, p. 440): the scene's chip names it.
    expect(preset('tokyo-light').figure).toEqual({ ...preset('tokyo').figure, label: 'Fig. 2B' });
    expect(preset('tokyo-light').source).toBe('Tero et al. 2010, Fig. 2B');
  });

  it('opens the free PDF of Baumgarten, Jones and Hauser 2015 at the page of Fig. 2 (ADR 0045)', () => {
    // Page 1 of the PDF is page 1201 of the journal; Fig. 2 is on page 1207.
    expect(preset('coarsening').figure).toEqual({
      href: `${BAUMGARTEN_PDF}#page=7`,
      label: 'Fig. 2',
      note: 'page 7 of the free PDF',
    });
  });

  it('opens the free PDF of Tsuda, Jones et al. 2011 at the page of Fig. 11 (ADR 0047)', () => {
    expect(TSUDA_PDF).toBe('https://arxiv.org/pdf/1204.1752');
    expect(preset('electrotaxis').figure).toEqual({
      href: `${TSUDA_PDF}#page=11`,
      label: 'Fig. 11',
      note: 'page 11 of the free PDF',
    });
    expect(sourceKind(preset('electrotaxis'))).toBe('tsuda');
  });

  it('opens the PDF of Jones and Adamatzky 2015 at arXiv at the page of Fig. 10 (ADR 0048)', () => {
    // The PDF prints its page numbers: Fig. 10 is on page 10, the tenth page of the file.
    expect(preset('voronoi').figure).toEqual({
      href: `${VORONOI_PDF}#page=10`,
      label: 'Fig. 10',
      note: 'page 10 of the free PDF',
    });
    expect(VORONOI_PDF).toBe('https://arxiv.org/pdf/1503.06973v1');
  });

  it('is absent where no figure shows the result of the scene', () => {
    const linked = PRESETS.filter((p) => p.figure).map((p) => p.id);
    expect(linked).toHaveLength(14);
    for (const p of PRESETS)
      if (sourceKind(p) === 'app' || sourceKind(p) === 'fogleman' || p.source.startsWith('After'))
        expect(p.figure, p.id).toBeUndefined();
  });
});
