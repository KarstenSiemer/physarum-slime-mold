// The pictures of ADR 0057, "The picture": the film of the slime in each style, from the app's own renderer. Not part
// of CI. It writes PNG files to test-results/pictures/, which git ignores:
//
//   npm run build && npx playwright test --project=pictures tests/pictures/slime.spec.ts
//
// A file is named slime-<case>-<style>-<off or on>.png. The seed is 1. `SLIME=snail,stroke` makes those cases only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Settings } from '../../src/model/params';
import { PRESETS } from '../../src/model/presets';

interface Shot {
  /** The name of the picture. */
  name: string;
  patch: Partial<Settings>;
  /** Zoom in by this factor around the point of the canvas (shares of its width and height). */
  zoom?: { at: [number, number]; factor: number };
}
interface Case {
  id: string;
  /** A scene id, or '' for the default settings. */
  scene: string;
  backend?: 'webgl2';
  patch?: Partial<Settings>;
  steps: number;
  /** Strokes of the Slime tool after the steps, in shares of the grid: from, to, radius in cells. */
  strokes?: { from: [number, number]; to: [number, number]; radius: number }[];
  shots: Shot[];
}

const on = (names: Settings['style'][]): Shot[] =>
  names.map((style) => ({ name: `${style}-on`, patch: { style, showSlime: true } }));
/** The same styles, zoomed in by `factor` around a point of the canvas: `name` says where. */
const zoomed = (names: Settings['style'][], name: string, at: [number, number], factor: number): Shot[] =>
  names.map((style) => ({ name: `${style}-${name}`, patch: { style, showSlime: true }, zoom: { at, factor } }));
const STYLES: Settings['style'][] = ['glow', 'gel', 'paper', 'agents'];

const CASES: Case[] = [
  // The Snail maze after the colony left its blind branches: the default life time, 144 hours. Fitted, 5 times
  // closer at a blind branch on the left, and 12 times closer at a track in the outer ring.
  {
    id: 'snail',
    scene: 'snail-maze',
    steps: 22000,
    shots: [
      ...on(STYLES),
      ...zoomed(STYLES, 'zoom', [0.232, 0.781], 5),
      ...zoomed(STYLES, 'close', [0.283, 0.107], 12),
      { name: 'glow-off', patch: { style: 'glow', showSlime: false } },
    ],
  },
  // The same with a life time of 6 hours (10,800 steps): the ground that the colony left first is blank again.
  {
    id: 'snail-6h',
    scene: 'snail-maze',
    patch: { slimeLife: 6 },
    steps: 22000,
    shots: [
      ...on(['glow', 'gel', 'paper']),
      { name: 'paper-zoom-on', patch: { style: 'paper', showSlime: true }, zoom: { at: [0.62, 0.72], factor: 16 } },
    ],
  },
  {
    id: 'snail-webgl2',
    scene: 'snail-maze',
    backend: 'webgl2',
    patch: { slimeLife: 6 },
    steps: 22000,
    shots: on(['glow']),
  },
  // Strokes of the Slime tool on plain ground, in an empty box: a wide stroke, a curved one of short segments, a dab
  // and a thin line.
  {
    id: 'stroke',
    scene: '',
    patch: { layout: 'empty', boundary: 'box', resolution: 512 },
    steps: 0,
    strokes: [
      { from: [0.2, 0.42], to: [0.62, 0.42], radius: 22 },
      ...Array.from({ length: 40 }, (_, k) => ({
        from: [0.25 + (0.5 * k) / 40, 0.72 + 0.07 * Math.sin(k / 4)] as [number, number],
        to: [0.25 + (0.5 * (k + 1)) / 40, 0.72 + 0.07 * Math.sin((k + 1) / 4)] as [number, number],
        radius: 5,
      })),
      { from: [0.8, 0.3], to: [0.8, 0.3], radius: 12 },
      { from: [0.82, 0.62], to: [0.88, 0.7], radius: 1.5 },
    ],
    shots: [...on(STYLES), ...zoomed(STYLES, 'zoom', [0.3, 0.42], 6)],
  },
  // The start scene: slime everywhere.
  { id: 'start', scene: '', patch: { resolution: 512 }, steps: 600, shots: on(['glow']) },
];
const only = process.env.SLIME?.split(',');
const out = 'test-results/pictures';
mkdirSync(out, { recursive: true });

test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });

for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
  test(c.id, async ({ page }) => {
    test.setTimeout(1_800_000); // a manual tool: 22,000 steps of the Snail maze take minutes on WebGL2
    const preset = PRESETS.find((p) => p.id === c.scene);
    await page.goto(c.backend ? `/?backend=${c.backend}` : '/');
    await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => globalThis.physarum?.paused === true);
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
    await page.evaluate(async (n) => {
      const e = globalThis.physarum;
      if (!e) throw new Error('no engine');
      for (let i = 0; i < n; i += 16) {
        e.frame(performance.now(), Math.min(16, n - i));
        if (i % 64 === 0) await e.sim.finish();
      }
      await e.sim.finish();
    }, c.steps);
    if (c.strokes) {
      await page.evaluate(async (strokes) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        const [w, h] = [e.sim.width, e.sim.height];
        for (const s of strokes)
          e.paint({
            kind: 'slime',
            from: [s.from[0] * w, s.from[1] * h],
            to: [s.to[0] * w, s.to[1] * h],
            radius: s.radius,
          });
        e.frame(performance.now(), 0);
        await e.sim.finish();
      }, c.strokes);
    }
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
      writeFileSync(`${out}/slime-${c.id}-${shot.name}.png`, Buffer.from(png, 'base64'));
    }
  });
}
