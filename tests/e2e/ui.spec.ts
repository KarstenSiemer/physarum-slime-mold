import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { decodeLink } from '../../src/model/url';
import { openSmallScene, smallScene, watchErrors } from './helpers';

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

// Owner decision 2026-11-11 (ADR 0022): the Jones model offers only Jones' settings. The extended model shows its
// own settings beside the choice, and a switch back to Jones drops them from the settings and from the link.
test('the Jones model offers only Jones’ settings, and a switch back to it drops the extended ones', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('network');
  await page.waitForFunction(() => globalThis.physarum?.settings.model === 'jones');
  const model = page.getByRole('combobox', { name: 'Model' });
  const saturation = page.getByLabel('Trail saturation', { exact: true });
  const light = page.getByRole('radio', { name: 'Light' });
  const rule = page.getByRole('checkbox', { name: /^One agent per cell/ });
  const covered = page.getByRole('checkbox', { name: 'Covered food releases less' });
  const changed = page.getByRole('region', { name: 'Scene', exact: true }).getByText('changed', { exact: true });
  await expect(model).toHaveValue('jones');
  await expect(saturation).toHaveCount(0);
  await expect(page.getByLabel('Scent decay', { exact: true })).toHaveCount(0);
  await expect(light).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add strain' })).toHaveCount(0);
  await expect(rule).toBeChecked();
  await expect(rule).toBeDisabled();
  await page.locator('summary', { hasText: 'Environment' }).click();
  await expect(covered).toBeVisible();
  // Extended shows its settings beside the choice.
  await model.selectOption('extended');
  await expect(saturation).toBeVisible();
  await expect(page.getByLabel('Scent decay', { exact: true })).toBeVisible();
  await expect(light).toBeVisible();
  await expect(rule).toBeEnabled();
  await page.getByLabel('Trail saturation value').fill('30');
  await page.getByLabel('Trail saturation value').press('Enter');
  await covered.check();
  await page.waitForFunction(() => {
    const s = globalThis.physarum?.settings;
    return s?.trailSaturation === 30 && s.coveredFood;
  });
  // The page address follows the settings a little later.
  const link = async () => {
    const s = (await decodeLink((await page.evaluate(() => location.hash)).slice(1)))?.settings;
    return [s?.model, s?.trailSaturation, s?.coveredFood];
  };
  await expect.poll(link).toEqual(['extended', 30, true]);
  await covered.uncheck();
  // Back to Jones: K goes from the settings and the link, and the scene is the scene again.
  await model.selectOption('jones');
  await page.waitForFunction(() => {
    const s = globalThis.physarum?.settings;
    return s?.model === 'jones' && s.trailSaturation === 0;
  });
  await expect(saturation).toHaveCount(0);
  await expect(changed).toBeHidden();
  await expect.poll(link).toEqual(['jones', 0, false]);
  expect(errors).toEqual([]);
});

test('a switch to Jones keeps strain A and says what went', async ({ page }) => {
  const errors = watchErrors(page);
  // The small scene: two strains without the rule, on the extended model.
  await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue('extended');
  await page.getByRole('combobox', { name: 'Model' }).selectOption('jones');
  await expect(page.getByRole('status')).toContainText('It removed strain B and agents that share a cell.');
  await page.waitForFunction(() => {
    const s = globalThis.physarum?.settings;
    return s?.model === 'jones' && s.strains.length === 1 && s.collisions;
  });
  expect(errors).toEqual([]);
});

