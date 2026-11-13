import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { variant } from './variant';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('variant', () => {
  const source = ['a', '//#if FLOW', 'b', '//#else', 'c', '//#endif', 'd'].join('\n');

  it('keeps the lines of a block only while its name is on, and never a marker line', () => {
    expect(variant(source)).toBe('a\nc\nd');
    expect(variant(source, ['FLOW'])).toBe('a\nb\nd');
    expect(variant(source, ['OTHER'])).toBe('a\nc\nd');
  });

  it('returns a source without markers as it is, character for character', () => {
    const plain = 'fn f() {\n  return;\n}\n\n// #if is no marker\n';
    expect(variant(plain)).toBe(plain);
    expect(variant(plain, ['FLOW'])).toBe(plain);
  });

  it('takes a marker after spaces, and blocks inside blocks', () => {
    const nested = ['  //#if A', 'a', '  //#if B', 'ab', '  //#endif', '//#else', 'none', '//#endif'].join('\n');
    expect(variant(nested)).toBe('none');
    expect(variant(nested, ['A'])).toBe('a');
    expect(variant(nested, ['A', 'B'])).toBe('a\nab');
    // A block inside a block that is off stays off.
    expect(variant(nested, ['B'])).toBe('none');
  });

  it('refuses markers that do not pair', () => {
    expect(() => variant('//#if A\na')).toThrow('without //#endif');
    expect(() => variant('a\n//#endif')).toThrow('without //#if');
    expect(() => variant('a\n//#else\nb')).toThrow('without //#if');
  });
});

// The passes that the flow in the tubes changes (ADR 0029). Without the flow their source has none of its lines: the
// passes of every scene without the flow compile from the source of the code before.
describe.each(['./agents.wgsl', './growth.wgsl'])('the flow in %s', (path) => {
  const source = read(path);

  it('is in the source only with the name FLOW', () => {
    const [off, on] = [variant(source), variant(source, ['FLOW'])];
    const marker = /^\s*\/\/#/m;
    for (const word of ['flowMemory', 'FlowRule', 'FLOW'])
      expect(off.includes(word), `${word} without the flow`).toBe(false);
    expect(marker.test(off)).toBe(false);
    expect(on.includes('flowMemory')).toBe(true);
    expect(on.includes('FlowRule')).toBe(true);
    expect(marker.test(on)).toBe(false);
    expect(on.length).toBeGreaterThan(off.length);
  });

  it('adds lines and changes none: every line without the flow is a line with the flow, in the same order', () => {
    const on = variant(source, ['FLOW']).split('\n');
    const kept = source.split('\n').filter((l) => !/^\s*\/\/#/.test(l));
    // The lines of the source without its markers: with the flow, less the lines after `//#else`.
    let i = 0;
    for (const line of on) {
      while (i < kept.length && kept[i] !== line) i++;
      expect(i, line).toBeLessThan(kept.length);
      i++;
    }
  });
});

describe('the random streams of the agent passes', () => {
  const streams = (path: string, pattern: RegExp) =>
    [...read(path).matchAll(pattern)].map((m) => [m[1] ?? '', Number(m[2])] as const);

  it('gives every draw of the flow a stream of its own, in WGSL and in GLSL', () => {
    const wgsl = [
      ...streams('./agents.wgsl', /^const (STEER|TOOL|SHRINK|BLOCK|STARVE|RESPAWN) = (\d+)u;/gm),
      ...streams('./growth.wgsl', /^const (GROW|BIRTH|PLACE_ORDER) = (\d+)u;/gm),
    ];
    expect(wgsl.map(([name]) => name).sort()).toEqual(
      ['BIRTH', 'BLOCK', 'GROW', 'PLACE_ORDER', 'RESPAWN', 'SHRINK', 'STARVE', 'STEER', 'TOOL'].sort(),
    );
    expect(new Set(wgsl.map(([, n]) => n)).size).toBe(wgsl.length);
    const glsl = [
      ...streams('../gl/glsl/tools.glsl', /^const uint (STEER|TOOL|SHRINK|BLOCK|STARVE|RESPAWN) = (\d+)u;/gm),
      ...streams('../gl/glsl/growth.glsl', /^const uint (GROW|BIRTH|PLACE_ORDER) = (\d+)u;/gm),
    ];
    expect(Object.fromEntries(glsl)).toEqual(Object.fromEntries(wgsl));
    // The start draws from the streams 7 + round · 65536 (init.wgsl, init.frag): no draw of a step uses one of them.
    // With stream 7, the draw of starvation in step 0 was the first draw of the agent's start (review of 2026-11-13).
    for (const [name, n] of wgsl) expect(n % 0x10000, name).not.toBe(7);
  });

  it('seeds every draw of a shader with a named stream, and the start with its own streams', () => {
    const names = ['BIRTH', 'BLOCK', 'GROW', 'PLACE_ORDER', 'RESPAWN', 'SHRINK', 'STARVE', 'STEER', 'TOOL'];
    const calls = (dir: string) =>
      readdirSync(new URL(dir, import.meta.url))
        .filter((f) => /\.(wgsl|glsl|frag|vert)$/.test(f))
        .flatMap((f) =>
          [...read(dir + f).matchAll(/^(?!\s*(?:fn|uint) rngSeed).*\brngSeed\([^,]+,\s*([^)]+)\)/gm)].map(
            (m) => [f, (m[1] ?? '').trim()] as const,
          ),
        );
    const all = [...calls('./'), ...calls('../gl/glsl/')];
    // Both backends draw in the same places: 11 calls each (agents, growth, the start).
    expect(all.length).toBe(22);
    for (const [file, stream] of all) {
      if (file.startsWith('init.')) expect(stream, file).toBe('7u + round * 0x10000u');
      else expect(names, `${file}: ${stream}`).toContain(stream);
    }
  });
});
