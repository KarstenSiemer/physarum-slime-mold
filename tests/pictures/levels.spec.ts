// The pictures and the numbers of ADR 0062: scenes with one agent per cell, each drawn with the black level of before
// (the 65th percentile alone) and with the black level of the app, which stays below the plasm. Not part of CI. It
// writes PNG files to test-results/pictures/, which git ignores, and prints one line of numbers for each case:
//
//   npm run build && npx playwright test --project=pictures tests/pictures/levels.spec.ts
//
// A file is named levels-<case>-<step>-<before or after>.png. The seed is 1. `LEVELS=sheet,spots` makes those cases
// only, and `BACKEND=webgl2` runs the app on WebGL2.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import type { Settings } from '../../src/model/params';
import { PRESETS } from '../../src/model/presets';

interface Case {
  id: string;
  scene: string;
  /** Settings on top of the scene's. */
  patch?: Partial<Settings>;
  step: number;
}

const CASES: Case[] = [
  {
    // The owner's case of 2026-11-19: Three strains in a dish with one agent per cell, growth and the flow.
    id: 'three-strains',
    scene: 'three-strains',
    patch: { boundary: 'dish', collisions: true, growth: true, flow: true, density: 1, resolution: 768 },
    step: 900,
  },
  { id: 'sheet', scene: 'shrinking', step: 150 },
  { id: 'spots', scene: 'spots', step: 3000 },
  { id: 'stripes', scene: 'stripes', step: 3000 },
  { id: 'wound', scene: 'wound', step: 2000 },
  { id: 'rival-networks', scene: 'rival-networks', step: 3000 },
  { id: 'voronoi', scene: 'voronoi', step: 300 },
  { id: 'network', scene: 'network', step: 2000 },
  { id: 'coarsening', scene: 'coarsening', step: 300 },
  { id: 'maze', scene: 'maze', step: 500 },
  { id: 'corn-maze', scene: 'corn-maze', step: 6000 },
];
const only = process.env.LEVELS?.split(',');
const out = 'test-results/pictures';
mkdirSync(out, { recursive: true });

test.use({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });

/** The radiance of the white level (exposure.ts TARGET). */
const TARGET = 1.3;

/** The centre of the bin of the level that the share `fraction` of the cells exceed (exposure.ts levelAbove()). */
function levelAbove(bins: number[], cells: number, fraction: number): number {
  let above = 0;
  for (let b = bins.length - 1; b >= 0; b--) {
    above += bins[b] ?? 0;
    if (above >= fraction * cells) return 2 ** ((b + 0.5) / 2 - 10);
  }
  return 0;
}

/** The levels of before ADR 0062: black at the 65th percentile and at most 0.8 of white, white at the 99th. */
function before(bins: number[], cells: number) {
  const white = levelAbove(bins, cells, 0.01);
  const black = Math.min(levelAbove(bins, cells, 0.35), 0.8 * white);
  return { black, gain: TARGET / (white - black) };
}

for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
  test(c.id, async ({ page }) => {
    test.setTimeout(600_000);
    const preset = PRESETS.find((p) => p.id === c.scene);
    if (!preset) throw new Error(`no scene ${c.scene}`);
    await page.goto(process.env.BACKEND === 'webgl2' ? '/?backend=webgl2' : '/');
    await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
    // Pause through the UI: the startup auto-tune runs only while playing, and it would apply the UI's settings.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => globalThis.physarum?.paused === true);
    // Without the panel the canvas has the whole window.
    await page.getByRole('button', { name: 'Hide settings' }).click();
    await page.evaluate(
      async ([settings, env, steps]) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        await e.load(settings, env);
        e.fitView();
        for (let i = 0; i < steps; i += 16) {
          e.sim.run(Math.min(16, steps - i));
          // Keep the GPU queue short: a long queue on a busy GPU can trigger a GPU reset.
          if (i % 64 === 0) await e.sim.finish();
        }
        await e.sim.finish();
      },
      [{ ...preset.settings(), seed: 1, ...c.patch }, preset.env ?? [], c.step] as const,
    );
    // The trail that the frame draws, and the cells that hold an agent.
    const state = await page.evaluate(async () => {
      const e = globalThis.physarum;
      if (!e) throw new Error('no engine');
      const [w, cells] = [e.sim.width, e.sim.width * e.sim.height];
      const picture = await e.sim.readPicture();
      const trail = Array.from({ length: cells }, (_, i) =>
        [0, 1, 2, 3].reduce((t, l) => t + (picture[i * 4 + l] ?? 0), 0),
      );
      const holds = new Uint8Array(cells);
      for (const a of await e.sim.readAgents()) if (a.bits & 4) holds[Math.floor(a.y) * w + Math.floor(a.x)] = 1;
      const bins = new Array<number>(64).fill(0);
      for (const t of trail) {
        if (t <= 0) continue;
        const b = Math.min(63, Math.max(0, Math.floor((Math.log2(t) + 10) * 2)));
        bins[b] = (bins[b] ?? 0) + 1;
      }
      const under = trail.filter((_, i) => holds[i]).sort((a, b) => a - b);
      const after = await e.backend.measured(e.sim);
      return { cells, bins, under, after: { black: after.black, gain: after.gain, strand: after.strand } };
    });
    const old = before(state.bins, state.cells);
    const median = state.under[Math.floor((state.under.length - 1) / 2)] ?? 0;
    const white = TARGET / state.after.gain + state.after.black;
    /** The share of the cells with an agent whose trail lies at or below `black`: the picture draws them black. */
    const cut = (black: number) => state.under.filter((t) => t <= black).length / state.under.length;
    console.log(
      `${c.id} step ${String(c.step)}: an agent in ${(state.under.length / state.cells).toFixed(3)} of the cells,`,
      `white ${white.toFixed(3)}, median under the agents ${(median / white).toFixed(3)} of white,`,
      `black before ${(old.black / white).toFixed(3)} (cuts ${cut(old.black).toFixed(3)} of the agents' cells),`,
      `black after ${(state.after.black / white).toFixed(3)} (cuts ${cut(state.after.black).toFixed(3)})`,
    );
    for (const [name, levels] of [
      ['before', { ...state.after, ...old }],
      ['after', state.after],
    ] as const) {
      const png = await page.evaluate(async (levels) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        const { width, height } = e.canvas;
        const img = await e.backend.capture(e.sim, e.settings, e.view, width, height, levels);
        const canvas = new OffscreenCanvas(img.width, img.height);
        canvas.getContext('2d')?.putImageData(img, 0, 0);
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s);
      }, levels);
      writeFileSync(`${out}/levels-${c.id}-${String(c.step)}-${name}.png`, Buffer.from(png, 'base64'));
    }
  });
}
