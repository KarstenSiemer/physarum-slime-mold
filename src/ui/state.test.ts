import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CpuBackend } from '../engine/cpu-backend';
import { Engine } from '../engine/engine';
import type { EnvEdit } from '../engine/environment';
import { defaultSettings, type Boundary, type Settings } from '../model/params';
import { presetById, type EnvShape } from '../model/presets';

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

// A shared link names the scene, which of its shapes the list holds and the strokes after them (docs/adr/0021).
describe('a shared link', () => {
  const dab: EnvEdit = { kind: 'food', from: [100, 60], to: [100, 60], radius: 4, grid: [512, 320], boundary: 'box' };
  const mazeShapes = () => (presetById('maze')?.env ?? []).map(() => true);
  const canvas = () => ({ width: 1600, height: 1000 }) as HTMLCanvasElement;
  const loads = () => {
    const calls: [number, number, (string | undefined)?][] = [];
    const engine = {
      load: (_s: Settings, env: readonly EnvShape[] = [], arena?: Boundary, strokes: readonly EnvEdit[] = []) => {
        calls.push([env.length, strokes.length, arena]);
        return Promise.resolve();
      },
    };
    return { calls, engine };
  };

  it('loads once with its settings, the shapes it kept and its strokes, and the card says the scene changed', async () => {
    const { app, currentDrawing, openLink, sceneChanged, setEngine, startScene } = await fresh();
    const settings = presetById('maze')?.settings() ?? defaultSettings();
    const shapes = mazeShapes().map((_, i) => i !== 1);
    const drawing = { scene: 'maze', origins: [0], shapes, strokes: [dab] };
    openLink({ settings, drawing });
    expect(app.scene).toBe('maze');
    expect(app.strainOrigin).toEqual([0]);
    expect(sceneChanged()).toBe(true); // before the engine exists
    expect(currentDrawing()).toEqual(drawing);
    const { calls, engine } = loads();
    await startScene(engine);
    expect(calls).toEqual([[shapes.length - 1, 1, 'box']]);
    // With an engine: its list is the sender's, and the flag stays.
    openLink({ settings, drawing });
    const real = await Engine.create(canvas(), structuredClone(app.settings), undefined, new CpuBackend());
    setEngine(real);
    await startScene(real);
    expect(real.envList().at(-1)).toEqual(dab);
    expect(real.envList()).toHaveLength(shapes.length);
    expect(sceneChanged()).toBe(true);
    expect(currentDrawing()).toEqual(drawing);
    setEngine(undefined);
  });

  it("gives each strain the role it had in the sender's scene", async () => {
    const { app, openLink } = await fresh();
    const s = presetById('dot-grid')?.settings() ?? defaultSettings();
    // The sender removed strain A and added one: B and C moved up a letter.
    const settings = { ...s, strains: [...s.strains.slice(1), s.strains[0] ?? s.strains[1]] } as Settings;
    openLink({ settings, drawing: { scene: 'dot-grid', origins: [1, 2, -1], shapes: [], strokes: [] } });
    expect(app.strainOrigin).toEqual([1, 2, -1]);
  });

  it('of the scene as it loads is the scene unchanged, until a model setting differs', async () => {
    const { app, openLink, sceneChanged, setEngine, startScene } = await fresh();
    const settings = presetById('maze')?.settings() ?? defaultSettings();
    openLink({ settings, drawing: { scene: 'maze', origins: [0], shapes: mazeShapes(), strokes: [] } });
    expect(sceneChanged()).toBe(false);
    const engine = await Engine.create(canvas(), structuredClone(app.settings), undefined, new CpuBackend());
    setEngine(engine);
    await startScene(engine);
    expect(sceneChanged()).toBe(false);
    setEngine(undefined);
    const other = { ...settings, diffusion: 3 };
    openLink({ settings: other, drawing: { scene: 'maze', origins: [0], shapes: mazeShapes(), strokes: [] } });
    expect(sceneChanged()).toBe(true);
  });

  it('with settings only loads them alone, as before, and names no scene', async () => {
    const { app, currentDrawing, openLink, sceneChanged, startScene } = await fresh();
    const settings = { ...defaultSettings(), boundary: 'dish' as const };
    openLink({ settings });
    expect(app.scene).toBe('');
    expect(app.notice).toBe('');
    expect(sceneChanged()).toBe(false);
    expect(currentDrawing()).toEqual({ scene: '', origins: [], shapes: [], strokes: [] });
    const { calls, engine } = loads();
    await startScene(engine);
    expect(calls).toEqual([[0, 0, undefined]]);
  });

  it('with a drawing this app cannot read loads the settings alone, and says so', async () => {
    const { app, currentDrawing, openLink, startScene } = await fresh();
    const settings = { ...defaultSettings(), boundary: 'dish' as const };
    openLink({ settings, drawingLost: true });
    expect(app.notice).toBe('This app cannot read the scene and drawing in this link, so only its settings load.');
    expect(app.scene).toBe('');
    expect(currentDrawing()).toEqual({ scene: '', origins: [], shapes: [], strokes: [] });
    const { calls, engine } = loads();
    await startScene(engine);
    expect(calls).toEqual([[0, 0, undefined]]);
  });

  it('loses its drawing to a preset or a Clear chosen before the engine starts', async () => {
    const { clearEnvironment, currentDrawing, loadPreset, openLink, startScene } = await fresh();
    const settings = presetById('maze')?.settings() ?? defaultSettings();
    const drawing = { scene: 'maze', origins: [0], shapes: mazeShapes(), strokes: [dab] };
    openLink({ settings, drawing });
    clearEnvironment();
    expect(currentDrawing()).toEqual({ ...drawing, shapes: mazeShapes().map(() => false), strokes: [] });
    const cleared = loads();
    await startScene(cleared.engine);
    expect(cleared.calls).toEqual([[0, 0, 'box']]);
    openLink({ settings, drawing });
    loadPreset('steiner');
    const loaded = loads();
    await startScene(loaded.engine);
    expect(loaded.calls).toEqual([[4, 0, 'dish']]);
  });

  it('counts every change of the food, light and walls for the page address', async () => {
    const { app, clearEnvironment, loadPreset, setEngine, startScene } = await fresh();
    const before = app.envVersion;
    loadPreset('maze');
    clearEnvironment();
    expect(app.envVersion).toBe(before + 2);
    const engine = await Engine.create(canvas(), structuredClone(app.settings), undefined, new CpuBackend());
    setEngine(engine);
    await startScene(engine);
    const loaded = app.envVersion;
    engine.paint(dab);
    expect(app.envVersion).toBe(loaded + 1);
    setEngine(undefined);
  });
});

