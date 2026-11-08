import { expect, test } from '@playwright/test';
import { estimateBytes, memoryBudget } from '../../src/engine/sizing';
import { smallScene, watchErrors } from './helpers';

test('boots from a shared link, simulates and draws a network without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(await smallScene());
  await page.waitForFunction(() => globalThis.physarum !== undefined, undefined, { timeout: 30_000 });
  const adapter = await page.evaluate(() => globalThis.physarum?.backend.description ?? '?');
  test.info().annotations.push({ type: 'adapter', description: adapter });
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 100, undefined, { timeout: 60_000 });
  const { mean, std } = await page.evaluate(async () => {
    const img = await globalThis.physarum?.capture();
    if (!img) throw new Error('no engine');
    let sum = 0;
    let sq = 0;
    const n = img.width * img.height;
    for (let i = 0; i < img.data.length; i += 4) {
      const l = 0.2126 * (img.data[i] ?? 0) + 0.7152 * (img.data[i + 1] ?? 0) + 0.0722 * (img.data[i + 2] ?? 0);
      sum += l;
      sq += l * l;
    }
    return { mean: sum / n, std: Math.sqrt(sq / n - (sum / n) ** 2) };
  });
  // A network: bright filaments on a dark background, so high contrast and a dark mean.
  expect(std, `adapter ${adapter}`).toBeGreaterThan(20);
  expect(mean).toBeGreaterThan(5);
  expect(mean).toBeLessThan(200);
  expect(errors).toEqual([]);
});

test('falls back to WebGL2 and still simulates and draws (ADR 0003)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto((await smallScene()).replace('/#', '/?backend=webgl2#'));
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 60, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => globalThis.physarum?.backend.kind)).toBe('webgl2');
  const std = await page.evaluate(async () => {
    const img = await globalThis.physarum?.capture();
    if (!img) throw new Error('no engine');
    let sum = 0;
    let sq = 0;
    const n = img.width * img.height;
    for (let i = 0; i < img.data.length; i += 4) {
      const l = 0.2126 * (img.data[i] ?? 0) + 0.7152 * (img.data[i + 1] ?? 0) + 0.0722 * (img.data[i + 2] ?? 0);
      sum += l;
      sq += l * l;
    }
    return Math.sqrt(sq / n - (sum / n) ** 2);
  });
  expect(std).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('fits a shared link to the device memory before the first allocation', async ({ page }) => {
  const errors = watchErrors(page);
  // A phone with 0.25 GB: the budget is 32 MiB, far below a 2048 grid (about 270 MB).
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 0.25 });
  });
  await page.goto(await smallScene({ resolution: 2048, density: 1 }));
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 60_000 });
  const sim = await page.evaluate(() => {
    const e = globalThis.physarum;
    if (!e) throw new Error('no engine');
    return { width: e.sim.width, height: e.sim.height, agents: e.sim.agents, grid: e.settings.resolution };
  });
  expect(sim.grid).toBeLessThan(2048);
  expect(estimateBytes(sim.width, sim.height, sim.agents)).toBeLessThanOrEqual(memoryBudget(0.25));
  await expect(page.getByRole('status')).toContainText('Lowered the grid to');
  // The panel shows the grid that the engine runs (startup tuning may lower it further).
  const select = page.getByLabel('Grid (cells on the long side)');
  await expect
    .poll(
      async () =>
        (await select.inputValue()) === String(await page.evaluate(() => globalThis.physarum?.settings.resolution)),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test('offers a fresh start without the shared settings after a failure', async ({ page }) => {
  // A small device memory keeps the start scene small on SwiftShader in CI.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 0.25 });
  });
  await page.goto(await smallScene());
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => globalThis.physarum?.settings.strains.length)).toBe(2);
  await page.evaluate(() => globalThis.physarum?.onError?.(new Error('test failure')));
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('test failure');
  const reload = page.waitForEvent('load');
  await alert.getByRole('button', { name: 'Start fresh' }).click();
  await reload;
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 60_000 });
  // The start scene has three strains; the shared link had two.
  expect(await page.evaluate(() => globalThis.physarum?.settings.strains.length)).toBe(3);
});
