// The pictures behind ADR 0057, decision 2: which amount of slime keeps the shape of a tube? Not part of CI. It runs a
// scene, samples the trail every 16 steps, and keeps candidate amounts on the CPU. At some steps it writes each
// candidate as a grey picture, one pixel per cell, to test-results/pictures/, which git ignores:
//
//   npm run build && npx playwright test --project=pictures tests/pictures/slime-amount.spec.ts
//
// A file is named amount-<scene>-<step>-<candidate>.png. White is the full amount. A cell that holds plasm at that
// step is blue, so the slime beside the living colony stands out. `SCENE=corn-maze` takes another scene, and
// `AT=6000,22000` other steps. The seed is 1.
//
// It also writes the table of ADR 0057 to amount-<scene>-<step>.txt, one line per candidate: over the cells that have
// slime and hold no plasm at that step, the mean of the candidate, and the shares of these cells above 0.9 and below
// 0.25, in percent. The line `app` is the amount that the app holds in its field at that step.
//
// The candidates:
//   peak        the largest level of the plasm that the cell had
//   sum500      the level summed over the steps, full after 500 steps under a full tube; also sum2000 and sum8000
//   rule        the rule of the app (docs/model.md, 6.9): 1 of 4,095 per step, up to the level of the plasm
//   stay        the time with plasm, full after 8,000 steps
//   now         the level of the plasm at that step, for comparison
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { trailLevels } from '../../src/engine/flow';
import { SLIME_FULL } from '../../src/engine/slime';
import { PRESETS } from '../../src/model/presets';

const out = 'test-results/pictures';
mkdirSync(out, { recursive: true });
const SCENE = process.env.SCENE ?? 'snail-maze';
const AT = (process.env.AT ?? '6000,14000,22000').split(',').map(Number);
const SAMPLE = 16;

test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });

test(`candidate amounts of slime in the scene ${SCENE}`, async ({ page }) => {
  test.setTimeout(1_800_000);
  const preset = PRESETS.find((p) => p.id === SCENE);
  if (!preset) throw new Error(`no scene ${SCENE}`);
  const settings = preset.settings();
  const strain = settings.strains[0];
  if (!strain) throw new Error('the scene has no strain');
  const [low, full] = trailLevels(strain, settings.stepOrder);
  await page.goto('/');
  await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => globalThis.physarum?.paused === true);
  await page.evaluate(
    async ([base, env]) => {
      const e = globalThis.physarum;
      if (!e) throw new Error('no engine');
      await e.load({ ...base, seed: 1 }, env);
    },
    [settings, preset.env ?? []] as const,
  );
  let step = 0;
  for (const at of AT) {
    const shots = await page.evaluate(
      async ([from, to, sample, lo, hi, top]) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        const [w, h] = [e.sim.width, e.sim.height];
        const names = ['peak', 'sum500', 'sum2000', 'sum8000', 'rule', 'stay', 'now'] as const;
        type Fields = Record<(typeof names)[number], Float32Array>;
        const g = globalThis as unknown as { amounts?: Fields };
        g.amounts ??= Object.fromEntries(names.map((n) => [n, new Float32Array(w * h)])) as Fields;
        const f = g.amounts;
        for (let s = from; s < to; s += sample) {
          e.frame(performance.now(), sample);
          await e.sim.finish();
          // The trail of the first strain after the diffusion of the step, as the pass of the stamps reads it.
          const trail = await e.sim.readView();
          for (let c = 0; c < w * h; c++) {
            const t = trail[c * 4] ?? 0;
            const level = Math.min(Math.max((t - lo) / (hi - lo), 0), 1);
            f.now[c] = t >= lo ? Math.max(level, 1 / 255) : 0;
            if (t < lo) continue;
            f.peak[c] = Math.max(f.peak[c] ?? 0, level);
            f.sum500[c] = Math.min(1, (f.sum500[c] ?? 0) + (level * sample) / 500);
            f.sum2000[c] = Math.min(1, (f.sum2000[c] ?? 0) + (level * sample) / 2000);
            f.sum8000[c] = Math.min(1, (f.sum8000[c] ?? 0) + (level * sample) / 8000);
            f.rule[c] = Math.max(f.rule[c] ?? 0, Math.min(level, (f.rule[c] ?? 0) + sample / top));
            f.stay[c] = Math.min(1, (f.stay[c] ?? 0) + sample / 8000);
          }
        }
        const png = async (field: Float32Array, live?: Float32Array) => {
          const img = new ImageData(w, h);
          for (let c = 0; c < w * h; c++) {
            const v = Math.round(255 * (field[c] ?? 0));
            img.data.set(live && (live[c] ?? 0) > 0 ? [0, 60, 160, 255] : [v, v, v, 255], c * 4);
          }
          const canvas = new OffscreenCanvas(w, h);
          canvas.getContext('2d')?.putImageData(img, 0, 0);
          const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
          let s = '';
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s);
        };
        const res: Record<string, string> = {};
        for (const n of names) res[n] = await png(f[n], n === 'now' ? undefined : f.now);
        // The cells that have slime, by the stamps of the app, and hold no plasm at this step.
        const stamps = await e.sim.readSlime();
        const left: number[] = [];
        for (let c = 0; c < w * h; c++) if ((stamps[c] ?? 0) > 0 && (f.now[c] ?? 0) === 0) left.push(c);
        const table = [`cells with slime and no plasm: ${left.length}`];
        const line = (name: string, field: (c: number) => number) => {
          let [sum, high, low] = [0, 0, 0];
          for (const c of left) {
            const v = field(c);
            sum += v;
            if (v > 0.9) high++;
            if (v < 0.25) low++;
          }
          const share = (count: number) => ((100 * count) / left.length).toFixed(1);
          table.push(
            `${name} mean ${(sum / left.length).toFixed(2)} above-0.9 ${share(high)} below-0.25 ${share(low)}`,
          );
        };
        for (const n of names) if (n !== 'now') line(n, (c) => f[n][c] ?? 0);
        // The amount that the app holds, which gains in every step and not in every sample.
        const amounts = await e.sim.readSlimeAmount();
        line('app', (c) => (amounts[c] ?? 0) / top);
        return { pictures: res, table: table.join('\n') + '\n' };
      },
      [step, at, SAMPLE, low, full, SLIME_FULL] as const,
    );
    step = at;
    const file = `${out}/amount-${SCENE}-${String(at).padStart(5, '0')}`;
    for (const [name, data] of Object.entries(shots.pictures))
      writeFileSync(`${file}-${name}.png`, Buffer.from(data, 'base64'));
    writeFileSync(`${file}.txt`, shots.table);
  }
});
