// The helpers of the tests that wait for steps of a colony: tubes.spec.ts and veins.spec.ts.
import type { Page } from '@playwright/test';
import { decodeLink } from '../../src/model/url';

// The start took 32 s on SwiftShader on an M3 Pro (review of 2026-11-11): 150 s keeps it under a quarter (ADR 0010).
export async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 150_000 });
}

// The limit of a wait for steps. In the image of CI on 4 cores of an M3 Pro, the first 30 steps took 27 s in the Maze
// and in Rival networks and 34 s on the Tokyo scene, and GitHub is about 3 times slower (ADR 0010).
export const WAIT = 300_000;
// The limit of a test with such a wait: two starts of the app and the wait.
export const LIMIT = 480_000;

// A result of the simulation comes with its steps, not with the seconds: a test waits for a step and then reads once.
// A wait of seconds for a result failed on GitHub, where a slow runner made too few steps (TODO.md, 2026-11-15).
// The limit of the wait is only a guard against a simulation that stands still. A test that waits for more steps
// gives its own limit (ADR 0103).
export const steps = (page: Page, n: number, limit = WAIT) =>
  page.waitForFunction((n) => (globalThis.physarum?.sim.step ?? 0) >= n, n, { timeout: limit });
// The agents alive of each strain, and a step that the simulation had reached at most when it counted them.
export const alive = (page: Page) =>
  page.evaluate(async () => {
    const sim = globalThis.physarum?.sim;
    const alive = [...((await sim?.alive()) ?? [])];
    return { alive, step: sim?.step ?? 0 };
  });
// Waits for a scene with the flow on a grid of this width, and lets it rest at once, in the frame that sees it: the
// first count is then of step 2 to 7. Only a young colony grows by 20 agents for sure: a first count many steps late,
// as on a fast machine under load, found colonies of 200 to 270 agents that grew no more in 30 steps, and a rival
// that had lost agents (3 of 30 runs, 2026-11-15). grow() lets the scene run again.
export const colonyScene = (page: Page, width: number) =>
  page.waitForFunction(
    (width) => {
      const engine = globalThis.physarum;
      if (!engine?.settings.flow || engine.sim.width !== width) return false;
      engine.paused = true;
      return true;
    },
    width,
    { timeout: 150_000 },
  );
export const grow = async (page: Page, to: number, limit = WAIT) => {
  await page.evaluate(() => {
    if (globalThis.physarum) globalThis.physarum.paused = false;
  });
  await steps(page, to, limit);
};

// The settings that the link of the page holds.
export const linked = async (page: Page) =>
  (await decodeLink(await page.evaluate(() => location.hash.slice(1))))?.settings;
