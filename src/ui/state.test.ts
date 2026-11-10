import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CpuBackend } from '../engine/cpu-backend';
import { Engine } from '../engine/engine';
import type { Boundary, Settings } from '../model/params';
import type { EnvShape } from '../model/presets';

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

// The owner: painting counts too. The card offers Reload scene when the food, light or walls are not the scene's.
describe('food, light and walls of the scene', () => {
  it('count as a change once they differ from the scene, and not once the sweep took a stroke back', async () => {
    const { app, clearEnvironment, loadPreset, sceneChanged, setEngine, startScene } = await fresh();
    loadPreset('maze');
    const canvas = { width: 1600, height: 1000 } as HTMLCanvasElement;
    const engine = await Engine.create(canvas, structuredClone(app.settings), undefined, new CpuBackend());
    setEngine(engine);
    await startScene(engine);
    expect(sceneChanged()).toBe(false);
    engine.paint({ kind: 'food', from: [100, 100], to: [100, 100], radius: 5 });
    expect(sceneChanged()).toBe(true);
    // Erased completely: the sweep deletes the food and the erase, and the list is the scene's again.
    engine.paint({ kind: 'erase', from: [100, 100], to: [100, 100], radius: 10 });
    expect(sceneChanged()).toBe(false);
    // Over a wall of the maze: the wall goes, and so does the scene.
    engine.paint({ kind: 'erase', from: [128, 0], to: [128, 230], radius: 12 });
    expect(sceneChanged()).toBe(true);
    loadPreset('maze');
    expect(sceneChanged()).toBe(false);
    clearEnvironment();
    expect(sceneChanged()).toBe(true);
    loadPreset('three-strains');
    clearEnvironment(); // nothing to clear
    expect(sceneChanged()).toBe(false);
    setEngine(undefined);
  });

  it('count a Clear before the engine exists as a change of a scene with shapes, until a preset loads', async () => {
    const { app, clearEnvironment, loadPreset, sceneChanged, setEngine, startScene } = await fresh();
    loadPreset('three-strains');
    clearEnvironment();
    expect(sceneChanged()).toBe(false);
    loadPreset('maze');
    clearEnvironment();
    expect(sceneChanged()).toBe(true);
    // The engine then starts without the shapes, and says so too.
    const canvas = { width: 1600, height: 1000 } as HTMLCanvasElement;
    const engine = await Engine.create(canvas, structuredClone(app.settings), undefined, new CpuBackend());
    setEngine(engine);
    await startScene(engine);
    expect(engine.matches([], 'box')).toBe(true);
    expect(sceneChanged()).toBe(true);
    loadPreset('maze');
    expect(sceneChanged()).toBe(false);
    setEngine(undefined);
  });
});

describe('the scene flag', () => {
  // loadPreset resets it: a scene chosen after a Clear before the engine exists is that scene unchanged (mutant ST1 of
  // the review of ADR 0019).
  it('is clear for a preset chosen after a Clear before the engine exists', async () => {
    const { clearEnvironment, loadPreset, sceneChanged } = await fresh();
    loadPreset('maze');
    clearEnvironment();
    expect(sceneChanged()).toBe(true);
    loadPreset('steiner');
    expect(sceneChanged()).toBe(false);
  });

  // The list is judged in the scene's own arena, not the one on screen (mutant ST3).
  it('is clear after a stroke and its erase in another arena, back in the scene arena', async () => {
    const { app, loadPreset, sceneChanged, setEngine, startScene } = await fresh();
    loadPreset('steiner'); // a dish scene
    const canvas = { width: 1600, height: 1000 } as HTMLCanvasElement;
    const engine = await Engine.create(canvas, structuredClone(app.settings), undefined, new CpuBackend());
    setEngine(engine);
    await startScene(engine);
    app.settings.boundary = 'box';
    await engine.apply(structuredClone(app.settings));
    engine.paint({ kind: 'food', from: [20, 20], to: [20, 20], radius: 4 });
    expect(sceneChanged()).toBe(true);
    engine.paint({ kind: 'erase', from: [20, 20], to: [20, 20], radius: 9 });
    app.settings.boundary = 'dish';
    await engine.apply(structuredClone(app.settings));
    expect(sceneChanged()).toBe(false);
    setEngine(undefined);
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

// App.svelte calls startScene() once the engine exists; the panel works before that.
describe('the start of the engine', () => {
  type Call = [string, string, number, (string | undefined)?];
  const recorder = () => {
    const calls: Call[] = [];
    const engine = {
      load: (s: Settings, env: readonly EnvShape[] = [], arena?: Boundary) => {
        calls.push(['load', s.boundary, env.length, arena]);
        return Promise.resolve();
      },
      // Not part of what startScene() may call: a second step there would undo a setting changed during the load.
      apply: (s: Settings) => {
        calls.push(['apply', s.boundary, 0]);
        return Promise.resolve();
      },
    };
    return { calls, engine };
  };

  it("loads once: the panel's settings, and the scene's shapes in the scene's own arena", async () => {
    const { app, loadPreset, startScene } = await fresh();
    loadPreset('steiner');
    app.settings.boundary = 'box';
    app.settings.speed = 3;
    const { calls, engine } = recorder();
    await startScene(engine);
    expect(calls).toEqual([['load', 'box', 4, 'dish']]);
  });

  it('starts without the shapes after a Clear before the engine existed, until a preset is chosen', async () => {
    const { clearEnvironment, loadPreset, startScene } = await fresh();
    loadPreset('maze');
    clearEnvironment();
    const first = recorder();
    await startScene(first.engine);
    expect(first.calls).toEqual([['load', 'box', 0, 'box']]);
    loadPreset('steiner');
    const second = recorder();
    await startScene(second.engine);
    expect(second.calls).toEqual([['load', 'dish', 4, 'dish']]);
  });

  it('starts settings from the page address without shapes, under their own boundary', async () => {
    const { app, startScene } = await fresh();
    app.settings.boundary = 'dish'; // a shared link names no scene
    const { calls, engine } = recorder();
    await startScene(engine);
    expect(calls).toEqual([['load', 'dish', 0, undefined]]);
  });
});
