import { describe, expect, it } from 'vitest';
import { FrameBudget, MAX_STEPS_PER_FRAME } from './budget';

const FRAME = 1000 / 60;

/**
 * Frames on a vsync of `period` ms (60 Hz by default); `gpuMs` is how long the GPU needs for a frame with
 * that many steps. A frame waits for the GPU while three earlier frames are unfinished (the browser stops
 * issuing frames then). `gaps` adds a pause in rendering (ms) before a frame, like a hidden tab.
 */
function run(
  b: FrameBudget,
  frames: number,
  speed: number | ((frame: number) => number),
  gpuMs: (steps: number) => number,
  gaps: Record<number, number> = {},
  period = FRAME,
) {
  const steps: number[] = [];
  const finish: number[] = []; // GPU finish time of each frame
  const late: number[] = []; // frames that had to wait for the GPU
  const budgets: number[] = [];
  let now = 0;
  let busyUntil = 0;
  let resolved = 0;
  for (let f = 0; f < frames; f++) {
    if (f > 0) now += period + (gaps[f] ?? 0);
    const blocker = finish[f - 3];
    if (blocker !== undefined && blocker > now) {
      now = Math.ceil(blocker / period) * period;
      late.push(f);
    }
    while (resolved < finish.length && (finish[resolved] ?? Infinity) <= now) b.done(finish[resolved++] ?? now);
    const n = b.next(now, typeof speed === 'number' ? speed : speed(f));
    steps.push(n);
    budgets.push(b.steps);
    b.submitted();
    busyUntil = Math.max(busyUntil, now) + gpuMs(n);
    finish.push(busyUntil);
  }
  return { steps, late, budgets };
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** A budget that has seen one frame, at −FRAME, and is then set to `steps`. */
function budget(steps: number) {
  const b = new FrameBudget();
  b.next(-FRAME, 0);
  b.steps = steps;
  return b;
}

/** One frame stays in flight all the time, so the budget neither rises nor drops. */
function steady(b: FrameBudget, frames: number, speed: number, start = 0) {
  b.submitted();
  const out: number[] = [];
  for (let f = 0; f < frames; f++) {
    out.push(b.next(start + f * FRAME, speed));
    b.submitted();
    b.done(start + f * FRAME);
  }
  return out;
}

describe('FrameBudget', () => {
  it('follows the speed while the GPU keeps up, one step above what the speed asks for', () => {
    const { steps, late, budgets } = run(new FrameBudget(), 240, 120, (n) => 1 + 2 * n); // 2 steps: 5 of 16.7 ms
    expect(steps.slice(10)).toEqual(Array<number>(230).fill(2)); // the budget starts at 1 and rises by 1/8
    expect(late).toEqual([]);
    expect(Math.max(...budgets.slice(10))).toBeLessThanOrEqual(3);
  });

  it('runs fewer steps instead of piling up frames when the GPU is slow', () => {
    // 5 ms per step: 2 steps fit a frame, the 16 that speed 960 asks for do not.
    const b = new FrameBudget();
    const { steps, late } = run(b, 600, 960, (n) => 1 + 5 * n);
    expect(late).toEqual([]);
    expect(Math.max(...steps)).toBeLessThanOrEqual(3);
    expect(sum(steps.slice(60)) / 540).toBeGreaterThan(1.8);
    // At 25 ms per step not even one step fits a frame: the budget stays at its floor of 1.
    const c = new FrameBudget();
    expect(Math.max(...run(c, 600, 120, (n) => 1 + 25 * n).steps.slice(60))).toBe(1);
    expect(c.steps).toBe(1);
  });

  it('cuts the budget by a quarter with two frames in flight, to at least one step', () => {
    const b = budget(16);
    b.submitted();
    b.submitted();
    b.next(0, 960);
    expect(b.steps).toBe(12);
    b.next(FRAME, 960);
    expect(b.steps).toBe(9);
    for (let f = 2; f < 20; f++) b.next(f * FRAME, 960);
    expect(b.steps).toBe(1);
  });

  it('keeps the budget with one frame in flight', () => {
    const b = budget(3);
    steady(b, 10, 960);
    expect(b.steps).toBe(3);
  });

  it('rises by 1/8 only when the GPU was idle for more than a third of the frame interval', () => {
    // The GPU finished `idle` ms before the next frame, with no frame left in flight.
    const after = (idle: number) => {
      const b = budget(3);
      b.submitted();
      b.done(-idle);
      b.next(0, 960);
      return b.steps;
    };
    expect(after(1)).toBe(3);
    expect(after(0.25 * FRAME)).toBe(3);
    expect(after(0.3 * FRAME)).toBe(3);
    expect(after(0.37 * FRAME)).toBe(3.125);
    expect(after(0.45 * FRAME)).toBe(3.125);
    expect(after(FRAME)).toBe(3.125);
  });

  it('never rises more than one step above the steps of the last frame, and keeps it while paused', () => {
    const b = budget(MAX_STEPS_PER_FRAME);
    b.next(0, 120); // 2 steps
    expect(b.steps).toBe(3);
    for (let f = 1; f < 100; f++) b.next(f * FRAME, 0); // paused, the GPU idle
    expect(b.steps).toBe(3);
  });

  it('alternates 1 and 2 steps at a budget of 1.5', () => {
    expect(steady(budget(1.5), 8, 120)).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
  });

  it('runs the same steps every frame despite timing jitter', () => {
    const b = budget(3);
    const steps = [0, 16.6, 33.4, 50.0, 66.6, 83.4, 100.1, 116.6].map((t) => b.next(t, 120));
    expect(steps).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it('keeps a fractional average and never runs more than ceil(budget) in one frame', () => {
    for (const steps of [1.25, 2.6, 7.875]) {
      const b = budget(steps);
      const out = steady(b, 800, 960);
      expect(sum(out) / out.length).toBeCloseTo(steps, 1);
      expect(Math.max(...out)).toBe(Math.ceil(steps));
    }
  });

  it('builds no step debt: after a slow phase the steps return to the speed without a burst', () => {
    const b = budget(1);
    expect(steady(b, 60, 120)).toEqual(Array<number>(60).fill(1)); // 2 asked, 1 allowed
    b.steps = MAX_STEPS_PER_FRAME; // the GPU recovers
    b.done(60 * FRAME);
    expect(steady(b, 10, 120, 60 * FRAME)).toEqual(Array<number>(10).fill(2));
  });

  it('follows speeds below one step per frame', () => {
    const b = new FrameBudget();
    expect(sum(steady(b, 61, 30))).toBe(30);
    const c = new FrameBudget();
    expect(steady(c, 7, 30).slice(1)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('runs nothing while paused and does not catch up afterwards', () => {
    const b = new FrameBudget();
    expect(sum(steady(b, 30, 0))).toBe(0);
    const c = budget(3);
    expect(steady(c, 60, 120)).toEqual(Array<number>(60).fill(2));
    // A 5 s pause in rendering counts as 100 ms, 12 steps, and the budget allows one more than before.
    expect(c.next(5000, 120)).toBe(3);
    expect(c.next(4990, 120)).toBe(0); // an earlier time (a key press before the next frame) asks for nothing
    expect(c.next(5000 + FRAME, 120)).toBe(2);
  });

  it('does not make frames late after a pause in rendering', () => {
    // The default scene on an M3 Pro: about 5 ms per step and 2 ms per draw. A 300 ms gap at frame 120.
    const { steps, late } = run(new FrameBudget(), 240, 120, (n) => 2 + 5 * n, { 120: 300 });
    expect(steps[120]).toBe(3);
    expect(late).toEqual([]);
    expect(sum(steps.slice(120, 240))).toBeLessThanOrEqual(2 * 120 + 1);
  });

  it('ramps up after a speed raise instead of running 16 steps at once', () => {
    // 0.5 ms per step: the GPU keeps up with 16 steps per frame. The speed goes from 120 to 960 at frame 60.
    const { steps, late } = run(
      new FrameBudget(),
      240,
      (f) => (f < 60 ? 120 : 960),
      (n) => 1 + 0.5 * n,
    );
    expect(late).toEqual([]);
    for (let f = 61; f < 240; f++) expect(steps[f] ?? 0).toBeLessThanOrEqual((steps[f - 1] ?? 0) + 1);
    expect(steps.slice(200)).toEqual(Array<number>(40).fill(16)); // 112 frames of 1/8 later
  });

  it('counts the steps the speed asked for while the GPU is busy, whatever the budget allowed', () => {
    const b = budget(1);
    steady(b, 60, 120); // one frame always in flight: 2 per frame asked, 1 run
    expect(b.requested).toBeCloseTo(2 * 60, 6);
    const c = budget(16);
    c.submitted();
    c.next(0, 120);
    c.next(5000, 120); // a long gap counts as 100 ms: 12 steps
    expect(c.requested).toBeCloseTo(2 + 12, 6);
    const d = budget(16);
    d.submitted();
    d.next(0, 960);
    d.next(2 * FRAME, 960); // at 30 Hz, speed 960 asks for 32 steps, but a frame runs at most 16
    expect(d.requested).toBeCloseTo(16 + 16, 6);
  });

  it('does not count the steps it held back while it rose on an idle GPU', () => {
    // A speed raise from 120 to 960 on a GPU that keeps up: the steps lag the speed for about 2 s, and
    // the startup check must not take that for a slow device. A slow GPU's shortfall counts.
    const fast = new FrameBudget();
    const ramp = run(
      fast,
      240,
      (f) => (f < 60 ? 120 : 960),
      (n) => 1 + 0.5 * n,
    );
    expect(sum(ramp.steps.slice(60, 180))).toBeLessThan(0.75 * 120 * 16);
    expect(sum(ramp.steps)).toBeGreaterThan(0.99 * fast.requested);
    const slow = new FrameBudget();
    const limited = run(slow, 240, 960, (n) => 1 + 5 * n);
    expect(sum(limited.steps)).toBeLessThan(0.25 * slow.requested);
  });

  it('counts the frames that start with the GPU idle, and their intervals: the rate the browser gives', () => {
    // A browser that gives 30 fps (iOS Low Power Mode) and a GPU that keeps up: every frame but the first.
    const capped = new FrameBudget();
    const { late } = run(capped, 90, 120, (n) => 2 + 5 * n, {}, 2 * FRAME);
    expect(late).toEqual([]);
    expect(capped.idleFrames).toBe(89);
    expect(capped.idleMs / capped.idleFrames).toBeCloseTo(2 * FRAME, 6);
    // A GPU too slow for even one step holds the frames up: only the second frame, before its queue
    // fills, starts with it idle.
    const slow = new FrameBudget();
    run(slow, 600, 120, (n) => 1 + 25 * n);
    expect(slow.idleFrames).toBe(1);
    // A pause in rendering (a hidden tab) is no frame interval of the browser.
    const paused = new FrameBudget();
    paused.next(0, 120);
    paused.next(5000, 120);
    expect(paused.idleFrames).toBe(0);
    expect(paused.idleMs).toBe(0);
  });
});
