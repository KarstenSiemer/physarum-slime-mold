// Shared links hold the scene with its food, light and walls (docs/adr/0021). The Maze runs on grid 512, which the
// startup check does not lower, and is small enough for SwiftShader in CI (ADR 0010).
import { expect, test, type Page } from '@playwright/test';
import { openSmallScene, smallScene, watchErrors } from './helpers';

const card = (page: Page) => page.getByRole('region', { name: 'Scene', exact: true });

/** The environment as a digest: the grid, a hash of every byte and the cells with wall, food and light. */
const environment = (page: Page) =>
  page.evaluate(async () => {
    const e = globalThis.physarum;
    if (!e || e.busy) return undefined;
    const env = await e.sim.readEnv();
    let hash = 2166136261;
    const cells = [0, 0, 0];
    env.forEach((v, i) => {
      hash = Math.imul(hash ^ v, 16777619) >>> 0;
      if (i % 4 < 3 && v > 0) cells[i % 4] = (cells[i % 4] ?? 0) + 1;
    });
    return { grid: [e.sim.width, e.sim.height], hash, cells };
  });

/** The same value twice, a second apart: the address and the environment once the last change reached them. */
async function settled<T>(read: () => Promise<T | undefined>): Promise<T> {
  let last: string | undefined;
  let value: T | undefined;
  await expect
    .poll(
      async () => {
        value = await read();
        const now = JSON.stringify(value);
        const same = now === last;
        last = now;
        return same && value !== undefined;
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(true);
  return value as T;
}

const address = (page: Page) => page.evaluate(() => location.hash);

async function openMaze(page: Page) {
  await openSmallScene(page);
  // Paused, a frame only draws: on SwiftShader in CI that keeps input and reads of the environment fast.
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('combobox', { name: 'Preset' }).selectOption('maze');
  await page.waitForFunction(
    () => globalThis.physarum?.settings.boundary === 'box' && !globalThis.physarum.busy,
    undefined,
    { timeout: 60_000 },
  );
  await expect.poll(async () => (await environment(page))?.cells[0] ?? 0, { timeout: 60_000 }).toBeGreaterThan(100);
}

/** A drag with a tool across the canvas, in fractions of its size, left of the panel and above the toolbar. */
async function drag(page: Page, tool: string, from: [number, number], to: [number, number]) {
  await page.getByRole('radio', { name: tool }).click();
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
  await page.mouse.up();
}

test('a link holds what was painted: a new page paints the same bytes and shows the scene changed', async ({
  page,
  context,
}) => {
  const errors = watchErrors(page);
  await openMaze(page);
  await drag(page, 'Food', [0.3, 0.5], [0.42, 0.62]);
  await drag(page, 'Wall', [0.15, 0.25], [0.6, 0.3]);
  await drag(page, 'Light', [0.6, 0.72], [0.66, 0.8]);
  // Across the Maze's middle wall: a part of a scene's shape goes.
  await drag(page, 'Erase', [0.46, 0.55], [0.54, 0.6]);
  await expect(card(page).getByText('changed', { exact: true })).toBeVisible();
  const sent = await settled(() => environment(page));
  const hash = await settled(() => address(page));
  expect(hash).toMatch(/^#s=[\w-]+&e=[\w-]+$/);
  expect(sent.cells.every((n) => n > 0)).toBe(true);

  const other = await context.newPage();
  const otherErrors = watchErrors(other);
  await other.goto(`/${hash}`);
  await expect.poll(() => environment(other), { timeout: 60_000 }).toEqual(sent);
  await expect(card(other).getByRole('heading', { name: 'Maze' })).toBeVisible();
  await expect(card(other).getByText('changed', { exact: true })).toBeVisible();
  // The new page writes the same link back.
  expect(await settled(() => address(other))).toBe(hash);
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
});

test('a link with settings only loads them alone: no food, light or walls, and no scene', async ({ page }) => {
  const errors = watchErrors(page);
  await openSmallScene(page); // a link from before links held a drawing
  expect((await settled(() => environment(page))).cells).toEqual([0, 0, 0]);
  await expect(card(page)).toContainText('These settings came from a link that names no scene this app can read');
  // With no scene and no stroke, the address holds the settings alone.
  expect(await settled(() => address(page))).toMatch(/^#s=[\w-]+$/);
  expect(errors).toEqual([]);
});

test('a link with a drawing this app cannot read: a notice, and the settings load alone', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${await smallScene()}&e=AAAA`);
  await expect(page.getByRole('status')).toHaveText(
    'This app cannot read the scene and drawing in this link, so only its settings load.',
  );
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 60_000 });
  expect((await settled(() => environment(page))).cells).toEqual([0, 0, 0]);
  await expect(card(page)).toContainText('These settings came from a link that names no scene this app can read');
  // The address keeps the settings and leaves out the part it could not read.
  expect(await settled(() => address(page))).toMatch(/^#s=[\w-]+$/);
  expect(errors).toEqual([]);
});

test('a drawing too large for a link: a notice, and the link holds the settings and the scene', async ({
  page,
  context,
}) => {
  const errors = watchErrors(page);
  await openMaze(page);
  const scene = await settled(() => environment(page));
  // Dabs at random places do not compress: 3,000 of them need far more than the 8,192 characters of a link.
  await page.evaluate(() => {
    const e = globalThis.physarum;
    if (!e) return;
    let seed = 1;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 3000; i++) {
      const at: [number, number] = [r() * e.sim.width, r() * e.sim.height];
      e.paint({ kind: 'food', from: at, to: at, radius: 1 + 3 * r() });
    }
  });
  await expect(page.getByRole('status')).toHaveText('The drawing is too large for a link.');
  const hash = await settled(() => address(page));
  expect(hash).toMatch(/^#s=[\w-]+&e=[\w-]+$/);
  expect(hash.length).toBeLessThanOrEqual(1 + 8192);

  const other = await context.newPage();
  const otherErrors = watchErrors(other);
  await other.goto(`/${hash}`);
  // The Maze as it loads, without a part of the drawing.
  await expect.poll(() => environment(other), { timeout: 60_000 }).toEqual(scene);
  await expect(card(other).getByRole('heading', { name: 'Maze' })).toBeVisible();
  await expect(card(other).getByText('changed', { exact: true })).toBeHidden();
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
});