// ADR 0022, decisions 25 and 29: the tools follow the model, also after a change of the preset, and the panel says
// that the Jones model draws light without effect.
test('the Jones model offers no Light tool, and says that drawn light has no effect', async ({ page }) => {
  const errors = watchErrors(page);
  const preset = page.getByRole('combobox', { name: 'Preset' });
  const light = page.getByRole('radio', { name: 'Light' });
  const move = page.getByRole('radio', { name: 'Move' });
  const hint = page.locator('#jones-light');
  await preset.selectOption('light');
  await light.click();
  await preset.selectOption('network');
  await expect(light).toHaveCount(0);
  await expect(move).toHaveAttribute('aria-checked', 'true');
  await preset.selectOption('light');
  await page.waitForFunction(() => globalThis.physarum?.settings.lightStrength === 0.2);
  await light.click();
  await expect(hint).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Model' }).selectOption('jones');
  await expect(page.getByRole('status')).toContainText('It changed Light strength from 0.2 to 0.05.');
  await expect(light).toHaveCount(0);
  await expect(move).toHaveAttribute('aria-checked', 'true');
  await expect(hint).toHaveText(
    'The light on the canvas has no effect in the Jones model. To remove it, use the Erase tool. To use it, select Extended.',
  );
  await expect(page.getByRole('combobox', { name: 'Model' })).toHaveAttribute('aria-describedby', 'jones-light');
  await page.locator('summary', { hasText: 'Environment' }).click();
  await page.getByRole('button', { name: 'Clear food, light and walls' }).click();
  await expect(hint).toHaveCount(0);
  expect(errors).toEqual([]);
});

// A key can select another tool while the inoculate or cut tool is held: the held tool then stops (decision 31).
test('a held agent tool acts only while it is selected', async ({ page }) => {
  await page.evaluate(() => {
    const e = globalThis.physarum;
    if (!e) throw new Error('no engine');
    const agentTool = e.agentTool.bind(e);
    const g = globalThis as unknown as { held: number };
    g.held = 0;
    e.agentTool = (t) => {
      g.held++;
      agentTool(t);
    };
  });
  const held = () => page.evaluate(() => (globalThis as unknown as { held: number }).held);
  await page.getByRole('radio', { name: 'Inoculate' }).click();
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await expect.poll(held, { timeout: 60_000 }).toBeGreaterThan(2);
  await page.keyboard.press('3');
  await expect(page.getByRole('radio', { name: 'Food' })).toHaveAttribute('aria-checked', 'true');
  const stopped = await held();
  // Longer than a few frames, also on SwiftShader.
  await page.waitForTimeout(1000);
  expect(await held()).toBe(stopped);
  await page.keyboard.press('7');
  await expect.poll(held, { timeout: 60_000 }).toBeGreaterThan(stopped);
  await page.mouse.up();
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

// Inoculate places only dead agents (docs/adr/0023). In the small scene every agent is alive: the tool places nothing
// and says so. The alive count in the stats is at most 500 ms old.
test('the inoculate tool says so when no dead agents of its strain are left', async ({ page }) => {
  await page.getByRole('radio', { name: 'Inoculate' }).click();
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await expect(page.getByRole('status')).toContainText('All agents of strain A are alive.', { timeout: 60_000 });
  await page.mouse.up();
});

// Paused, a hold runs steps only while a dead agent of the strain is known (docs/adr/0023). Here every agent lives:
// the steps would only move the paused scene.
test('a paused hold of the inoculate tool runs no step while every agent of its strain lives', async ({ page }) => {
  await expect(page.locator('.stats')).toContainText('agents', { timeout: 60_000 }); // a count of this run
  await page.locator('canvas').click();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => globalThis.physarum?.paused)).toBe(true);
  await page.getByRole('radio', { name: 'Inoculate' }).click();
  const step = await page.evaluate(() => globalThis.physarum?.sim.step);
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await expect(page.getByRole('status')).toContainText('All agents of strain A are alive.', { timeout: 60_000 });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => globalThis.physarum?.sim.step)).toBe(step);
  await page.mouse.up();
});

