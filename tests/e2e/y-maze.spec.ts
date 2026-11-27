// The Y-maze of Reid et al. 2012 with the rules of the growth front (ADR 0088): with slime on one arm, the colony
// grows into the other arm. The file sorts after ui.spec.ts, so CI runs its test last, in the fourth shard, beside the
// short tests of ui.spec.ts: CI shares the e2e tests out to its shards by their count, in the order of the files
// (ADR 0049, ADR 0061).
import { expect, test, type Page } from '@playwright/test';
import { decodeLink } from '../../src/model/url';
import { yMaze } from '../../src/model/y-maze';
import { smallScene, watchErrors } from './helpers';

// From step ARMS on, the territory of the colony covers more of the blank arm than of the arm with slime, by 1.47 times
// or more in each of 40 runs on the GPU of an M3 Pro (`bash research/front/e4.sh y`; 1.07 at step 1,500). The test asks
// for MARGIN times. The colony reaches the first food only after 2,825 to 3,670 steps.
const ARMS = 1800;
const MARGIN = 1.2;
// SwiftShader, the GPU of CI, runs the scene at 2.2 steps per second in the app, which draws in every step, and at 16
// steps per second without the picture, in the image of CI on 4 cores of an M3 Pro (ADR 0088, decision 7); GitHub is
// about three times slower (ADR 0010). So the test pauses the app and steps the scene itself, 50 steps at a time: 1,800
// steps take about 2 minutes there. The limit guards against a scene that stands still.
const LIMIT = 1_500_000;

const linked = async (page: Page) => (await decodeLink(await page.evaluate(() => location.hash.slice(1))))?.settings;

test('the Y-maze with slime: the colony grows into the blank arm, and the Slime section holds the avoidance', async ({
  page,
}) => {
  test.setTimeout(LIMIT);
  const errors = watchErrors(page);
  await page.goto(await smallScene({ resolution: 256 }));
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 150_000 });
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('y-maze');
  await page.waitForFunction(() => globalThis.physarum?.sim.width === 129, undefined, { timeout: 150_000 });
  const card = page.getByRole('region', { name: 'Scene', exact: true });
  await expect(card.getByRole('heading', { name: 'Y-maze with slime' })).toBeVisible();
  // The rules of the growth front are on, and the Slime section shows the avoidance with its defaults.
  await page.locator('summary', { hasText: 'Flow' }).click();
  await expect(page.getByRole('checkbox', { name: 'Rules of the growth front', exact: true })).toBeChecked();
  await page.locator('summary', { hasText: 'Slime' }).click();
  await expect(page.getByLabel('Weight on slime value')).toHaveValue('0.025');
  await expect(page.getByLabel('Reach to fresh ground value')).toHaveValue('6');
  // The colony starts on the base and grows into both arms; the arm with slime is the left one.
  const { left, right } = yMaze().arm;
  const arms = await page.evaluate(
    async ({ left, right, to }) => {
      const engine = globalThis.physarum;
      if (!engine) return { left: -1, right: -1, step: -1 };
      engine.paused = true;
      const sim = engine.sim;
      while (sim.step < to) {
        sim.run(Math.min(50, to - sim.step));
        await sim.finish();
      }
      const territory = await sim.readTerritory();
      const cover = (cells: number[]) => cells.filter((c) => ((territory[c] ?? 0) & 1) !== 0).length;
      return { left: cover(left), right: cover(right), step: sim.step };
    },
    { left, right, to: ARMS },
  );
  expect(arms.step).toBe(ARMS);
  expect(arms.right).toBeGreaterThan(MARGIN * arms.left);
  // The link holds the avoidance while the rules are on.
  const weight = page.getByLabel('Weight on slime value');
  await weight.fill('1');
  await weight.press('Enter');
  await expect.poll(async () => (await linked(page))?.slimeWeight).toBe(1);
  // Without the rules the Slime section names their switch, and the link holds no avoidance.
  await page.getByRole('checkbox', { name: 'Rules of the growth front', exact: true }).uncheck();
  await expect(page.getByLabel('Weight on slime value')).toHaveCount(0);
  await expect(page.getByLabel('Reach to fresh ground value')).toHaveCount(0);
  await expect(page.getByText(/The avoidance of slime needs the switch Rules of the growth front/)).toBeVisible();
  await expect.poll(async () => (await linked(page))?.slimeWeight).toBe(0.025);
  expect(errors).toEqual([]);
});
