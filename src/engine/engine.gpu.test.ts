// Engine behavior in a real browser (ADR 0010).
import { expect, it } from 'vitest';
import { defaultSettings } from '../model/params';
import { Engine } from './engine';
import { OutOfMemoryError } from './gpu';

it('frees the old simulation before it allocates the new one (peak memory: one simulation)', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const engine = await Engine.create(canvas, { ...defaultSettings(), resolution: 256, density: 0.2 });
  const old = engine.sim;
  let freed = false;
  const destroy = old.destroy.bind(old);
  old.destroy = () => {
    freed = true;
    destroy();
  };
  const createSim = engine.backend.createSim.bind(engine.backend);
  let freedFirst: boolean | undefined;
  engine.backend.createSim = (...args) => {
    freedFirst = freed;
    return createSim(...args);
  };
  await engine.apply({ ...engine.settings, resolution: 512 });
  expect(freedFirst).toBe(true);
  expect(engine.sim.width).toBe(512);
  engine.frame(performance.now(), 2);
  expect(engine.sim.step).toBe(2);
  engine.destroy();
});

it('steps the grid down after an out-of-memory error, also back to the old size', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const engine = await Engine.create(canvas, { ...defaultSettings(), resolution: 512, density: 0.2 });
  const old = engine.sim;
  const createSim = engine.backend.createSim.bind(engine.backend);
  const sizes: number[] = [];
  engine.backend.createSim = (settings, ...rest) => {
    sizes.push(settings.resolution);
    if (sizes.length === 1) return Promise.reject(new OutOfMemoryError('test'));
    return createSim(settings, ...rest);
  };
  const adjusted: number[] = [];
  engine.onAdjust = (_, resolution) => adjusted.push(resolution);
  await engine.apply({ ...engine.settings, resolution: 768 });
  // 768 fails, 512 is the next lower grid: the old one was freed, so a new one must be built.
  expect(sizes).toEqual([768, 512]);
  expect(adjusted).toEqual([512]);
  expect(engine.sim).not.toBe(old);
  expect(engine.sim.width).toBe(512);
  engine.destroy();
});
