import { RESOLUTIONS } from '../model/params';

/** Active time (ms) at which the startup check looks at the window since the last check or restart. */
export const CHECKS_MS = [3000, 6000, 10_000, 15_000] as const;
/** Shortest window that counts. */
export const MIN_WINDOW_MS = 2000;
/** The check never lowers below this grid, and at most this often in a session. */
export const MIN_GRID = 512;
export const MAX_LOWERINGS = 2;
/** Too slow: fewer frames per second than this, or fewer steps per second than this share of the speed. */
export const MIN_FPS = 40;
export const MIN_SPEED_SHARE = 0.75;

/** Frames and steps over a stretch of active time. */
export interface Window {
  ms: number;
  frames: number;
  steps: number;
}

/**
 * The decision of the startup check: the grid to lower to after this window, or undefined to keep it.
 * The frame budget (engine/budget.ts) keeps the frame rate up on a slow GPU and lowers the steps per
 * second instead, so both count.
 */
export function lowerGrid(w: Window, speed: number, resolution: number, lowered: number): number | undefined {
  if (lowered >= MAX_LOWERINGS || w.ms < MIN_WINDOW_MS) return undefined;
  const fps = (1000 * w.frames) / w.ms;
  const stepsPerSecond = (1000 * w.steps) / w.ms;
  if (fps >= MIN_FPS && stepsPerSecond >= MIN_SPEED_SHARE * speed) return undefined;
  const lower = [...RESOLUTIONS].reverse().find((r) => r < resolution);
  return lower !== undefined && lower >= MIN_GRID ? lower : undefined;
}

/** What the startup check sees at one stats tick. */
export interface Tick {
  /** performance.now() */
  now: number;
  /** The tab is visible, the simulation runs, and no rebuild is going on. */
  active: boolean;
  /** How often the simulation started over (Engine.restarts): a reset or rebuild starts a new window. */
  run: number;
  /** Frames drawn and simulation steps so far. */
  frames: number;
  steps: number;
  speed: number;
  resolution: number;
  /** The user picked a grid in the panel: the check never lowers it. */
  picked: boolean;
}

/**
 * Startup check (App.svelte): lowers the grid one step, at most twice and not below 512 cells, while the
 * device is too slow. It counts active time only and decides at the checks in CHECKS_MS, each over the
 * window since the previous check or since the last restart (pause, hidden tab, rebuild, reset).
 */
export class GridTuner {
  private activeMs = 0;
  private lastActive: number | undefined;
  private start: { at: number; frames: number; steps: number; run: number } | undefined;
  private next = 0;
  private lowered = 0;
  private done = false;

  /** False once the check has ended for this session. */
  get running(): boolean {
    return !this.done;
  }

  /** Returns the grid to switch to, if any. */
  tick(t: Tick): number | undefined {
    if (this.done) return undefined;
    if (t.picked) {
      this.done = true;
      return undefined;
    }
    const restart = () => {
      this.start = { at: this.activeMs, frames: t.frames, steps: t.steps, run: t.run };
    };
    if (!t.active) {
      this.lastActive = undefined;
      this.start = undefined;
      return undefined;
    }
    if (this.lastActive !== undefined) this.activeMs += t.now - this.lastActive;
    this.lastActive = t.now;
    if (this.start?.run !== t.run) {
      restart();
      return undefined;
    }
    const due = CHECKS_MS[this.next];
    if (due === undefined || this.activeMs < due) return undefined;
    const last = CHECKS_MS[CHECKS_MS.length - 1] ?? 0;
    const w = {
      ms: this.activeMs - this.start.at,
      frames: t.frames - this.start.frames,
      steps: t.steps - this.start.steps,
    };
    if (w.ms < MIN_WINDOW_MS) {
      // Too short after a restart: wait for a full window, but not past the last check.
      if (this.activeMs >= last) this.done = true;
      return undefined;
    }
    while ((CHECKS_MS[this.next] ?? Infinity) <= this.activeMs) this.next++;
    restart();
    const lower = lowerGrid(w, t.speed, t.resolution, this.lowered);
    if (lower !== undefined) this.lowered++;
    if (this.next >= CHECKS_MS.length || this.lowered >= MAX_LOWERINGS) this.done = true;
    return lower;
  }
}
