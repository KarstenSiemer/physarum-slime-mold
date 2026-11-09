import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app, loadPreset, sceneChanged } from './state.svelte';

// One app state per module: the tests run in order.
describe('the current scene', () => {
  beforeAll(() => {
    vi.useFakeTimers(); // notices hide themselves after a few seconds
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('is the loaded preset, unchanged until a model parameter changes', () => {
    loadPreset('network');
    expect(app.scene).toBe('network');
    expect(sceneChanged()).toBe(false);
    app.settings.seed = 42;
    app.settings.style = 'paper';
    expect(sceneChanged()).toBe(false);
    const a = app.settings.strains[0];
    if (!a) throw new Error('no strain');
    a.sensorAngle = 30;
    expect(sceneChanged()).toBe(true);
    loadPreset('network');
    expect(sceneChanged()).toBe(false);
  });

  it('does not count a grid the device lowered as a change', () => {
    loadPreset('network');
    app.maxResolution = 768; // as the startup check or the memory fit set it
    app.settings.resolution = 768;
    expect(sceneChanged()).toBe(false);
    app.settings.resolution = 512; // the user's choice
    expect(sceneChanged()).toBe(true);
    app.maxResolution = 4096;
  });
});
