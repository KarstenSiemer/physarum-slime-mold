// A scene of Jones runs on the lattice of its figure (ADR 0026): the grid choice, the hint with its way back, the
// link, and tools on the letterboxed view. Steiner tree has 200 × 200 cells and 800 agents: fast on SwiftShader in CI.
import { expect, test, type Page } from '@playwright/test';
import type { Settings } from '../../src/model/params';
import { presetById, shapeRevision } from '../../src/model/presets';
import { decodeLink, encodeLink } from '../../src/model/url';
import { watchErrors } from './helpers';

const card = (page: Page) => page.getByRole('region', { name: 'Scene', exact: true });
const grid = (page: Page) => page.getByRole('combobox', { name: 'Grid' });
const hint = (page: Page) => page.locator('#lattice-help');

/** The grid the engine runs, once no rebuild is going on. */
const simGrid = (page: Page) =>
  page.evaluate(() => {
    const e = globalThis.physarum;
    return e && !e.busy ? [e.sim.width, e.sim.height] : undefined;
  });

/** Steiner tree from a link, paused: one page load (a new WebGPU device on SwiftShader in CI takes seconds). */
async function openSteiner(page: Page, query = '') {
  const p = presetById('steiner');
  if (!p) throw new Error('no Steiner tree');
  const { hash } = await encodeLink(p.settings(), {
    scene: p.id,
    revision: shapeRevision(p),
    origins: [0],
    shapes: p.env?.map(() => true) ?? [],
    strokes: [],
  });
  await page.goto(`/${query}#${hash}`);
  await expect.poll(() => simGrid(page), { timeout: 120_000 }).toEqual([200, 200]);
  // Paused, a frame only draws: on SwiftShader in CI that keeps input and reads fast.
  await page.getByRole('button', { name: 'Pause' }).click();
}

/** The settings of the page address once it follows the state (App.svelte writes it 400 ms after a change). */
async function linked(page: Page) {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => location.hash);
        const same = now === last;
        last = now;
        return same;
      },
      { timeout: 30_000, intervals: [700] },
    )
    .toBe(true);
  return (await decodeLink(last.slice(1)))?.settings;
}

