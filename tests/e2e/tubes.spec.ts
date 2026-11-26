// Flow in the tubes (ADR 0029): the switch of the extended model, its strength, the scene card and the link.
// The file sorts after scenes.spec.ts (it was flow.spec.ts): CI shares the e2e tests out to its shards by their count,
// in the order of the files, so its tests that wait for steps run in the second shard, beside the short tests of
// ui.spec.ts, and the other tests that wait for steps in the first (ADR 0049).
import { expect, test, type Page } from '@playwright/test';
import { decodeLink } from '../../src/model/url';
import { smallScene, watchErrors } from './helpers';

// The start took 32 s on SwiftShader on an M3 Pro (review of 2026-11-11): 150 s keeps it under a quarter (ADR 0010).
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 150_000 });
}

// The steps of a wait, measured on 2026-11-15 on WebGPU and WebGL2, on the GPU of an M3 Pro and on SwiftShader in the
// image of CI. The runs differ a little, so each wait has a margin.
// TUBES: the Maze draws more than 100 cells above their trail from step 16 to 19 on (6 runs: 16, 17, 17, 17, 19,
// 16), and 1,500 to 2,900 cells at step 27 to 32.
const TUBES = 30;
// GROWN: from a first count at step 2 to 7 (60 runs on the M3 Pro), the colony of the Tokyo scene has 20 to 44 agents
// more after 10 steps, which is too few, and 50 to 133 more after 30. Each colony of Rival networks has 76 or more
// agents more after 30 steps.
const GROWN = 30;
// The limit of a wait for steps. In the image of CI on 4 cores of an M3 Pro, the first 30 steps took 27 s in the Maze
// and in Rival networks and 34 s on the Tokyo scene, and GitHub is about 3 times slower (ADR 0010).
const WAIT = 300_000;
// The limit of a test with such a wait: two starts of the app and the wait.
const LIMIT = 480_000;

// A result of the simulation comes with its steps, not with the seconds: a test waits for a step and then reads once.
// A wait of seconds for a result failed on GitHub, where a slow runner made too few steps (TODO.md, 2026-11-15).
// The limit of the wait is only a guard against a simulation that stands still.
const steps = (page: Page, n: number) =>
  page.waitForFunction((n) => (globalThis.physarum?.sim.step ?? 0) >= n, n, { timeout: WAIT });
// The agents alive of each strain, and a step that the simulation had reached at most when it counted them.
const alive = (page: Page) =>
  page.evaluate(async () => {
    const sim = globalThis.physarum?.sim;
    const alive = [...((await sim?.alive()) ?? [])];
    return { alive, step: sim?.step ?? 0 };
  });
// Waits for a scene with the flow on a grid of this width, and lets it rest at once, in the frame that sees it: the
// first count is then of step 2 to 7. Only a young colony grows by 20 agents for sure: a first count many steps late,
// as on a fast machine under load, found colonies of 200 to 270 agents that grew no more in 30 steps, and a rival
// that had lost agents (3 of 30 runs, 2026-11-15). grow() lets the scene run again.
const colonyScene = (page: Page, width: number) =>
  page.waitForFunction(
    (width) => {
      const engine = globalThis.physarum;
      if (!engine?.settings.flow || engine.sim.width !== width) return false;
      engine.paused = true;
      return true;
    },
    width,
    { timeout: 150_000 },
  );
const grow = async (page: Page, to: number) => {
  await page.evaluate(() => {
    if (globalThis.physarum) globalThis.physarum.paused = false;
  });
  await steps(page, to);
};

const linked = async (page: Page) => (await decodeLink(await page.evaluate(() => location.hash.slice(1))))?.settings;
const memory = (page: Page) => page.evaluate(async () => (await globalThis.physarum?.sim.readFlow())?.length ?? -1);