// The start layout Empty restarts a scene where every agent lived. For up to 500 ms the stats still hold the count of
// the run before: the tool must not take it for this one (docs/adr/0023). Paused, the hold waits for the count of the
// new run, which WebGPU must take after the reset: before, it gave the count of the last step before it.
for (const paused of [false, true])
  test(`the inoculate tool places agents right after a restart into the empty start layout (paused ${paused})`, async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await expect(page.locator('.stats')).toContainText('agents', { timeout: 60_000 });
    if (paused) {
      await page.locator('canvas').click();
      await page.keyboard.press('Space');
      await expect.poll(() => page.evaluate(() => globalThis.physarum?.paused)).toBe(true);
    }
    await page.getByRole('radio', { name: 'Inoculate' }).click();
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('no canvas');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const restarts = await page.evaluate(() => globalThis.physarum?.restarts ?? 0);
    await page.getByLabel('Start layout').selectOption('empty');
    await page.waitForFunction((r) => (globalThis.physarum?.restarts ?? 0) > r, restarts);
    await page.mouse.down();
    // The agents themselves: on WebGPU the alive count of the old code still said that every agent lives.
    const alive = () =>
      page.evaluate(async () => (await globalThis.physarum?.sim.readAgents())?.filter((a) => a.bits & 4).length);
    await expect.poll(alive, { timeout: 60_000 }).toBeGreaterThan(50);
    // Longer than the stats interval (500 ms): a count that said every agent lives would have shown the notice.
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByRole('status').filter({ hasText: 'are alive' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

test('the inoculate tool brings dead agents to life in the empty start layout', async ({ page }) => {
  const errors = watchErrors(page);
  // A new hash alone would not load the page again.
  await page.goto('about:blank');
  await page.goto(await smallScene({ layout: 'empty' }));
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 120_000 });
  const alive = () => page.evaluate(async () => (await globalThis.physarum?.sim.alive())?.reduce((a, b) => a + b, 0));
  expect(await alive()).toBe(0);
  await page.getByRole('radio', { name: 'Inoculate' }).click();
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await expect.poll(alive, { timeout: 60_000 }).toBeGreaterThan(50);
  await page.mouse.up();
  await expect(page.getByRole('status').filter({ hasText: 'are alive' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Growth and shrinkage need one agent per cell (ADR 0025): without the rule the switch is off and disabled. A scene of
// Jones offers it, its values show while it is on, the card names it and counts it as a change, and the link holds it.
test('the Growth section offers growth with the rule, and the scene card and the link follow it', async ({ page }) => {
  const errors = watchErrors(page);
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
  expect(errors).toEqual([]);
});

// A Capacity above Agents per cell keeps dead agents in a full scene (ADR 0025): Inoculate places them.
test('a higher capacity gives the inoculate tool agents in a full scene', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('about:blank');
  await page.goto(await smallScene({ capacity: 1 }));
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 120_000 });
  const alive = () => page.evaluate(async () => (await globalThis.physarum?.sim.alive())?.reduce((a, b) => a + b, 0));
  const start = (await alive()) ?? 0;
  expect(await page.evaluate(() => globalThis.physarum?.sim.agents)).toBeGreaterThan(start);
  await page.getByRole('radio', { name: 'Inoculate' }).click();
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await expect.poll(alive, { timeout: 60_000 }).toBeGreaterThan(start + 50);
  await page.mouse.up();
  await expect(page.getByRole('status').filter({ hasText: 'are alive' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Growth brings dead agents to life from 1 % of the cells, with one agent per cell (ADR 0025).
test('growth adds agents from a small start', async ({ page }) => {
  const errors = watchErrors(page);
  const alive = () => page.evaluate(async () => (await globalThis.physarum?.sim.alive())?.reduce((a, b) => a + b, 0));
  await page.goto('about:blank');
  await page.goto(await smallScene({ collisions: true, density: 0.01, capacity: 1, growth: true, layout: 'center' }));
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 120_000 });
  const first = (await alive()) ?? 0;
  await expect.poll(alive, { timeout: 60_000 }).toBeGreaterThan(2 * first);
  expect(errors).toEqual([]);
});