for (const [backend, query] of [
  ['WebGPU', ''],
  ['WebGL2', '?backend=webgl2'],
] as const) {
  test(`a scene of Jones keeps its lattice; another grid shows why, and the hint’s button restores it (${backend})`, async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openSteiner(page, query);
    await expect(grid(page)).toHaveValue('200x200');
    await expect(grid(page).locator('option:checked')).toHaveText('200 × 200 cells, as in the paper');
    await expect(hint(page)).toBeHidden();
    await expect(card(page).getByText('changed', { exact: true })).toBeHidden();

    await grid(page).selectOption('256');
    await expect.poll(() => simGrid(page), { timeout: 120_000 }).not.toEqual([200, 200]);
    await expect(hint(page)).toContainText('This grid has 256 cells on the long side.');
    await expect(hint(page)).toContainText('For this figure, Jones used 200 × 200 cells.');
    await expect(hint(page)).toContainText('Sensor distance and Step size');
    await expect(hint(page)).toContainText('the pattern keeps its size in cells');
    await expect(grid(page)).toHaveAttribute('aria-describedby', 'lattice-help');
    await expect(card(page).getByText('changed', { exact: true })).toBeVisible();
    await expect(card(page)).toContainText('You changed the scene.');
    // The grid choice still lists the paper's lattice.
    await expect(grid(page).locator('option[value="200x200"]')).toHaveText('200 × 200 cells, as in the paper');
    // The link holds the grid shaped like the screen.
    expect((await linked(page))?.lattice).toBeNull();

    // The button removes itself with the hint: the focus goes to the grid choice.
    await hint(page).getByRole('button', { name: 'Use 200 × 200 cells' }).click();
    await expect.poll(() => simGrid(page), { timeout: 120_000 }).toEqual([200, 200]);
    await expect(hint(page)).toBeHidden();
    await expect(grid(page)).toHaveValue('200x200');
    await expect(grid(page)).toBeFocused();
    await expect(card(page).getByText('changed', { exact: true })).toBeHidden();

    // The link holds the lattice. The tests below open such links.
    expect((await linked(page))?.lattice).toEqual([200, 200]);
    expect(errors).toEqual([]);
  });

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 375, height: 812 },
  ])
    test(`a tool paints the cell under the pointer on a letterboxed lattice (${backend}, ${viewport.width} px)`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await page.setViewportSize(viewport);
      // A link opens the scene on a phone too, where the settings start closed.
      await openSteiner(page, query);
      const box = await page.locator('canvas').boundingBox();
      if (!box) throw new Error('no canvas');
      // The lattice fills the canvas's short side, centred.
      const px = Math.min(box.width, box.height) / 200;
      const [left, top] = [box.x + (box.width - 200 * px) / 2, box.y + (box.height - 200 * px) / 2];
      const edits = () => page.evaluate(() => globalThis.physarum?.envList().length);
      expect(await edits()).toBe(4);
      await page.getByRole('radio', { name: 'Food' }).click();
      const [cx, cy] = viewport.width > viewport.height ? [70, 120] : [100, 60];
      await page.mouse.click(left + (cx + 0.5) * px, top + (cy + 0.5) * px);
      await expect.poll(edits).toBe(5);
      const food = (x: number, y: number) =>
        page.evaluate(
          async ([i, j]) => {
            const env = (await globalThis.physarum?.sim.readEnv()) ?? new Uint8Array();
            return env[(j * 200 + i) * 4 + 1] ?? 0;
          },
          [x, y] as const,
        );
      // One read of the environment took 3.6 s on GitHub (PR #32): the default 5 s of expect left room for one read.
      await expect.poll(() => food(cx, cy), { timeout: 60_000 }).toBeGreaterThan(0);
      // The free space beside the dish's lattice paints nothing.
      const [fx, fy] =
        viewport.width > viewport.height
          ? [box.x + (left - box.x) / 2, top + 100 * px]
          : [left + 100 * px, box.y + (top - box.y) / 2 + 40];
      await page.mouse.click(fx, fy);
      await page.waitForTimeout(300);
      expect(await edits()).toBe(5);
      expect(errors).toEqual([]);
    });
}

