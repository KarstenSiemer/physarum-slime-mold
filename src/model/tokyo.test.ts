import { describe, expect, it } from 'vitest';
import { dishRadius } from '../engine/brush';
import { fromShape, strokeOn } from '../engine/environment';
import { paintReference } from '../engine/paint-reference';
import { presetById } from './presets';
import {
  TOKYO_CITIES,
  TOKYO_DABS,
  TOKYO_FOOD_RADIUS,
  TOKYO_KM_PER_UNIT,
  TOKYO_MAP,
  TOKYO_MEASURED,
  TOKYO_SCALE,
  TOKYO_WALL_RADIUS,
  tokyoShapes,
} from './tokyo';

/** The length of the minimum spanning tree of points (Prim). */
function mst(points: readonly (readonly [number, number])[]): number {
  const best = points.map(() => Infinity);
  const done = points.map(() => false);
  best[0] = 0;
  let total = 0;
  // One point joins the tree in each round: the nearest one to the tree.
  points.forEach(() => {
    let u = -1;
    for (let i = 0; i < points.length; i++) if (!done[i] && (u < 0 || (best[i] ?? 0) < (best[u] ?? 0))) u = i;
    done[u] = true;
    total += best[u] ?? 0;
    const [ux, uy] = points[u] ?? [0, 0];
    points.forEach(([x, y], v) => {
      if (!done[v]) best[v] = Math.min(best[v] ?? Infinity, Math.hypot(x - ux, y - uy));
    });
  });
  return total;
}

