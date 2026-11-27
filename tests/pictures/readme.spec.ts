// The pictures of README.md, and the picture tokyo-flow.jpg of ADR 0029, in docs/images/. Not part of CI. It writes
// files of the repository, so it is not in the project of `npm run gallery`. Run it by hand after a change of the look
// of these scenes:
//
//   npm run build && npx playwright test --project=pictures tests/pictures/readme.spec.ts
//
// A picture is one or more panels in a grid. A panel is a snapshot of the app's own renderer: the scene with its
// settings and seed 7, a patch of view switches or settings on top, at a step, in a view of the grid (a middle and a
// zoom over the fit). The window is 1,600 × 1,000 pixels at 2 device pixels per pixel, so a snapshot has 3,200 × 2,000
// pixels; a picture shows a crop of it, scaled down to its width. Panels of the same run (scene, settings and seed)
// come from one run, at their steps in order.
//
// `README=crown-growth,dish` makes those pictures only. `README_OUT=research/front/out/owner/readme` writes them there
// instead of docs/images/, to look at candidates first.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, type Browser, type Page } from '@playwright/test';
import { crownLevers, strainLike, type Settings } from '../../src/model/params';
import { PRESETS, type EnvShape } from '../../src/model/presets';

interface Panel {
  scene: string;
  /** Settings on top of the scene's, made from the scene's settings. */
  patch?: (s: Settings) => Partial<Settings>;
  /** The food, light and walls in place of the scene's. */
  env?: EnvShape[];
  /** Switch on Rules of the growth front as the panel does (setRules()): the territory and the levers of the crown. */
  rules?: boolean;
  /** The name of the run, when its patch or env differs from that of the other panels of the scene in the picture. */
  run?: string;
  step: number;
  /** The middle of the view as a share of the grid's width and height, and the zoom over the fit. */
  view?: { at: [number, number]; zoom: number };
  /** In a picture of single panels: the crop of this panel in place of the picture's. */
  crop?: Picture['crop'];
  text?: string;
}
interface Picture {
  file: string;
  panels: Panel[];
  /** Panels in a row; more panels start a new row. All in one row by default. */
  columns?: number;
  /** The width of a panel in the picture, in pixels. */
  width: number;
  /** The part of the snapshot that a panel shows: x, y, width and height as shares of the snapshot. */
  crop?: [x: number, y: number, width: number, height: number];
  /** The window, its device pixels per pixel, and the JPEG quality. tokyo-flow keeps the frame of ADR 0029. */
  window?: [width: number, height: number, scale: number];
  quality?: number;
  /** Each panel a picture of its own, in the file <file>-<n>.jpg, n from 1. */
  single?: boolean;
  /** A picture of an ADR: made only when README names it. */
  adr?: boolean;
}

/** The colours of the four strains in the dish: rose, amber, aqua and violet on the dark ground. */
const FOUR = ['#ff4f8b', '#ffb43c', '#2fe0cf', '#9a7dff'];
/** Food in the dish of the four strains: four in the middle, one for each strain to start on, and twelve on a ring. */
const ring = (count: number, radius: number, turn: number): EnvShape[] =>
  Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count + (turn * Math.PI) / 180;
    const at = (v: number) => Math.round(radius * v * 1e4) / 1e4;
    return { kind: 'food', at: [at(Math.cos(a)), at(Math.sin(a))], r: 0.012 };
  });
const DISH_FOOD = [...ring(4, 0.12, 45), ...ring(12, 0.34, 15)];
/** The start scene with four strains on a dish of 1,024 × 1,024 cells. */
const four = (s: Settings): Partial<Settings> => {
  const [first] = s.strains;
  if (!first) throw new Error('no strain');
  return {
    lattice: [1024, 1024],
    strains: FOUR.map((color, i) => ({ ...strainLike(first, i), color })),
  };
};
/** A square in the middle of the snapshot of 1.6 : 1, for a square grid fit to the height. */
const SQUARE: Picture['crop'] = [0.1875, 0, 0.625, 1];