// A small extended scene: the switch turns the flow on while the scene runs, the simulation then holds the memory of
// the flow, and the card, the link and the help follow. The Jones model has no such section.
test('the Flow section turns the flow on in the extended model, and the Jones model has none', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, await smallScene({ resolution: 256 }));
  const card = page.getByRole('region', { name: 'Scene', exact: true });
  await page.locator('summary', { hasText: 'Flow' }).click();
  const flow = page.getByRole('checkbox', { name: 'Flow in the tubes', exact: true });
  await expect(flow).not.toBeChecked();
  await expect(page.getByLabel('Flow strength value')).toHaveCount(0);
  expect(await memory(page)).toBe(0);
  const before = await page.evaluate(() => globalThis.physarum?.sim.step ?? 0);
  await flow.check();
  await expect(page.getByLabel('Flow strength value')).toHaveValue('8');
  await page.waitForFunction(() => globalThis.physarum?.settings.flow === true);
  // The same simulation goes on: the flow needs no restart. It holds 4 values of memory per cell.
  await expect.poll(() => memory(page), { timeout: 60_000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => globalThis.physarum?.sim.step ?? 0)).toBeGreaterThanOrEqual(before);
  await expect.poll(async () => (await linked(page))?.flow).toBe(true);
  // The strength is a setting of the link too.
  const strength = page.getByLabel('Flow strength value');
  await strength.fill('2');
  await strength.press('Enter');
  await expect.poll(async () => (await linked(page))?.flowStrength).toBe(2);
  // The help names the model and the time scale.
  await page.getByRole('button', { name: 'About Flow in the tubes', exact: true }).click();
  await expect(page.getByText(/Kirchhoff’s law, as in the model of Tero, Kobayashi and Nakagaki/)).toBeVisible();
  await expect(page.getByText(/Thirty steps are one minute of model time/)).toBeVisible();
  // The Maze has the flow, and its card says so. Its strength is the default again.
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('maze');
  await expect(card.getByText('Flow in the tubes', { exact: true })).toBeVisible();
  await expect(flow).toBeChecked();
  await expect(page.getByLabel('Flow strength value')).toHaveValue('8');
  // A scene of Jones: no section Flow, no chip, and the settings hold no flow.
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('network');
  await page.waitForFunction(() => globalThis.physarum?.settings.model === 'jones');
  await expect(page.locator('summary', { hasText: 'Flow' })).toHaveCount(0);
  await expect(card.getByText('Flow in the tubes', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.physarum?.settings.flow)).toBe(false);
  await expect.poll(async () => (await linked(page))?.flow).toBe(false);
  expect(errors).toEqual([]);
});

