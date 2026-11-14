import type { Engine } from '../engine/engine';
import { fromFrame, toFrame } from '../engine/environment';
import type { EnvTool } from '../engine/types';
import type { Boundary } from '../model/params';

type Px = [number, number];

/**
 * One drag of a brush over the canvas (App.svelte). It records a segment only once the pointer has moved half a
 * brush radius, and paints exactly what it records: every new grid paints all segments again (ADR 0019), and a slow
 * drag would otherwise add one per pointer event.
 *
 * The end of the last segment is kept in canvas pixels, and the next segment starts where those pixels lie on the
 * grid on screen now. When a new grid is built during the drag (the startup check lowers the grid) or the view moves,
 * the segment still runs along the pointer's path, instead of from cells of the old grid to cells of the new one.
 */
export class BrushDrag {
  private last: Px | undefined;

  /** Paints toward canvas pixel `p` with a brush of `radius` cells. */
  to(engine: Pick<Engine, 'toGrid' | 'paint'>, p: Px, kind: EnvTool, radius: number) {
    const to = engine.toGrid(...p);
    const from = this.last ? engine.toGrid(...this.last) : to;
    if (this.last && Math.hypot(to[0] - from[0], to[1] - from[1]) < radius / 2) return;
    engine.paint({ kind, from, to, radius });
    this.last = p;
  }

  /** The pointer went up: the next drag starts with a dab. */
  end() {
    this.last = undefined;
  }
}

type LineEngine = Pick<Engine, 'toGrid' | 'paint' | 'gridOnScreen' | 'settings'>;

/**
 * Straight lines of a brush tool with Shift (ADR 0035): a click sets the start, and the next click paints the line
 * from it to the pointer as one stroke. The end of that line is the start of the next one, so clicks in a row draw a
 * line with corners.
 *
 * The start is a point of the scene, not of the screen: it stays where it was clicked when the view moves between the
 * clicks. So it is kept in cells of the grid on screen, with that grid. When a new grid is built between the clicks
 * (the startup check lowers the grid), the canonical frame of the arena takes the start to the new grid, as it takes
 * an edit there (environment.ts). On the same grid the start is the end of the last line exactly, so a line with
 * corners is strokes that join.
 */
export class StraightLine {
  private start: { at: Px; grid: Px; boundary: Boundary } | undefined;

  /** A start waits for the click that ends its line. */
  get waiting(): boolean {
    return this.start !== undefined;
  }

  /** The start in cells of the grid on screen now; undefined while no start waits or no grid is on screen. */
  startOn(engine: Pick<Engine, 'gridOnScreen'>): Px | undefined {
    const grid = engine.gridOnScreen;
    if (!this.start || !grid) return undefined;
    const { at, grid: was, boundary } = this.start;
    if (was[0] === grid[0] && was[1] === grid[1]) return at;
    return fromFrame(toFrame(at, was, boundary), [grid[0], grid[1]], boundary);
  }

  /** A click with Shift at canvas pixel `p`: paints the line from the start, if one waits, and starts the next. */
  click(engine: LineEngine, p: Px, kind: EnvTool, radius: number) {
    const to = engine.toGrid(...p);
    const from = this.startOn(engine);
    if (from) engine.paint({ kind, from, to, radius });
    const grid = engine.gridOnScreen;
    this.start = grid ? { at: to, grid: [grid[0], grid[1]], boundary: engine.settings.boundary } : undefined;
  }

  /** Escape, Shift let go, a click without Shift or another tool: the next click with Shift only sets a start. */
  end() {
    this.start = undefined;
  }
}
