import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fresh module per test: the app state and the once-per-page-load notice live in the module.
async function fresh() {
  vi.resetModules();
  return import('./state.svelte');
}

beforeEach(() => {
  vi.useFakeTimers(); // notices hide themselves after a few seconds
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the current scene', () => {
  it('is the loaded preset, unchanged until a model parameter changes', async () => {
    const { app, loadPreset, sceneChanged } = await fresh();
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

  it('does not count a grid the device lowered as a change', async () => {
    const { app, loadPreset, sceneChanged } = await fresh();
    loadPreset('network');
    app.maxResolution = 768; // as the startup check or the memory fit set it
    app.settings.resolution = 768;
    expect(sceneChanged()).toBe(false);
    app.settings.resolution = 512; // the user's choice
    expect(sceneChanged()).toBe(true);
  });

  it('keeps the rule off without the backend feature, and says so once per page load', async () => {
    const { app, loadPreset, ruleUnavailable, sceneChanged } = await fresh();
    loadPreset('three-strains'); // made without the rule: no notice
    ruleUnavailable();
    expect(app.notice).toBe('');
    loadPreset('spots');
    expect(app.settings.collisions).toBe(false);
    expect(sceneChanged()).toBe(false);
    expect(app.notice).toMatch(/cannot run one agent per cell/);
    app.notice = '';
    loadPreset('network');
    expect(app.settings.collisions).toBe(false);
    expect(app.notice).toBe('');
  });

  it('gives the notice for a scene chosen before the engine found the rule missing', async () => {
    const { app, loadPreset, ruleUnavailable, sceneChanged } = await fresh();
    loadPreset('maze'); // the panel works while the engine starts
    expect(app.settings.collisions).toBe(true);
    ruleUnavailable();
    expect(app.settings.collisions).toBe(false);
    expect(sceneChanged()).toBe(false);
    expect(app.notice).toMatch(/cannot run one agent per cell/);
  });

  it('points the inoculate tool at a strain the new scene has', async () => {
    const { app, loadPreset } = await fresh();
    loadPreset('dot-grid');
    app.strain = 2;
    loadPreset('network');
    expect(app.strain).toBe(0);
    loadPreset('three-strains');
    app.strain = 1;
    loadPreset('two-strains');
    expect(app.strain).toBe(1);
  });
});

describe('adding and removing strains', () => {
  it('keeps the scene index of every strain, so each keeps its role', async () => {
    const { app, addStrain, loadPreset, removeStrain } = await fresh();
    loadPreset('dot-grid');
    expect(app.strainOrigin).toEqual([0, 1, 2]);
    removeStrain(0);
    expect(app.strainOrigin).toEqual([1, 2]);
    addStrain();
    expect(app.settings.strains).toHaveLength(3);
    expect(app.strainOrigin).toEqual([1, 2, -1]);
    loadPreset('dot-grid');
    expect(app.strainOrigin).toEqual([0, 1, 2]);
  });

  it('keeps the inoculate tool on its strain when an earlier one goes', async () => {
    const { app, loadPreset, removeStrain } = await fresh();
    loadPreset('dot-grid');
    const c = app.settings.strains[2]?.color;
    app.strain = 2;
    removeStrain(0);
    expect(app.strain).toBe(1);
    expect(app.settings.strains[app.strain]?.color).toBe(c);
    removeStrain(1); // the selected strain itself
    expect(app.strain).toBe(0);
  });

  it('counts adding a strain as a change, and removing it again as none', async () => {
    const { app, addStrain, loadPreset, removeStrain, sceneChanged } = await fresh();
    for (const id of ['three-strains', 'two-strains', 'cyclones', 'network']) {
      loadPreset(id);
      addStrain();
      expect(sceneChanged(), id).toBe(true);
      removeStrain(app.settings.strains.length - 1);
      expect(sceneChanged(), id).toBe(false);
    }
  });
});
