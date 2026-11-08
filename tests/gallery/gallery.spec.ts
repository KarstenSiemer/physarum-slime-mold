// Visual review loop (not part of CI): renders every preset at fixed steps and saves PNG files to
// test-results/gallery/. Run with `npm run gallery`, optionally `GALLERY=id1,id2 STEPS=300,1200` and
// `GALLERY_RESOLUTION=1024` (a smaller grid for machines short of GPU memory).
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { PRESETS } from '../../src/model/presets';

const only = process.env.GALLERY?.split(',');
const style = process.env.GALLERY_STYLE as 'glow' | 'gel' | 'paper' | 'agents' | undefined;
const steps = (process.env.STEPS ?? '400,1500').split(',').map(Number);
const resolution = Number(process.env.GALLERY_RESOLUTION) || undefined;
const out = 'test-results/gallery';
mkdirSync(out, { recursive: true });

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

for (const preset of PRESETS.filter((p) => !only || only.includes(p.id))) {
  test(preset.id, async ({ page }) => {
    test.setTimeout(600_000); // a manual tool: slow machines need time for thousands of steps
    await page.goto('/');
    await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
    // Pause through the UI: the startup auto-tune runs only while playing, and it would apply the UI's settings.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => globalThis.physarum?.paused === true);
    const settings = {
      ...preset.settings(),
      seed: 7,
      ...(style ? { style } : {}),
      ...(resolution ? { resolution } : {}),
    };
    await page.evaluate(
      async ([s, env]) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        await e.load(s, env);
      },
      [settings, preset.env ?? []] as const,
    );
    let done = 0;
    for (const target of steps) {
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
      const png = await page.evaluate(async () => {
        const blob = await globalThis.physarum?.snapshot();
        if (!blob) throw new Error('no snapshot');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s);
      });
      const name = `${preset.id}${style ? `-${style}` : ''}-${String(target).padStart(5, '0')}`;
      writeFileSync(`${out}/${name}.png`, Buffer.from(png, 'base64'));
    }
  });
}
