// The food, light and walls of a shared link: the engine's edit list as compact bytes (docs/adr/0021).
import { fromShape, MIN_RADIUS, sameEdit, STEP, type EnvEdit } from '../engine/environment';
import { EnvKind, type EnvTool } from '../engine/types';
import { BOUNDARIES, MAX_STRAINS, type Boundary } from './params';
import { presetById, shapesAt, type EnvShape } from './presets';

/** What a link holds besides the settings: the scene, and the engine's edit list as the sweep left it. */
export interface Drawing {
  /** The id of the loaded scene; '' when the settings came from a link that names no scene. */
  scene: string;
  /**
   * The revision of the scene's shapes that the list holds (presets.ts `envHistory`, ADR 0027): the scene's newest
   * after a preset load, a link's own after a link. A link of version 1 holds revision 0. 0 without a scene.
   */
  revision: number;
  /** For each strain, its index in the scene, or −1 for a strain added since (app.strainOrigin). */
  origins: number[];
  /** For each of the scene's shapes, whether the list holds it: a Clear and the sweep delete shapes. */
  shapes: boolean[];
  /** The edits after the shapes, in order: strokes, each with its own grid and arena. */
  strokes: EnvEdit[];
}

/** Most strokes a link can hold. */
export const MAX_STROKES = 4096;
/**
 * Most paint work a link can ask for, in passes over 4096 × 4096 cells (workOf()). It also caps the paint segments:
 * a stroke shorter than half a period has one, and a longer one costs at least a quarter pass per segment, so a link
 * asks for at most MAX_STROKES + 4 · MAX_WORK of them.
 */
export const MAX_WORK = 64;

/**
 * Version 2 writes the revision of the scene's shapes after the scene's id (ADR 0027). A link of version 1 names
 * revision 0, the shapes of 2026-11-10.
 */
const VERSION = 2;
/** Grid sides that gridSize() (engine/sizing.ts) gives. */
const [SIDE_MIN, SIDE_MAX] = [16, 4096];
/** Largest distance of a position from the grid's origin, in cells. A drag on screen stays below 2^17. */
const REACH = 2 ** 20;
/** Largest radius, in cells. A brush on screen stays below 2,000. */
const RADIUS_MAX = 2 ** 14;
const SCENE_ID = /^[a-z0-9-]{1,32}$/;
const KINDS: EnvTool[] = ['erase', 'wall', 'food', 'light'];
const BIT = { grid: 16, from: 32, to: 64, radius: 128 } as const;

/** Cells to whole steps (STEP), or undefined for a value off the steps or out of `[-max, max]`. */
function steps(v: number, max: number): number | undefined {
  const n = v / STEP;
  return Number.isInteger(n) && Math.abs(v) <= max ? n : undefined;
}

/**
 * An upper bound of the paint work of a stroke on any grid of at most 4096 cells a side: its paint segments, and
 * the cells they dispatch over, as a share of 4096 × 4096 cells. On another grid a stroke moves through the canonical
 * frame of its arena (engine/environment.ts): a dish scales positions and radius by the ratio of the short sides, a
 * box or a periodic grid scales positions by the ratio of each side and the radius by that of the short sides. So
 * along every axis of every grid the stroke covers at most (D + 2r) / s of that axis, with D the longer side of the
 * stroke's own box, r its radius and s the short side of its own grid. The box a segment dispatches over (paintBox()
 * in engine/brush.ts) adds at most 6 cells: one cell on each side, their rounding and MIN_RADIUS. A periodic stroke
 * is painted in segments of at most half a period (paintSegments()): at most ⌈2D / s⌉ of them, and one more where
 * float rounding of the mapped positions lifts 2D / s over a whole number.
 */
export function workOf({ from, to, radius, grid, boundary }: EnvEdit): { parts: number; work: number } {
  const s = Math.min(...(grid ?? [1, 1]));
  const D = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  const wrap = boundary === 'wrap';
  const parts = wrap ? Math.max(1, Math.ceil((2 * D) / s + 1e-6)) : 1;
  const share = Math.min(1, (wrap ? Math.min(0.5, D / s) : D / s) + (2 * radius) / s + 6 / SIDE_MAX);
  return { parts, work: parts * share * share };
}

/** Counts paint work against MAX_WORK; the number of strokes is checked before the first one (MAX_STROKES). */
class Budget {
  private work = 0;

  /** Adds a stroke: false once the link asks for more work than MAX_WORK. */
  add(e: EnvEdit): boolean {
    this.work += workOf(e).work;
    return this.work <= MAX_WORK;
  }
}

/**
 * The drawing of an edit list: the scene's shapes it holds, in the scene's order, and the strokes after them. A
 * preset load puts the shapes first, and later edits are strokes (Engine.load(), Engine.paint()). An edit without a
 * grid that is not the next shape of the scene stays among the strokes, and packDrawing() then gives up on it. `env`
 * is the scene's shapes of `revision`, the revision that the list was loaded with.
 */
