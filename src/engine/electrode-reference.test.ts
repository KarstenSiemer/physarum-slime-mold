import { describe, expect, it } from 'vitest';
import { STYLES } from '../model/params';
import {
  electrodesOver,
  POLE_COLOR,
  POLE_RIM,
  POLE_SHADE,
  POLE_SHADOW,
  polesAt,
  studAt,
  SUN,
  type Rgb,
} from './electrode-reference';
import { distanceByte, outlineModel, POLE_SCHEME, type OutlineGrid } from './outline-reference';
import type { Stroke } from './types';

// The view of the electrodes on the CPU (ADR 0058), which the picture of both backends is checked against
// (electrode.gpu.test.ts).
describe('the CPU reference of the picture of the electrodes', () => {
  const blue: Rgb = [...POLE_COLOR.cathode];
  /** Toward the light on the ground, and away from it: unit vectors. Grid y points down, and the light is top left. */
  const toLight: [number, number] = [-0.6, -0.8];
  const away: [number, number] = [0.6, 0.8];
  const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  it('has the light of the picture: top left, as the gel and the walls', () => {
    expect(Math.hypot(...SUN)).toBeCloseTo(1, 12);
    expect(SUN[0] / SUN[1]).toBeCloseTo(0.45 / 0.6, 12);
    expect(SUN[2]).toBeCloseTo(0.65 / Math.sqrt(0.985), 12);
  });

  it('draws the flat top of a stud in the colour of its pole, a little darker, with no shadow', () => {
    // From POLE_RIM cells inside the outline on, the surface is flat: the light falls on it from above.
    const half = Math.hypot(SUN[0], SUN[1], SUN[2] + 1);
    const shine = 0.6 * ((SUN[2] + 1) / half) ** 60;
    for (const sd of [POLE_RIM, 2, 9])
      for (const grad of [toLight, away, [0, 0]] as const) {
        const top = studAt(blue, sd, sd, grad, 1 / 8);
        expect(top.cover).toBe(1);
        expect(top.shadow).toBe(0);
        top.color.forEach((v, k) => {
          expect(v).toBeCloseTo((blue[k] ?? 0) * (0.5 + 0.7 * SUN[2]) + shine, 12);
        });
      }
    // 0.958 of the colour, and 0.002 of white.
    expect(0.5 + 0.7 * SUN[2]).toBeCloseTo(0.958, 3);
    expect(shine).toBeCloseTo(0.002, 3);
  });

  it('lights the slope toward the light more than the top, and the slope away from it less', () => {
    // Half way up the rim. The gradient of the distance points into the pole: away from the light on the lit side.
    const [top, lit, shaded] = [
      studAt(blue, 3, 3, away, 1 / 8),
      studAt(blue, 0.75, 0.75, away, 1 / 8),
      studAt(blue, 0.75, 0.75, toLight, 1 / 8),
    ];
    expect(luma(lit.color)).toBeGreaterThan(luma(top.color) * 1.1);
    expect(luma(shaded.color)).toBeLessThan(luma(top.color) * 0.8);
    // The slope is steepest at the outline, and gone at the rim.
    const slope = (sd: number) => luma(studAt(blue, sd, sd, away, 4).color) - luma(top.color);
    expect(slope(1.4)).toBeGreaterThan(0);
    expect(slope(1.4)).toBeLessThan(slope(0.9));
    expect(studAt(blue, POLE_RIM, POLE_RIM, away, 1 / 8).color).toEqual(top.color);
  });

  it('draws a dark line along the outline: 1.5 pixels wide, at least 0.35 and at most 0.75 cells', () => {
    // On the outline the colour goes toward a quarter of the colour of the pole by 0.6. Without a slope (a gradient of
    // 0) the lit colour is that of the flat top.
    const top = studAt(blue, 3, 3, [0, 0], 1 / 8).color;
    const on = studAt(blue, 0, 0, [0, 0], 1 / 8).color;
    on.forEach((v, k) => {
      expect(v).toBeCloseTo(0.4 * (top[k] ?? 0) + 0.6 * 0.25 * (blue[k] ?? 0), 12);
    });
    // The first distance from the outline at which the line is gone, to 0.01 cells.
    const width = (scale: number) => {
      for (let sd = 0; sd < 2; sd += 0.01) if (studAt(blue, sd, sd, [0, 0], scale).color[2] >= top[2] - 1e-9) return sd;
      return NaN;
    };
    expect(width(1 / 32)).toBeCloseTo(0.35, 2);
    expect(width(1 / 8)).toBeCloseTo(0.35, 2);
    expect(width(0.3)).toBeCloseTo(0.45, 2);
    expect(width(0.5)).toBeCloseTo(0.75, 2);
    expect(width(6)).toBeCloseTo(0.75, 2);
  });

  it('casts a shadow beside the outline on the side away from the light, up to 2 cells from it', () => {
    // Outside the pole on the side away from the light the gradient points to the pole, and so toward the light.
    const at = (sd: number, grad: readonly [number, number]) => studAt(blue, sd, sd, grad, 1 / 8).shadow;
    expect(at(-0.1, toLight)).toBeCloseTo(0.99275, 5);
    expect(at(-1, toLight)).toBe(0.5);
    expect(at(-POLE_SHADOW, toLight)).toBe(0);
    expect(at(-3, toLight)).toBe(0);
    // None on the side toward the light, and less where the gradient is short or turned away from the light.
    expect(at(-1, away)).toBe(0);
    expect(at(-1, [0.6 * 0.5, 0.8 * 0.5].map((v) => -v) as [number, number])).toBe(0.25);
    expect(at(-1, [-1, 0])).toBeCloseTo(0.3, 12);
    // No shadow on the pole itself: only the part of the pixel that the pole does not cover.
    expect(at(1, toLight)).toBe(0);
    expect(studAt(blue, 0, 0, toLight, 1 / 8).shadow).toBe(0.5);
  });

  describe('over a picture', () => {
    const [w, h] = [40, 32];
    const grid: OutlineGrid = { width: w, height: h, boundary: 'box' };
    const dab = (kind: Stroke['kind'], x: number, y: number, radius: number): Stroke => ({
      kind,
      from: [x, y],
      to: [x, y],
      radius,
    });
    /** The outline distances of the poles as Sim.readPoles() returns them, from the CPU model of the outline pass. */
    const polesOf = (strokes: Stroke[]) => {
      const model = outlineModel(strokes, 'box', w, h, POLE_SCHEME);
      return Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 4 < 2 ? (model[(i >> 2) * 2 + (i % 4)] ?? 0) : 0));
    };
    const ground: Rgb = [0.8, 0.7, 0.5];
    /** Two colours are the same to 12 digits: a blend of 1 rounds the last one. */
    const same = (a: Rgb, b: Rgb) => {
      a.forEach((v, k) => {
        expect(v).toBeCloseTo(b[k] ?? NaN, 12);
      });
    };

    it('leaves the picture far from every pole as it is, and darkens it in a shadow by the share of the style', () => {
      const poles = polesOf([dab('cathode', 14.3, 14.2, 6)]);
      expect(polesAt(poles, grid, 30.5, 26.5, 1 / 8, 'paper').near).toBe(false);
      expect(electrodesOver(ground, poles, grid, 30.5, 26.5, 1 / 8, 'paper')).toBe(ground);
      // 1 cell outside the outline on the diagonal of the light: about half of the full shadow.
      const [px, py] = [14.3 + 0.6 * 7, 14.2 + 0.8 * 7];
      for (const style of STYLES) {
        const s = polesAt(poles, grid, px, py, 1 / 8, style);
        expect(s.cover).toBe(0);
        expect(s.cathode.shadow).toBeGreaterThan(0.45);
        expect(s.cathode.shadow).toBeLessThan(0.5);
        expect(s.lit).toBeCloseTo(1 - POLE_SHADE[style] * s.cathode.shadow, 12);
        const shaded = electrodesOver(ground, poles, grid, px, py, 1 / 8, style);
        shaded.forEach((v, k) => {
          expect(v).toBeCloseTo((ground[k] ?? 0) * s.lit, 12);
        });
      }
      expect([POLE_SHADE.glow, POLE_SHADE.agents, POLE_SHADE.gel, POLE_SHADE.paper]).toEqual([0.75, 0.75, 0.6, 0.3]);
      // No shadow on the side toward the light.
      expect(electrodesOver(ground, poles, grid, 14.3 - 0.6 * 7, 14.2 - 0.8 * 7, 1 / 8, 'paper')).toEqual(ground);
    });

    it('covers all of the picture below a pole', () => {
      const poles = polesOf([dab('cathode', 14.3, 14.2, 6), dab('anode', 28, 20, 3)]);
      for (const [px, py] of [
        [14.5, 14.5],
        [10.1, 11.3],
        [28.2, 19.6],
        [29.9, 21.4],
      ] as const) {
        const s = polesAt(poles, grid, px, py, 1 / 8, 'glow');
        expect(s.cover).toBe(1);
        // Whatever lies below, the pixel is the surface of the pole.
        for (const below of [ground, [0, 0, 0], [1, 1, 1]] as Rgb[])
          same(electrodesOver(below, poles, grid, px, py, 1 / 8, 'glow'), s.surface);
      }
      // On the outline the pole covers a part of the pixel, and the picture below shows in the rest.
      const edge = polesAt(poles, grid, 14.3 + 5.97, 14.2, 1 / 8, 'glow');
      expect(edge.cover).toBeGreaterThan(0.1);
      expect(edge.cover).toBeLessThan(0.9);
      const mixed = electrodesOver(ground, poles, grid, 14.3 + 5.97, 14.2, 1 / 8, 'glow');
      mixed.forEach((v, k) => {
        expect(v).toBeCloseTo((ground[k] ?? 0) * edge.lit * (1 - edge.cover) + (edge.surface[k] ?? 0) * edge.cover, 12);
      });
    });

    it('lets each pole cover its share of a pixel where the two meet, and shows no ground between them', () => {
      // A thin anode over a wide cathode: the cathode ends where the anode begins.
      const poles = polesOf([dab('cathode', 20, 16, 12), dab('anode', 20.3, 16.2, 1.5)]);
      let seam = 0;
      for (let k = 0; k < 360; k++)
        for (let r = 0.6; r < 2.4; r += 0.01) {
          const [px, py] = [20.3 + r * Math.cos((k / 180) * Math.PI), 16.2 + r * Math.sin((k / 180) * Math.PI)];
          const s = polesAt(poles, grid, px, py, 1 / 8, 'paper');
          expect(s.cover).toBeGreaterThan(1 - 1e-9);
          if (s.cathode.cover > 0 && s.anode.cover > 0) {
            seam++;
            const both = s.cathode.cover + s.anode.cover;
            expect(both).toBeCloseTo(1, 9);
            s.surface.forEach((v, c) => {
              expect(v).toBeCloseTo(
                s.cathode.cover * (s.cathode.color[c] ?? 0) + s.anode.cover * (s.anode.color[c] ?? 0),
                9,
              );
            });
            same(electrodesOver(ground, poles, grid, px, py, 1 / 8, 'paper'), s.surface);
          }
        }
      expect(seam).toBeGreaterThan(2000);
    });

    it('reads the two bytes of a cell alone: the distance to the cathodes and the one to the anodes', () => {
      const poles = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          poles[(y * w + x) * 4] = distanceByte(10 - (x + 0.5));
          poles[(y * w + x) * 4 + 1] = distanceByte(x + 0.5 - 30);
        }
      const [left, middle, right] = [5.5, 20.5, 35.5].map((px) => polesAt(poles, grid, px, 16.5, 1 / 8, 'glow'));
      expect([left?.cathode.cover, left?.anode.cover]).toEqual([1, 0]);
      expect([middle?.cathode.cover, middle?.anode.cover, middle?.near]).toEqual([0, 0, false]);
      expect([right?.cathode.cover, right?.anode.cover]).toEqual([0, 1]);
      expect(left?.surface[2]).toBeGreaterThan(0.9);
      expect(right?.surface[0]).toBeGreaterThan(0.9);
    });
  });
});
