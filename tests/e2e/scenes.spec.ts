// Scene name, scene card, grouped presets, the one-agent-per-cell switch and Learn → Scenes.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PRESETS } from '../../src/model/presets';
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
    await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 120_000 });
    expect(errors).toEqual([]);
  });
}

test('the scene card shows after choosing a preset', async ({ page }) => {
  const errors = watchErrors(page);
  await openSmallScene(page);
  // A link with settings only names no scene (docs/adr/0021).
  await expect(page.getByRole('button', { name: /^Scene: Custom settings/ })).toBeVisible();
  await expect(card(page)).toContainText('These settings came from a link that names no scene');
  await preset(page).selectOption('shortest-path');
  await expect(card(page).getByRole('heading', { name: 'Shortest path' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Scene: Shortest path/ })).toBeVisible();
  await expect(card(page)).toContainText('the network contracts into one band between them');
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

/** Wall, food and light cells and a checksum of the environment the engine holds. */
const environment = (page: Page) =>
  page.evaluate(async () => {
    const env = (await globalThis.physarum?.sim.readEnv()) ?? new Uint8Array();
    const n = [0, 0, 0, 0];
    env.forEach((v, i) => {
      if (i % 4 < 3 && v > 0) n[i % 4] = (n[i % 4] ?? 0) + 1;
      n[3] = ((n[3] ?? 0) * 31 + v) % 2 ** 31;
    });
    return n;
  });

test('Reload scene restores food, light and walls, and keeps the focus in the card', async ({ page }) => {
  const errors = watchErrors(page);
  await openSmallScene(page);
  // Paused, a frame only draws: on SwiftShader in CI that keeps input and reads of the environment fast.
  await page.getByRole('button', { name: 'Pause' }).click();
  await preset(page).selectOption('maze');
  // The engine takes the scene's settings first, builds the new grid and then paints the walls. On
  // SwiftShader in CI the build takes seconds, and reading the environment meanwhile found no walls.
  await page.waitForFunction(
    () => globalThis.physarum?.settings.boundary === 'box' && !globalThis.physarum.busy,
    undefined,
    { timeout: 60_000 },
  );
  await expect.poll(async () => (await environment(page))[0], { timeout: 60_000 }).toBeGreaterThan(100);
  const scene = await environment(page);
  expect(scene[1], 'food cells').toBeGreaterThan(10);
  const changed = card(page).getByText('changed', { exact: true });
  await expect(changed).toBeHidden();
  // Painted food changes the scene (ADR 0019).
  await page.getByRole('radio', { name: 'Food' }).click();
  const canvas = await box(page.locator('canvas'));
  await page.mouse.move(canvas.x + canvas.width * 0.3, canvas.y + canvas.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.5, { steps: 2 });
  await page.mouse.up();
  // Strokes are painted in the next frame, and on SwiftShader a frame and a read of the environment can each
  // take a second: wait longer than expect.poll's default of 5 s.
  await expect.poll(async () => (await environment(page))[1], { timeout: 30_000 }).toBeGreaterThan(scene[1] ?? 0);
  await expect(changed).toBeVisible();
  await expect(card(page)).toContainText('You changed the scene.');
  // By keyboard: the button goes away with the change, and the focus stays in the card.
  await card(page).getByRole('button', { name: 'Reload scene' }).focus();
  await page.keyboard.press('Enter');
  await expect(card(page).getByRole('heading', { name: 'Maze' })).toBeFocused();
  await expect.poll(() => environment(page), { timeout: 30_000 }).toEqual(scene);
  await expect(changed).toBeHidden();
  // A Clear changes the scene too, and Reload scene brings its walls and food back.
  await page.locator('summary', { hasText: 'Environment' }).click();
  await page.getByRole('button', { name: 'Clear food, light and walls' }).click();
  await expect.poll(async () => (await environment(page)).slice(0, 3), { timeout: 30_000 }).toEqual([0, 0, 0]);
  await expect(changed).toBeVisible();
  await card(page).getByRole('button', { name: 'Reload scene' }).click();
  await expect.poll(() => environment(page), { timeout: 30_000 }).toEqual(scene);
  await expect(changed).toBeHidden();
  expect(errors).toEqual([]);
});

// Owner report: load the Maze, change the grid, and the walls and the food were gone (ADR 0019). Grids 512 and 256
// keep the scene small on SwiftShader in CI (ADR 0010).
test('the Maze keeps its walls and food when the grid changes, and gets them back unchanged', async ({ page }) => {
  const errors = watchErrors(page);
  await openSmallScene(page);
  // Paused, a frame only draws, and the startup check, which may lower the grid, waits.
  await page.getByRole('button', { name: 'Pause' }).click();
  await preset(page).selectOption('maze');
  const grid = (width: number) =>
    page.waitForFunction(
      (w) =>
        globalThis.physarum?.sim.width === w &&
        globalThis.physarum.settings.boundary === 'box' &&
        !globalThis.physarum.busy,
      width,
      { timeout: 60_000 },
    );
  await grid(512);
  await expect.poll(async () => (await environment(page))[0], { timeout: 60_000 }).toBeGreaterThan(100);
  const fine = await environment(page);
  const cellsOf = () =>
    page.evaluate(() => (globalThis.physarum?.sim.width ?? 0) * (globalThis.physarum?.sim.height ?? 0));
  const fineCells = await cellsOf();
  const select = page.getByRole('combobox', { name: 'Grid' });
  await select.selectOption('256');
  await grid(256);
  const coarse = await environment(page);
  const coarseCells = await cellsOf();
  // The same share of the box, painted again on the coarser grid.
  for (const channel of [0, 1]) {
    const [a, b] = [(fine[channel] ?? 0) / fineCells, (coarse[channel] ?? 0) / coarseCells];
    expect(Math.abs(b - a) / a, channel ? 'food' : 'walls').toBeLessThan(0.25);
  }
  await select.selectOption('512');
  await grid(512);
  expect(await environment(page)).toEqual(fine);
  expect(errors).toEqual([]);
});

test('the panel shows the density a scene runs, and a typed density is not rounded', async ({ page }) => {
  await openSmallScene(page);
  await preset(page).selectOption('steiner');
  await page.waitForFunction(() => globalThis.physarum?.settings.density === 0.02);
  const density = page.getByRole('spinbutton', { name: 'Agents per cell value' });
  await expect(density).toHaveValue('0.02');
  // The slider's step of 0.01 would make 0.01 of it: a log range keeps three significant digits.
  await density.fill('0.013');
  await density.press('Enter');
  await page.waitForFunction(() => globalThis.physarum?.settings.density === 0.013);
  await expect(density).toHaveValue('0.013');
});

test('More in Learn opens the topic for the source of the scene', async ({ page }) => {
  // A small memory budget keeps the Fogleman scene small on SwiftShader in CI.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 0.25 });
  });
  await openSmallScene(page);
  const dialog = page.getByRole('dialog', { name: 'Learn' });
  for (const [id, source, tab] of [
    ['spots', 'Jones 2010, Fig. 16 (top)', 'The model'],
    ['dunes', 'Fogleman 2020', 'About'],
    ['maze', 'Nakagaki et al. 2000', 'Physarum'],
    ['three-strains', 'Made for this app', 'Scenes'],
  ] as const) {
    await preset(page).selectOption(id);
    const chip = card(page).getByRole('button', { name: source, exact: true });
    if ((await chip.getAttribute('aria-expanded')) !== 'true') await chip.click();
    const more = card(page).getByRole('button', { name: 'More in Learn' });
    await more.click();
    await expect(dialog.getByRole('tab', { name: tab, exact: true }), id).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();
  }
});

