/** Most steps one frame may run: 16 × 60 Hz = 960 steps/s, the top of the speed slider. */
export const MAX_STEPS_PER_FRAME = 16;

/** Longest frame interval that still counts in full; after a pause in rendering the speed is not caught up. */
const MAX_INTERVAL_MS = 100;

/** Frame timing jitter, in steps, that does not change the step count: 2.0 ± 0.06 runs 2, 2, 2 and not 1, 3. */
const SLACK = 1 / 16;

/**
 * Steps per frame: as many as the speed asks for and the GPU keeps up with (Engine.frame).
 *
 * A frame is in flight from its submission until the GPU has finished it. With two in flight at the next
 * frame, the GPU falls behind: the budget drops by a quarter, to at least 1 step. With none in flight and
 * the GPU idle for more than a third of the last frame interval, it rises by 1/8, to at most `max`. A slow
 * GPU thus lowers the simulation speed instead of the frame rate.
 *
 * Each frame adds the smaller of the requested steps and the budget to one accumulator and runs its whole
 * part. A fractional budget therefore gives a fractional average (1.5 alternates 1 and 2 steps), a frame
 * never runs more than ceil(budget) steps, and less than one step carries over: steps the budget did not
 * allow are dropped, never owed, so a slow phase is not followed by a burst of catch-up steps.
 */
export class FrameBudget {
  /** Steps per frame the GPU keeps up with. */
  steps: number;
  /**
   * Steps the speed asked for so far, before the budget (at most `max` per frame): what the startup check
   * (ui/tune.ts) compares the steps run with, also while the speed changes.
   */
  requested = 0;
  /** Allowed steps not run yet, in [−SLACK, 1 − SLACK). */
  private wanted = 0;
  private inFlight = 0;
  private doneAt = -Infinity;
  private last: number | undefined;

  constructor(private readonly max = MAX_STEPS_PER_FRAME) {
    this.steps = max;
  }

  /** Frames submitted whose GPU work has not finished. */
  get pending(): number {
    return this.inFlight;
  }

  /** Steps for the frame at `now` (ms) at `speed` steps per second; speed 0 while paused. */
  next(now: number, speed: number): number {
    // A frame from a key press can carry a later time than the next animation frame: time never runs back.
    const interval = this.last === undefined ? 0 : Math.max(0, now - this.last);
    this.last = Math.max(this.last ?? now, now);
    if (this.inFlight >= 2) this.steps = Math.max(1, this.steps * 0.75);
    else if (this.inFlight === 0 && interval > 0 && now - this.doneAt > interval / 3)
      this.steps = Math.min(this.max, this.steps + 1 / 8);
    const demand = Math.min((Math.min(interval, MAX_INTERVAL_MS) / 1000) * speed, this.max);
    this.requested += demand;
    this.wanted += Math.min(demand, this.steps);
    const steps = Math.floor(this.wanted + SLACK);
    this.wanted -= steps;
    return steps;
  }

  /** The frame's GPU work is submitted. */
  submitted() {
    this.inFlight++;
  }

  /** The GPU has finished the oldest submitted frame, at `now` (ms). */
  done(now: number) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.doneAt = now;
  }
}
