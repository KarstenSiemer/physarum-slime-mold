// The light on the mountains as the specification of 2026-11-11 drew it, for the scene Tokyo with light: one disc of
// radius 0.024 (half the diagonal of a cell) on the centre of each lit cell of the grid of elevations. The scene does
// not use it. The brush paints the full light byte only within 0.3 of a radius (model.md, section 6.7), so these discs
// leave dim seams between the cells, and the colony built a mesh in them (ADR 0029, amendment 2026-11-15 (3)). The
// scene fills the cells (tokyoLight() in src/model/tokyo.ts). dump.gpu.test.ts paints these shapes with
// VITE_SHAPES=dabs, and measure-tokyo.ts measures under them with LIT=dabs.
import type { EnvShape } from '../../../src/model/presets';
import {
  elevationCell,
  TOKYO_LAKES,
  TOKYO_MOUNTAINS,
  TOKYO_SCALE,
  tokyoLight,
  tokyoShapes,
} from '../../../src/model/tokyo';

/** The radius of a disc of the specification, in the map frame. */
export const DAB_RADIUS = 0.024;

/** The food and walls of the Tokyo scene, a disc on each lit cell, and the lakes of the scene. */
export function dabShapes(): EnvShape[] {
  const k = TOKYO_SCALE;
  const discs = TOKYO_MOUNTAINS.map(([column, row]): EnvShape => {
    const [west, north, east, south] = elevationCell(column, row);
    return { kind: 'light', at: [((west + east) / 2) * k, ((north + south) / 2) * k], r: DAB_RADIUS * k };
  });
  // The lakes are the last strokes of the scene's light: one stroke per piece of their lines.
  const lakes = TOKYO_LAKES.reduce((n, l) => n + l.line.length - 1, 0);
  return [...tokyoShapes(), ...discs, ...tokyoLight().slice(-lakes)];
}
