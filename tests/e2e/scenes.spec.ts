// Scene name, scene card, grouped presets, the one-agent-per-cell switch and Learn → Scenes.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openSmallScene, smallScene, watchErrors } from './helpers';

const serious = async (page: Page, include?: string) => {
  const axe = new AxeBuilder({ page });
  if (include) axe.include(include);
  const { violations } = await axe.analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
};

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
};

type Box = Awaited<ReturnType<typeof box>>;
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const card = (page: Page) => page.getByRole('region', { name: 'Scene', exact: true });
const preset = (page: Page) => page.getByRole('combobox', { name: 'Preset' });

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]) {
  test(`names the start scene over the canvas, clear of the notice and the toolbar (${viewport.width} px)`, async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.setViewportSize(viewport);
    // A small device memory keeps the start scene small on SwiftShader in CI; the grid it lowers shows a notice.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 0.25 });
    });
    await page.goto('/');
    const label = page.getByRole('button', { name: /^Scene: Three strains/ });
    await expect(label).toBeVisible();
    const notice = page.getByRole('status');
    await expect(notice).toContainText('Lowered the grid to', { timeout: 60_000 });
    const [l, n, t] = [await box(label), await box(notice), await box(page.getByRole('toolbar'))];
    expect(overlap(l, n)).toBe(false);
    expect(overlap(l, t)).toBe(false);
    expect(l.x).toBeGreaterThanOrEqual(0);
    expect(l.x + l.width).toBeLessThanOrEqual(viewport.width);
    // A lowered grid is the device's limit, not a change to the scene.
    await expect(label).not.toContainText('changed');
    await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 60_000 });
    expect(errors).toEqual([]);
  });
}

test('the scene card shows after choosing a preset', async ({ page }) => {
  const errors = watchErrors(page);
  await openSmallScene(page);
  // A shared link names no scene.
  await expect(page.getByRole('button', { name: /^Scene: Settings from a link/ })).toBeVisible();
  await expect(card(page)).toContainText('shared link');
  await preset(page).selectOption('shortest-path');
  await expect(card(page).getByRole('heading', { name: 'Shortest path' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Scene: Shortest path/ })).toBeVisible();
  await expect(card(page)).toContainText('the network shrinks to one short path');
  await expect(card(page)).toContainText('What to watch:');
  // The source chip explains Jones 2010.
  const chip = card(page).getByRole('button', { name: 'Jones 2010, Fig. 18' });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page)).toContainText('This scene uses the settings of Fig. 18 of the paper');
  // About this scene is collapsed until opened; its strain line comes from the settings.
  const about = card(page).getByText('About this scene');
  await expect(card(page).getByText('Why these settings')).toBeHidden();
  await about.click();
  await expect(card(page).getByText('Why these settings')).toBeVisible();
  await expect(card(page).getByRole('list', { name: 'Strains' })).toContainText(
    'sensor angle 45°, rotation 45°, sensor distance 9',
  );
  await page.waitForFunction(() => globalThis.physarum?.settings.foodStrength === 0.01);
  expect(await serious(page)).toEqual([]);
  // An edited model parameter marks the scene as changed, and the strain line follows it; Reload scene restores it.
  const angle = page.getByRole('spinbutton', { name: 'Sensor angle value' });
  await angle.fill('30');
  await angle.press('Enter');
  await expect(card(page).getByText('changed', { exact: true })).toBeVisible();
  await expect(card(page).getByRole('list', { name: 'Strains' })).toContainText('sensor angle 30°');
  await page.waitForFunction(() => globalThis.physarum?.settings.strains[0]?.sensorAngle === 30);
  await card(page).getByRole('button', { name: 'Reload scene' }).click();
  await expect(card(page).getByText('changed', { exact: true })).toBeHidden();
  await page.waitForFunction(() => globalThis.physarum?.settings.strains[0]?.sensorAngle === 45);
  expect(errors).toEqual([]);
});