// The Tokyo rail network (ADR 0024, 0029): the scene runs on its square lattice on every screen, so north stays up;
// a small colony starts at Tokyo and grows; the card names its rules and its source.
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]) {
  test(`Tokyo rail network grows from Tokyo on its square lattice (${String(viewport.width)} px)`, async ({ page }) => {
    test.setTimeout(LIMIT);
    const errors = watchErrors(page);
    await page.setViewportSize(viewport);
    await open(page, await smallScene({ resolution: 256 }));
    // On a phone the panel opens with the Settings button.
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    if (await settings.isVisible()) await settings.click();
    await page.getByRole('combobox', { name: 'Preset' }).selectOption('tokyo');
    await colonyScene(page, 512);
    const state = await page.evaluate(() => {
      const e = globalThis.physarum;
      return e && { size: [e.sim.width, e.sim.height], lattice: e.settings.lattice, flux: e.settings.flowStrength };
    });
    // The flow strength of the scene since ADR 0054.
    expect(state).toEqual({ size: [512, 512], lattice: [512, 512], flux: 2.8 });
    const card = page.getByRole('region', { name: 'Scene', exact: true });
    await expect(card.getByRole('heading', { name: 'Tokyo rail network' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Tero et al. 2010, Fig. 1' })).toBeVisible();
    for (const chip of ['One agent per cell', 'Growth and shrinkage', 'Flow in the tubes'])
      await expect(card.getByText(chip, { exact: true })).toBeVisible();
    await expect(card.getByText('changed', { exact: true })).toHaveCount(0);
    // The colony of about 50 agents at Tokyo grows: more agents live some steps later.
    const first = await alive(page);
    const colony = first.alive.reduce((a, b) => a + b, 0);
    expect(colony).toBeGreaterThan(20);
    expect(colony).toBeLessThan(2000);
    await grow(page, first.step + GROWN);
    expect((await alive(page)).alive.reduce((a, b) => a + b, 0)).toBeGreaterThan(colony + 20);
    // The simulation holds the memory of the flow, and Tokyo's food sites lie in the middle part of the lattice.
    expect(await memory(page)).toBe(512 * 512 * 4);
    expect(errors).toEqual([]);
  });
}

// Rival networks (ADR 0031, 0031): two strains, each with a colony on a food of its own and a flow of its own.
test('Rival networks starts a colony of each strain, and each strain has a flow of its own', async ({ page }) => {
  test.setTimeout(LIMIT);
  const errors = watchErrors(page);
  await open(page, await smallScene({ resolution: 256 }));
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('rival-networks');
  await colonyScene(page, 384);
  const state = await page.evaluate(() => {
    const e = globalThis.physarum;
    return e && { size: [e.sim.width, e.sim.height], strains: e.settings.strains.length, layout: e.settings.layout };
  });
  expect(state).toEqual({ size: [384, 384], strains: 2, layout: 'food' });
  const card = page.getByRole('region', { name: 'Scene', exact: true });
  await expect(card.getByRole('heading', { name: 'Rival networks' })).toBeVisible();
  for (const chip of ['One agent per cell', 'Growth and shrinkage', 'Flow in the tubes'])
    await expect(card.getByText(chip, { exact: true })).toBeVisible();
  await expect(card.getByText('changed', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Start layout')).toHaveValue('food');
  // Each strain starts as a colony of about 50 agents on its own food, and both colonies grow.
  const first = await alive(page);
  expect(first.alive.length).toBeGreaterThanOrEqual(2);
  for (const n of first.alive.slice(0, 2)) {
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(2000);
  }
  await grow(page, first.step + GROWN);
  const later = (await alive(page)).alive;
  for (const [i, n] of first.alive.slice(0, 2).entries()) expect(later[i]).toBeGreaterThan(n + 20);
  // The simulation holds the memory of a flow for each of the two strains, and for no third one.
  const memories = await page.evaluate(async () => {
    const sim = globalThis.physarum?.sim;
    return sim ? [(await sim.readFlow(0)).length, (await sim.readFlow(1)).length, (await sim.readFlow(2)).length] : [];
  });
  expect(memories).toEqual([384 * 384 * 4, 384 * 384 * 4, 0]);
  expect(errors).toEqual([]);
});

// The picture of the tubes (ADR 0034): its switch below the flow strength changes the view only. With it the picture
// holds another trail than the view of the model, and without it the same.
test('the switch below the flow strength draws the tubes by their flow, and changes the view only', async ({
  page,
}) => {
  test.setTimeout(LIMIT);
  const errors = watchErrors(page);
  await open(page, await smallScene({ resolution: 256 }));
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('maze');
  // The Maze runs on a grid 512 cells wide. The scene before ran on a smaller grid, and its steps do not count.
  await page.waitForFunction(
    () => globalThis.physarum?.settings.flow === true && globalThis.physarum.sim.width === 512,
    undefined,
    { timeout: 150_000 },
  );
  await page.locator('summary', { hasText: 'Flow' }).click();
  const tubes = page.getByRole('checkbox', { name: 'Draw the tubes by their flow', exact: true });
  await expect(tubes).toBeChecked();
  expect(await page.evaluate(() => globalThis.physarum?.settings.showTubes)).toBe(true);
  // How many cells the picture draws with another trail than the view of the model, how many of them with more, and
  // the step. Only a tube draws a cell with more than its trail: without a tube a cell holds a quarter of its trail.
  // The simulation rests while the two are read: on a slow machine it steps between two reads, and every cell would
  // differ.
  const differs = () =>
    page.evaluate(async () => {
      const engine = globalThis.physarum;
      if (!engine) return { cells: -1, more: -1, step: -1 };
      const { sim, paused } = engine;
      engine.paused = true;
      try {
        await sim.finish();
        const [picture, view] = [await sim.readPicture(), await sim.readView()];
        let [cells, more] = [0, 0];
        for (let i = 0; i < view.length; i += 4) {
          if (picture[i] !== view[i]) cells++;
          if ((picture[i] ?? 0) > (view[i] ?? 0)) more++;
        }
        return { cells, more, step: sim.step };
      } finally {
        engine.paused = paused;
      }
    });
  // The colony holds tubes after some steps: their discs then draw many cells with more than their trail.
  await steps(page, TUBES);
  const on = await differs();
  expect(on.step).toBeGreaterThanOrEqual(TUBES);
  expect(on.more).toBeGreaterThan(100);
  const before = on.step;
  await tubes.uncheck();
  await page.waitForFunction(() => globalThis.physarum?.settings.showTubes === false);
  // The same simulation goes on, and the picture is the trail of the view again.
  const off = await differs();
  expect(off.cells).toBe(0);
  expect(off.step).toBeGreaterThanOrEqual(before);
  await expect.poll(async () => (await linked(page))?.showTubes).toBe(false);
  // The card of the scene does not count the switch as a change of the scene.
  const card = page.getByRole('region', { name: 'Scene', exact: true });
  await expect(card.getByText('changed', { exact: true })).toHaveCount(0);
  // The help states the rule and its numbers.
  await page.getByRole('button', { name: 'About Draw the tubes by their flow', exact: true }).click();
  await expect(page.getByText(/grows with the fourth root of the conductivity/)).toBeVisible();
  // The switch needs no step: the simulation kept the memory of the flow, and the next read draws the tubes from it.
  await tubes.check();
  await page.waitForFunction(() => globalThis.physarum?.settings.showTubes === true);
  expect((await differs()).more).toBeGreaterThan(100);
  // Without the flow there is no switch: the picture is the trail.
  await page.getByRole('checkbox', { name: 'Flow in the tubes', exact: true }).uncheck();
  await expect(tubes).toHaveCount(0);
  await page.waitForFunction(() => globalThis.physarum?.settings.flow === false);
  expect((await differs()).cells).toBe(0);
  expect(errors).toEqual([]);
});

// The Crown of veins (ADR 0087): the rules of the growth front with the levers of the crown of ADR 0084, which the Flow
// section shows. The colony starts on the food at the closed end of the neck, and its growth front takes the flux of
// the tubes from its first steps on: in 12 runs on WebGPU and WebGL2 on the GPU of an M3 Pro (seeds 1 to 6), the
// colony grew by 15 to 22 agents from step 10 to step 40, and it had 8 to 19 sinks at step 30, since every birth comes
// from the budget (ADR 0100; before it 27 to 38 agents and 16 to 29 sinks). It leaves the neck
// only after 1,150 to 1,450 steps (`bash research/front/e5b.sh neck`): too many for CI, whose SwiftShader runs the
// scene at about one step per second in the image on 4 cores (ADR 0087).
test('the Crown of veins shows its rules and levers in the Flow section, and its front takes flux', async ({
  page,
}) => {
  test.setTimeout(LIMIT);
  const errors = watchErrors(page);
  await open(page, await smallScene({ resolution: 256 }));
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('crown');
  await colonyScene(page, 520);
  const card = page.getByRole('region', { name: 'Scene', exact: true });
  await expect(card.getByRole('heading', { name: 'Crown of veins' })).toBeVisible();
  await expect(card.getByText('changed', { exact: true })).toHaveCount(0);
  // The Flow section shows the rules and the levers with the values of the scene.
  await page.locator('summary', { hasText: 'Flow' }).click();
  await expect(page.getByRole('checkbox', { name: 'Flow over 8 neighbours', exact: true })).toBeChecked();
  await expect(page.getByLabel('Base conductance value')).toHaveValue('0.002');
  await expect(page.getByRole('checkbox', { name: 'Rules of the growth front', exact: true })).toBeChecked();
  await expect(page.getByLabel('Drift value')).toHaveValue('1.50');
  await expect(page.getByLabel('Flux to the front value')).toHaveValue('2');
  // The colony of about 50 agents on the food grows, and its growth front has sinks: cells that take the flux of the
  // strain hold their rate with a minus sign (Sim.readSinks()).
  const first = await alive(page);
  const colony = first.alive[0] ?? 0;
  expect(colony).toBeGreaterThan(20);
  expect(colony).toBeLessThan(200);
  await grow(page, first.step + GROWN);
  const later = await page.evaluate(async () => {
    const sim = globalThis.physarum?.sim;
    if (!sim) return { alive: -1, sinks: -1 };
    const [alive, sinks] = [(await sim.alive())[0] ?? -1, await sim.readSinks(0)];
    return { alive, sinks: sinks.filter((r) => r < 0).length };
  });
  expect(later.alive).toBeGreaterThan(colony + 8);
  expect(later.sinks).toBeGreaterThan(0);
  // The link holds the rules and the levers of the scene.
  await expect
    .poll(async () => {
      const s = await linked(page);
      return s && [s.territory, s.drift, s.flowEdges, s.flowBase, s.frontFlux];
    })
    .toEqual([true, 1.5, 8, 0.002, 2]);
  // Each control shows only where it acts: the drift and the flux to the front with the rules, the rules and the
  // levers of the flow with the flow.
  await page.getByRole('checkbox', { name: 'Rules of the growth front', exact: true }).uncheck();
  await expect(page.getByLabel('Drift value')).toHaveCount(0);
  await expect(page.getByLabel('Flux to the front value')).toHaveCount(0);
  await expect(page.getByLabel('Base conductance value')).toHaveValue('0.002');
  // The switch on sets the levers of the Crown of veins again (ADR 0098).
  const base = page.getByLabel('Base conductance value');
  await base.fill('0.02');
  await base.press('Enter');
  await page.waitForFunction(() => globalThis.physarum?.settings.flowBase === 0.02);
  await page.getByRole('checkbox', { name: 'Rules of the growth front', exact: true }).check();
  await expect(base).toHaveValue('0.002');
  await expect(page.getByLabel('Flux to the front value')).toHaveValue('2');
  await page.getByRole('checkbox', { name: 'Flow in the tubes', exact: true }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Rules of the growth front', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Flow over 8 neighbours', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Base conductance value')).toHaveCount(0);
  expect(errors).toEqual([]);
});
