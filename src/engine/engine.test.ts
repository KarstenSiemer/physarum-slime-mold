import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../model/params';
import { presetById } from '../model/presets';
import { CpuBackend } from './cpu-backend';
import { Engine, type HeldTool } from './engine';
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
