// The pictures of ADR 0034, "The pictures": a scene with the flow at some steps, each time without and with the
// picture of the tubes, from the app's own renderer. Not part of CI. It writes PNG files to test-results/pictures/,
// which git ignores:
//
//   npm run build && npx playwright test --project=pictures tests/pictures/tubes.spec.ts
//
// A file is named <case>-<step>-<style>-<off or on>.png. The seed is 1. `TUBES=maze,tokyo` makes those cases only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import type { Settings } from '../../src/model/params';
import { PRESETS, type EnvShape } from '../../src/model/presets';

interface Case {
  id: string;
  scene: string;
  /** Settings on top of the scene's. */
  patch?: Partial<Settings>;
  /** Shapes of the environment on top of the scene's. */
  env?: EnvShape[];
  steps: number[];
  styles: Settings['style'][];
}

const CASES: Case[] = [
  { id: 'maze', scene: 'maze', steps: [4000], styles: ['glow'] },
  { id: 'tokyo', scene: 'tokyo', steps: [16000], styles: ['glow', 'gel'] },
  { id: 'tokyo-rivals', scene: 'tokyo-rivals', steps: [10000], styles: ['glow'] },
  { id: 'food-ring', scene: 'food-ring', steps: [6000, 12000], styles: ['glow', 'gel', 'paper'] },
  {
    // The owner's case of ADR 0032: three strains in a dish with one agent per cell, growth, the flow and two foods.
    id: 'three-strains',
    scene: 'three-strains',
    patch: { boundary: 'dish', collisions: true, growth: true, flow: true, resolution: 512 },
    env: [
      { kind: 'food', at: [-0.15, 0], r: 0.02 },
      { kind: 'food', at: [0.15, 0], r: 0.02 },
    ],
    steps: [4000],
    styles: ['glow'],
  },
];
const only = process.env.TUBES?.split(',');
const out = 'test-results/pictures';
mkdirSync(out, { recursive: true });

test.use({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });

for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
  test(c.id, async ({ page }) => {
    test.setTimeout(1_800_000); // a manual tool: 16,000 steps of the Tokyo scene take minutes
    const preset = PRESETS.find((p) => p.id === c.scene);
    if (!preset) throw new Error(`no scene ${c.scene}`);
    await page.goto('/');
    await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
    // Pause through the UI: the startup auto-tune runs only while playing, and it would apply the UI's settings.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => globalThis.physarum?.paused === true);
    // Without the panel the canvas has the whole window.
    await page.getByRole('button', { name: 'Hide settings' }).click();
    await page.evaluate(
      async ([settings, env]) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        await e.load(settings, env);
        e.fitView();
      },
      [{ ...preset.settings(), seed: 1, ...c.patch }, [...(preset.env ?? []), ...(c.env ?? [])]] as const,
    );
    let done = 0;
    for (const target of c.steps) {
      await page.evaluate(async (n) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        for (let i = 0; i < n; i += 16) {
          e.frame(performance.now(), Math.min(16, n - i));
          // Keep the GPU queue short: a long queue on a busy GPU can trigger a GPU reset.
          if (i % 64 === 0) await e.sim.finish();
        }
        await e.sim.finish();
      }, target - done);
      done = target;
      // The switch changes the view only, so both pictures show the same state.
      for (const style of c.styles)
        for (const showTubes of [false, true]) {
          const png = await page.evaluate(
            async ([style, showTubes]) => {
              const e = globalThis.physarum;
              if (!e) throw new Error('no engine');
              await e.apply({ ...e.settings, style, showTubes });
              const blob = await e.snapshot();
              const bytes = new Uint8Array(await blob.arrayBuffer());
              let s = '';
              for (const b of bytes) s += String.fromCharCode(b);
              return btoa(s);
            },
            [style, showTubes] as const,
          );
          const name = `${c.id}-${String(target)}-${style}-${showTubes ? 'on' : 'off'}.png`;
          writeFileSync(`${out}/${name}`, Buffer.from(png, 'base64'));
        }
    }
  });
}
