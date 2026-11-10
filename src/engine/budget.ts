/** Most steps one frame may run: 16 × 60 Hz = 960 steps/s, the top of the speed slider. */
export const MAX_STEPS_PER_FRAME = 16;

/** Longest frame interval that still counts in full. */
const MAX_INTERVAL_MS = 100;

/** Frame timing jitter, in steps, that does not change the step count: 2.0 ± 0.06 runs 2, 2, 2 and not 1, 3. */
const SLACK = 1 / 16;

/**
 * Steps per frame: as many as the speed asks for and the GPU keeps up with (Engine.frame).
 *
 * A frame is in flight from its submission until the GPU has finished it. With two in flight at the next
 * frame, the GPU falls behind: the budget drops by a quarter, to at least 1 step. With none in flight and
 * the GPU idle for more than a third of the last frame interval, the GPU has time to spare: the budget
 * rises by 1/8, to at most `max`. A slow GPU thus lowers the simulation speed instead of the frame rate.
 *
 * The budget starts at 1 step and never exceeds the steps of the last frame plus one, so it rises past
 * what the speed asks for only while it is the limit. Without that cap it would climb to `max` on an idle
 * GPU, and the first frame after a pause in rendering (a hidden tab) or after a speed raise would run up to
 * `max` steps at once. Now such a frame runs at most one step more than the frame before, and the steps
 * follow a speed raise at 1/8 step per frame. Frames that ask for no steps (paused, or no time passed)
 * leave the budget as it is, unless frames pile up.
 *
 * Each frame adds the smaller of the requested steps and the budget to one accumulator and runs its whole
 * part. A fractional budget therefore gives a fractional average (1.5 alternates 1 and 2 steps), a frame
 * never runs more than ceil(budget) steps, and less than one step carries over: steps the budget did not
 * allow are dropped, never owed, so a slow phase is not followed by a burst of catch-up steps.
 */
export class FrameBudget {
  /** Steps per frame the GPU keeps up with. */
  steps = 1;
  /**
   * Steps the speed asked for so far (at most `max` per frame), less those the budget held back while the
   * GPU had time to spare, when the budget was still rising and not the GPU too slow. The startup check
   * (ui/tune.ts) compares the steps run with this, also while the speed changes.
   */
  requested = 0;
  /**
   * Frames that started with no frame on the GPU, and the sum of their intervals (ms; intervals up to
   * MAX_INTERVAL_MS only). The GPU did not hold these frames up, so their rate is the frame rate the
   * browser gives. That can be below the display rate: iOS Safari gives 30 fps in Low Power Mode, and
   * Chrome's Energy Saver lowers the frame rate too. The startup check (ui/tune.ts) compares with it.
   */
  idleFrames = 0;
  idleMs = 0;
  /** Allowed steps not run yet, in [−SLACK, 1 − SLACK). */
  private wanted = 0;
  private inFlight = 0;
  private doneAt = -Infinity;
  private last: number | undefined;

  constructor(private readonly max = MAX_STEPS_PER_FRAME) {}

  /** Frames submitted whose GPU work has not finished. */
  get pending(): number {
    return this.inFlight;
  }

  /** Steps for the frame at `now` (ms) at `speed` steps per second; speed 0 while paused. */
  next(now: number, speed: number): number {
    // A frame from a key press can carry a later time than the next animation frame: time never runs back.
    const interval = this.last === undefined ? 0 : Math.max(0, now - this.last);
    this.last = Math.max(this.last ?? now, now);
    const demand = Math.min((Math.min(interval, MAX_INTERVAL_MS) / 1000) * speed, this.max);
    if (this.inFlight === 0 && interval > 0 && interval <= MAX_INTERVAL_MS) {
      this.idleFrames++;
      this.idleMs += interval;
    }
    const spare = this.inFlight === 0 && interval > 0 && now - this.doneAt > interval / 3;
    if (this.inFlight >= 2) this.steps = Math.max(1, this.steps * 0.75);
    else if (spare && demand > 0) this.steps = Math.min(this.max, this.steps + 1 / 8);
    const allowed = Math.min(demand, this.steps);
    this.requested += spare ? allowed : demand;
    this.wanted += allowed;
    const steps = Math.floor(this.wanted + SLACK);
    this.wanted -= steps;
    if (demand > 0) this.steps = Math.min(this.steps, steps + 1);
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