// The inoculate tool uses only dead agents (ADR 0023). Whether one is left comes from the alive count of the stats,
// and only from a count of the engine's current run. After the start layout Empty restarted a scene where every agent
// lived, the count of the run before still said so for up to 500 ms, and the app said that no dead agent was left.
describe('dead agents for the inoculate tool', () => {
  it('come from the alive count of the current run only', async () => {
    const { app, deadLeft } = await fresh();
    const s = { ...defaultSettings(), resolution: 256 };
    const canvas = { width: 1600, height: 1000 } as HTMLCanvasElement;
    const engine = await Engine.create(canvas, s, undefined, new CpuBackend());
    const agents = engine.sim.agents;
    app.strain = 0;
    app.stats = { ...app.stats, alive: [agents], run: engine.restarts };
    expect(deadLeft(engine)).toBe(false);
    app.stats = { ...app.stats, alive: [agents - 1], run: engine.restarts };
    expect(deadLeft(engine)).toBe(true);
    app.stats = { ...app.stats, alive: [agents], run: engine.restarts };
    engine.reset();
    expect(deadLeft(engine)).toBeUndefined();
    app.stats = { ...app.stats, alive: [0], run: engine.restarts };
    expect(deadLeft(engine)).toBe(true);
    app.strain = 1; // no such strain
    expect(deadLeft(engine)).toBeUndefined();
  });
});
