// The pictures of the electrodes (ADR 0058): the poles of the Electrode tool
// in each style, fitted and zoomed in, from the app's own renderer. Not part of CI. It writes PNG files to
// test-results/pictures/, which git ignores:
//
//   npm run build && npx playwright test --project=pictures tests/pictures/electrodes.spec.ts
//
// A file is named electrodes-<case>-<style>-<shot>.png. The seed is 1. `ELECTRODES=scene,strokes` makes those cases
// only. `ELECTRODES_TAG=main` names the files electrodes-main-<case>-…: the same tool on a build of another commit,
// to compare the look.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Settings } from '../../src/model/params';
import { PRESETS } from '../../src/model/presets';

type Style = Settings['style'];
/** A stroke in cells of the grid: a dab without `to`. */
interface Dab {
  kind: 'cathode' | 'anode' | 'erase' | 'wall' | 'food' | 'light';
  from: [number, number];
  to?: [number, number];
  radius: number;
}
interface Shot {
  name: string;
  /** Zoom in by `factor` on this grid position (cells), and show it in the middle. Without it the view is fitted. */
  at?: [number, number];
  factor?: number;
}
interface Case {
  id: string;
  /** A scene id, or '' for the default settings. */
  scene: string;
  backend?: 'webgl2';
  patch?: Partial<Settings>;
  /** Steps before the strokes. */
  steps: number;
  strokes?: Dab[];
  /** Steps after the strokes. */
  more?: number;
  styles: Style[];
  shots: Shot[];
}

const STYLES: Style[] = ['glow', 'gel', 'paper', 'agents'];

/**
 * Strokes of both poles on a lattice of 160 × 120 cells: wide dabs, the dabs of the scene Electrotaxis (1.5 cells),
 * thin and thicker lines, a cathode over a part of an anode and the other way round, an erase and a wall through a
 * pole, a pole on food and in the light, and thin poles and a thin wall over a wide pole.
 */
const STROKES: Dab[] = [
  { kind: 'cathode', from: [26, 24], radius: 10 },
  { kind: 'anode', from: [56, 24], radius: 10 },
  // The dabs of the scene, and one cell smaller and larger.
  { kind: 'cathode', from: [80, 12], radius: 0.75 },
  { kind: 'cathode', from: [80, 20], radius: 1.5 },
  { kind: 'cathode', from: [80, 30], radius: 2.5 },
  { kind: 'anode', from: [90, 12], radius: 0.75 },
  { kind: 'anode', from: [90, 20], radius: 1.5 },
  { kind: 'anode', from: [90, 30], radius: 2.5 },
  // Lines, slanted against the grid: the thinnest brush with a wall and a food of it beside them, and thicker ones.
  { kind: 'wall', from: [12, 37], to: [62, 43], radius: 0.75 },
  { kind: 'food', from: [12, 41], to: [62, 47], radius: 0.75 },
  { kind: 'cathode', from: [12, 45], to: [62, 51], radius: 0.75 },
  { kind: 'anode', from: [12, 49], to: [62, 55], radius: 0.75 },
  { kind: 'cathode', from: [12, 53.5], to: [62, 59.5], radius: 1 },
  { kind: 'anode', from: [12, 58], to: [62, 64], radius: 1 },
  { kind: 'cathode', from: [12, 64], to: [62, 70], radius: 1.5 },
  { kind: 'anode', from: [12, 73], to: [62, 79], radius: 3 },
  // A cathode over a part of an anode, and an anode over a part of a cathode.
  { kind: 'anode', from: [116, 22], radius: 9 },
  { kind: 'cathode', from: [124, 27], radius: 6 },
  { kind: 'cathode', from: [142, 22], radius: 7 },
  { kind: 'anode', from: [136, 30], to: [150, 34], radius: 2 },
  // An erase and a wall through a pole.
  { kind: 'cathode', from: [30, 100], radius: 9 },
  { kind: 'erase', from: [20, 94], to: [42, 107], radius: 1.5 },
  { kind: 'anode', from: [58, 100], radius: 9 },
  { kind: 'wall', from: [48, 107], to: [70, 94], radius: 1.5 },
  // A pole on a part of a food, and poles in the light.
  { kind: 'food', from: [88, 62], radius: 8 },
  { kind: 'cathode', from: [94, 66], radius: 4 },
  { kind: 'light', from: [124, 62], radius: 14 },
  { kind: 'anode', from: [120, 60], radius: 3 },
  { kind: 'cathode', from: [130, 66], radius: 1.5 },
  // A wall with a pole beside it, and poles side by side.
  { kind: 'wall', from: [84, 96], to: [150, 96], radius: 2 },
  { kind: 'cathode', from: [100, 104], radius: 4 },
  { kind: 'anode', from: [107.5, 104], radius: 4 },
  { kind: 'anode', from: [130, 88], radius: 3 },
  // Thin poles over a wide pole, and a thin wall through it: a pole ends where the stroke over it begins (ADR 0058).
  { kind: 'cathode', from: [148, 64], radius: 9 },
  { kind: 'anode', from: [142, 60], to: [154, 62], radius: 0.75 },
  { kind: 'anode', from: [145, 66], radius: 1.5 },
  { kind: 'anode', from: [151, 67], radius: 1 },
  { kind: 'wall', from: [143, 70], to: [153, 58.5], radius: 0.75 },
];

