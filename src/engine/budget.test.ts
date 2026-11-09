import { describe, expect, it } from 'vitest';
import { FrameBudget, MAX_STEPS_PER_FRAME } from './budget';

const FRAME = 1000 / 60;

/**
 * Frames on a 60 Hz vsync; `gpuMs` is how long the GPU needs for a frame with that many steps. A frame
 * waits for the GPU while three earlier frames are unfinished (the browser stops issuing frames then).
 */
function run(b: FrameBudget, frames: number, speed: number, gpuMs: (steps: number) => number) {
  const steps: number[] = [];
  const finish: number[] = []; // GPU finish time of each frame
  let now = 0;
  let busyUntil = 0;
  let resolved = 0;
  for (let f = 0; f < frames; f++) {
    if (f > 0) now += FRAME;
    const blocker = finish[f - 3];
    if (blocker !== undefined && blocker > now) now = Math.ceil(blocker / FRAME) * FRAME;
    while (resolved < finish.length && (finish[resolved] ?? Infinity) <= now) b.done(finish[resolved++] ?? now);
    const n = b.next(now, speed);
    steps.push(n);
    b.submitted();
    busyUntil = Math.max(busyUntil, now) + gpuMs(n);
    finish.push(busyUntil);
  }
  return steps;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

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
  it('follows the speed while the GPU keeps up, and the budget climbs to the maximum', () => {
    const b = new FrameBudget();
    b.steps = 4;
    const steps = run(b, 240, 120, (n) => 1 + 2 * n); // 2 steps: 5 of 16.7 ms
    expect(sum(steps.slice(1))).toBeGreaterThanOrEqual(2 * 238);
    expect(Math.max(...steps)).toBe(2);
    expect(b.steps).toBe(MAX_STEPS_PER_FRAME);
  });

  it('runs fewer steps instead of piling up frames when the GPU is slow', () => {
    const b = new FrameBudget();
    const steps = run(b, 600, 120, (n) => 1 + 25 * n); // 25 ms per step
    expect(Math.max(...steps.slice(60))).toBe(1);
    expect(b.steps).toBe(1);
  });

  it('cuts the budget by a quarter with two frames in flight, to at least one step', () => {
    const b = new FrameBudget();
    b.submitted();
    b.submitted();
    b.next(0, 120);
    expect(b.steps).toBe(12);
    b.next(FRAME, 120);
    expect(b.steps).toBe(9);
    for (let f = 2; f < 20; f++) b.next(f * FRAME, 120);
    expect(b.steps).toBe(1);
  });

  it('keeps the budget with one frame in flight, or when the GPU was idle for less than a third', () => {
    const b = new FrameBudget();
    b.steps = 3;
    steady(b, 10, 120);
    expect(b.steps).toBe(3);
    const c = new FrameBudget();
    c.steps = 3;
    c.next(0, 120);
    c.submitted();
    c.done(FRAME - 1); // the GPU finished 1 ms before the next frame
    c.next(FRAME, 120);
    expect(c.steps).toBe(3);
    c.submitted();
    c.done(FRAME + 2); // idle for 14.7 of 16.7 ms
    c.next(2 * FRAME, 120);
    expect(c.steps).toBe(3.125);
  });

  it('alternates 1 and 2 steps at a budget of 1.5', () => {
    const b = new FrameBudget();
    b.steps = 1.5;
    expect(steady(b, 9, 120).slice(1)).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
  });

  it('runs the same steps every frame despite timing jitter', () => {
    const b = new FrameBudget();
    const steps = [0, 16.6, 33.4, 50.0, 66.6, 83.4, 100.1, 116.6].map((t) => b.next(t, 120));
    expect(steps.slice(1)).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it('keeps a fractional average and never runs more than ceil(budget) in one frame', () => {
    for (const budget of [1.25, 2.6, 7.875]) {
      const b = new FrameBudget();
      b.steps = budget;
      const steps = steady(b, 801, 960).slice(1);
      expect(sum(steps) / steps.length).toBeCloseTo(budget, 1);
      expect(Math.max(...steps)).toBe(Math.ceil(budget));
    }
  });

  it('builds no step debt: after a slow phase the steps return to the speed without a burst', () => {
    const b = new FrameBudget();
    b.steps = 1;
    expect(steady(b, 60, 120).slice(1)).toEqual(Array<number>(59).fill(1)); // 2 asked, 1 allowed
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
    const c = new FrameBudget();
    c.next(0, 120);
    expect(c.next(5000, 120)).toBe(12); // a long gap counts as 100 ms: 12 steps, not 600
    expect(c.next(4990, 120)).toBe(0); // an earlier time (a key press before the next frame) asks for nothing
    expect(c.next(5000 + FRAME, 120)).toBe(2);
  });
});
