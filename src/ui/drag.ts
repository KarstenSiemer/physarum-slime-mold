import type { Engine } from '../engine/engine';
import type { EnvTool } from '../engine/types';

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