test('the app’s own scenes show no hint and no lattice of a paper', async ({ page }) => {
  const errors = watchErrors(page);
  // The Maze on 256 cells: cheap on SwiftShader in CI.
  const p = presetById('maze');
  if (!p) throw new Error('no Maze');
  const { hash } = await encodeLink(
    { ...p.settings(), resolution: 256 },
    { scene: p.id, revision: shapeRevision(p), origins: [0], shapes: p.env?.map(() => true) ?? [], strokes: [] },
  );
  await page.goto(`/#${hash}`);
  await expect.poll(() => simGrid(page), { timeout: 120_000 }).toEqual([256, 144]);
  await expect(card(page).getByRole('heading', { name: 'Maze' })).toBeVisible();
  await expect(hint(page)).toBeHidden();
  await expect(grid(page)).not.toHaveAttribute('aria-describedby');
  await expect(grid(page).locator('option', { hasText: '×' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an old link of a scene of Jones opens as it was made, on a grid shaped like the screen, with the hint', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // A link of Shortest path from before lattices: its settings hold no lattice, and grid 256 (ADR 0026).
  const p = presetById('shortest-path');
  if (!p) throw new Error('no Shortest path');
  const old: Partial<Settings> = { ...p.settings(), resolution: 256, speed: 240 };
  delete old.lattice;
  // Revision 0 of its shapes, the foods of before ADR 0027.
  const drawing = { scene: p.id, revision: 0, origins: [0], shapes: [true, true], strokes: [] };
  const { hash } = await encodeLink(old as Settings, drawing);
  await page.goto(`/#${hash}`);
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 0, undefined, { timeout: 120_000 });
  await expect.poll(() => simGrid(page), { timeout: 120_000 }).toEqual([256, 144]);
  await expect(card(page).getByRole('heading', { name: 'Shortest path' })).toBeVisible();
  await expect(card(page).getByText('changed', { exact: true })).toBeVisible();
  // The receiver changed nothing: the link did.
  await expect(card(page)).toContainText('This link changes the scene.');
  await expect(hint(page)).toContainText('This grid has 256 cells on the long side.');
  await expect(hint(page)).toContainText('For this figure, Jones used 200 × 200 cells.');
  // It paints the foods it was made with, 57.6 cells left and right of the middle (revision 0, ADR 0027).
  const foods = () => page.evaluate(() => globalThis.physarum?.envList().map((e) => e.from[0]));
  expect(await foods()).toEqual([-0.288, 0.288]);
  await hint(page).getByRole('button', { name: 'Use 200 × 200 cells' }).click();
  await expect.poll(() => simGrid(page), { timeout: 120_000 }).toEqual([200, 200]);
  // The foods of revision 0 stay a change of the scene; Reload scene loads those of Fig. 18.
  await expect(card(page).getByText('changed', { exact: true })).toBeVisible();
  await card(page).getByRole('button', { name: 'Reload scene' }).click();
  await expect.poll(foods, { timeout: 120_000 }).toEqual([-0.255, 0.255]);
  await expect(card(page).getByText('changed', { exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});

test('a lattice the device cannot hold runs on a grid shaped like the screen; the notice, the panel and the link say so', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // 0.25 GB of device memory: a budget of 32 MiB. A link asks Wound healing for 4096 × 4096 cells (about 1.5 GB).
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 0.25 });
  });
  const p = presetById('wound');
  if (!p) throw new Error('no Wound healing');
  const s: Settings = { ...p.settings(), lattice: [4096, 4096], resolution: 512 };
  const { hash } = await encodeLink(s, {
    scene: p.id,
    revision: shapeRevision(p),
    origins: [0],
    shapes: [],
    strokes: [],
  });
  await page.goto(`/#${hash}`);
  await expect(page.getByRole('status')).toContainText(
    'This device cannot hold a lattice of 4096 × 4096 cells. The scene runs on a grid of 512 cells on the long side.',
    { timeout: 60_000 },
  );
  await expect.poll(() => simGrid(page), { timeout: 120_000 }).toEqual([512, 288]);
  // The panel and the link follow what runs, so the next setting does not ask for the lattice again
  // (Engine.supported() tells only about a lattice it was asked for).
  await expect(grid(page)).toHaveValue('512');
  expect((await linked(page))?.lattice).toBeNull();
  // The scene's own lattice is the way back.
  await expect(hint(page)).toContainText('For this figure, Jones used 300 × 300 cells.');
  await hint(page).getByRole('button', { name: 'Use 300 × 300 cells' }).click();
  await expect.poll(() => simGrid(page), { timeout: 120_000 }).toEqual([300, 300]);
  expect(errors).toEqual([]);
});

test('a device that cannot hold the scene’s own lattice runs a grid shaped like the screen, as no change of the scene', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // 1 MB of device memory: a budget of 128 KiB, below the 9.5 MB that Wound healing's 300 × 300 cells need. The app's
  // smallest grid still runs (the memory fit never goes below it).
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 0.001 });
  });
  const p = presetById('wound');
  if (!p) throw new Error('no Wound healing');
  const { hash } = await encodeLink(p.settings(), {
    scene: p.id,
    revision: shapeRevision(p),
    origins: [0],
    shapes: [],
    strokes: [],
  });
  await page.goto(`/#${hash}`);
  await expect(page.getByRole('status')).toContainText('This device cannot hold a lattice of 300 × 300 cells.', {
    timeout: 60_000,
  });
  await expect.poll(() => simGrid(page), { timeout: 120_000 }).toEqual([256, 144]);
  // No change of the scene, and no way back that would fail the same way.
  await expect(card(page).getByText('changed', { exact: true })).toBeHidden();
  await expect(hint(page)).toContainText(
    'This device cannot hold Jones’ grid of 300 × 300 cells for this figure. The scene runs on a grid of 256 cells on the long side',
  );
  await expect(hint(page).getByRole('button')).toHaveCount(0);
  await expect(grid(page)).toHaveAttribute('aria-describedby', 'lattice-help');
  expect(errors).toEqual([]);
});
