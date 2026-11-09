// The gel style's height field (render.wgsl `heightField`, gl/glsl/height.frag) on both backends (ADR 0009).
import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { WebGl2Backend } from './gl/backend';
import type { Backend } from './types';
import { WebGpuBackend } from './webgpu';

const BACKENDS = {
  webgpu: (c: HTMLCanvasElement): Promise<Backend> => WebGpuBackend.create(c),
  webgl2: (c: HTMLCanvasElement): Promise<Backend> => Promise.resolve(WebGl2Backend.create(c)),
};

const SIZE = 192;

/** Centre of the pixels the gel draws (anything clearly away from the background), in canvas pixels. */
function blobCentre(img: ImageData) {
  const bg = [img.data[0] ?? 0, img.data[1] ?? 0, img.data[2] ?? 0];
  let [n, sx, sy] = [0, 0, 0];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const d = Math.abs((img.data[i] ?? 0) - (bg[0] ?? 0)) + Math.abs((img.data[i + 1] ?? 0) - (bg[1] ?? 0));
      if (d > 40) [n, sx, sy] = [n + 1, sx + x + 0.5, sy + y + 0.5];
    }
  return { pixels: n, x: sx / n, y: sy / n };
}

describe.each(Object.entries(BACKENDS))('%s', (_, create) => {
  // A blob of trail around one cell, seen at 8 px per cell (one bilinear lookup per height) and at
  // 1.5 cells per px (four taps): the drawn blob must sit on that cell, across the wrap seam too.
  it.each([
    ['wrap', 5, 9, 1 / 8],
    ['wrap', 0, 0, 1 / 8],
    ['wrap', 0, 0, 1.5],
    ['box', 0, 13, 1 / 8],
    ['box', 40, 3, 1 / 8],
    ['box', 30, 20, 1.5],
  ] as const)('draws the height field in place (%s, cell %i, %i, scale %f)', async (boundary, cx, cy, scale) => {
    const backend = await create(document.createElement('canvas'));
    const [w, h] = [64, 48];
    const settings: Settings = {
      ...defaultSettings(),
      style: 'gel',
      boundary,
      layout: 'empty',
      strains: [defaultStrain(0)],
    };
    const sim = await backend.createSim(settings, w, h, 1);
    const trail = new Float32Array(w * h * 4);
    for (let dy = -8; dy <= 8; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        const [x, y] = [cx + dx, cy + dy];
        if (boundary !== 'wrap' && (x < 0 || y < 0 || x >= w || y >= h)) continue;
        trail[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] = 400 * Math.exp(-(dx * dx + dy * dy) / 8);
      }
    sim.writeTrail(trail);
    const view = { center: [cx + 0.5, cy + 0.5] as [number, number], scale };
    const img = await backend.capture(sim, settings, view, SIZE, SIZE);
    const c = blobCentre(img);
    expect(c.pixels).toBeGreaterThan(30);
    // A closed arena cuts the blob at its edge: only check the axes it does not cut. A lookup one cell
    // off moves the centre by 8 px at 8 px per cell.
    const tolerance = scale < 1 ? 1.5 : 0.75;
    if (boundary === 'wrap' || (cx > 8 && cx < w - 9)) expect(Math.abs(c.x - SIZE / 2)).toBeLessThan(tolerance);
    if (boundary === 'wrap' || (cy > 8 && cy < h - 9)) expect(Math.abs(c.y - SIZE / 2)).toBeLessThan(tolerance);
    sim.destroy();
    backend.destroy();
  });
});
