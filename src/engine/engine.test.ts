import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { presetById } from '../model/presets';
import { CpuBackend, hold } from './cpu-backend';
import { Engine, MAX_IN_FLIGHT, SETTLE_FRAMES, type HeldTool } from './engine';
import { AgentToolKind, stepChance } from './pack';
import { diffusePlan, equilibrium, gridSize } from './sizing';

describe('gridSize', () => {
  it('puts the resolution on the long side', () => {
    expect(gridSize(1024, 2)).toEqual([1024, 512]);
    expect(gridSize(1024, 0.5)).toEqual([512, 1024]);
    expect(gridSize(1024, 1000)).toEqual([1024, 16]);
  });
});

describe('equilibrium', () => {
  it('is deposit × density / decay for one strain', () => {
    const s = defaultSettings();
    expect(equilibrium(s)).toBeCloseTo((5 * 1) / 0.1);
  });
});

describe('diffusePlan', () => {
  it('adds deposits on the first pass and decays on the last', () => {
    expect(diffusePlan(0)).toEqual([{ first: true, last: true, blur: false }]);
    expect(diffusePlan(1)).toEqual([{ first: true, last: true, blur: true }]);
    expect(diffusePlan(3).map((p) => [p.first, p.last])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
  });
});

// How Engine.frame() hands a held tool to the steps it runs (ADR 0023). The CPU backend runs no agents; the calls of
// Sim.run() show what the GPU would get.
describe('agent tools held over frames', () => {
  const RATE = 2;
  const tool: HeldTool = { kind: AgentToolKind.inoculate, x: 10, y: 10, radius: 5, strain: 0, rate: RATE };

  async function start(patch: Partial<Settings>) {
    const canvas = { width: 160, height: 100 } as HTMLCanvasElement;
    const engine = await Engine.create(
      canvas,
      { ...defaultSettings(), resolution: 256, ...patch },
      undefined,
      new CpuBackend(),
    );
    const runs: { steps: number; revive: number | undefined }[] = [];
    const run = engine.sim.run.bind(engine.sim);
    engine.sim.run = (steps, t) => {
      runs.push({ steps, revive: t?.revive });
      run(steps, t);
    };
    engine.frame(0, 0); // the frame before the press
    return { engine, runs };
  }

  /** Frames at `fps` from the first one after the press; the tool is held in those where `held` says so. */
  function frames(engine: Engine, fps: number, n: number, steps?: number, held = (_: number) => true, t = tool) {
    for (let k = 1; k <= n; k++) {
      if (held(k)) engine.agentTool(t);
      engine.frame((k * 1000) / fps, steps);
    }
  }

  it('gives every step of a frame its share of the frame time', async () => {
    const { engine, runs } = await start({});
    frames(engine, 60, 3, 4);
    expect(runs.map((r) => r.steps)).toEqual([4, 4, 4]);
    for (const r of runs) expect(r.revive).toBeCloseTo(stepChance(RATE, 1 / 60 / 4), 12);
  });

  it('passes the time of a frame without a step on to the next step', async () => {
    // 30 steps per second at 60 Hz: every other frame runs a step (budget.ts).
    const { engine, runs } = await start({ speed: 30 });
    frames(engine, 60, 6);
    expect(runs.map((r) => r.steps)).toEqual([1, 1, 1]);
    for (const r of runs) expect(r.revive).toBeCloseTo(stepChance(RATE, 2 / 60), 12);
  });

  it('runs 60 steps per second of a tool held while paused, at any frame rate', async () => {
    for (const [fps, perFrame] of [
      [120, [0, 1, 0, 1, 0, 1]],
      [60, [1, 1, 1, 1, 1, 1]],
      [30, [2, 2, 2, 2, 2, 2]],
    ] as const) {
      const { engine, runs } = await start({});
      engine.paused = true;
      const before = engine.sim.step;
      frames(engine, fps, 6);
      expect(engine.sim.step - before, `${fps} fps`).toBe(perFrame.reduce<number>((a, b) => a + b, 0));
      for (const r of runs) expect(r.revive, `${fps} fps`).toBeCloseTo(stepChance(RATE, 1 / 60), 12);
    }
  });

  // Idle: the app knows no dead agent of the strain (ui/state.svelte.ts deadLeft()). Steps would only move the paused
  // scene.
  it('runs no step for an idle tool held while paused, and keeps none of its time', async () => {
    const { engine, runs } = await start({});
    engine.paused = true;
    frames(engine, 60, 30, undefined, () => true, { ...tool, idle: true });
    expect(runs).toEqual([]);
    // A dead agent is known again: the next frame runs one step with the time of that frame only.
    engine.agentTool(tool);
    engine.frame((31 * 1000) / 60);
    expect(runs.map((r) => r.steps)).toEqual([1]);
    expect(runs[0]?.revive).toBeCloseTo(stepChance(RATE, 1 / 60), 12);
  });

  it('runs an idle tool held while running, and a forced step of it while paused', async () => {
    const { engine, runs } = await start({});
    frames(engine, 60, 3, 2, () => true, { ...tool, idle: true });
    expect(runs.map((r) => r.steps)).toEqual([2, 2, 2]);
    for (const r of runs) expect(r.revive).toBeCloseTo(stepChance(RATE, 1 / 60 / 2), 12);
    engine.paused = true;
    engine.agentTool({ ...tool, idle: true });
    engine.frame(4000 / 60, 1);
    expect(runs.map((r) => r.steps)).toEqual([2, 2, 2, 1]);
  });

  it('runs no step for a tool held while running when the speed asks for none, and forgets its time on release', async () => {
    const { engine, runs } = await start({ speed: 30 });
    // Held in the first frame only: the step of the second frame gets no tool.
    frames(engine, 60, 2, undefined, (k) => k === 1);
    expect(runs).toEqual([{ steps: 1, revive: undefined }]);
  });
});

// The scent view (ADR 0009, amendment 2026-11-11) draws over the picture and changes nothing in the simulation: no
// restart, no new simulation, and the parameters the GPU gets stay as they were (pack.test.ts).
describe('the scent view', () => {
  it('neither restarts nor rebuilds the simulation', async () => {
    const canvas = { width: 160, height: 100 } as HTMLCanvasElement;
    const settings = { ...defaultSettings(), resolution: 256 };
    const engine = await Engine.create(canvas, settings, undefined, new CpuBackend());
    const [sim, restarts] = [engine.sim, engine.restarts];
    engine.frame(0, 3);
    await engine.apply({ ...settings, showScent: true });
    engine.frame(16, 3);
    await engine.apply({ ...settings, showScent: false });
    expect(engine.sim).toBe(sim);
    expect(engine.restarts).toBe(restarts);
    expect(engine.sim.step).toBe(6);
  });

  // The strand belongs to a run: a restart and a new simulation start the backend's levels anew (forget()), and while a
  // new simulation is built the old one's strand is none of the new one, so the legend explains no line of the old
  // run (ADR 0009, amendment 2026-11-12). The backend here reports a strand until it forgets it.
  it('reports the strand of the running simulation only', async () => {
    const backend = new CpuBackend();
    let strand = 7;
    backend.levels = () => ({ gain: 1, black: 0, strand });
    backend.forget = () => {
      strand = 0;
    };
    const canvas = { width: 160, height: 100 } as HTMLCanvasElement;
    const settings = { ...defaultSettings(), resolution: 256 };
    const engine = await Engine.create(canvas, settings, undefined, backend);
    strand = 7; // measured on the new run
    expect(engine.levels().strand).toBe(7);
    engine.reset();
    expect(engine.levels().strand).toBe(0);
    strand = 7;
    const release = hold(backend);
    const rebuilt = engine.apply({ ...settings, resolution: 512 });
    expect(engine.busy).toBe(true);
    expect(engine.levels()).toEqual({ gain: 1, black: 0, strand: 0 }); // the old run's strand: none of the new one
    release();
    await rebuilt;
    expect(engine.levels().strand).toBe(0); // the new run has measured none yet
  });
});

// ADR 0026: beside a closed lattice nothing may happen. A tool there reaches no cell of the arena, so it is idle, and a
// paused hold runs no step. On a periodic lattice every place shows a cell of the grid.
describe('agent tools beside a lattice', () => {
  async function paused(id: string) {
    const p = presetById(id);
    if (!p) throw new Error(id);
    const engine = await Engine.create(
      { width: 1280, height: 720 } as HTMLCanvasElement,
      p.settings(),
      undefined,
      new CpuBackend(),
    );
    engine.paused = true;
    engine.frame(now, 0);
    return engine;
  }
  let now = 0; // the frame clock runs on across holds: a frame never goes back in time (budget.ts)
  const hold = (engine: Engine, kind: HeldTool['kind'], x: number, y: number, frames = 30) => {
    const before = engine.sim.step;
    for (let k = 1; k <= frames; k++) {
      engine.agentTool({ kind, x, y, radius: 6, strain: 0, rate: 1 });
      now += 1000 / 60;
      engine.frame(now);
    }
    return engine.sim.step - before;
  };

  it('runs no step while a tool is held on the free space beside a closed lattice, and runs them on it', async () => {
    for (const id of ['steiner', 'shrinking']) {
      const engine = await paused(id);
      const side = engine.sim.width;
      for (const kind of [AgentToolKind.cut, AgentToolKind.inoculate]) {
        // Left of the lattice, above it, and in its corner outside the dish.
        expect(hold(engine, kind, -20, side / 2), `${id} left`).toBe(0);
        expect(hold(engine, kind, side / 2, -30), `${id} above`).toBe(0);
        expect(hold(engine, kind, 3, 3), `${id} corner`).toBe(0);
        expect(hold(engine, kind, side / 2, side / 2), `${id} on it`).toBe(30);
      }
    }
  });

  it('runs the steps of a tool held on a copy of a periodic lattice', async () => {
    const engine = await paused('wound');
    expect(hold(engine, AgentToolKind.cut, -100, 150)).toBe(30);
    expect(hold(engine, AgentToolKind.cut, 450, -20)).toBe(30);
  });
});

// A frame draws only what is new (ADR 0028): paused, the canvas keeps its picture and the GPU stays idle.
describe('frames that show nothing new', () => {
  async function start(patch: Partial<Settings> = {}) {
    const canvas = { width: 160, height: 100 } as HTMLCanvasElement;
    const backend = new CpuBackend();
    const engine = await Engine.create(canvas, { ...defaultSettings(), resolution: 256, ...patch }, undefined, backend);
    let t = 0;
    /** `n` frames of the loop, 1/60 s apart; returns how many of them drew. */
    const frames = (n = 1) => {
      const before = backend.draws;
      for (let k = 0; k < n; k++) engine.frame((t += 1000 / 60));
      return backend.draws - before;
    };
    /** Frames until none draws any more. */
    const rest = () => {
      frames(SETTLE_FRAMES);
      expect(frames(5), 'at rest').toBe(0);
    };
    return { engine, backend, canvas, frames, rest };
  }

  it('draws every frame while steps run, and counts every frame', async () => {
    const { engine, frames } = await start({ speed: 60 });
    expect(frames(40)).toBe(40);
    expect(engine.draws).toBe(40);
    expect(engine.frames).toBe(40);
  });

  it('stops after the frames that let the levels settle while paused, and still counts the frames', async () => {
    const { engine, frames } = await start();
    engine.paused = true;
    expect(frames(SETTLE_FRAMES + 20)).toBe(SETTLE_FRAMES);
    expect(engine.frames).toBe(SETTLE_FRAMES + 20);
    expect(engine.sim.step).toBe(0);
  });

  it('draws slow steps only: a frame without a step shows nothing new', async () => {
    // 6 steps per second at 60 Hz: one frame in 10 runs a step, and SETTLE_FRAMES frames draw after each.
    const { engine, frames } = await start({ speed: 6 });
    const drew = frames(600);
    expect(engine.sim.step).toBeGreaterThanOrEqual(58);
    expect(drew).toBe(600);
    // 1 step in 4 s: most frames draw nothing.
    const slow = await start({ speed: 0.25 });
    expect(slow.frames(600)).toBeLessThanOrEqual(3 * SETTLE_FRAMES);
  });

  // Every input of a picture: each one makes the next frame draw, and SETTLE_FRAMES frames in all.
  const stroke = {
    kind: 'food' as const,
    from: [20, 20] as [number, number],
    to: [30, 20] as [number, number],
    radius: 4,
  };
  const INPUTS: Record<string, (e: Engine, c: HTMLCanvasElement, b: CpuBackend) => void | Promise<void>> = {
    'a pan': (e) => {
      e.panBy(3, 0);
    },
    'a zoom': (e) => {
      e.zoomAt(80, 50, 1.25);
    },
    'a fitted view after the page set the canvas size again': (e) => {
      e.fitView();
    },
    'another canvas size': (e, c) => {
      c.width = 200;
    },
    'another style': (e) => e.apply({ ...e.settings, style: 'paper' }),
    'another colour': (e) =>
      e.apply({ ...e.settings, strains: e.settings.strains.map((s, i) => (i === 0 ? { ...s, color: '#123456' } : s)) }),
    'another exposure': (e) => e.apply({ ...e.settings, exposure: 0.5 }),
    'the scent view': (e) => e.apply({ ...e.settings, showScent: true }),
    'a restart from another seed': (e) => e.apply({ ...e.settings, seed: e.settings.seed + 1 }),
    'another grid': (e) => e.apply({ ...e.settings, resolution: 512 }),
    'a stroke': (e) => {
      e.paint(stroke);
    },
    'a reset': (e) => {
      e.reset();
    },
    'a loaded scene': (e) => e.load({ ...e.settings }, []),
    'a call of invalidate()': (e) => {
      e.invalidate();
    },
    'levels that moved': (e, c, b) => {
      b.current = { gain: 1, black: 0.1, strand: 2 };
    },
    'a step by hand': (e) => {
      e.frame(0, 1);
    },
  };
  it.each(Object.keys(INPUTS))('draws again after %s while paused', async (name) => {
    const { engine, backend, canvas, frames, rest } = await start();
    engine.paused = true;
    rest();
    const before = backend.draws;
    await INPUTS[name]?.(engine, canvas, backend);
    expect(frames(1), 'the next frame').toBe(1);
    frames(SETTLE_FRAMES + 10);
    // A step by hand is the first of these frames.
    expect(backend.draws - before).toBe(SETTLE_FRAMES);
  });

  it('draws again after a clear of the food, light and walls', async () => {
    const { engine, frames, rest } = await start();
    engine.paused = true;
    engine.paint(stroke);
    rest();
    engine.clearEnvironment();
    expect(frames(1)).toBe(1);
  });

  it('keeps the picture while the levels move less than a picture shows', async () => {
    const { engine, backend, frames, rest } = await start();
    engine.paused = true;
    backend.current = { gain: 1, black: 0.5, strand: 3 };
    rest();
    backend.current = { gain: 1.0005, black: 0.5002, strand: 3.001 };
    expect(frames(5)).toBe(0);
    backend.current = { gain: 1.002, black: 0.5002, strand: 3.001 };
    expect(frames(1)).toBe(1);
  });

  it('goes on drawing while a part of the picture is still being built', async () => {
    const { engine, backend, frames } = await start();
    engine.paused = true;
    backend.ready = false;
    expect(frames(3 * SETTLE_FRAMES)).toBe(3 * SETTLE_FRAMES);
    backend.ready = true;
    expect(frames(3 * SETTLE_FRAMES)).toBe(SETTLE_FRAMES);
  });

  it('draws the steps of a tool held while paused, and none for an idle tool', async () => {
    const { engine, frames, rest } = await start();
    engine.paused = true;
    rest();
    const tool: HeldTool = { kind: AgentToolKind.inoculate, x: 10, y: 10, radius: 5, strain: 0, rate: 1 };
    engine.agentTool(tool);
    expect(frames(1)).toBe(1);
    expect(engine.sim.step).toBe(1);
    rest();
    engine.agentTool({ ...tool, idle: true });
    expect(frames(1)).toBe(0);
  });
});

// The loop starts no frame while MAX_IN_FLIGHT frames are on the GPU (ADR 0028).
describe('frames in flight', () => {
  async function start() {
    const canvas = { width: 160, height: 100 } as HTMLCanvasElement;
    const engine = await Engine.create(
      canvas,
      { ...defaultSettings(), resolution: 256, speed: 960 },
      undefined,
      new CpuBackend(),
    );
    // The GPU finishes a frame when the test says so.
    const finish: (() => void)[] = [];
    engine.sim.finish = () => new Promise<void>((r) => finish.push(r));
    /** The GPU finishes its oldest frame. */
    const done = async () => {
      finish.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    };
    return { engine, done };
  }

  it('starts no frame with two in flight, and the next one runs the steps of the time since the last', async () => {
    const { engine, done } = await start();
    expect(MAX_IN_FLIGHT).toBe(2);
    expect(engine.tick(0)).toBe(true);
    expect(engine.tick(10)).toBe(true);
    expect(engine.budget.pending).toBe(2);
    const [frames, step] = [engine.frames, engine.sim.step];
    engine.budget.steps = 8;
    expect(engine.tick(20), 'two in flight').toBe(false);
    expect(engine.tick(30), 'two in flight').toBe(false);
    expect([engine.frames, engine.sim.step, engine.budget.pending]).toEqual([frames, step, 2]);
    // Each turn that started no frame told the budget that the GPU is behind.
    expect(engine.budget.steps).toBe(4.5);
    await done();
    expect(engine.budget.pending).toBe(1);
    expect(engine.tick(40)).toBe(true);
    // 30 ms at 960 steps per second ask for 28.8 steps; the budget allows 4.5.
    expect(engine.sim.step - step).toBe(4);
    expect(engine.frames).toBe(frames + 1);
  });

  it('runs a frame asked for by hand also with two in flight', async () => {
    const { engine } = await start();
    engine.tick(0);
    engine.tick(10);
    const step = engine.sim.step;
    engine.frame(20, 1);
    expect(engine.sim.step).toBe(step + 1);
    expect(engine.budget.pending).toBe(3);
  });

  it('holds no frame back for frames that drew nothing', async () => {
    const { engine } = await start();
    engine.paused = true;
    for (let k = 0; k < SETTLE_FRAMES + 50; k++) engine.frame(k * 10);
    const pending = engine.budget.pending;
    for (let k = 0; k < 20; k++) engine.frame(1000 + k * 10);
    expect(engine.budget.pending).toBe(pending);
  });
});
