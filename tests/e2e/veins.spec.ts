// The Crown of veins in the app. The file sorts after ui.spec.ts: CI shares the e2e tests out to its shards by their
// count, in the order of the files, so this test, the longest of all, runs apart from the tests of tubes.spec.ts that
// wait for steps (ADR 0102).
import { expect, test } from '@playwright/test';
import { alive, colonyScene, grow, LIMIT, linked, open } from './colony';
import { smallScene, watchErrors } from './helpers';

// The Crown of veins (ADR 0087): the rules of the growth front with the levers of the crown of ADR 0084, which the Flow
// section shows. The colony starts on the food at the closed end of the neck, and its growth front takes the flux of
// the tubes from its first steps on. Since every birth comes from the budget and the front is paid in the share of its
// sinks (ADR 0100), a young colony grows slower: in 20 runs on WebGPU and WebGL2 on the GPU of an M3 Pro (seeds 1 to
// 10), from a first count at step 2 to 7 it grew by at least 6 agents in 30 steps, too few to tell growth with a
// margin, and by at least 25 in 60 steps (CROWN_GROWN); it had 6 to 21 sinks at step 30. It leaves the neck
// only after 1,150 to 1,450 steps (`bash research/front/e5b.sh neck`): too many for CI, whose SwiftShader runs the
// scene at about one step per second in the image on 4 cores (ADR 0087).
const CROWN_GROWN = 60;
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
  await grow(page, first.step + CROWN_GROWN);
  const later = await page.evaluate(async () => {
    const sim = globalThis.physarum?.sim;
    if (!sim) return { alive: -1, sinks: -1 };
    const [alive, sinks] = [(await sim.alive())[0] ?? -1, await sim.readSinks(0)];
    return { alive, sinks: sinks.filter((r) => r < 0).length };
  });
  expect(later.alive).toBeGreaterThan(colony + 12);
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