const CASES: Case[] = [
  // The scene Electrotaxis after 800 steps: a third of the agents stand at the cathodes.
  {
    id: 'scene',
    scene: 'electrotaxis',
    steps: 800,
    styles: STYLES,
    shots: [
      { name: 'fit' },
      { name: 'cathode', at: [25, 120], factor: 8 },
      { name: 'anode', at: [145, 120], factor: 8 },
    ],
  },
  // The scene at its start: the poles on the bare ground.
  {
    id: 'scene-start',
    scene: 'electrotaxis',
    steps: 0,
    styles: STYLES,
    shots: [{ name: 'fit' }, { name: 'cathode', at: [25, 120], factor: 8 }],
  },
  {
    id: 'strokes',
    scene: '',
    patch: { layout: 'empty', boundary: 'box', lattice: [160, 120] },
    steps: 0,
    strokes: STROKES,
    styles: STYLES,
    shots: [
      { name: 'fit' },
      { name: 'dabs', at: [85, 21], factor: 6 },
      { name: 'lines', at: [22, 51], factor: 5 },
      { name: 'thin', at: [40, 46], factor: 12 },
      { name: 'overlap', at: [128, 27], factor: 4 },
      { name: 'cut', at: [44, 100], factor: 4 },
      { name: 'beside', at: [104, 100], factor: 6 },
      { name: 'seam', at: [148, 64], factor: 8 },
      { name: 'far', at: [80, 60], factor: 0.3 },
    ],
  },
  {
    id: 'strokes-webgl2',
    scene: '',
    backend: 'webgl2',
    patch: { layout: 'empty', boundary: 'box', lattice: [160, 120] },
    steps: 0,
    strokes: STROKES,
    styles: ['glow', 'paper'],
    shots: [
      { name: 'fit' },
      { name: 'dabs', at: [85, 21], factor: 6 },
      { name: 'overlap', at: [128, 27], factor: 4 },
      { name: 'seam', at: [148, 64], factor: 8 },
    ],
  },
  // The same strokes without the poles: this change of the view leaves walls, food and light as they were, so the
  // pictures of two builds agree but for the dither.
  {
    id: 'plain',
    scene: '',
    patch: { layout: 'empty', boundary: 'box', lattice: [160, 120] },
    steps: 0,
    strokes: STROKES.filter((s) => s.kind !== 'cathode' && s.kind !== 'anode'),
    styles: STYLES,
    shots: [{ name: 'fit' }, { name: 'thin', at: [40, 46], factor: 12 }, { name: 'cut', at: [44, 100], factor: 4 }],
  },
  // Poles on a network of the default settings: the trail and the agents lie below them.
  {
    id: 'network',
    scene: '',
    patch: { resolution: 512 },
    steps: 500,
    strokes: [
      { kind: 'cathode', from: [150, 200], radius: 6 },
      { kind: 'anode', from: [360, 200], radius: 6 },
      { kind: 'cathode', from: [230, 120], to: [280, 130], radius: 1.5 },
      { kind: 'anode', from: [230, 280], to: [280, 270], radius: 1.5 },
      { kind: 'cathode', from: [256, 200], radius: 1.5 },
    ],
    more: 300,
    styles: STYLES,
    shots: [
      { name: 'fit' },
      { name: 'cathode', at: [150, 200], factor: 6 },
      { name: 'line', at: [256, 126], factor: 8 },
    ],
  },
];
const only = process.env.ELECTRODES?.split(',');
const tag = process.env.ELECTRODES_TAG ? `${process.env.ELECTRODES_TAG}-` : '';
const out = 'test-results/pictures';
mkdirSync(out, { recursive: true });