export function drawingOf(
  edits: readonly EnvEdit[],
  scene: string,
  env: readonly EnvShape[],
  arena: Boundary,
  origins: readonly number[],
  revision = 0,
): Drawing {
  const shapes = env.map(() => false);
  let i = 0;
  env.forEach((shape, j) => {
    const e = edits[i];
    if (e && sameEdit(e, fromShape(shape, arena))) [shapes[j], i] = [true, i + 1];
  });
  return { scene, revision, origins: [...origins], shapes, strokes: edits.slice(i) };
}

/**
 * The kinds of edit that a drawing holds: the scene's shapes it keeps, and its strokes. A stroke counts until the
 * engine's sweep deletes it from the list, also when an eraser covers a part of it.
 */
export function kindsOf(d: Drawing): Set<EnvTool> {
  const preset = presetById(d.scene);
  const env = (preset && shapesAt(preset, d.revision)) ?? [];
  return new Set([...env.filter((_, i) => d.shapes[i]).map((e) => e.kind), ...d.strokes.map((e) => e.kind)]);
}

/** The drawing of the scene as it loads: every shape, no stroke. Undefined without a scene. */
export function sceneOnly(d: Drawing): Drawing | undefined {
  return d.scene
    ? { scene: d.scene, revision: d.revision, origins: [...d.origins], shapes: d.shapes.map(() => true), strokes: [] }
    : undefined;
}

class Writer {
  private readonly out: number[] = [];

  byte(v: number) {
    this.out.push(v & 255);
  }

  /** An unsigned integer, 7 bits per byte, lowest first. */
  varint(v: number) {
    for (; v >= 128; v = Math.floor(v / 128)) this.out.push((v % 128) | 128);
    this.out.push(v);
  }

  /** A signed integer by zigzag: 0, −1, 1, −2, … as 0, 1, 2, 3, … */
  signed(v: number) {
    this.varint(v < 0 ? -2 * v - 1 : 2 * v);
  }

  bytes(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.out);
  }
}

/** Thrown by Reader when the bytes end too early or a number is too long; unpackDrawing() catches it. */
const END = new Error('link drawing ends early');

class Reader {
  private i = 0;

  constructor(private readonly data: Uint8Array) {}

  byte(): number {
    const v = this.data[this.i++];
    if (v === undefined) throw END;
    return v;
  }

  /** At most 5 bytes: below 2^35. */
  varint(): number {
    let v = 0;
    for (let k = 0; k < 5; k++) {
      const b = this.byte();
      v += (b & 127) * 128 ** k;
      if (b < 128) return v;
    }
    throw END;
  }

  signed(): number {
    const z = this.varint();
    return z % 2 ? -(z + 1) / 2 : z / 2;
  }

  get done() {
    return this.i === this.data.length;
  }
}

/**
 * The drawing as bytes (docs/adr/0021): a version, the scene's id, for a scene the revision of its shapes (ADR 0027),
 * its strains' origins and which of those shapes the list holds, then the strokes. Each stroke has a head byte (kind, arena, and which of grid, start, end and radius
 * follow), then those that follow: its grid when it differs from the stroke before, its start from the end of the
 * stroke before unless it starts there (a drag), its end from its start unless it is a dab, and its radius unless it
 * is the one before. Positions and radii count whole steps of 1/16 cell (STEP), exactly as the engine records them.
 * Undefined when a value is off the steps or out of range, or the strokes exceed the caps.
 */
