// The panels are translucent glass over the canvas, and the canvas can be white: the paper style, or white-hot
// trails behind the panel. Text on the glass keeps WCAG 2.2 contrast (1.4.3: 4.5:1 for small text) even then.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

type Rgba = [number, number, number, number];

function token(name: string): Rgba {
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? '';
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) return [...hex.slice(1, 4).map((h) => parseInt(h, 16)), 1] as Rgba;
  const rgba = /^rgba\(([^)]+)\)$/.exec(value);
  if (rgba) return rgba[1]?.split(',').map(Number) as Rgba;
  throw new Error(`--${name}: cannot read "${value}"`);
}

const over = ([r, g, b, a]: Rgba, under: Rgba): Rgba => [
  a * r + (1 - a) * under[0],
  a * g + (1 - a) * under[1],
  a * b + (1 - a) * under[2],
  1,
];

/** Relative luminance (WCAG 2.2). */
const luminance = ([r, g, b]: Rgba) => {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

describe('glass', () => {
  const white: Rgba = [255, 255, 255, 1];
  const panel = over(token('glass'), white);
  // The scene card and the strain cards add a faint white layer (SceneCard.svelte, StrainCard.svelte).
  const card = over([255, 255, 255, 0.03], panel);

  it.each(['fg', 'muted', 'accent'])('keeps --%s readable on a panel over a white canvas', (name) => {
    expect(contrast(token(name), panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(name), card)).toBeGreaterThanOrEqual(4.5);
  });
});
