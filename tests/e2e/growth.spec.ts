// Growth and shrinkage and Capacity (ADR 0025). Each test starts the app once, from its own link: two starts per test
// took over a quarter of the time limit on SwiftShader (ADR 0010).
import { expect, test, type Page } from '@playwright/test';
import { decodeLink } from '../../src/model/url';
import { smallScene, watchErrors } from './helpers';

// The start took 32 s on SwiftShader on an M3 Pro (review of 2026-11-11): 150 s keeps it under a quarter (ADR 0010).
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 150_000 });
}

const alive = (page: Page) =>
  page.evaluate(async () => (await globalThis.physarum?.sim.alive())?.reduce((a, b) => a + b, 0) ?? 0);

// Growth and shrinkage need one agent per cell: without the rule the switch is off and disabled. A scene of Jones
// offers it, its values show while it is on, the card names it and counts it as a change, and the link holds it.
test('the Growth section offers growth with the rule, and the scene card and the link follow it', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, await smallScene());
  await page.locator('summary', { hasText: 'Growth' }).click();
  const growth = page.getByRole('checkbox', { name: /^Growth and shrinkage/ });
  await expect(growth).toBeDisabled();
  await expect(growth).not.toBeChecked();
  await expect(page.getByText('Growth and shrinkage (Jones 2011): needs one agent per cell')).toBeVisible();
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('network');
  await page.waitForFunction(() => globalThis.physarum?.settings.model === 'jones');
  await expect(growth).toBeEnabled();
  await expect(page.getByLabel('Growth window', { exact: true })).toHaveCount(0);
  await growth.check();
  await expect(page.getByLabel('Growth window', { exact: true })).toHaveValue('9');
  await expect(page.getByLabel('Shrinkage maximum', { exact: true })).toHaveValue('20');
  await page.waitForFunction(() => globalThis.physarum?.settings.growth === true);
  const card = page.getByRole('region', { name: 'Scene', exact: true });
  await expect(card.getByText('Growth and shrinkage', { exact: true })).toBeVisible();
  await expect(card.getByText('changed', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await decodeLink(await page.evaluate(() => location.hash.slice(1))))?.settings.growth)
    .toBe(true);
  // A window of 8 cells is 9: the field shows what the simulation uses.
  const window = page.getByLabel('Growth window value');
  await window.fill('8');
  await window.press('Enter');
  await expect(window).toHaveValue('9');
  // Both tests off: the card names no rule, and the section says why nothing happens.
  for (const label of ['Growth test every value', 'Shrinkage test every value']) {
    await page.getByLabel(label).fill('0');
    await page.getByLabel(label).press('Enter');
  }
  await expect(page.getByText('Both tests are off, so growth and shrinkage do nothing.')).toBeVisible();
  await expect(card.getByText('Growth and shrinkage', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// With every agent alive, growth has no room: the section says so and offers a Capacity that makes room.
test('growth without a dead agent says so, and the offered Capacity makes room', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, await smallScene({ collisions: true, density: 0.01, growth: true, layout: 'mixed' }));
  await page.locator('summary', { hasText: 'Growth' }).click();
  const offer = page.getByRole('button', { name: 'Set Capacity to 1' });
  await expect(page.getByText(/Growth has no room/)).toBeVisible({ timeout: 60_000 });
  const start = await alive(page);
  const agents = await page.evaluate(() => globalThis.physarum?.sim.agents ?? 0);
  expect(agents).toBe(start);
  await offer.click();
  await page.waitForFunction(() => globalThis.physarum?.settings.capacity === 1);
  await expect.poll(() => page.evaluate(() => globalThis.physarum?.sim.agents ?? 0)).toBeGreaterThan(50 * agents);
  await expect.poll(() => alive(page), { timeout: 60_000 }).toBeGreaterThan(2 * start);
  await expect(page.getByText(/Growth has no room/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

// A Capacity above Agents per cell keeps dead agents in a full scene: Inoculate places them.
test('a higher capacity gives the inoculate tool agents in a full scene', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, await smallScene({ capacity: 1 }));
  const start = await alive(page);
  expect(await page.evaluate(() => globalThis.physarum?.sim.agents)).toBeGreaterThan(start);
  await page.getByRole('radio', { name: 'Inoculate' }).click();
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await expect.poll(() => alive(page), { timeout: 60_000 }).toBeGreaterThan(start + 50);
  await page.mouse.up();
  await expect(page.getByRole('status').filter({ hasText: 'are alive' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// The scene Foraging maze starts a small colony on its first food, and the colony grows (its start: engine.gpu.test.ts).
test('the Foraging maze grows from a small colony on its food', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, await smallScene());
  const restarts = await page.evaluate(() => globalThis.physarum?.restarts ?? 0);
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('foraging-maze');
  await page.waitForFunction((r) => (globalThis.physarum?.restarts ?? 0) > r, restarts);
  await expect.poll(() => alive(page), { timeout: 60_000 }).toBeGreaterThan(300);
  const card = page.getByRole('region', { name: 'Scene', exact: true });
  await expect(card.getByText('Growth and shrinkage', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
