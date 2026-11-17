import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hexToLinear } from '../model/color';
import { defaultSettings, STYLES, type Settings } from '../model/params';
import { BACKGROUND, packView, SLIME_BEAD, SLIME_LOOK, SLIME_RELIEF, VIEW_BYTES } from './render';
import { slimeSteps } from './slime';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The members of a block of `source` between `open` and its closing brace, with the 4-byte words that each takes. */
function members(source: string, open: RegExp, member: RegExp): [name: string, words: number][] {
  const body = open.exec(source)?.[1] ?? '';
  const words: Record<string, number> = { f32: 1, u32: 1, float: 1, uint: 1, vec2f: 2, vec2: 2 };
  return [...body.matchAll(member)].map((m) => {
    const [type = '', name = '', count] = [m.groups?.type, m.groups?.name, m.groups?.count];
    return [name, (words[type] ?? 4) * Number(count ?? 1)];
  });
}

describe('the uniform of the view', () => {
  // `struct View` of render.wgsl is the std140 block `View` of the WebGL2 renderer, and packView() fills both.
  it('has the same members in render.wgsl and in view.glsl, and as many bytes as packView() fills', () => {
    const wgsl = members(
      read('./shaders/render.wgsl'),
      /struct View \{([\s\S]*?)\n\}/,
      /^\s*(?<name>\w+): (?:array<)?(?<type>\w+)(?:, (?<count>\d+)>)?,/gm,
    );
    const glsl = members(
      read('./gl/glsl/view.glsl'),
      /uniform View \{([\s\S]*?)\n\} V;/,
      /^\s*(?<type>\w+) (?<name>\w+)(?:\[(?<count>\d+)\])?;/gm,
    );
    expect(wgsl.map(([name]) => name)).toEqual(glsl.map(([name]) => name));
    expect(wgsl.map(([, words]) => words)).toEqual(glsl.map(([, words]) => words));
    expect(wgsl.reduce((sum, [, words]) => sum + words, 0) * 4).toBe(VIEW_BYTES);
    // The slime comes after every member of the code before, so no pass of the code before reads another value.
    expect(wgsl.slice(-3)).toEqual([
      ['slime', 4],
      ['slimeFx', 4],
      ['slimeLight', 4],
    ]);
    expect(VIEW_BYTES).toBe(272);
  });
});

