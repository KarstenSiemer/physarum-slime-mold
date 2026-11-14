import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CpuBackend } from '../engine/cpu-backend';
import { Engine } from '../engine/engine';
import type { EnvEdit } from '../engine/environment';
import { decodeLink, encodeLink } from '../model/url';
import { constrain, defaultSettings, jonesFits, type Boundary, type Settings } from '../model/params';
import { presetById, PRESETS, shapeRevision, shapesAt, type EnvShape } from '../model/presets';

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

  // The scent view is the user's, not the scene's (ADR 0009, amendment 2026-11-11): it survives a new scene, so two
  // scenes compare, and it is no change to a scene.
  it('keeps the scent view on a new scene, and does not count it as a change', async () => {
    const { app, loadPreset, sceneChanged } = await fresh();
    loadPreset('network');
    app.settings.showScent = true;
    expect(sceneChanged()).toBe(false);
    loadPreset('light');
    expect(app.settings.showScent).toBe(true);
    expect(app.sceneBase?.showScent).toBe(true);
    expect(sceneChanged()).toBe(false);
    app.settings.showScent = false;
    loadPreset('maze');
    expect(app.settings.showScent).toBe(false);
  });

  // So is the picture of the tubes (ADR 0034): a switch of the view, not of a scene.
  it('keeps the picture of the tubes on a new scene, and does not count it as a change', async () => {
    const { app, loadPreset, sceneChanged } = await fresh();
    loadPreset('maze');
    expect(app.settings.showTubes).toBe(true);
    app.settings.showTubes = false;
    expect(sceneChanged()).toBe(false);
    loadPreset('tokyo');
    expect(app.settings.showTubes).toBe(false);
    expect(app.sceneBase?.showTubes).toBe(false);
    expect(sceneChanged()).toBe(false);
    app.settings.showTubes = true;
    loadPreset('maze');
    expect(app.settings.showTubes).toBe(true);
  });

  it('does not count a grid the device lowered as a change', async () => {
    const { app, loadPreset, sceneChanged } = await fresh();
    loadPreset('three-strains');
    app.maxResolution = 768; // as the startup check or the memory fit set it
    app.settings.resolution = 768;
    expect(sceneChanged()).toBe(false);
    app.settings.resolution = 512; // the user's choice
    expect(sceneChanged()).toBe(true);
  });

  // ADR 0026: a scene of Jones runs on the lattice of its figure. Another grid is the user's choice: the scene changed,
  // and the panel names the lattice with a way back (latticeLeft(), useSceneLattice()).
  it('counts another grid of a scene of Jones as a change, and its way back restores the lattice', async () => {
    const { app, latticeLeft, latticeValue, loadPreset, pickGrid, sceneChanged, useSceneLattice } = await fresh();
    loadPreset('shrinking');
    expect(app.settings.lattice).toEqual([300, 300]);
    expect([sceneChanged(), latticeLeft()]).toEqual([false, undefined]);
    // On its lattice the resolution sets nothing: no change.
    app.settings.resolution = 1024;
    expect(sceneChanged()).toBe(false);
    // A grid shaped like the screen is a change, also at the scene's own resolution.
    pickGrid('512');
    expect([sceneChanged(), latticeLeft()]).toEqual([true, [300, 300]]);
    pickGrid('768');
    expect([app.settings.lattice, app.settings.resolution, app.gridPicked]).toEqual([null, 768, true]);
    expect([sceneChanged(), latticeLeft()]).toEqual([true, [300, 300]]);
    // Another change stays when the lattice comes back.
    app.settings.foodStrength = 0.1;
    useSceneLattice();
    expect(app.settings.lattice).toEqual([300, 300]);
    expect(latticeLeft()).toBeUndefined();
    expect(sceneChanged()).toBe(true);
    app.settings.foodStrength = 0.05;
    expect(sceneChanged()).toBe(false);
    // The grid choice takes the lattice's own value too, and ignores what it does not know.
    pickGrid('512');
    pickGrid(latticeValue([300, 300]));
    expect([app.settings.lattice, sceneChanged()]).toEqual([[300, 300], false]);
    pickGrid('evil');
    pickGrid('0');
    expect([app.settings.lattice, app.settings.resolution]).toEqual([[300, 300], 512]);
    // The app's scenes have no lattice, so no hint and nothing to restore.
    loadPreset('maze');
    pickGrid('256');
    useSceneLattice();
    expect([app.settings.lattice, latticeLeft(), sceneChanged()]).toEqual([null, undefined, true]);
  });

  it('opens an old link of a scene of Jones as it was made, on the grid shaped like the screen', async () => {
    const { app, latticeLeft, linkUnchanged, loadPreset, openLink, sceneChanged, useSceneLattice } = await fresh();
    const old = { ...(presetById('steiner')?.settings() ?? defaultSettings()), lattice: null, resolution: 256 };
    const link = await decodeLink(
      (
        await encodeLink(old, {
          scene: 'steiner',
          revision: 0,
          origins: [0],
          shapes: [true, true, true, true],
          strokes: [],
        })
      ).hash,
    );
    if (!link) throw new Error('no link');
    openLink(link);
    expect([app.scene, app.settings.lattice, app.settings.resolution]).toEqual(['steiner', null, 256]);
    expect([sceneChanged(), latticeLeft()]).toEqual([true, [200, 200]]);
    // The receiver changed nothing: the card says that the link changes the scene, until the receiver changes it.
    expect(linkUnchanged()).toBe(true);
    app.settings.density = 0.03;
    expect(linkUnchanged()).toBe(false);
    app.settings.density = 0.02;
    expect(linkUnchanged()).toBe(true);
    // The way back is no change made by the link. The link holds revision 0 of the foods (ADR 0027), so the scene
    // stays changed until Reload scene loads its foods of Fig. 19.
    useSceneLattice();
    expect([sceneChanged(), linkUnchanged(), app.sceneRevision]).toEqual([true, false, 0]);
    loadPreset('steiner');
    expect(app.linkBase).toBeUndefined();
    expect([sceneChanged(), app.sceneRevision]).toEqual([false, 1]);
  });

  // ADR 0026: the scene's own lattice is no pick of a grid size, so the startup check goes on for later scenes.
  it('stops the startup check for a picked grid size, not for the scene’s own lattice', async () => {
    const { app, loadPreset, pickGrid, useSceneLattice } = await fresh();
    loadPreset('wound');
    pickGrid('300x300');
    expect(app.gridPicked).toBe(false);
    app.settings.lattice = null;
    useSceneLattice();
    expect([app.settings.lattice, app.gridPicked]).toEqual([[300, 300], false]);
    pickGrid('512');
    expect(app.gridPicked).toBe(true);
    app.gridPicked = false;
    pickGrid('640x480');
    expect([app.settings.lattice, app.gridPicked]).toEqual([[640, 480], true]);
  });

  // ADR 0026: what the app does when the engine cannot hold a grid (Engine.onAdjust).
  it('drops a lattice the device cannot hold, and counts the scene’s own lattice as no change', async () => {
    const { app, deviceAdjusted, latticeLeft, loadPreset, sceneChanged } = await fresh();
    loadPreset('shrinking');
    deviceAdjusted('no room', 256, [300, 300]);
    expect([app.settings.lattice, app.settings.resolution, app.maxResolution]).toEqual([null, 256, 4096]);
    expect([app.lostLattice, sceneChanged(), latticeLeft(), app.notice]).toEqual([
      [300, 300],
      false,
      undefined,
      'no room',
    ]);
    // A new load tries the lattice again.
    loadPreset('shrinking');
    expect([app.settings.lattice, app.lostLattice]).toEqual([[300, 300], null]);
    // A lattice from a link that the device cannot hold: the scene's own lattice stays the way back.
    app.settings.lattice = [3000, 3000];
    deviceAdjusted('no room', 512, [3000, 3000]);
    expect([app.settings.lattice, app.lostLattice, sceneChanged(), latticeLeft()]).toEqual([
      null,
      null,
      true,
      [300, 300],
    ]);
    // A scene chosen meanwhile keeps its lattice.
    loadPreset('steiner');
    deviceAdjusted('no room', 256, [300, 300]);
    expect(app.settings.lattice).toEqual([200, 200]);
    // A grid shaped like the screen: the device's largest grid caps it and later scenes.
    loadPreset('three-strains');
    deviceAdjusted('lowered', 768);
    expect([app.settings.resolution, app.maxResolution, sceneChanged()]).toEqual([768, 768, false]);
  });

  // ADR 0026: the startup check never lowers the scene's own lattice and counts none of its time; a larger lattice from
  // a link counts as the grid shaped like the screen with at least its cells, and goes.
  it('lowers a link’s lattice but never the scene’s own in the startup check', async () => {
    const { app, autoTune, loadPreset } = await fresh();
    const { GridTuner } = await import('./tune');
    /** An engine that runs `fps` frames and half the steps the speed asks for: too slow for the check. */
    const slow = (fps: number) => {
      const e = {
        settings: app.settings,
        canvas: { width: 1280, height: 720 },
        busy: false,
        restarts: 0,
        frames: 0,
        sim: { step: 0 },
        budget: { requested: 0, idleFrames: 0, idleMs: 0 },
      };
      return (tuner: InstanceType<typeof GridTuner>, ms: number) => {
        for (let t = 0; t < ms; t += 500) {
          e.settings = app.settings;
          e.frames += fps / 2;
          e.sim.step += 30;
          e.budget.requested += 60;
          autoTune(tuner, e as unknown as Parameters<typeof autoTune>[1], t, true);
        }
      };
    };
    loadPreset('wound');
    let tuner = new GridTuner();
    slow(10)(tuner, 20_000);
    expect([app.settings.lattice, tuner.running, app.notice]).toEqual([[300, 300], true, '']);
    // A link's lattice of 2048 × 2048 cells (4.2 million): it counts as 3072 on 16:9 and goes to 2048 × 1152.
    app.settings.lattice = [2048, 2048];
    tuner = new GridTuner();
    slow(10)(tuner, 4000);
    expect([app.settings.lattice, app.settings.resolution, app.maxResolution]).toEqual([null, 2048, 2048]);
    expect(app.notice).toMatch(/^Lowered the grid to 2048 cells/);
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
    const drawing = { scene: 'maze', revision: 0, origins: [0], shapes, strokes: [dab] };
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

  // ADR 0027: a link made before a scene's shapes changed paints the shapes it was made with, and says that it changes
  // the scene; Reload scene loads the scene's shapes of now.
  it("of an earlier revision of the scene's shapes paints those shapes, and Reload scene the newest", async () => {
    const { app, currentDrawing, linkUnchanged, loadPreset, openLink, sceneChanged, setEngine, startScene } =
      await fresh();
    const p = presetById('shrinking');
    if (!p) throw new Error('no Shrinking plasmodium');
    const old = shapesAt(p, 0) ?? [];
    const drawing = { scene: 'shrinking', revision: 0, origins: [0], shapes: old.map(() => true), strokes: [] };
    // After the scene's newest shapes, the link's own revision.
    loadPreset('shrinking');
    expect(app.sceneRevision).toBe(1);
    openLink({ settings: p.settings(), drawing });
    expect([app.sceneRevision, sceneChanged(), linkUnchanged()]).toEqual([0, true, true]);
    expect(currentDrawing()).toEqual(drawing);
    // Before the engine exists, startScene() loads the 8 shapes of revision 0.
    const { calls, engine } = loads();
    await startScene(engine);
    expect(calls).toEqual([[8, 0, 'dish']]);
    // With an engine: the list holds them, the address keeps revision 0, and the card says that the link changes the
    // scene.
    openLink({ settings: p.settings(), drawing });
    const real = await Engine.create(canvas(), structuredClone(app.settings), undefined, new CpuBackend());
    setEngine(real);
    await startScene(real);
    expect(real.envList()).toHaveLength(8);
    expect(real.matches(old, 'dish')).toBe(true);
    expect([sceneChanged(), linkUnchanged()]).toEqual([true, true]);
    expect(currentDrawing()).toEqual(drawing);
    // Reload scene: the 19 foods of Fig. 21, revision 1, and no change.
    loadPreset('shrinking');
    await vi.waitFor(() => {
      expect(real.envList()).toHaveLength(19);
    });
    expect([app.sceneRevision, sceneChanged(), currentDrawing().revision]).toEqual([1, false, 1]);
    expect(currentDrawing().shapes).toEqual(p.env?.map(() => true));
    setEngine(undefined);
  });

  it("gives each strain the role it had in the sender's scene", async () => {
    const { app, openLink } = await fresh();
    const s = presetById('dot-grid')?.settings() ?? defaultSettings();
    // The sender removed strain A and added one: B and C moved up a letter.
    const settings = { ...s, strains: [...s.strains.slice(1), s.strains[0] ?? s.strains[1]] } as Settings;
    openLink({ settings, drawing: { scene: 'dot-grid', revision: 0, origins: [1, 2, -1], shapes: [], strokes: [] } });
    expect(app.strainOrigin).toEqual([1, 2, -1]);
  });

  it('of the scene as it loads is the scene unchanged, until a model setting differs', async () => {
    const { app, openLink, sceneChanged, setEngine, startScene } = await fresh();
    const settings = presetById('maze')?.settings() ?? defaultSettings();
    openLink({ settings, drawing: { scene: 'maze', revision: 0, origins: [0], shapes: mazeShapes(), strokes: [] } });
    expect(sceneChanged()).toBe(false);
    const engine = await Engine.create(canvas(), structuredClone(app.settings), undefined, new CpuBackend());
    setEngine(engine);
    await startScene(engine);
    expect(sceneChanged()).toBe(false);
    setEngine(undefined);
    const other = { ...settings, diffusion: 3 };
    openLink({
      settings: other,
      drawing: { scene: 'maze', revision: 0, origins: [0], shapes: mazeShapes(), strokes: [] },
    });
    expect(sceneChanged()).toBe(true);
  });

  it('with settings only loads them alone, as before, and names no scene', async () => {
    const { app, currentDrawing, openLink, sceneChanged, startScene } = await fresh();
    const settings = { ...defaultSettings(), boundary: 'dish' as const };
    openLink({ settings });
    expect(app.scene).toBe('');
    expect(app.notice).toBe('');
    expect(sceneChanged()).toBe(false);
    expect(currentDrawing()).toEqual({ scene: '', revision: 0, origins: [], shapes: [], strokes: [] });
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
    expect(currentDrawing()).toEqual({ scene: '', revision: 0, origins: [], shapes: [], strokes: [] });
    const { calls, engine } = loads();
    await startScene(engine);
    expect(calls).toEqual([[0, 0, undefined]]);
  });

  it('loses its drawing to a preset or a Clear chosen before the engine starts', async () => {
    const { clearEnvironment, currentDrawing, loadPreset, openLink, startScene } = await fresh();
    const settings = presetById('maze')?.settings() ?? defaultSettings();
    const drawing = { scene: 'maze', revision: 0, origins: [0], shapes: mazeShapes(), strokes: [dab] };
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
describe('growth and shrinkage (ADR 0025)', () => {
  it('count as a change of the scene: the switch, each value and the capacity', async () => {
    const { app, loadPreset, sceneChanged } = await fresh();
    loadPreset('network');
    expect(sceneChanged()).toBe(false);
    app.settings.growth = true;
    expect(sceneChanged()).toBe(true);
    app.settings.growth = false;
    expect(sceneChanged()).toBe(false);
    for (const [k, v] of [
      ['growthMax', 15],
      ['shrinkWindow', 9],
      ['capacity', 0.5],
    ] as const) {
      loadPreset('network');
      app.settings[k] = v;
      expect(sceneChanged(), k).toBe(true);
    }
  });

  it('a link from before them opens every scene unchanged', async () => {
    const gone = (k: string) => /^(growth|shrink[A-Z])/.test(k) || k === 'capacity';
    for (const p of PRESETS) {
      const { app, openLink, sceneChanged } = await fresh();
      const old = Object.fromEntries(Object.entries(p.settings()).filter(([k]) => !gone(k)));
      const drawing = {
        scene: p.id,
        revision: shapeRevision(p),
        origins: p.settings().strains.map((_s, i) => i),
        shapes: [] as boolean[],
      };
      const link = await decodeLink((await encodeLink(old as unknown as Settings, { ...drawing, strokes: [] })).hash);
      if (!link) throw new Error(p.id);
      openLink(link);
      expect([app.settings.growth, app.settings.capacity, sceneChanged()], p.id).toEqual([false, 0, false]);
    }
  });
});

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

  // A capacity above Agents per cell keeps dead agents in a full scene (ADR 0025): the tool has some to place.
  it('are left in a full scene when the capacity holds more agents than start', async () => {
    const { app, deadLeft } = await fresh();
    const s = { ...defaultSettings(), resolution: 256, density: 0.2, capacity: 0.5 };
    const canvas = { width: 1600, height: 1000 } as HTMLCanvasElement;
    const engine = await Engine.create(canvas, s, undefined, new CpuBackend());
    const { agents, start } = engine.sim as unknown as { agents: number; start: number };
    expect(agents).toBe(Math.round(0.5 * 256 * 160));
    expect(start).toBe(Math.round(0.2 * 256 * 160));
    app.strain = 0;
    app.stats = { ...app.stats, alive: [start], run: engine.restarts };
    expect(deadLeft(engine)).toBe(true);
  });
});

// Owner rule of 2026-11-11 (ADR 0022): a run labelled Jones is always Jones. A switch to Jones drops the extended values
// and says what went, a switch to Extended keeps Jones' values, and the tools offered follow the model.
describe('the model switch', () => {
  const BASE = 'The Jones model has only Jones’ rules, and light has no effect in it.';

  it('offers every tool in the extended model and all but Light in the Jones model', async () => {
    const { TOOLS, toolsFor } = await fresh();
    expect(toolsFor('extended')).toEqual(TOOLS);
    expect(toolsFor('jones').map((t) => t.id)).toEqual(['pan', 'inoculate', 'food', 'wall', 'erase', 'cut']);
  });

  it('to Jones keeps strain A, the rule and one diffusion pass, and says what went', async () => {
    const { app, loadPreset, setModel } = await fresh();
    loadPreset('three-strains');
    app.strain = 2;
    app.tool = 'light';
    setModel('jones');
    const s = app.settings;
    expect([s.model, jonesFits(s), s.strains.length, s.collisions, s.diffusion]).toEqual(['jones', true, 1, true, 1]);
    expect([app.strainOrigin, app.strain, app.tool]).toEqual([[0], 0, 'pan']);
    expect(app.notice).toBe(
      `${BASE} It removed strains B to C and agents that share a cell. It changed Agents per cell from 3 to 1, ` +
        'Diffusion passes from 2 to 1 and Scent decay from 0.1 to 0.6 (the Decay of strain A).',
    );
  });

  // The Jones model never has the flow in the tubes (ADR 0029): the switch to Jones takes it off and says so.
  it('to Jones takes the flow in the tubes off and names it, not its strength', async () => {
    const { app, loadPreset, setModel } = await fresh();
    loadPreset('maze');
    expect(app.settings.flow).toBe(true);
    app.settings.flowStrength = 12;
    setModel('jones');
    expect([app.settings.model, app.settings.flow, app.settings.flowStrength]).toEqual(['jones', false, 8]);
    expect(app.notice).toContain('It removed the flow in the tubes.');
    expect(app.notice).not.toContain('Flow strength');
    // Back in the extended model the flow stays off until the user turns it on.
    setModel('extended');
    expect([app.settings.model, app.settings.flow]).toEqual(['extended', false]);
  });

  // Every value that toJones() changes is in the notice, also those that the panel of the extended model shows
  // elsewhere: the light strength, the weights of strain A and no diffusion.
  it('to Jones names every value it changed', async () => {
    const { app, loadPreset, setModel } = await fresh();
    loadPreset('light');
    const a = app.settings.strains[0];
    if (!a) throw new Error('no strain');
    Object.assign(a, { food: 0.4, light: 2, share: 0.5 });
    a.attraction[0] = 0.5;
    Object.assign(app.settings, { diffusion: 0, trailSaturation: 30, scentDecay: 0.01 });
    setModel('jones');
    expect(app.notice).toBe(
      `${BASE} It changed Diffusion passes from 0 to 1, Light strength from 0.2 to 0.05, Scent decay from 0.01 to ` +
        '0.1 (the Decay of strain A), Trail saturation from 30 to 0, the weight of strain A on its own trail from ' +
        '+0.5 to +1, Food attraction from +0.4 to +1 and Light avoidance from +2 to +1.',
    );
    expect(app.settings.strains[0]?.share).toBe(1);
    // A scene of Jones that is Jones already: nothing changes, and there is no notice.
    loadPreset('network');
    app.notice = '';
    setModel('jones');
    expect(app.notice).toBe('');
  });

  it('to Jones turns a weight on the own trail into +1 or −1 by its sign', async () => {
    const { app, loadPreset, setModel } = await fresh();
    for (const [w, want] of [
      [-0.5, -1],
      [-1, -1],
      [0, 1],
      [0.5, 1],
      [2, 1],
    ] as const) {
      loadPreset('maze');
      const a = app.settings.strains[0];
      if (!a) throw new Error('no strain');
      a.attraction[0] = w;
      setModel('jones');
      expect(app.settings.strains[0]?.attraction[0], `${w}`).toBe(want);
      expect(jonesFits(app.settings), `${w}`).toBe(true);
    }
  });

  // Only the extended model's sensors check walls on their way (ADR 0020): the Maze's walls act differently in Jones.
  it('to Jones says that drawn walls no longer block the sensors', async () => {
    const { app, loadPreset, setModel } = await fresh();
    loadPreset('maze');
    setModel('jones');
    // The Maze also has the flow in the tubes, which the Jones model never has (ADR 0029).
    expect(app.notice).toBe(
      `${BASE} The walls stop agents, but they do not block sensors. It removed the flow in the tubes.`,
    );
  });

  it('to Jones is not possible without the rule, and changes nothing then', async () => {
    const { app, loadPreset, ruleUnavailable, setModel } = await fresh();
    loadPreset('two-strains');
    ruleUnavailable();
    const before = structuredClone(app.settings);
    setModel('jones');
    expect(app.settings).toEqual(before);
    expect(app.notice).toBe('The Jones model needs one agent per cell, and this browser cannot run it.');
  });

  it('to Extended keeps every value of Jones and the tool, also through a link', async () => {
    const { app, loadPreset, setModel } = await fresh();
    loadPreset('network');
    // Jones binds the scent decay to the strain's Decay, whose range reaches below 0.001.
    const a = app.settings.strains[0];
    if (!a) throw new Error('no strain');
    a.decay = 0.0005;
    app.settings = constrainedJones(app.settings);
    expect(app.settings.scentDecay).toBe(0.0005);
    app.tool = 'cut';
    const before = structuredClone(app.settings);
    setModel('extended');
    expect(app.settings).toEqual({ ...before, model: 'extended' });
    expect(app.tool).toBe('cut');
    expect(app.notice).toBe('');
    const link = await decodeLink((await encodeLink(structuredClone(app.settings))).hash);
    expect(link?.settings).toEqual(app.settings);
  });

  // The review's case: Extended, then values of its own, then back to Jones. The card shows the scene, and the link holds
  // the scene's values. Then Extended again is a change of the scene: its model differs.
  it('to Extended and back leaves a scene of Jones unchanged, after values of the extended model', async () => {
    const { addStrain, app, loadPreset, sceneChanged, setModel } = await fresh();
    for (const id of ['network', 'spots', 'shortest-path', 'wound']) {
      loadPreset(id);
      setModel('extended');
      expect(sceneChanged(), id).toBe(true);
      Object.assign(app.settings, { trailSaturation: 30, scentDecay: 0.01, lightStrength: 0.3, diffusion: 2 });
      addStrain();
      const a = app.settings.strains[0];
      if (!a) throw new Error('no strain');
      Object.assign(a, { share: 0.5, food: 0.4, light: 2 });
      setModel('jones');
      expect(sceneChanged(), id).toBe(false);
      expect(app.settings, id).toEqual({ ...sceneOf(id), seed: app.settings.seed });
      setModel('extended');
      expect(sceneChanged(), id).toBe(true);
      setModel('jones');
      expect(sceneChanged(), id).toBe(false);
    }
  });

  it('to Jones and back changes an extended scene that fits Jones only for the switch itself', async () => {
    const { app, loadPreset, sceneChanged, setModel } = await fresh();
    // Foraging maze is extended for its walls alone. The Maze also has the flow in the tubes, which stays off after
    // the way back (ADR 0029).
    loadPreset('foraging-maze');
    setModel('jones');
    expect(sceneChanged()).toBe(true);
    setModel('extended');
    expect(sceneChanged()).toBe(false);
    expect(app.settings).toEqual({ ...sceneOf('foraging-maze'), seed: app.settings.seed });
    loadPreset('maze');
    setModel('jones');
    setModel('extended');
    expect(sceneChanged()).toBe(true);
    expect(app.settings).toEqual({ ...sceneOf('maze'), seed: app.settings.seed, flow: false });
  });

  it('is undone by Reload scene, which restores the model of the scene', async () => {
    const { app, loadPreset, sceneChanged, setModel } = await fresh();
    for (const id of ['network', 'three-strains', 'light']) {
      loadPreset(id);
      const model = app.settings.model;
      setModel(model === 'jones' ? 'extended' : 'jones');
      loadPreset(id); // the card's Reload scene
      expect([app.settings.model, sceneChanged()], id).toEqual([model, false]);
    }
  });
});

describe('the tools of the model', () => {
  it('lose Light when a scene of Jones loads, also by Reload scene', async () => {
    const { app, loadPreset, setModel } = await fresh();
    loadPreset('light');
    app.tool = 'light';
    loadPreset('network');
    expect(app.tool).toBe('pan');
    loadPreset('light');
    app.tool = 'light';
    setModel('jones');
    expect(app.tool).toBe('pan');
    setModel('extended');
    app.tool = 'light';
    loadPreset('light'); // Reload scene of an extended scene: the tool stays
    expect(app.tool).toBe('light');
    app.tool = 'food';
    loadPreset('network'); // a tool that both models have stays
    expect(app.tool).toBe('food');
  });

  it('lose Light when a Jones link opens', async () => {
    const { app, openLink } = await fresh();
    app.tool = 'light';
    openLink({ settings: sceneOf('network') });
    expect(app.tool).toBe('pan');
    app.tool = 'light';
    openLink({ settings: sceneOf('light') });
    expect(app.tool).toBe('light');
  });

  // App.svelte's settings effect: constrain() turns a Jones model with a value Jones does not have into Extended, or
  // binds it, and adopt() writes only what changed.
  it('follow what adopt() writes, and adopt() writes only what changed', async () => {
    const { adopt, app, loadPreset } = await fresh();
    loadPreset('network');
    const strains = app.settings.strains;
    app.tool = 'light'; // as before the fix of decision 25: a tool the model does not offer
    const a = app.settings.strains[0];
    if (!a) throw new Error('no strain');
    a.decay = 0.05;
    adopt(constrainedJones(app.settings));
    expect(app.settings.scentDecay).toBe(0.05);
    expect(app.settings.strains).toBe(strains); // the strains held the bound values already
    expect(app.tool).toBe('pan');
    adopt({ ...structuredClone(app.settings), model: 'extended', diffusion: 2 });
    expect([app.settings.model, app.settings.diffusion]).toEqual(['extended', 2]);
    app.tool = 'light';
    adopt(structuredClone(app.settings));
    expect(app.tool).toBe('light');
  });

  // Decision 29: the Jones model draws light without effect, and the panel says so while light is drawn.
  it('say that drawn light has no effect in the Jones model, before and after the engine starts', async () => {
    const { app, clearEnvironment, lightDrawn, loadPreset, setEngine, setModel, startScene } = await fresh();
    loadPreset('light');
    expect(lightDrawn()).toBe(true);
    setModel('jones');
    expect(lightDrawn()).toBe(true); // the light stays drawn
    loadPreset('network');
    expect(lightDrawn()).toBe(false);
    const canvas = { width: 1600, height: 1000 } as HTMLCanvasElement;
    const engine = await Engine.create(canvas, structuredClone(app.settings), undefined, new CpuBackend());
    setEngine(engine);
    await startScene(engine);
    expect(lightDrawn()).toBe(false);
    engine.paint({ kind: 'light', from: [100, 100], to: [100, 100], radius: 5 });
    expect(lightDrawn()).toBe(true);
    clearEnvironment();
    expect(lightDrawn()).toBe(false);
    setEngine(undefined);
  });
});

// A shared link of the Jones model holds only Jones' values, and a link from before the model switch opens as Jones
// only if the Jones model runs it as it was made (ADR 0022, decision 24).
describe('a link and the model', () => {
  it('of every scene, from before the model switch, opens with the scene unchanged', async () => {
    for (const p of PRESETS) {
      const { app, openLink, sceneChanged } = await fresh();
      const { model: _, coveredFood: __, coveredFoodFactor: ___, trailSaturation: ____, ...now } = p.settings();
      // Before the switch the scenes of Jones weighed food with +1, also the repelling ones (jones() in presets.ts).
      const jones = p.settings().model === 'jones';
      const old = { ...now, strains: now.strains.map((st) => (jones ? { ...st, food: 1 } : st)) };
      // A link of that day holds revision 0 of the scene's shapes (ADR 0027).
      const shapes = (shapesAt(p, 0) ?? []).map(() => true);
      const drawing = { scene: p.id, revision: 0, origins: now.strains.map((_s, i) => i), shapes };
      const hash = await encodeLink(old as unknown as Settings, { ...drawing, strokes: [] });
      const link = await decodeLink(hash.hash);
      if (!link) throw new Error(p.id);
      openLink(link);
      // Its settings are the scene's; only a scene whose shapes changed since is changed, by those shapes.
      const moved = shapeRevision(p) > 0;
      expect([app.settings.model, sceneChanged(), app.envChanged], p.id).toEqual([p.settings().model, moved, moved]);
    }
  });
});

function sceneOf(id: string): Settings {
  const s = presetById(id)?.settings();
  if (!s) throw new Error(`no preset ${id}`);
  return s;
}

/** The settings as App.svelte's settings effect leaves them (constrain()). */
function constrainedJones(s: Settings): Settings {
  return constrain(structuredClone(s));
}
