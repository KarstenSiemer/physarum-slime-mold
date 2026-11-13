// The pictures of README.md and of ADR 0029 in docs/images/: two panels of a scene side by side, each with a line of
// text below it. Not part of CI. Run it by hand after a change of the look of these scenes:
//
//   npx playwright test --project gallery tests/gallery/readme.spec.ts
//
// A panel is a snapshot of the app's own renderer on 1,280 × 800 pixels with seed 7, as `npm run gallery` takes it,
// cut to the arena and shown 640 pixels wide. `README=maze-flow` makes one picture only.
import { writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import type { Settings } from '../../src/model/params';
import { PRESETS } from '../../src/model/presets';

interface Panel {
  /** Settings on top of the scene's. Two panels with the same patch are two steps of one run. */
  patch?: Partial<Settings>;
  step: number;
  text: string;
}
interface Picture {
  file: string;
  scene: string;
  /** The part of the snapshot that a panel shows: x, y, width and height in its pixels. */
  crop: [x: number, y: number, width: number, height: number];
  panels: [Panel, Panel];
}

/** The Tokyo map on its square lattice: the land in the middle of the window, with a small margin. */
const TOKYO: Picture['crop'] = [336, 76, 586, 626];
const PICTURES: Picture[] = [
  {
    file: 'maze-flow',
    scene: 'maze',
    crop: [0, 0, 1280, 800],
    panels: [
      { patch: { flow: false }, step: 5000, text: 'Without the flow: step 5,000' },
      { step: 5000, text: 'With the flow in the tubes: step 5,000' },
    ],
  },
  {
    file: 'tokyo-flow',
    scene: 'tokyo',
    crop: TOKYO,
    panels: [
      { patch: { flow: false }, step: 12000, text: 'Without the flow: step 12,000' },
      { step: 12000, text: 'With the flow in the tubes: step 12,000' },
    ],
  },
  {
    file: 'tokyo-time',
    scene: 'tokyo',
    crop: TOKYO,
    panels: [
      { step: 1000, text: 'With the flow: step 1,000' },
      { step: 48000, text: 'With the flow: step 48,000 (26 hours)' },
    ],
  },
];
const only = process.env.README?.split(',');
/** The width of a panel, the gap between the two, and the height of the line of text, in pixels. */
const [WIDTH, GAP, LINE] = [640, 8, 36];

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

/** Snapshots of one run of a scene at the given steps, as data URLs. */
async function snapshots(page: Page, scene: string, patch: Partial<Settings>, steps: number[]): Promise<string[]> {
  const preset = PRESETS.find((p) => p.id === scene);
  if (!preset) throw new Error(`no scene ${scene}`);
  await page.goto('/');
  await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
  // Pause through the UI: the startup auto-tune runs only while playing, and it would apply the UI's settings.
  await page.keyboard.press('Space');
  await page.waitForFunction(() => globalThis.physarum?.paused === true);
  await page.evaluate(
    async ([s, env]) => {
      const e = globalThis.physarum;
      if (!e) throw new Error('no engine');
      await e.load(s, env);
    },
    [{ ...preset.settings(), seed: 7, ...patch }, preset.env ?? []] as const,
  );
  const urls: string[] = [];
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
    urls.push(
      await page.evaluate(async () => {
        const blob = await globalThis.physarum?.snapshot();
        if (!blob) throw new Error('no snapshot');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return `data:image/png;base64,${btoa(s)}`;
      }),
    );
  }
  return urls;
}

for (const picture of PICTURES.filter((p) => !only || only.includes(p.file))) {
  test(picture.file, async ({ page, context }) => {
    test.setTimeout(1_800_000); // a manual tool: 48,000 steps of the Tokyo scene take minutes
    const [a, b] = picture.panels;
    const same = JSON.stringify(a.patch ?? {}) === JSON.stringify(b.patch ?? {});
    const urls = same
      ? await snapshots(page, picture.scene, a.patch ?? {}, [a.step, b.step])
      : [
          ...(await snapshots(page, picture.scene, a.patch ?? {}, [a.step])),
          ...(await snapshots(page, picture.scene, b.patch ?? {}, [b.step])),
        ];
    const [x, y, w, h] = picture.crop;
    const scale = WIDTH / w;
    const height = Math.round(h * scale);
    const panel = (url: string, text: string) =>
      `<div style="width:${String(WIDTH)}px">` +
      `<div style="width:${String(WIDTH)}px;height:${String(height)}px;overflow:hidden">` +
      `<img src="${url}" style="display:block;width:${String(1280 * scale)}px;` +
      `margin:${String(-y * scale)}px 0 0 ${String(-x * scale)}px"></div>` +
      `<div style="height:${String(LINE)}px;line-height:${String(LINE)}px;padding-left:10px;box-sizing:border-box;` +
      `font:18px/${String(LINE)}px Helvetica,Arial,sans-serif;color:#ececec;background:#0c0d12">${text}</div></div>`;
    const sheet = await context.newPage();
    await sheet.setViewportSize({ width: 2 * WIDTH + GAP, height: height + LINE });
    await sheet.setContent(
      `<body style="margin:0;background:#0c0d12"><div id="picture" style="display:flex;gap:${String(GAP)}px;` +
        `width:${String(2 * WIDTH + GAP)}px">${panel(urls[0] ?? '', a.text)}${panel(urls[1] ?? '', b.text)}</div></body>`,
    );
    await sheet.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
    const jpeg = await sheet.locator('#picture').screenshot({ type: 'jpeg', quality: 88 });
    writeFileSync(`docs/images/${picture.file}.jpg`, jpeg);
    await sheet.close();
  });
}
