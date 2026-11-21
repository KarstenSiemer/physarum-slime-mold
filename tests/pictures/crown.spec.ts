// The pictures of ADR 0087: the scene Crown of veins in the app's own renderer, at the steps of the pictures of the
// prototype in ADR 0085 (8,000 and 16,000). Not part of CI. It writes PNG files to research/front/out/e5b/app/, which
// git ignores:
//
//   npm run build && npx playwright test --project=pictures tests/pictures/crown.spec.ts
//
// A file is named <backend>-s<seed>-<step>.png. The viewport holds the grid of 520 × 340 cells at 3 pixels per cell,
// as the pictures of the prototype draw it. `CROWN_SEEDS=1,2` and `CROWN_BACKENDS=webgpu,webgl2` pick the runs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { presetById } from '../../src/model/presets';

const SEEDS = (process.env.CROWN_SEEDS ?? '1').split(',').map(Number);
const BACKENDS = (process.env.CROWN_BACKENDS ?? 'webgpu,webgl2').split(',');
const STEPS = [8000, 16000];
const out = 'research/front/out/e5b/app';
mkdirSync(out, { recursive: true });

test.use({ viewport: { width: 1560, height: 1020 } });

for (const backend of BACKENDS)
  for (const seed of SEEDS)
    test(`${backend} seed ${String(seed)}`, async ({ page }) => {
      test.setTimeout(1_800_000);
      const preset = presetById('crown');
      if (!preset) throw new Error('no scene crown');
      await page.goto(backend === 'webgl2' ? '/?backend=webgl2' : '/');
      await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => globalThis.physarum?.paused === true);
      await page.getByRole('button', { name: 'Hide settings' }).click();
      const kind = await page.evaluate(
        async ([base, env, s]) => {
          const e = globalThis.physarum;
          if (!e) throw new Error('no engine');
          await e.load({ ...base, seed: s }, env);
          e.fitView();
          return e.backend.kind;
        },
        [preset.settings(), preset.env ?? [], seed] as const,
      );
      expect(kind).toBe(backend);
      // The step that places the colony is the engine's first step (Engine.seedAtFood()): step k of the prototype is
      // step k + 1 of the engine.
      for (const step of STEPS) {
        await page.evaluate(async (target) => {
          const e = globalThis.physarum;
          if (!e) throw new Error('no engine');
          for (let frames = 1; e.sim.step < target; frames++) {
            e.frame(performance.now(), Math.min(16, target - e.sim.step));
            if (frames % 4 === 0) await e.sim.finish();
          }
          await e.sim.finish();
        }, step + 1);
        const png = await page.evaluate(async () => {
          const e = globalThis.physarum;
          if (!e) throw new Error('no engine');
          e.fitView();
          const blob = await e.snapshot();
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let s = '';
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s);
        });
        writeFileSync(`${out}/${backend}-s${String(seed)}-${String(step)}.png`, Buffer.from(png, 'base64'));
      }
    });
