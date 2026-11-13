// The corners in the walls of every scene (README.md, step 4): built as the app builds a scene, on the screens of the
// maze harness. Not a test of the app: it runs only when asked, with the configuration research/vitest.config.ts.
//
// For every pair of open cells that are diagonal neighbours, the two cells beside the corner between them:
// - `gaps`: both are walls. Only a child could pass there (the gap of ADR 0025, amendment of 2026-11-13).
// - `corners`: one is a wall. A move from a position in the one cell can reach the other through the free cell.
// A cell outside a box or the dish is no wall, as for a move (wallIn in agents.wgsl). One line per scene and screen
// goes to research/corner/out/walls.jsonl.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../src/engine/engine';
import { grid } from '../../src/engine/growth-reference';
import { WebGpuBackend } from '../../src/engine/webgpu';
import { constrain, defaultSettings } from '../../src/model/params';
import { PRESETS } from '../../src/model/presets';

const SCREENS = ['1280x720', '1280x800', '800x800'];

it('counts the corners in the walls of every scene', async () => {
  const backend = await WebGpuBackend.create(document.createElement('canvas'));
  const lent = new Proxy(backend, {
    get(target, key) {
      if (key === 'destroy') return () => undefined;
      return Reflect.get(target, key, target) as unknown;
    },
  });
  const rows: string[] = [];
  const scenes = [{ id: 'default', settings: () => defaultSettings(), env: [] }, ...PRESETS];
  for (const scene of scenes)
    for (const screen of SCREENS) {
      const [cw, ch] = screen.split('x').map(Number) as [number, number];
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [cw, ch];
      const settings = constrain({ ...scene.settings(), seed: 1 });
      const engine = await Engine.create(canvas, settings, undefined, lent);
      await engine.load(settings, scene.env ?? []);
      const { width: w, height: h } = engine.sim;
      const env = await engine.sim.readEnv();
      const { cellAt } = grid(w, h, settings.boundary);
      const wall = (x: number, y: number) => {
        const c = cellAt(x, y);
        return c >= 0 && (env[c * 4] ?? 0) >= 128;
      };
      const open = (x: number, y: number) => cellAt(x, y) >= 0 && !wall(x, y);
      let [gaps, corners, walls] = [0, 0, 0];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (wall(x, y)) walls++;
          if (!open(x, y)) continue;
          // Each pair once: the neighbours below left and below right.
          for (const dx of [-1, 1]) {
            if (!open(x + dx, y + 1)) continue;
            const n = Number(wall(x + dx, y)) + Number(wall(x, y + 1));
            if (n === 2) gaps++;
            else if (n === 1) corners++;
          }
        }
      const row = {
        scene: scene.id,
        screen,
        w,
        h,
        boundary: settings.boundary,
        growth: settings.growth,
        walls,
        gaps,
        corners,
      };
      console.log(JSON.stringify(row));
      rows.push(JSON.stringify(row));
      engine.destroy();
    }
  await commands.writeFile('research/corner/out/walls.jsonl', rows.join('\n') + '\n');
  backend.destroy();
}, 1_800_000);