// ADR 0055, decision 8, and ADR 0057: the film of the slime in the uniform of the view.
describe('the film of the slime in the uniform of the view', () => {
  const view = { center: [32, 24] as [number, number], scale: 1 };
  const pack = (settings: Settings, slime?: number) => {
    const data = new ArrayBuffer(VIEW_BYTES);
    packView(data, 64, 48, view, 1, 0, settings, 0, true, false, 0, undefined, false, slime);
    return data;
  };
  /** `slime`: the steps that ran so far, the life time in steps, 2 unused. */
  const steps = (data: ArrayBuffer) => [...new Uint32Array(data).slice(56, 60)];
  /** `slimeFx`: the colour of the body of the film and how much of it full slime shows. */
  const body = (data: ArrayBuffer) => [...new Float32Array(data).slice(60, 64)];
  /** `slimeLight`: the highlight, the wide light, the height of the relief and the height of the beads. */
  const light = (data: ArrayBuffer) => [...new Float32Array(data).slice(64, 68)];

  it('holds the steps that ran so far and the life time in steps as unsigned integers', () => {
    const d = defaultSettings();
    expect(steps(pack(d, 0))).toEqual([0, 259_200, 0, 0]);
    expect(steps(pack(d, 12_345))).toEqual([12_345, 259_200, 0, 0]);
    expect(steps(pack({ ...d, slimeLife: 18 }, 7))).toEqual([7, 32_400, 0, 0]);
    // A float holds whole numbers up to 2^24 only: the count of the steps stays exact above it.
    expect(steps(pack(d, 2 ** 24 + 1))).toEqual([2 ** 24 + 1, 259_200, 0, 0]);
    expect(steps(pack(d, 2 ** 32 - 1))).toEqual([2 ** 32 - 1, 259_200, 0, 0]);
    // The count wraps as the count of the passes does.
    expect(steps(pack(d, 2 ** 32 + 5))).toEqual([5, 259_200, 0, 0]);
  });

  it('holds a life time of 0 for a frame without the film', () => {
    const d = defaultSettings();
    expect(steps(pack(d))).toEqual([0, 0, 0, 0]);
    expect(steps(pack({ ...d, model: 'jones' }, 9))).toEqual([9, slimeSteps({ ...d, model: 'jones' }), 0, 0]);
    expect(steps(pack({ ...d, slimeLife: 0 }, 9))).toEqual([9, 0, 0, 0]);
  });

  it('holds the colour of the body of the film of the style, and how much of it full slime shows', () => {
    for (const style of STYLES) {
      const look = SLIME_LOOK[style];
      const want = [...hexToLinear(look.color), look.body].map(Math.fround);
      expect(body(pack({ ...defaultSettings(), style }, 3))).toEqual(want);
      expect(body(pack({ ...defaultSettings(), style }))).toEqual(want);
    }
    // The glow style: #c4d7ce in linear light, and 0.075 of it.
    const [r, g, b, share] = body(pack({ ...defaultSettings(), style: 'glow' }, 3));
    expect([r, g, b].map((v) => Math.round((v ?? 0) * 1000) / 1000)).toEqual([0.552, 0.68, 0.617]);
    expect(share).toBe(Math.fround(0.075));
  });

  it('holds the highlight and the wide light of the style, the height of the relief and the height of the beads', () => {
    for (const style of STYLES) {
      const look = SLIME_LOOK[style];
      const want = [look.gloss, look.wide, SLIME_RELIEF, SLIME_BEAD].map(Math.fround);
      expect(light(pack({ ...defaultSettings(), style }, 3))).toEqual(want);
      expect(light(pack({ ...defaultSettings(), style }))).toEqual(want);
    }
    expect([SLIME_RELIEF, SLIME_BEAD]).toEqual([2.5, 0.11]);
    expect(light(pack({ ...defaultSettings(), style: 'paper' }, 3))).toEqual([0.7, 0.35, 2.5, 0.11].map(Math.fround));
  });

  it('leaves every other value of the uniform as it is', () => {
    const d = defaultSettings();
    const before = (data: ArrayBuffer) => new Uint8Array(data).slice(0, 56 * 4);
    expect(before(pack(d, 77))).toEqual(before(pack(d)));
    expect(before(pack({ ...d, showSlime: false }, 77))).toEqual(before(pack(d)));
    // The slime fills the block to its end: 3 members of 16 bytes.
    expect(68 * 4).toBe(VIEW_BYTES);
  });

  // One pale colour: little colour, and a lightness that stands out from the ground of the style. A share above 0
  // and far below 1 of it shows, so a tube stays much stronger than the film.
  it('has a pale colour that stands out from the ground of each style, and lights that stay weak', () => {
    const luma = (hex: string) => {
      const [r, g, b] = hexToLinear(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const style of STYLES) {
      const { color, body: share, gloss, wide } = SLIME_LOOK[style];
      const [r, g, b] = hexToLinear(color);
      // Little colour: the channels lie close together.
      expect((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b), style).toBeLessThan(0.35);
      expect(share, style).toBeGreaterThan(0);
      expect(share, style).toBeLessThanOrEqual(0.5);
      const ground = luma(BACKGROUND[style]);
      // Lighter than a dark ground, darker than paper.
      if (style === 'paper') expect(luma(color), style).toBeLessThan(ground);
      else expect(luma(color), style).toBeGreaterThan(ground);
      // The highlight is below white, and the wide light is weaker than the highlight.
      expect(gloss, style).toBeGreaterThan(0);
      expect(gloss, style).toBeLessThan(1);
      expect(wide, style).toBeGreaterThan(0);
      expect(wide, style).toBeLessThan(gloss);
    }
    // The agents style has the film of the glow style.
    expect(SLIME_LOOK.agents).toEqual(SLIME_LOOK.glow);
  });
});
