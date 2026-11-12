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

// The scent view (ADR 0009, amendments of 2026-11-11): a switch of the look, with a key and a legend. It goes into the
// link as the style does, changes no scene and does not restart the simulation. The legend names what the scene holds.
test('the Scent switch and the S key show the scent with its legend, and go into the link', async ({ page }) => {
  const errors = watchErrors(page);
  const button = page.getByRole('button', { name: 'Scent', exact: true });
  const legend = page.getByRole('figure', { name: 'Scent per cell' });
  // The small scene has no food and no light: the legend says so.
  await button.click();
  await expect(legend).toContainText('no food and no light');
  await button.click();
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('light');
  // The scene has another density than the small scene, so the engine builds a new simulation, and that restart comes
  // after the settings: wait for it to end before counting restarts.
  await page.waitForFunction(() => globalThis.physarum?.settings.lightStrength === 0.2 && !globalThis.physarum.busy);
  const changed = page.getByRole('region', { name: 'Scene', exact: true }).getByText('changed', { exact: true });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(legend).toHaveCount(0);
  const restarts = await page.evaluate(() => globalThis.physarum?.restarts);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(legend).toBeVisible();
  // Fleeing light has light and no food.
  await expect(legend.getByText(/^Light \(pink glow\)$/)).toBeVisible();
  await expect(legend.getByText(/^Food/)).toHaveCount(0);
  await expect(legend).toHaveAccessibleDescription(/Pink glow/);
  await page.waitForFunction(() => globalThis.physarum?.settings.showScent === true);
  await expect(changed).toHaveCount(0);
  await expect
    .poll(async () => (await decodeLink(await page.evaluate(() => location.hash.slice(1))))?.settings.showScent)
    .toBe(true);
  const axe = await new AxeBuilder({ page }).include('figure').analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  // The key works right after a click on a toolbar button, and not in a number field.
  await button.focus();
  await page.keyboard.press('s');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(legend).toHaveCount(0);
  await page.waitForFunction(() => globalThis.physarum?.settings.showScent === false);
  await page.getByRole('button', { name: 'Fit' }).click();
  await page.keyboard.press('s');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Agents per cell value').focus();
  await page.keyboard.press('s');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => globalThis.physarum?.restarts)).toBe(restarts);
  expect(errors).toEqual([]);
});

