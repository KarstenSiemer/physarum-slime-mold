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
  // The settings, and the scene with its food, light and walls (docs/adr/0021).
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#s=[\w-]+&e=[\w-]+$/);
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

// Every new grid paints all recorded strokes again (ADR 0019): a slow drag must not record one per pointer event.
test('a slow drag records a segment only once the pointer moved half a brush radius', async ({ page }) => {
  // Paused, a frame only draws: on SwiftShader in CI a pointer move can wait for a frame.
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('radio', { name: 'Food' }).click();
  await page.evaluate(() => {
    const e = globalThis.physarum;
    if (!e) throw new Error('no engine');
    const paint = e.paint.bind(e);
    const g = globalThis as unknown as { strokes: Parameters<typeof paint>[0][] };
    g.strokes = [];
    e.paint = (s) => {
      g.strokes.push(s);
      paint(s);
    };
  });
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const [x, y] = [box.x + box.width * 0.3, box.y + box.height * 0.5];
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) await page.mouse.move(x + i, y);
  await page.mouse.up();
  const strokes = await page.evaluate(
    () => (globalThis as unknown as { strokes: { from: number[]; to: number[]; radius: number }[] }).strokes,
  );
  // The first stroke is a dab where the drag starts; each later one is at least half a radius long.
  const [first, ...rest] = strokes;
  expect(first?.from).toEqual(first?.to);
  expect(rest.length).toBeGreaterThan(0);
  for (const s of rest)
    expect(Math.hypot((s.to[0] ?? 0) - (s.from[0] ?? 0), (s.to[1] ?? 0) - (s.from[1] ?? 0))).toBeGreaterThanOrEqual(
      s.radius / 2,
    );
  // 24 moves of one pixel, half a radius about 9 pixels: a dab and two strokes, not 25.
  expect(strokes.length).toBeLessThan(8);
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
