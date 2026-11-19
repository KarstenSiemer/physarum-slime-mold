// The numbers and the pictures of ADR 0064: the two start scenes and Fleeing light with the rules of the organism.
// Not part of CI. It prints one line per reading: the agents of every strain, the foods that every strain covers, and
// the share of the cells that hold trail. It writes PNG files to test-results/pictures/, which git ignores:
//
//   npm run build && npx playwright test --project=pictures tests/pictures/scenes.spec.ts
//
// A file is named scenes-<scene>-<step>.png. The seed is 1; `SEED=7` takes another one. `SCENES=light` makes that
// scene only, `LONG=1` adds pictures of the steps 20,000 and 40,000, and `BACKEND=webgl2` runs the app on WebGL2.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { PRESETS } from '../../src/model/presets';

/** The scenes of this record. */
const SCENES = ['three-networks', 'two-networks', 'light'];
/** The steps of a reading: every 250 steps to step 3,000, then every 500 steps to step 12,000. */
const READINGS = [
  ...Array.from({ length: 12 }, (_, i) => 250 * (i + 1)),
  ...Array.from({ length: 18 }, (_, i) => 3500 + 500 * i),
];
/** The steps of a picture. */
const PICTURES = [800, 4000, 8000, 12000, ...(process.env.LONG === '1' ? [20000, 40000] : [])];
const only = process.env.SCENES?.split(',');
const seed = Number(process.env.SEED ?? 1);
const out = 'test-results/pictures';
mkdirSync(out, { recursive: true });

test.use({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });

for (const id of SCENES.filter((x) => !only || only.includes(x))) {
  test(id, async ({ page }) => {
    test.setTimeout(1_800_000);
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`no scene ${id}`);
    await page.goto(process.env.BACKEND === 'webgl2' ? '/?backend=webgl2' : '/');
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
      [{ ...preset.settings(), seed }, preset.env ?? []] as const,
    );
    let done = 0;
    for (const target of [...new Set([...READINGS, ...PICTURES])].sort((a, b) => a - b)) {
      await page.evaluate(async (n) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        for (let i = 0; i < n; i += 16) {
          e.sim.run(Math.min(16, n - i));
          // Keep the GPU queue short: a long queue on a busy GPU can trigger a GPU reset.
          if (i % 64 === 0) await e.sim.finish();
        }
        await e.sim.finish();
      }, target - done);
      done = target;
      if (READINGS.includes(target)) {
        const line = await page.evaluate(async () => {
          const e = globalThis.physarum;
          if (!e) throw new Error('no engine');
          const [w, h] = [e.sim.width, e.sim.height];
          const cells = w * h;
          const [alive, env, trail] = [await e.sim.alive(), await e.sim.readEnv(), await e.sim.readTrail()];
          // A food site: food cells that touch. A strain covers a site when a cell of it holds more than one deposit
          // of its trail.
          const site = new Int32Array(cells).fill(-1);
          let sites = 0;
          for (let c = 0; c < cells; c++) {
            if ((env[c * 4 + 1] ?? 0) < 128 || site[c] !== -1) continue;
            const stack = [c];
            site[c] = sites;
            for (let k = stack.pop(); k !== undefined; k = stack.pop())
              for (const m of [k + 1, k - 1, k + w, k - w]) {
                const beside = Math.abs((m % w) - (k % w)) <= 1 && m >= 0 && m < cells;
                if (beside && (env[m * 4 + 1] ?? 0) >= 128 && site[m] === -1) {
                  site[m] = sites;
                  stack.push(m);
                }
              }
            sites++;
          }
          const covered = alive.map((_, strain) => {
            const got = new Set<number>();
            for (let c = 0; c < cells; c++)
              if (site[c] !== -1 && (trail[c * 4 + strain] ?? 0) > 1) got.add(site[c] ?? 0);
            return got.size;
          });
          let held = 0;
          for (let c = 0; c < cells; c++)
            if ([0, 1, 2, 3].reduce((t, l) => t + (trail[c * 4 + l] ?? 0), 0) > 2 ** -10) held++;
          return (
            `step ${String(e.sim.step)}: agents ${alive.join(', ')}; foods covered ${covered.join(', ')} of ` +
            `${String(sites)}; trail on ${(held / cells).toFixed(2)} of the cells`
          );
        });
        console.log(`${id} ${line}`);
      }
      if (PICTURES.includes(target)) {
        const png = await page.evaluate(async () => {
          const blob = await globalThis.physarum?.snapshot();
          if (!blob) throw new Error('no snapshot');
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let s = '';
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s);
        });
        writeFileSync(`${out}/scenes-${id}-${String(target)}.png`, Buffer.from(png, 'base64'));
      }
    }
  });
}