const PICTURES: Picture[] = [
  {
    file: 'front-crown-steps',
    width: 400,
    crop: [0.02, 0, 0.96, 0.78],
    panels: [4000, 8000, 12000, 16000].map((step) => ({
      scene: 'crown',
      step,
      text: `step ${step.toLocaleString('en-US')}`,
    })),
  },
  {
    file: 'front-crown',
    width: 900,
    crop: [0.1, 0, 0.8, 0.72],
    panels: [{ scene: 'crown', step: 12000 }],
  },
  {
    file: 'front-ring-steps',
    width: 400,
    crop: SQUARE,
    panels: [2000, 6000, 12000, 20000].map((step) => ({
      scene: 'food-ring',
      rules: true,
      step,
      text: `step ${step.toLocaleString('en-US')}`,
    })),
  },
  {
    file: 'hero',
    width: 1200,
    crop: SQUARE,
    panels: [{ scene: 'three-networks', patch: four, env: DISH_FOOD, step: 12000 }],
  },
  {
    file: 'gallery',
    single: true,
    width: 800,
    crop: [0.125, 0, 0.75, 1],
    panels: [
      [0.325, 0.375, 5],
      [0.63, 0.58, 5],
      [0.26, 0.72, 4],
      [0.585, 0.415, 5],
      [0.45, 0.28, 4],
      [0.55, 0.14, 3],
    ].map(([x = 0, y = 0, zoom = 1]) => ({
      scene: 'three-networks',
      patch: four,
      env: DISH_FOOD,
      step: 12000,
      view: { at: [x, y], zoom },
    })),
  },
  {
    file: 'steiner',
    width: 400,
    crop: SQUARE,
    // Seed 6: of seeds 1 to 20 at step 12,000, its tree shows the bridge between its two junctions most clearly.
    panels: [500, 2000, 12000].map((step) => ({
      scene: 'steiner',
      patch: () => ({ seed: 6 }),
      step,
      view: { at: [0.5, 0.5], zoom: 2.2 },
      text: `seed 6, step ${step.toLocaleString('en-US')}`,
    })),
  },
  {
    file: 'cyclones',
    width: 600,
    crop: SQUARE,
    panels: [{ scene: 'cyclones', patch: () => ({ resolution: 2048 }), step: 3000 }],
  },
  {
    file: 'maze-flow',
    width: 640,
    panels: [
      {
        scene: 'maze',
        run: 'without',
        patch: () => ({ flow: false }),
        step: 5000,
        text: 'Without the flow: step 5,000',
      },
      { scene: 'maze', step: 5000, text: 'With the flow in the tubes: step 5,000' },
    ],
  },
  {
    file: 'tokyo-flow',
    adr: true,
    width: 640,
    window: [1280, 800, 1],
    crop: [336 / 1280, 76 / 800, 586 / 1280, 626 / 800],
    quality: 88,
    panels: [
      {
        scene: 'tokyo',
        run: 'without',
        patch: () => ({ flow: false }),
        step: 12000,
        text: 'Without the flow: step 12,000',
      },
      { scene: 'tokyo', step: 12000, text: 'With the flow in the tubes: step 12,000' },
    ],
  },
  {
    file: 'tokyo-time',
    width: 640,
    crop: [0.25, 0.08, 0.5, 0.84],
    panels: [
      { scene: 'tokyo', step: 1000, text: 'step 1,000' },
      { scene: 'tokyo', step: 48000, text: 'step 48,000 (26 hours)' },
    ],
  },
];
const only = process.env.README?.split(',');
const out = process.env.README_OUT ?? 'docs/images';
/** The gap between two panels and the height of a line of text, in pixels. */
const [GAP, LINE] = [8, 36];

/** The settings of a panel's run. */
function settingsOf(panel: Panel): Settings {
  const preset = PRESETS.find((p) => p.id === panel.scene);
  if (!preset) throw new Error(`no scene ${panel.scene}`);
  let s: Settings = { ...preset.settings(), seed: 7 };
  s = { ...s, ...panel.patch?.(s) };
  if (panel.rules) s = { ...s, territory: true, ...crownLevers(s) };
  return s;
}

/** Snapshots of the panels of one run, in the order of their steps, as data URLs. */
async function snapshots(page: Page, panels: Panel[]): Promise<string[]> {
  const [first] = panels;
  if (!first) return [];
  const preset = PRESETS.find((p) => p.id === first.scene);
  await page.goto('/');
  await page.waitForFunction(() => globalThis.physarum?.sim !== undefined);
  // Pause through the UI: the startup auto-tune runs only while playing, and it would apply the UI's settings.
  await page.keyboard.press('Space');
  await page.waitForFunction(() => globalThis.physarum?.paused === true);
  // The canvas fills the window without the panel.
  await page.getByRole('button', { name: 'Hide settings' }).click();
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return c !== null && c.width >= Math.round(innerWidth * Math.min(devicePixelRatio, 2)) - 1;
  });
  await page.evaluate(
    async ([s, env]) => {
      const e = globalThis.physarum;
      if (!e) throw new Error('no engine');
      await e.load(s, env);
    },
    [settingsOf(first), first.env ?? preset?.env ?? []] as const,
  );
  const urls: string[] = [];
  for (const panel of panels) {
    await page.evaluate(async (target) => {
      const e = globalThis.physarum;
      if (!e) throw new Error('no engine');
      for (let frames = 1; e.sim.step < target; frames++) {
        e.frame(performance.now(), Math.min(16, target - e.sim.step));
        // Keep the GPU queue short: a long queue on a busy GPU can trigger a GPU reset.
        if (frames % 4 === 0) await e.sim.finish();
      }
      await e.sim.finish();
    }, panel.step);
    urls.push(
      await page.evaluate(async (view) => {
        const e = globalThis.physarum;
        if (!e) throw new Error('no engine');
        e.fitView();
        if (view) {
          const { width, height } = e.sim;
          e.view = { center: [view.at[0] * width, view.at[1] * height], scale: e.view.scale / view.zoom };
        }
        const blob = await e.snapshot();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return `data:image/png;base64,${btoa(s)}`;
      }, panel.view),
    );
  }
  return urls;
}