export function packDrawing(d: Drawing): Uint8Array<ArrayBuffer> | undefined {
  const out = new Writer();
  out.byte(VERSION);
  const preset = d.scene && SCENE_ID.test(d.scene) ? presetById(d.scene) : undefined;
  if (d.scene && !preset) return undefined;
  out.byte(d.scene.length);
  for (const c of d.scene) out.byte(c.charCodeAt(0));
  if (preset) {
    const shapes = shapesAt(preset, d.revision);
    if (!shapes) return undefined;
    out.varint(d.revision);
    const strains = preset.settings().strains.length;
    const fine = d.origins.every((o) => Number.isInteger(o) && o >= -1 && o < strains);
    if (!fine || d.origins.length < 1 || d.origins.length > MAX_STRAINS) return undefined;
    if (d.shapes.length !== shapes.length) return undefined;
    out.byte(d.origins.length);
    for (const o of d.origins) out.byte(o + 1);
    out.byte(d.shapes.length);
    for (let j = 0; j < d.shapes.length; j += 8) {
      let bits = 0;
      for (let k = 0; k < 8; k++) if (d.shapes[j + k]) bits |= 1 << k;
      out.byte(bits);
    }
  }
  if (d.strokes.length > MAX_STROKES) return undefined;
  out.varint(d.strokes.length);
  const budget = new Budget();
  let last = { grid: [0, 0], to: [0, 0], radius: -1 };
  for (const e of d.strokes) {
    const [w = 0, h = 0] = e.grid ?? [];
    const [fx, fy, tx, ty] = [...e.from, ...e.to].map((v) => steps(v, REACH));
    const radius = e.radius >= MIN_RADIUS ? steps(e.radius, RADIUS_MAX) : undefined;
    const sides = [w, h].every((v) => Number.isInteger(v) && v >= SIDE_MIN && v <= SIDE_MAX);
    const arena = BOUNDARIES.indexOf(e.boundary);
    if (fx === undefined || fy === undefined || tx === undefined || ty === undefined || radius === undefined)
      return undefined;
    if (!sides || arena < 0 || !budget.add(e)) return undefined;
    const grid = w !== last.grid[0] || h !== last.grid[1];
    const from = fx !== last.to[0] || fy !== last.to[1];
    const to = tx !== fx || ty !== fy;
    const r = radius !== last.radius;
    const flags = (grid ? BIT.grid : 0) | (from ? BIT.from : 0) | (to ? BIT.to : 0) | (r ? BIT.radius : 0);
    out.byte(EnvKind[e.kind] | (arena << 2) | flags);
    if (grid) {
      out.varint(w);
      out.varint(h);
    }
    if (from) {
      out.signed(fx - (last.to[0] ?? 0));
      out.signed(fy - (last.to[1] ?? 0));
    }
    if (to) {
      out.signed(tx - fx);
      out.signed(ty - fy);
    }
    if (r) out.varint(radius);
    last = { grid: [w, h], to: [tx, ty], radius };
  }
  return out.bytes();
}

/**
 * The drawing from bytes of packDrawing(). Untrusted input (a shared link): never throws, and gives undefined unless
 * every value is in range and the strokes stay within the caps. The scene must be a preset with the revision that the
 * link names (0 for version 1) and as many shapes in it as the link says, and its strains' origins must lie between −1
 * and the preset's strains.
 */
export function unpackDrawing(data: Uint8Array): Drawing | undefined {
  try {
    return unpack(new Reader(data));
  } catch {
    return undefined;
  }
}

function unpack(input: Reader): Drawing | undefined {
  const version = input.byte();
  if (version !== 1 && version !== VERSION) return undefined;
  const length = input.byte();
  const scene = String.fromCharCode(...Array.from({ length }, () => input.byte()));
  const d: Drawing = { scene, revision: 0, origins: [], shapes: [], strokes: [] };
  if (scene) {
    const preset = SCENE_ID.test(scene) ? presetById(scene) : undefined;
    if (!preset) return undefined;
    d.revision = version === 1 ? 0 : input.varint();
    const env = shapesAt(preset, d.revision);
    if (!env) return undefined;
    const strains = preset.settings().strains.length;
    const n = input.byte();
    if (n < 1 || n > MAX_STRAINS) return undefined;
    d.origins = Array.from({ length: n }, () => input.byte() - 1);
    if (d.origins.some((o) => o >= strains)) return undefined;
    const shapes = input.byte();
    if (shapes !== env.length) return undefined;
    for (let j = 0; j < shapes; j += 8) {
      const bits = input.byte();
      for (let k = 0; k < 8; k++) {
        if (j + k < shapes) d.shapes.push((bits & (1 << k)) !== 0);
        else if (bits & (1 << k)) return undefined;
      }
    }
  }
  const count = input.varint();
  if (count > MAX_STROKES) return undefined;
  const budget = new Budget();
  let last: { grid?: [number, number]; to: [number, number]; radius?: number } = { to: [0, 0] };
  for (let i = 0; i < count; i++) {
    const head = input.byte();
    const boundary = BOUNDARIES[(head >> 2) & 3];
    const grid: [number, number] | undefined = head & BIT.grid ? [input.varint(), input.varint()] : last.grid;
    const [ax, ay] = last.to;
    const from: [number, number] =
      head & BIT.from ? [ax + input.signed() * STEP, ay + input.signed() * STEP] : [ax, ay];
    const [bx, by] = from;
    const to: [number, number] = head & BIT.to ? [bx + input.signed() * STEP, by + input.signed() * STEP] : [bx, by];
    const radius = head & BIT.radius ? input.varint() * STEP : last.radius;
    const kind = KINDS[head & 3];
    if (!kind || !boundary || !grid || radius === undefined || radius < MIN_RADIUS || radius > RADIUS_MAX)
      return undefined;
    if (!grid.every((v) => v >= SIDE_MIN && v <= SIDE_MAX)) return undefined;
    if (![...from, ...to].every((v) => Math.abs(v) <= REACH)) return undefined;
    const e: EnvEdit = { kind, from, to, radius, grid, boundary };
    if (!budget.add(e)) return undefined;
    d.strokes.push(e);
    last = { grid, to, radius };
  }
  return input.done ? d : undefined;
}