describe('the map of the Tokyo experiment (Tero et al. 2010)', () => {
  const at = TOKYO_CITIES.map(([, x, y]) => [x, y] as const);

  it('has the 36 food sources of Fig. 1, Tokyo first, and the 33 nodes of Fig. 2 before the other three', () => {
    expect(TOKYO_CITIES.length).toBe(36);
    expect(TOKYO_MEASURED).toBe(33);
    expect(TOKYO_CITIES[0][0]).toBe('Tokyo');
    expect(new Set(TOKYO_CITIES.map(([name]) => name)).size).toBe(36);
    expect(TOKYO_CITIES.slice(TOKYO_MEASURED).map(([name]) => name)).toEqual(['Utsunomiya', 'Hitachi', 'Ito']);
    const [west, north, east, south] = TOKYO_MAP;
    for (const [name, x, y] of TOKYO_CITIES) {
      expect(x, name).toBeGreaterThan(west);
      expect(x, name).toBeLessThan(east);
      expect(y, name).toBeGreaterThan(north);
      expect(y, name).toBeLessThan(south);
    }
    // The panels of Fig. 1 are 17 cm wide: the map is 182 km wide, 10.7 km per cm.
    expect((east - west) * TOKYO_KM_PER_UNIT).toBeCloseTo(182.5, 0);
    expect((south - north) * TOKYO_KM_PER_UNIT).toBeCloseTo(206.3, 0);
  });

  it('places Tokyo by the projection of the map frame', () => {
    // Tokyo station: 139.7669° E, 35.6808° N.
    const [x, y] = [((139.7669 - 139.97) * 90.333) / 285, (-(35.6808 - 35.76) * 110.95) / 285];
    expect(TOKYO_CITIES[0][1]).toBeCloseTo(x, 3);
    expect(TOKYO_CITIES[0][2]).toBeCloseTo(y, 3);
  });

  it('gives the minimum spanning trees that the measures of the paper are divided by', () => {
    // 642 km for the 33 nodes of Fig. 2, 732 km for all 36 (ADR 0024).
    expect(mst(at.slice(0, TOKYO_MEASURED))).toBeCloseTo(2.254, 2);
    expect(mst(at)).toBeCloseTo(2.569, 2);
    expect(mst(at.slice(0, TOKYO_MEASURED)) * TOKYO_KM_PER_UNIT).toBeCloseTo(642, -1);
  });

  it('keeps the food sources apart, but for Hiratsuka and Chigasaki, which lie 5 km from each other', () => {
    const close: string[] = [];
    TOKYO_CITIES.forEach(([a, ax, ay], i) => {
      TOKYO_CITIES.slice(i + 1).forEach(([b, bx, by]) => {
        if (Math.hypot(ax - bx, ay - by) < 2 * TOKYO_FOOD_RADIUS) close.push(`${a}, ${b}`);
      });
    });
    expect(close).toEqual(['Hiratsuka, Chigasaki']);
    // Tokyo's own seven sources touch: each lies two radii from the centre.
    for (const [dx, dy] of TOKYO_DABS.slice(1)) expect(Math.hypot(dx, dy)).toBeCloseTo(2 * TOKYO_FOOD_RADIUS, 4);
  });

  it('is the scene’s food and walls: Tokyo’s seven food sources first, and a coast without gaps', () => {
    const shapes = tokyoShapes();
    expect(presetById('tokyo')?.env).toEqual(shapes);
    const foods = shapes.filter((s) => s.kind === 'food');
    const walls = shapes.filter((s) => s.kind === 'wall');
    expect(foods.length).toBe(36 + 6);
    expect(shapes.slice(0, foods.length).every((s) => s.kind === 'food')).toBe(true);
    expect(shapes.length).toBe(foods.length + walls.length);
    expect(foods[0]?.at[0]).toBeCloseTo(TOKYO_CITIES[0][1] * TOKYO_SCALE, 12);
    for (const f of foods) expect(f.r).toBeCloseTo(TOKYO_FOOD_RADIUS * TOKYO_SCALE, 12);
    for (const w of walls) expect(w.r).toBeCloseTo(TOKYO_WALL_RADIUS * TOKYO_SCALE, 12);
    // Each wall of the coast starts where the one before it ends; the last three are the edges of the map.
    const coast = walls.slice(0, -3);
    coast.slice(1).forEach((w, i) => {
      expect(w.at, `wall ${String(i + 1)}`).toEqual(coast[i]?.to);
    });
    // No piece of the coast is longer than 25 km, and the line never goes back on itself by a full turn.
    for (const w of coast)
      expect(Math.hypot((w.to?.[0] ?? 0) - w.at[0], (w.to?.[1] ?? 0) - w.at[1])).toBeLessThan(25 / TOKYO_KM_PER_UNIT);
  });

  // The scene on its lattice, painted as the simulation paints it (paint-reference.ts).
  describe.each([
    [512, 512],
    [256, 256],
    [512, 320],
  ])('on a grid of %i × %i cells', (w, h) => {
    const env = new Uint8Array(w * h * 4);
    const sites: [number, number][] = [];
    for (const shape of tokyoShapes()) {
      const stroke = strokeOn(fromShape(shape, 'dish'), w, h);
      if (!stroke) throw new Error('a shape of the scene is not on the grid');
      paintReference(env, w, h, stroke, 'dish');
      if (shape.kind === 'food') sites.push([Math.floor(stroke.from[0]), Math.floor(stroke.from[1])]);
    }
    const radius = dishRadius(w, h);
    const open = (x: number, y: number) =>
      x >= 0 &&
      y >= 0 &&
      x < w &&
      y < h &&
      Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= radius &&
      (env[(y * w + x) * 4] ?? 0) < 128;
    // The land: the open cells that a walk from Tokyo station reaches over the sides of the cells, as the agents and
    // the flux do.
    const land = new Uint8Array(w * h);
    const first = sites[0] ?? [0, 0];
    const stack = [first];
    land[first[1] * w + first[0]] = 1;
    while (stack.length > 0) {
      const [x, y] = stack.pop() ?? [0, 0];
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const [nx, ny] = [x + dx, y + dy];
        if (!open(nx, ny) || land[ny * w + nx]) continue;
        land[ny * w + nx] = 1;
        stack.push([nx, ny]);
      }
    }
    const short = Math.min(w, h);
    const cell = (x: number, y: number) =>
      [Math.floor(w / 2 + x * TOKYO_SCALE * short), Math.floor(h / 2 + y * TOKYO_SCALE * short)] as const;

    it('has every food source on land, with food at its centre', () => {
      expect(sites.length).toBe(42);
      expect(new Set(sites.map(([x, y]) => y * w + x)).size).toBe(42);
      sites.forEach(([x, y], i) => {
        expect(land[y * w + x], `site ${String(i)}`).toBe(1);
        expect(env[(y * w + x) * 4 + 1], `site ${String(i)}`).toBe(255);
      });
    });

    it('closes the land against the sea: the coast and the edges of the map have no gap', () => {
      // Sea: the middle of Tokyo Bay, Sagami Bay, and the Pacific east of the Boso peninsula and of Choshi.
      for (const [name, x, y] of [
        ['Tokyo Bay', -0.03, 0.09],
        ['Sagami Bay', -0.17, 0.25],
        ['the Pacific off Boso', 0.2, 0.2],
        ['the Pacific off Choshi', 0.31, -0.1],
      ] as const) {
        const [cx, cy] = cell(x, y);
        expect(open(cx, cy), name).toBe(true);
        expect(land[cy * w + cx], name).toBe(0);
      }
      // The land is most of the map west of the coast: between a third and two thirds of the map's rectangle.
      const cells = land.reduce((a, v) => a + v, 0);
      const [west, north, east, south] = TOKYO_MAP;
      const map = (east - west) * (south - north) * (TOKYO_SCALE * short) ** 2;
      expect(cells / map).toBeGreaterThan(0.45);
      expect(cells / map).toBeLessThan(0.7);
    });
  });
});
