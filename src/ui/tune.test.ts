import { describe, expect, it } from 'vitest';
import { GridTuner, lowerGrid, type Tick } from './tune';

describe('lowerGrid', () => {
  const ok = { ms: 3000, frames: 180, steps: 360 }; // 60 fps, 120 steps/s
  it('keeps the grid while frames and steps keep up', () => {
    expect(lowerGrid(ok, 120, 1536, 0)).toBeUndefined();
    expect(lowerGrid({ ms: 3000, frames: 120, steps: 270 }, 120, 1536, 0)).toBeUndefined(); // 40 fps, 90 steps/s
  });
  it('lowers one step when the steps per second fall below 3/4 of the speed, also at 60 fps', () => {
    expect(lowerGrid({ ms: 3000, frames: 180, steps: 269 }, 120, 1536, 0)).toBe(1024);
  });
  it('lowers one step below 40 fps', () => {
    expect(lowerGrid({ ms: 3000, frames: 119, steps: 360 }, 120, 1536, 1)).toBe(1024);
    expect(lowerGrid({ ms: 2000, frames: 20, steps: 40 }, 120, 1024, 0)).toBe(768);
  });
  it('never goes below 512 cells, lowers at most twice, and needs a window of 2 s', () => {
    const slow = { ms: 3000, frames: 30, steps: 30 };
    expect(lowerGrid(slow, 120, 768, 0)).toBe(512);
    expect(lowerGrid(slow, 120, 512, 0)).toBeUndefined();
    expect(lowerGrid(slow, 120, 1536, 2)).toBeUndefined();
    expect(lowerGrid({ ...slow, ms: 1999 }, 120, 1536, 0)).toBeUndefined();
  });
});

/** Stats ticks every 500 ms, the first at time 0. */
function ticker(tuner: GridTuner) {
  const s = { now: 0, frames: 0, steps: 0, run: 0, resolution: 1536 };
  tuner.tick({ active: true, speed: 120, picked: false, ...s });
  return {
    s,
    /** Advances `ms` at the given rates; returns the grids the tuner asked for. */
    run(ms: number, fps: number, sps: number, extra: Partial<Tick> = {}) {
      const out: number[] = [];
      for (let t = 0; t < ms; t += 500) {
        s.now += 500;
        if (extra.active !== false) {
          s.frames += fps / 2;
          s.steps += sps / 2;
        }
        const lower = tuner.tick({ active: true, speed: 120, picked: false, ...s, ...extra });
        if (lower !== undefined) {
          out.push(lower);
          s.resolution = lower;
          s.run++; // rebuilt
          s.steps = 0;
        }
      }
      return out;
    },
  };
}

describe('GridTuner', () => {
  it('lowers a slow start twice, at most, and then stops', () => {
    const tuner = new GridTuner();
    const t = ticker(tuner);
    expect(t.run(20_000, 60, 30)).toEqual([1024, 768]);
    expect(tuner.running).toBe(false);
  });

  it('keeps a fast start and stops after 15 s of active time', () => {
    const tuner = new GridTuner();
    const t = ticker(tuner);
    expect(t.run(15_000, 60, 120)).toEqual([]);
    expect(tuner.running).toBe(false);
    expect(t.run(10_000, 10, 10)).toEqual([]); // later slowdowns are not its business
  });

  it('decides at 3 s of active time over a window of at least 2 s', () => {
    const t = ticker(new GridTuner());
    expect(t.run(2500, 60, 30)).toEqual([]);
    expect(t.run(500, 60, 30)).toEqual([1024]);
  });

  it('counts only active time: hidden, paused or rebuilding time does not move the checks', () => {
    const t = ticker(new GridTuner());
    expect(t.run(2000, 60, 30)).toEqual([]);
    expect(t.run(60_000, 0, 0, { active: false })).toEqual([]);
    // The window restarts at the first tick after the pause; the 3 s check waits for 2 s of it.
    expect(t.run(2000, 60, 30)).toEqual([]);
    expect(t.run(500, 60, 30)).toEqual([1024]);
  });

  it('restarts the window after a rebuild, so the time before it does not count', () => {
    const t = ticker(new GridTuner());
    expect(t.run(2500, 60, 120)).toEqual([]);
    t.s.run++; // rebuilt by a density change, say
    t.s.steps = 0;
    // At 3 s the window is 0.5 s: no decision yet, even though these frames are slow.
    expect(t.run(1000, 60, 30)).toEqual([]);
    expect(t.run(1500, 60, 30)).toEqual([1024]);
  });

  it('restarts the window after a reset, also one early in the window', () => {
    const t = ticker(new GridTuner());
    expect(t.run(2000, 60, 120)).toEqual([]);
    t.s.run++;
    t.s.steps = 0;
    expect(t.run(2000, 60, 30)).toEqual([]);
    expect(t.run(500, 60, 30)).toEqual([1024]);
  });

  it('never lowers a grid the user picked', () => {
    const tuner = new GridTuner();
    const t = ticker(tuner);
    expect(t.run(1000, 10, 10)).toEqual([]);
    expect(t.run(500, 10, 10, { picked: true })).toEqual([]);
    expect(t.run(20_000, 10, 10)).toEqual([]);
    expect(tuner.running).toBe(false);
  });

  it('checks again at 6, 10 and 15 s while the device keeps up and then slows down', () => {
    const t = ticker(new GridTuner());
    expect(t.run(10_000, 60, 120)).toEqual([]);
    expect(t.run(5000, 60, 60)).toEqual([1024]); // the 15 s check sees the window from 10 s
  });
});
