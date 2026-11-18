// The pictures of ADR 0060: the growth front in each style, from the app's own renderer. Not part of CI. It writes PNG
// files to test-results/pictures/, which git ignores:
//
//   npm run build && npx playwright test --project=pictures tests/pictures/front.spec.ts
//
// A file is named front-<case>-<step>-<shot>.png. The seed is 1. `FRONT=tokyo,maze` makes those cases only, and
// `STYLES=gel` those styles only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Settings } from '../../src/model/params';
import { PRESETS } from '../../src/model/presets';

type Style = Settings['style'];
interface Shot {
  name: string;
  patch: Partial<Settings>;
  /** Zoom in by this factor around the point of the canvas (shares of its width and height). */
  zoom?: { at: [number, number]; factor: number };
}
interface Case {
  id: string;
  /** A scene id. */
  scene: string;
  backend?: 'webgl2';
  patch?: Partial<Settings>;
  /** The steps at which the case makes its shots, in rising order. */
  steps: number[];
  shots: Shot[];
}

const picked = process.env.STYLES?.split(',') as Style[] | undefined;
const STYLES: [Style, ...Style[]] = picked?.length
  ? [picked[0] ?? 'glow', ...picked.slice(1)]
  : ['glow', 'gel', 'paper'];
/** Each style with the front, and the first style without it: fitted, and zoomed in where `zoom` says. */
const shots = (zoom?: { at: [number, number]; factor: number }): Shot[] => [
  ...STYLES.map((style) => ({ name: `${style}-on`, patch: { style, showFront: true } })),
  { name: `${STYLES[0]}-off`, patch: { style: STYLES[0], showFront: false } },
  ...(zoom ? STYLES.map((style) => ({ name: `${style}-zoom`, patch: { style, showFront: true }, zoom })) : []),
  ...(zoom ? [{ name: `${STYLES[0]}-zoom-off`, patch: { style: STYLES[0], showFront: false }, zoom }] : []),
];

const CASES: Case[] = [
  // The colony grows from Tokyo over the land: the front is a ring around the city, and tubes form behind it.
  { id: 'tokyo', scene: 'tokyo', steps: [600, 1500, 4000], shots: shots({ at: [0.62, 0.42], factor: 4 }) },
  // The line at which the gel ends, 10 times closer.
  {
    id: 'teeth',
    scene: 'tokyo',
    steps: [1500],
    shots: [{ name: 'gel-close', patch: { style: 'gel', showFront: true }, zoom: { at: [0.56, 0.6], factor: 10 } }],
  },
  // A colony grows through the corridors of a maze.
  { id: 'maze', scene: 'foraging-maze', steps: [1500, 4000], shots: shots({ at: [0.7, 0.6], factor: 3 }) },
  // Three strains on ground with slime everywhere: the tubes lie on the film of the slime.
  { id: 'strains', scene: 'three-strains', steps: [3000], shots: shots({ at: [0.5, 0.5], factor: 5 }) },
  // Two colonies of two strains: each sheet has the colour of its strain.
  { id: 'rivals', scene: 'rival-networks', steps: [1200], shots: shots() },
  {
    id: 'tokyo-webgl2',
    scene: 'tokyo',
    backend: 'webgl2',
    steps: [1500],
    shots: shots({ at: [0.62, 0.42], factor: 4 }),
  },
];

const only = process.env.FRONT?.split(',');
const out = 'test-results/pictures';
mkdirSync(out, { recursive: true });

for (const c of CASES.filter((k) => !only || only.includes(k.id))) {
  test(c.id, async ({ page }) => {
    test.setTimeout(900_000);
    const preset = PRESETS.find((p) => p.id === c.scene);
    if (!preset) throw new Error(`no scene ${c.scene}`);
    await page.goto(c.backend ? `/?backend=${c.backend}` : '/');
    await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => globalThis.physarum?.paused === true);
    await page.getByRole('button', { name: 'Hide settings' }).click();
    const kind = await page.evaluate(
      async ([base, env, patch]) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        await e.load({ ...base, seed: 1, ...patch }, env);
        e.fitView();
        return e.backend.kind;
      },
      [preset.settings(), preset.env ?? [], c.patch ?? {}] as const,
    );
    if (c.backend) expect(kind).toBe(c.backend);
    let done = 0;
    for (const step of c.steps) {
      await page.evaluate(async (n) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        for (let i = 0; i < n; i += 16) {
          e.frame(performance.now(), Math.min(16, n - i));
          if (i % 64 === 0) await e.sim.finish();
        }
        await e.sim.finish();
      }, step - done);
      done = step;
      for (const shot of c.shots) {
        const png = await page.evaluate(
          async ([patch, zoom]) => {
            const e = globalThis.physarum;
            if (!e) throw new Error('no engine');
            await e.apply({ ...e.settings, ...patch });
            e.fitView();
            if (zoom) {
              const { width, height } = e.canvas;
              e.zoomAt(zoom.at[0] * width, zoom.at[1] * height, zoom.factor);
            }
            const blob = await e.snapshot();
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let s = '';
            for (const b of bytes) s += String.fromCharCode(b);
            return btoa(s);
          },
          [shot.patch, shot.zoom] as const,
        );
        writeFileSync(`${out}/front-${c.id}-${step}-${shot.name}.png`, Buffer.from(png, 'base64'));
      }
    }
  });
}
