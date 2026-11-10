import { describe, expect, it } from 'vitest';
import { GridTuner, lowerGrid, type Tick } from './tune';

describe('lowerGrid', () => {
  const ok = { ms: 3000, frames: 180, steps: 360, requested: 360 }; // 60 fps, 120 of 120 steps/s
  it('keeps the grid while frames and steps keep up', () => {
    expect(lowerGrid(ok, 1536, 0)).toBeUndefined();
    expect(lowerGrid({ ms: 3000, frames: 120, steps: 270, requested: 360 }, 1536, 0)).toBeUndefined(); // 40 fps, 3/4
  });
  it('lowers one step when fewer than 3/4 of the requested steps ran, also at 60 fps', () => {
    expect(lowerGrid({ ms: 3000, frames: 180, steps: 269, requested: 360 }, 1536, 0)).toBe(1024);
  });
  it('lowers one step below 40 fps', () => {
    expect(lowerGrid({ ms: 3000, frames: 119, steps: 360, requested: 360 }, 1536, 1)).toBe(1024);
    expect(lowerGrid({ ms: 2000, frames: 20, steps: 40, requested: 40 }, 1024, 0)).toBe(768);
  });
  it('never goes below 512 cells, lowers at most twice, and needs a window of 2 s', () => {
    const slow = { ms: 3000, frames: 30, steps: 30, requested: 360 };
    expect(lowerGrid(slow, 768, 0)).toBe(512);
    expect(lowerGrid(slow, 512, 0)).toBeUndefined();
    expect(lowerGrid(slow, 1536, 2)).toBeUndefined();
    expect(lowerGrid({ ...slow, ms: 1999 }, 1536, 0)).toBeUndefined();
  });
});

/** Stats ticks every 500 ms, the first at time 0. */
function ticker(tuner: GridTuner) {
  const s = { now: 0, frames: 0, steps: 0, requested: 0, run: 0, resolution: 1536 };
  tuner.tick({ active: true, picked: false, ...s });
  /** Grids the tuner asked for, with the time of the tick. */
  const lowered: { at: number; lower: number }[] = [];
  return {
    s,
    lowered,
    /**
     * Advances `ms` with `fps` frames, `sps` steps and `rps` requested steps per second (FrameBudget.requested,
     * 120 by default); returns the grids the tuner asked for.
     */
    run(ms: number, fps: number, sps: number, extra: Partial<Tick> & { rps?: number } = {}) {
      const { rps = 120, ...patch } = extra;
      const out: number[] = [];
      for (let t = 0; t < ms; t += 500) {
        s.now += 500;
        if (patch.active !== false) {
          s.frames += fps / 2;
          s.steps += sps / 2;
          s.requested += rps / 2;
        }
        const lower = tuner.tick({ active: true, picked: false, ...s, ...patch });
        if (lower !== undefined) {
          out.push(lower);
          lowered.push({ at: s.now, lower });
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

  it('keeps the grid when the speed is raised inside a window and the device keeps up', () => {
    const t = ticker(new GridTuner());
    expect(t.run(2500, 60, 120)).toEqual([]);
    // Raised from 120 to 480 at 2.5 s; the 3 s window holds 540 steps, of 540 requested.
    expect(t.run(12_500, 60, 480, { rps: 480 })).toEqual([]);
  });

  it('lowers the grid for a speed the device cannot reach at it, also at 60 fps', () => {
    // Speed 960 on a GPU that runs 3 steps per frame at this grid (FrameBudget.requested grows by 16 per
    // frame while the GPU is busy): the check lowers to make the steps cheaper, as for any slow device.
    const t = ticker(new GridTuner());
    expect(t.run(10_000, 60, 180, { rps: 960 })).toEqual([1024, 768]);
  });

  it('ends at 15 s of active time even when a restart late in the check leaves too short a window', () => {
    const tuner = new GridTuner();
    const t = ticker(tuner);
    expect(t.run(14_000, 60, 120)).toEqual([]);
    t.s.run++; // reset at 14 s: at 15 s the window is 1 s
    expect(t.run(1000, 60, 30)).toEqual([]);
    expect(tuner.running).toBe(false);
    expect(t.run(10_000, 60, 30)).toEqual([]);
  });

  it('skips the checks a late tick has passed, so the next window is full', () => {
    const t = ticker(new GridTuner());
    expect(t.run(2500, 60, 120)).toEqual([]);
    // The stats timer is held up for 4.5 s: one tick at 7 s passes the checks at 3 and 6 s at once.
    t.s.now += 4000;
    t.s.frames += 240;
    t.s.steps += 480;
    t.s.requested += 480;
    expect(t.run(500, 60, 120)).toEqual([]);
    // The next check is the one at 10 s, over the 3 s since 7 s, not one at 9 s over 2 s.
    expect(t.run(3000, 60, 30)).toEqual([1024]);
    expect(t.lowered).toEqual([{ at: 10_000, lower: 1024 }]);
  });
});