test('hiding and showing the panel keeps the scene', async ({ page }) => {
  await openSmallScene(page);
  await preset(page).selectOption('spots');
  await expect(card(page).getByRole('heading', { name: 'Turing spots' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide settings' }).click();
  await expect(preset(page)).toBeHidden();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(preset(page)).toHaveValue('spots');
  await expect(card(page).getByRole('heading', { name: 'Turing spots' })).toBeVisible();
});

test('switching one agent per cell restarts the population, and its help opens', async ({ page }) => {
  const errors = watchErrors(page);
  await openSmallScene(page);
  await page.locator('canvas').click();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => globalThis.physarum?.paused)).toBe(true);
  expect(await page.evaluate(() => globalThis.physarum?.sim.step)).toBeGreaterThan(0);
  const help = page.getByRole('button', { name: 'About One agent per cell' });
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#rule-help')).toContainText('Switching the rule restarts the population.');
  const rule = page.getByRole('checkbox', { name: 'One agent per cell (Jones 2010)' });
  await rule.check();
  await page.waitForFunction(() => globalThis.physarum?.settings.collisions === true);
  await expect.poll(() => page.evaluate(() => globalThis.physarum?.sim.step)).toBe(0);
  await page.locator('canvas').click();
  await page.keyboard.press('.');
  await expect.poll(() => page.evaluate(() => globalThis.physarum?.sim.step)).toBe(1);
  await rule.uncheck();
  await page.waitForFunction(() => globalThis.physarum?.settings.collisions === false);
  await expect.poll(() => page.evaluate(() => globalThis.physarum?.sim.step)).toBe(0);
  expect(errors).toEqual([]);
});

test('switching the rule off in a Jones scene explains the collapse', async ({ page }) => {
  await openSmallScene(page);
  await preset(page).selectOption('spots');
  await page.waitForFunction(() => globalThis.physarum?.settings.collisions === true);
  await page.getByRole('checkbox', { name: 'One agent per cell (Jones 2010)' }).uncheck();
  await expect(page.getByRole('status')).toContainText('Without one agent per cell');
  await expect(card(page).getByText('changed', { exact: true })).toBeVisible();
});

test('without the rule in this browser, Jones scenes load with the switch off and one notice', async ({ page }) => {
  test.slow(); // waits for the notice to hide
  const errors = watchErrors(page);
  // WebGL2 without EXT_float_blend cannot run one agent per cell (ADR 0003, ADR 0008).
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'getExtension')?.value as (
      this: WebGL2RenderingContext,
      name: string,
    ) => unknown;
    Object.defineProperty(proto, 'getExtension', {
      value(this: WebGL2RenderingContext, name: string) {
        return name === 'EXT_float_blend' ? null : original.call(this, name);
      },
    });
  });
  await page.goto((await smallScene()).replace('/#', '/?backend=webgl2#'));
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => globalThis.physarum?.backend.supportsCollisions)).toBe(false);
  const rule = page.getByRole('checkbox', { name: /^One agent per cell/ });
  await preset(page).selectOption('spots');
  await expect(page.getByRole('status')).toContainText('cannot run one agent per cell');
  await expect(rule).not.toBeChecked();
  await expect(rule).toBeDisabled();
  await expect(card(page).getByText('changed', { exact: true })).toBeHidden();
  await expect(page.getByRole('status')).toBeHidden({ timeout: 20_000 });
  await preset(page).selectOption('shortest-path');
  await expect(card(page).getByRole('heading', { name: 'Shortest path' })).toBeVisible();
  await expect(rule).not.toBeChecked();
  await page.waitForTimeout(500);
  await expect(page.getByRole('status')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Learn → Scenes loads a scene, and the panel shows it', async ({ page }) => {
  const errors = watchErrors(page);
  await openSmallScene(page);
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Learn' });
  await dialog.getByRole('tab', { name: 'Scenes' }).click();
  for (const group of ['Start here', 'Jones 2010', 'Experiments', 'Fogleman 2020'])
    await expect(dialog.getByRole('heading', { name: group, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Details of Turing spots' }).click();
  await expect(dialog).toContainText('Why these settings:');
  expect(await serious(page, 'dialog')).toEqual([]);
  await dialog.getByRole('button', { name: 'Load Turing spots' }).click();
  await expect(dialog).toBeHidden();
  await expect(preset(page)).toHaveValue('spots');
  await expect(card(page).getByRole('heading', { name: 'Turing spots' })).toBeVisible();
  await page.waitForFunction(() => globalThis.physarum?.settings.collisions === true);
  expect(errors).toEqual([]);
});

test.describe('on a 375 × 812 phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const noSideways = (page: Page, selector: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no ${sel}`);
      const r = el.getBoundingClientRect();
      return {
        page: document.documentElement.scrollWidth <= innerWidth,
        inside: r.left >= 0 && r.right <= innerWidth,
        scroll: el.scrollWidth <= el.clientWidth,
      };
    }, selector);

  test('the panel and Learn do not scroll sideways', async ({ page }) => {
    await openSmallScene(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await preset(page).selectOption('shortest-path');
    await card(page).getByRole('button', { name: 'Jones 2010, Fig. 18' }).click();
    await card(page).getByText('About this scene').click();
    await expect(card(page).getByText('Why these settings')).toBeVisible();
    await page.getByRole('button', { name: 'About One agent per cell' }).click();
    expect(await noSideways(page, '.panel')).toEqual({ page: true, inside: true, scroll: true });
    await page.getByRole('button', { name: 'Learn', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Learn' });
    for (const tab of ['The model', 'Scenes']) {
      await dialog.getByRole('tab', { name: tab }).click();
      if (tab === 'Scenes') await dialog.getByRole('button', { name: 'Details of Dot grid' }).click();
      expect(await noSideways(page, 'dialog'), tab).toEqual({ page: true, inside: true, scroll: true });
      expect(await noSideways(page, '#learn-panel'), tab).toEqual({ page: true, inside: true, scroll: true });
    }
  });
});