/** One page in a window of the picture's size. */
async function pageOf(browser: Browser, picture: Picture): Promise<Page> {
  const [width, height, scale] = picture.window ?? [1600, 1000, 2];
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    baseURL: test.info().project.use.baseURL ?? '',
  });
  return context.newPage();
}

for (const picture of PICTURES.filter((p) => (only ? only.includes(p.file) : !p.adr))) {
  test(picture.file, async ({ browser }) => {
    test.setTimeout(3_600_000); // a manual tool: 48,000 steps of the Tokyo scene take minutes
    // The runs, each with its panels in the order of their steps.
    const runs = new Map<string, Panel[]>();
    for (const panel of picture.panels) {
      const key = `${panel.scene}/${panel.run ?? ''}`;
      runs.set(key, [...(runs.get(key) ?? []), panel]);
    }
    const urls = new Map<Panel, string>();
    for (const panels of runs.values()) {
      const sorted = [...panels].sort((a, b) => a.step - b.step);
      const page = await pageOf(browser, picture);
      const shots = await snapshots(page, sorted);
      sorted.forEach((p, i) => urls.set(p, shots[i] ?? ''));
      await page.context().close();
    }
    if (picture.single)
      for (const [i, p] of picture.panels.entries())
        await compose(
          browser,
          { ...picture, crop: p.crop ?? picture.crop ?? [0, 0, 1, 1], panels: [p] },
          urls,
          `${picture.file}-${String(i + 1)}`,
        );
    else await compose(browser, picture, urls, picture.file);
  });
}

/** Writes the panels of a picture in its grid, from their snapshots, to the file `name`.jpg. */
async function compose(browser: Browser, picture: Picture, urls: Map<Panel, string>, name: string) {
  const [ww, wh, ws] = picture.window ?? [1600, 1000, 2];
  const [cw, ch] = [ww * ws, wh * ws];
  const [x, y, w, h] = picture.crop ?? [0, 0, 1, 1];
  const width = picture.width;
  const scale = width / (w * cw);
  const height = Math.round(h * ch * scale);
  const columns = Math.min(picture.columns ?? picture.panels.length, picture.panels.length);
  const text = picture.panels.some((p) => p.text);
  const panel = (p: Panel) =>
    `<div style="width:${String(width)}px">` +
    `<div style="width:${String(width)}px;height:${String(height)}px;overflow:hidden">` +
    `<img src="${urls.get(p) ?? ''}" style="display:block;width:${String(cw * scale)}px;` +
    `margin:${String(-y * ch * scale)}px 0 0 ${String(-x * cw * scale)}px"></div>` +
    (text
      ? `<div style="height:${String(LINE)}px;padding-left:10px;box-sizing:border-box;` +
        `font:18px/${String(LINE)}px Helvetica,Arial,sans-serif;color:#ececec;background:#0c0d12">${p.text ?? ''}</div>`
      : '') +
    `</div>`;
  const full = columns * width + (columns - 1) * GAP;
  const rows = Math.ceil(picture.panels.length / columns);
  const sheet = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
  await sheet.setViewportSize({ width: full, height: rows * (height + (text ? LINE : 0)) + (rows - 1) * GAP });
  await sheet.setContent(
    `<body style="margin:0;background:#0c0d12"><div id="picture" style="display:flex;flex-wrap:wrap;` +
      `gap:${String(GAP)}px;width:${String(full)}px">${picture.panels.map(panel).join('')}</div></body>`,
  );
  await sheet.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
  const jpeg = await sheet.locator('#picture').screenshot({ type: 'jpeg', quality: picture.quality ?? 86 });
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/${name}.jpg`, jpeg);
  await sheet.context().close();
}