/** A slow GPU start: the panel already works, the engine does not exist yet. */
const slowStart = (page: Page) =>
  page.addInitScript(() => {
    // The small memory budget keeps the start scene small on SwiftShader in CI.
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 0.25 });
    const gpu = navigator.gpu as GPU | undefined;
    if (!gpu) return;
    const request = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = (options) =>
      new Promise((resolve) => setTimeout(() => void request(options).then(resolve), 3000));
  });

test('a preset chosen while the engine starts is the one that runs', async ({ page }) => {
  const errors = watchErrors(page);
  await slowStart(page);
  // A shared link first: from its address, '/' is a new page load, not a jump within the page.
  for (const url of [await smallScene(), '/']) {
    await page.goto(url);
    await preset(page).selectOption('maze');
    expect(await page.evaluate(() => globalThis.physarum === undefined), url).toBe(true);
    await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 120_000 });
    const s = await page.evaluate(() => globalThis.physarum?.settings);
    expect([s?.boundary, s?.density, s?.collisions], url).toEqual(['box', 0.12, true]);
    expect((await environment(page))[0], `${url}: wall cells`).toBeGreaterThan(100);
    await expect(page.getByRole('button', { name: /^Scene: Maze/ })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

/** The centres of the food sources: groups of food cells that touch. */
const foodSources = (page: Page) =>
  page.evaluate(async () => {
    const sim = globalThis.physarum?.sim;
    if (!sim) return [];
    const [env, w, h] = [await sim.readEnv(), sim.width, sim.height];
    const seen = new Uint8Array(w * h);
    const centres: [number, number][] = [];
    for (let c = 0; c < w * h; c++) {
      if (seen[c] || !env[c * 4 + 1]) continue;
      let [n, sx, sy] = [0, 0, 0];
      const stack = [c];
      seen[c] = 1;
      for (let k = stack.pop(); k !== undefined; k = stack.pop()) {
        const [x, y] = [k % w, Math.floor(k / w)];
        [n, sx, sy] = [n + 1, sx + x + 0.5, sy + y + 0.5];
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const) {
          const q = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[q] || !env[q * 4 + 1]) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
      centres.push([sx / n, sy / n]);
    }
    return centres;
  });

// App.svelte starts the engine with what the panel holds (startScene in state.svelte.ts): a scene's shapes stay in
// the frame of the scene's own arena, and a Clear made meanwhile counts (ADR 0019).
test('a boundary or a Clear chosen while the engine starts reaches the scene', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 800, height: 800 });
  await slowStart(page);
  await page.goto(await smallScene());
  await preset(page).selectOption('steiner');
  await page.getByLabel('Edges').selectOption('box');
  expect(await page.evaluate(() => globalThis.physarum === undefined)).toBe(true);
  const ready = (boundary: string) =>
    page.waitForFunction((b) => globalThis.physarum?.settings.boundary === b && !globalThis.physarum.busy, boundary, {
      timeout: 120_000,
    });
  await ready('box');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await foodSources(page)).length, { timeout: 30_000 }).toBe(4);
  // Four foods in a square: four equal sides, and diagonals √2 times as long.
  const c = await foodSources(page);
  const d = c.flatMap((p, i) => c.slice(i + 1).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))).sort((x, y) => x - y);
  const [sides, diagonals] = [d.slice(0, 4), d.slice(4)];
  expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(0.5);
  for (const diagonal of diagonals) expect(Math.abs(diagonal / (d[0] ?? NaN) - Math.SQRT2)).toBeLessThan(0.01);
  // The same bytes as Steiner tree loaded in its dish and then switched to the box.
  const started = await environment(page);
  await card(page).getByRole('button', { name: 'Reload scene' }).click();
  await ready('dish');
  await page.getByLabel('Edges').selectOption('box');
  await ready('box');
  await expect.poll(() => environment(page), { timeout: 30_000 }).toEqual(started);

  // The Maze, cleared before the engine exists: it starts without walls and food, and the card offers them back.
  // From the shared link's address, '/' is a new page load, not a jump within the page.
  await page.goto('/');
  await preset(page).selectOption('maze');
  await page.locator('summary', { hasText: 'Environment' }).click();
  await page.getByRole('button', { name: 'Clear food, light and walls' }).click();
  expect(await page.evaluate(() => globalThis.physarum === undefined)).toBe(true);
  await ready('box');
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 0, undefined, { timeout: 60_000 });
  expect((await environment(page)).slice(0, 2)).toEqual([0, 0]);
  await expect(card(page).getByText('changed', { exact: true })).toBeVisible();
  await card(page).getByRole('button', { name: 'Reload scene' }).click();
  await expect.poll(async () => (await environment(page))[0], { timeout: 60_000 }).toBeGreaterThan(100);
  expect((await environment(page))[1]).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('the scene name shows its focus ring on its own glass, readable on every style', async ({ page }) => {
  await openSmallScene(page);
  await page.getByRole('button', { name: 'Hide settings' }).focus();
  await page.keyboard.press('Tab');
  const label = page.getByRole('button', { name: /^Scene: / });
  await expect(label).toBeFocused();
  const ring = await label.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      visible: el.matches(':focus-visible'),
      style: cs.outlineStyle,
      outside: parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth),
    };
  });
  // The ring ends at the label's edge: it lies on the label's glass, not on the canvas.
  expect(ring).toEqual({ visible: true, style: 'solid', outside: 0 });
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
  await expect(page.locator('#rule-help')).toContainText('A switch restarts the population.');
  const rule = page.getByRole('checkbox', { name: 'One agent per cell (Jones 2010)' });
  // Like the sliders, the switch names its open help as its description.
  await expect(rule).toHaveAttribute('aria-describedby', 'rule-help');
  await expect(rule).toHaveAccessibleDescription(/Jones’ rule: a cell holds at most one agent/);
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
  // The Jones model always has the rule: only the extended model can switch it off (ADR 0022).
  await expect(page.getByRole('checkbox', { name: /^One agent per cell/ })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Model' }).selectOption('extended');
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
  await expect(page.getByRole('status')).toBeHidden({ timeout: 40_000 });
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

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]) {
  test(`Learn → Scenes keeps the focused button below its sticky header (${viewport.width} px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openSmallScene(page);
    await page.getByRole('button', { name: 'Learn', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Learn' });
    await dialog.getByRole('tab', { name: 'Scenes' }).click();
    // From the last scene back to the first, as a keyboard user goes back with Shift+Tab.
    await dialog.getByRole('button', { name: 'Details of Dot grid' }).focus();
    const covered: string[] = [];
    let stops = 0;
    for (;;) {
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        const head = document.querySelector('dialog header')?.getBoundingClientRect();
        if (!(el instanceof HTMLElement) || !head) throw new Error('no focus or no header');
        return {
          name: el.textContent.trim(),
          inScenes: el.closest('.scenes') !== null,
          covered: el.getBoundingClientRect().top < head.bottom,
        };
      });
      if (!stop.inScenes) break;
      stops++;
      if (stop.covered) covered.push(stop.name);
      await page.keyboard.press('Shift+Tab');
    }
    expect(stops).toBe(2 * PRESETS.length); // Load and Details of every scene
    expect(covered).toEqual([]);
  });
}

test.describe('on a 375 × 812 phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the scene name opens the card, and the panel starts below the name and any notice', async ({ page }) => {
    const errors = watchErrors(page);
    await openSmallScene(page);
    const label = page.getByRole('button', { name: /^Scene: / });
    await label.click();
    await expect(card(page)).toBeVisible();
    await preset(page).selectOption('spots');
    await page.waitForFunction(() => globalThis.physarum?.settings.collisions === true);
    await page.getByRole('button', { name: 'Hide settings' }).click();
    await expect(card(page)).toBeHidden();
    // The scene name opens the settings at the card, with About this scene open.
    await label.click();
    await expect(card(page).getByRole('heading', { name: 'Turing spots' })).toBeInViewport();
    await expect(card(page).getByText('Why these settings')).toBeVisible();
    const panel = page.locator('#settings');
    const below = async (above: Locator) => (await box(panel)).y - ((await box(above)).y + (await box(above)).height);
    expect(await below(label)).toBeGreaterThanOrEqual(0);
    // A notice pushes the panel down instead of covering the preset list and the card.
    await page.getByRole('combobox', { name: 'Model' }).selectOption('extended');
    await page.getByRole('checkbox', { name: 'One agent per cell (Jones 2010)' }).uncheck();
    const notice = page.getByRole('status');
    await expect(notice).toContainText('Without one agent per cell');
    await expect.poll(() => below(notice)).toBeGreaterThanOrEqual(0);
    expect(overlap(await box(label), await box(notice))).toBe(false);
    expect(errors).toEqual([]);
  });

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
