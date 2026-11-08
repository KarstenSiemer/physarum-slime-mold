import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openSmallScene, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => {
  await openSmallScene(page);
});

test('has no serious accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
});

test('Learn dialog opens, switches tabs and closes', async ({ page }) => {
  await page.getByRole('button', { name: 'Learn' }).click();
  const dialog = page.getByRole('dialog', { name: 'Learn' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'The model' }).click();
  await expect(dialog.getByText('Every step has six parts')).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('a preset reaches the engine and updates the shareable link', async ({ page }) => {
  const errors = watchErrors(page);
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('spots');
  await page.waitForFunction(() => globalThis.physarum?.settings.collisions === true);
  const s = await page.evaluate(() => globalThis.physarum?.settings);
  expect(s?.strains[0]?.attraction[0]).toBe(-1);
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#s=[\w-]+$/);
  expect(errors).toEqual([]);
});

test('the food tool paints food into the environment', async ({ page }) => {
  await page.getByRole('radio', { name: 'Food' }).click();
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  const foodCells = await page.evaluate(async () => {
    const env = await globalThis.physarum?.sim.readEnv();
    if (!env) throw new Error('no engine');
    let n = 0;
    for (let i = 1; i < env.length; i += 4) if ((env[i] ?? 0) > 0) n++;
    return n;
  });
  expect(foodCells).toBeGreaterThan(50);
});

test('keyboard shortcuts pause, step and switch tools', async ({ page }) => {
  await page.locator('canvas').click();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => globalThis.physarum?.paused)).toBe(true);
  const before = await page.evaluate(() => globalThis.physarum?.sim.step ?? 0);
  await page.keyboard.press('.');
  await expect.poll(() => page.evaluate(() => globalThis.physarum?.sim.step ?? 0)).toBe(before + 1);
  await page.keyboard.press('5');
  await expect(page.getByRole('radio', { name: 'Wall' })).toHaveAttribute('aria-checked', 'true');
});
