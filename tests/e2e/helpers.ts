import type { Page } from '@playwright/test';
import { defaultSettings, defaultStrain, type Settings } from '../../src/model/params';
import { encodeSettings } from '../../src/model/url';

/** Collects console errors and uncaught exceptions; a test fails if any appear. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** A shared link; by default a small scene, so tests also run fast on SwiftShader (a CPU rasteriser) in CI. */
export async function smallScene(patch: Partial<Settings> = {}) {
  const s: Settings = {
    ...defaultSettings(),
    resolution: 512,
    density: 0.5,
    speed: 240,
    strains: [defaultStrain(0), defaultStrain(1)],
    layout: 'bands',
    ...patch,
  };
  return `/#s=${await encodeSettings(s)}`;
}

export async function openSmallScene(page: Page) {
  await page.goto(await smallScene());
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 120_000 });
}
