import { RESOLUTIONS } from '../model/params';

/** Active time (ms) at which the startup check looks at the window since the last check or restart. */
export const CHECKS_MS = [3000, 6000, 10_000, 15_000] as const;
/** Shortest window that counts. */
export const MIN_WINDOW_MS = 2000;
/** The check never lowers below this grid, and at most this often in a session. */
export const MIN_GRID = 512;
export const MAX_LOWERINGS = 2;
/** Too slow: fewer frames per second than this, or fewer steps than this share of the steps the speed asked for. */
export const MIN_FPS = 40;
export const MIN_SPEED_SHARE = 0.75;
/** Also smooth: at least this share of the frame rate the browser gives, where that is below MIN_FPS. */
export const MIN_BROWSER_SHARE = 0.9;
/** The browser's frame rate counts once at least this share of the window's frames started with the GPU idle. */
export const MIN_IDLE_SHARE = 0.5;

/** Frames and steps over a stretch of active time. */
export interface Window {
  ms: number;
  frames: number;
  steps: number;
  /**
   * Steps the speed asked for (FrameBudget.requested): speed times frame interval, summed per frame, so a
   * speed change inside the window counts from when it happened; at most 16 per frame, the frame loop's
   * limit, and without the steps the budget held back while it was still rising on an idle GPU.
   */
  requested: number;
  /** Frames that started with the GPU idle, and the sum of their intervals in ms (FrameBudget.idleFrames, idleMs). */
  idleFrames: number;
  idleMs: number;
}

/**
 * The decision of the startup check: the grid to lower to after this window, or undefined to keep it.
 * The frame budget (engine/budget.ts) keeps the frame rate up on a slow GPU and lowers the steps per
 * second instead, so both count.
 *
 * A browser can give fewer than MIN_FPS frames per second whatever the grid: iOS Safari gives 30 in Low
 * Power Mode. A smaller grid does not raise that rate. The frames that started with the GPU idle show it,
 * so the frame rate must then reach only MIN_BROWSER_SHARE of it. A GPU that holds most frames up leaves
 * too few idle frames for that, and MIN_FPS applies.
 */
export function lowerGrid(w: Window, resolution: number, lowered: number): number | undefined {
  if (lowered >= MAX_LOWERINGS || w.ms < MIN_WINDOW_MS) return undefined;
  const fps = (1000 * w.frames) / w.ms;
  const idle = w.idleFrames > 0 && w.idleFrames >= MIN_IDLE_SHARE * w.frames;
  const browserFps = idle ? (1000 * w.idleFrames) / w.idleMs : Infinity;
  const minFps = Math.min(MIN_FPS, MIN_BROWSER_SHARE * browserFps);
  if (fps >= minFps && w.steps >= MIN_SPEED_SHARE * w.requested) return undefined;
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
  /** Frames drawn, simulation steps and steps the speed asked for (FrameBudget.requested), so far. */
  frames: number;
  steps: number;
  requested: number;
  /** Frames that started with the GPU idle, and their summed intervals (FrameBudget.idleFrames, idleMs), so far. */
  idleFrames: number;
  idleMs: number;
  resolution: number;
  /** The user picked a grid in the panel: the check never lowers it. */
  picked: boolean;
  /** The grid is a lattice (ADR 0026): it keeps its cells, so the check never lowers it, and its time does not count. */
  lattice?: boolean;
}

/**
 * Startup check (App.svelte): lowers the grid one step, at most twice and not below 512 cells, while the
 * device is too slow. It counts active time only and decides at the checks in CHECKS_MS, each over the
 * window since the previous check or since the last restart (pause, hidden tab, rebuild, reset).
 */
export class GridTuner {
  private activeMs = 0;
  private lastActive: number | undefined;
  private start:
    | { at: number; frames: number; steps: number; requested: number; idleFrames: number; idleMs: number; run: number }
    | undefined;
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
      const { frames, steps, requested, idleFrames, idleMs, run } = t;
      this.start = { at: this.activeMs, frames, steps, requested, idleFrames, idleMs, run };
    };
    if (!t.active || t.lattice) {
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
      requested: t.requested - this.start.requested,
      idleFrames: t.idleFrames - this.start.idleFrames,
      idleMs: t.idleMs - this.start.idleMs,
    };
    if (w.ms < MIN_WINDOW_MS) {
      // Too short after a restart: wait for a full window, but not past the last check.
      if (this.activeMs >= last) this.done = true;
      return undefined;
    }
    while ((CHECKS_MS[this.next] ?? Infinity) <= this.activeMs) this.next++;
    restart();
    const lower = lowerGrid(w, t.resolution, this.lowered);
    if (lower !== undefined) this.lowered++;
    if (this.next >= CHECKS_MS.length || this.lowered >= MAX_LOWERINGS) this.done = true;
    return lower;
  }
}
