// Flow in the tubes (ADR 0029): the switch of the extended model, its strength, the scene card and the link.
import { expect, test, type Page } from '@playwright/test';
import { decodeLink } from '../../src/model/url';
import { smallScene, watchErrors } from './helpers';

// The start took 32 s on SwiftShader on an M3 Pro (review of 2026-11-11): 150 s keeps it under a quarter (ADR 0010).
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 150_000 });
}

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
    const errors = watchErrors(page);
    await page.setViewportSize(viewport);
    await open(page, await smallScene({ resolution: 256 }));
    // On a phone the panel opens with the Settings button.
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    if (await settings.isVisible()) await settings.click();
    await page.getByRole('combobox', { name: 'Preset' }).selectOption('tokyo');
    await page.waitForFunction(
      () => globalThis.physarum?.settings.flow === true && globalThis.physarum.sim.width === 512,
      undefined,
      { timeout: 150_000 },
    );
    const state = await page.evaluate(() => {
      const e = globalThis.physarum;
      return e && { size: [e.sim.width, e.sim.height], lattice: e.settings.lattice, flux: e.settings.flowStrength };
    });
    expect(state).toEqual({ size: [512, 512], lattice: [512, 512], flux: 1.4 });
    const card = page.getByRole('region', { name: 'Scene', exact: true });
    await expect(card.getByRole('heading', { name: 'Tokyo rail network' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Tero et al. 2010, Fig. 1' })).toBeVisible();
    for (const chip of ['One agent per cell', 'Growth and shrinkage', 'Flow in the tubes'])
      await expect(card.getByText(chip, { exact: true })).toBeVisible();
    await expect(card.getByText('changed', { exact: true })).toHaveCount(0);
    // The colony of about 50 agents at Tokyo grows: more agents live some steps later.
    const alive = () =>
      page.evaluate(async () => (await globalThis.physarum?.sim.alive())?.reduce((a, b) => a + b, 0) ?? 0);
    await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) >= 3, undefined, { timeout: 120_000 });
    const first = await alive();
    expect(first).toBeGreaterThan(20);
    expect(first).toBeLessThan(2000);
    await expect.poll(alive, { timeout: 120_000 }).toBeGreaterThan(first + 20);
    // The simulation holds the memory of the flow, and Tokyo's food sites lie in the middle part of the lattice.
    expect(await memory(page)).toBe(512 * 512 * 4);
    expect(errors).toEqual([]);
  });
}