// Shortcuts work whenever the focus is not on a control that uses the key: before, a click on a toolbar button kept
// every key from the app until the canvas was clicked.
test('shortcuts work after a click on a toolbar button', async ({ page }) => {
  await page.getByRole('button', { name: 'Fit' }).click();
  await page.keyboard.press('5');
  await expect(page.getByRole('radio', { name: 'Wall' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Move' }).click();
  await page.keyboard.press('h');
  await expect(page.getByRole('toolbar', { name: 'Simulation controls' })).toBeHidden();
  await page.keyboard.press('h');
  await expect(page.getByRole('toolbar', { name: 'Simulation controls' })).toBeVisible();
  // Space presses the focused button, not the shortcut.
  const paused = await page.evaluate(() => globalThis.physarum?.paused);
  await page.getByRole('button', { name: 'Fit' }).focus();
  await page.keyboard.press(' ');
  expect(await page.evaluate(() => globalThis.physarum?.paused)).toBe(paused);
});

// The legend never covers the toolbar or the stats: the toolbar wraps into two rows on a tablet with the panel open
// (review of 2026-11-11). On a phone the legend is small, it hides while the panel covers the picture, and the toolbar
// scrolls to the Scent button.
for (const [width, height] of [
  [375, 812],
  [812, 375],
  [721, 900],
  [768, 1024],
  [1280, 800],
] as const)
  test(`the scent legend stays clear of the toolbar and the stats (${width} × ${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    if (await settings.isVisible()) await settings.click();
    await page.getByRole('combobox', { name: 'Preset' }).selectOption('maze');
    await page.waitForFunction(() => globalThis.physarum?.settings.foodStrength === 0.03);
    const button = page.getByRole('button', { name: 'Scent', exact: true });
    await button.click(); // scrolls the toolbar to it on a phone
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const legend = page.getByRole('figure', { name: 'Scent per cell' });
    if (width <= 720) {
      await expect(legend).toBeHidden(); // the panel covers the picture
      await page.getByRole('button', { name: 'Hide settings' }).click();
    }
    await expect(legend).toBeVisible();
    // What the line means, read after the bars (the review of 2026-11-11 heard "a strand" before "Food"). The row
    // shows once the auto levels measured a strand of the Maze's own simulation (ScentLegend.svelte reads it every
    // 500 ms): on SwiftShader on an M3 Pro 2.5 to 4.5 s after the switch, on GitHub's runners more (ADR 0010).
    await page.waitForFunction(
      () => {
        const e = globalThis.physarum;
        return !!e && !e.busy && e.levels().strand > 0;
      },
      undefined,
      { timeout: 90_000 },
    );
    const line = legend.getByText('Inside the line, food steers an agent more than a strand holds it.');
    await expect(line).toBeVisible({ timeout: 10_000 });
    await expect(legend).toHaveText(/^Scent per cell\s*Food/);
    const box = await legend.boundingBox();
    if (!box) throw new Error('no legend');
    const others = [page.locator('.stats'), ...(await page.locator('.toolbar .group').all())];
    for (const other of others) {
      const o = await other.boundingBox();
      if (!o || !(await other.isVisible())) continue;
      const apart =
        box.y + box.height <= o.y || o.y + o.height <= box.y || box.x + box.width <= o.x || o.x + o.width <= box.x;
      expect(apart, `${JSON.stringify(box)} against ${JSON.stringify(o)}`).toBe(true);
    }
    if (width <= 720 || height <= 500) expect(box.height).toBeLessThan(130); // compact
    // The numbers below the bar keep at least 3 px apart (the review of 2026-11-11 read "0.010.1" and "1k10k+").
    const ticks = await legend.locator('.ticks > span').evaluateAll((spans) =>
      spans
        .filter((s) => s.checkVisibility())
        .map((s) => s.getBoundingClientRect())
        .map((r) => [r.left, r.right] as const)
        .sort((a, b) => a[0] - b[0]),
    );
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    for (let k = 1; k < ticks.length; k++)
      expect((ticks[k]?.[0] ?? 0) - (ticks[k - 1]?.[1] ?? 0), JSON.stringify(ticks)).toBeGreaterThanOrEqual(3);
  });

// A lost device stays the message: the scent view asked for afterwards compiles nothing and reports no error of its
// own (review of 2026-11-11: WebGL2 replaced the loss by "GLSL compile error: ."). A device that something else
// destroys is a loss too (WebGPU reported nothing).
for (const [name, query] of [
  ['WebGPU', ''],
  ['WebGL2', '?backend=webgl2'],
] as const)
  test(`a lost device stays reported when the scent view is asked for (${name})`, async ({ page }) => {
    await page.goto((await smallScene()).replace('/#', `/${query}#`));
    await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 120_000 });
    await page.evaluate(() => {
      const backend = globalThis.physarum?.backend as unknown as {
        gpu?: { device: GPUDevice };
        gl?: WebGL2RenderingContext;
      };
      if (backend.gpu) backend.gpu.device.destroy();
      else backend.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('The graphics device was lost');
    await page.keyboard.press('s');
    await page.waitForFunction(() => globalThis.physarum?.settings.showScent === true);
    await page.waitForTimeout(1000); // a build of the view would fail within this
    await expect(alert).toContainText('The graphics device was lost');
    await expect(alert).not.toContainText('error');
  });

// The legend lies on the glass of the other panels, without a backdrop blur (ADR 0028), and its text keeps WCAG 2.2
// contrast (1.4.3: 4.5:1) over a white canvas, as glass.test.ts asks of the panels: the worst case of the paper style.
test('the scent legend keeps its text readable on the glass over a white canvas', async ({ page }) => {
  await page.locator('summary', { hasText: 'Look' }).click();
  await page.getByRole('combobox', { name: 'Style' }).selectOption('paper');
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('light');
  await page.waitForFunction(() => globalThis.physarum?.settings.lightStrength === 0.2);
  await page.getByRole('button', { name: 'Scent', exact: true }).click();
  const legend = page.getByRole('figure', { name: 'Scent per cell' });
  await expect(legend).toBeVisible();
  const { glass, blur, texts } = await legend.evaluate((figure) => {
    const rgba = (v: string) => (v.match(/[\d.]+/g) ?? []).map(Number);
    const style = getComputedStyle(figure);
    const texts = [...figure.querySelectorAll('*')]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()))
      .filter((el) => el.checkVisibility())
      .map((el) => ({ text: el.textContent.trim(), color: rgba(getComputedStyle(el).color) }));
    return { glass: rgba(style.backgroundColor), blur: style.backdropFilter, texts };
  });
  expect(blur).toBe('none');
  const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = ([r = 0, g = 0, b = 0]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const [r = 0, g = 0, b = 0, a = 1] = glass;
  const panel = [r, g, b].map((v) => a * v + (1 - a) * 255); // the glass over white
  expect(texts.length).toBeGreaterThan(5);
  for (const { text, color } of texts) {
    const [cr = 0, cg = 0, cb = 0, ca = 1] = color;
    const shown = [cr, cg, cb].map((v, k) => ca * v + (1 - ca) * (panel[k] ?? 0)); // a text colour with alpha
    const [hi, lo] = [luminance(shown), luminance(panel)].sort((x, y) => y - x);
    expect(((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05), text).toBeGreaterThanOrEqual(4.5);
  }
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