test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });

for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
  test(c.id, async ({ page }) => {
    test.setTimeout(600_000); // a manual tool
    const preset = PRESETS.find((p) => p.id === c.scene);
    await page.goto(c.backend ? `/?backend=${c.backend}` : '/');
    await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
    // Pause through the UI: the startup auto-tune runs only while playing, and it would apply the UI's settings.
    await page.keyboard.press('Space');
    await page.waitForFunction(() => globalThis.physarum?.paused === true);
    // Without the panel the canvas has the whole window.
    await page.getByRole('button', { name: 'Hide settings' }).click();
    const kind = await page.evaluate(
      async ([base, env, patch]) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        await e.load({ ...(base ?? e.settings), seed: 1, ...patch }, env);
        e.fitView();
        return e.backend.kind;
      },
      [preset?.settings(), preset?.env ?? [], c.patch ?? {}] as const,
    );
    // A case that asks for a backend must get it.
    if (c.backend) expect(kind).toBe(c.backend);
    const run = (steps: number) =>
      page.evaluate(async (n) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        for (let i = 0; i < n; i += 16) {
          e.frame(performance.now(), Math.min(16, n - i));
          // Keep the GPU queue short: a long queue on a busy GPU can trigger a GPU reset.
          if (i % 64 === 0) await e.sim.finish();
        }
        await e.sim.finish();
      }, steps);
    await run(c.steps);
    if (c.strokes) {
      await page.evaluate(async (strokes) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        for (const s of strokes) e.paint({ kind: s.kind, from: s.from, to: s.to ?? s.from, radius: s.radius });
        e.frame(performance.now(), 0);
        await e.sim.finish();
      }, c.strokes);
    }
    await run(c.more ?? 0);
    for (const style of c.styles)
      for (const shot of c.shots) {
        const png = await page.evaluate(
          async ([style, at, factor]) => {
            const e = globalThis.physarum;
            if (!e) throw new Error('no engine');
            await e.apply({ ...e.settings, style });
            e.fitView();
            if (at) {
              const { width, height } = e.canvas;
              const [px, py] = e.toCanvas(at[0], at[1]);
              e.zoomAt(px, py, factor);
              e.panBy(width / 2 - px, height / 2 - py);
            }
            const blob = await e.snapshot();
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let s = '';
            for (const b of bytes) s += String.fromCharCode(b);
            return btoa(s);
          },
          [style, shot.at, shot.factor ?? 1] as const,
        );
        writeFileSync(`${out}/electrodes-${tag}${c.id}-${style}-${shot.name}.png`, Buffer.from(png, 'base64'));
      }
  });
}
