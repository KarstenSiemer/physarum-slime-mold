import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAID_KEY } from '../paid';
import { PUSH } from '../territory';
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

/** The lines of the `//#else` branches of the blocks of `name` in `source`: the lines that the name replaces. */
function elseLines(source: string, name: string): Set<string> {
  const out = new Set<string>();
  const open: { mine: boolean; other: boolean }[] = [];
  for (const line of source.split('\n')) {
    const mark = /^\s*\/\/#(if|else|endif)\b\s*(\w*)/.exec(line);
    if (mark?.[1] === 'if') open.push({ mine: mark[2] === name, other: false });
    else if (mark?.[1] === 'else') {
      const top = open.at(-1);
      if (top) top.other = true;
    } else if (mark?.[1] === 'endif') open.pop();
    else if (open.some((b) => b.mine && b.other)) out.add(line);
  }
  return out;
}

/** Whether every line of `less`, but those of `skip`, is a line of `more`, in the same order. */
function inOrder(less: string, more: string, skip = new Set<string>()) {
  const kept = more.split('\n');
  let i = 0;
  for (const line of less.split('\n')) {
    if (skip.has(line)) continue;
    while (i < kept.length && kept[i] !== line) i++;
    expect(i, line).toBeLessThan(kept.length);
    i++;
  }
}

// The passes that the territory changes (ADR 0068). Its lines come only with those of the flow, and without them each
// source is the one of the code before: with the flow alone, and without the flow. They add lines to the source of
// the flow, and replace only the lines after a `//#else` of TERRITORY: in agents.wgsl the name of the sensor of the
// flow, which the drift wraps (ADR 0070).
describe.each(['./agents.wgsl', './growth.wgsl'])('the territory in %s', (path) => {
  const source = read(path);

  it('is in the source only with the name TERRITORY, and adds lines to the source of the flow', () => {
    const [flow, both] = [variant(source, ['FLOW']), variant(source, ['FLOW', 'TERRITORY'])];
    for (const off of [variant(source), flow]) expect(off.includes('territory')).toBe(false);
    expect(both.includes('var territory: texture_2d<u32>;')).toBe(true);
    const replaced = elseLines(source, 'TERRITORY');
    expect(replaced.size).toBe(path === './agents.wgsl' ? 1 : 0);
    inOrder(flow, both, replaced);
  });
});

// The flow takes the sinks while the rules of stage 4 run (ADR 0070): without them the source of the flow is the one
// of the code before, and with them it only adds lines.
describe('the rules of stage 4 in flow.wgsl', () => {
  const source = read('./flow.wgsl');

  it('are in the source only with the name TERRITORY, and add lines to it', () => {
    const [off, on] = [variant(source), variant(source, ['TERRITORY'])];
    for (const word of ['sinksAndSources', 'states', 'rates', 'U.take'])
      expect(off.includes(word), `${word} without the rules`).toBe(false);
    for (const word of ['sinksAndSources', 'var<storage, read> states', 'var<storage, read> rates', 'take: vec4f'])
      expect(on.includes(word), word).toBe(true);
    expect(elseLines(source, 'TERRITORY').size).toBe(0);
    inOrder(off, on);
  });
});

describe('the random streams of the agent passes', () => {
  const streams = (path: string, pattern: RegExp) =>
    [...read(path).matchAll(pattern)].map((m) => [m[1] ?? '', Number(m[2])] as const);

  it('gives every draw of the flow a stream of its own, in WGSL and in GLSL', () => {
    const wgsl = [
      ...streams('./agents.wgsl', /^const (STEER|TOOL|SHRINK|BLOCK|STARVE|RESPAWN) = (\d+)u;/gm),
      ...streams('./growth.wgsl', /^const (GROW|BIRTH|PLACE_ORDER|SHADE|PAID_KEY) = (\d+)u;/gm),
      ...streams('./territory.wgsl', /^const (PUSH) = (\d+)u;/gm),
    ];
    expect(wgsl.map(([name]) => name).sort()).toEqual(
      [
        'BIRTH',
        'BLOCK',
        'GROW',
        'PAID_KEY',
        'PLACE_ORDER',
        'PUSH',
        'RESPAWN',
        'SHADE',
        'SHRINK',
        'STARVE',
        'STEER',
        'TOOL',
      ].sort(),
    );
    expect(new Set(wgsl.map(([, n]) => n)).size).toBe(wgsl.length);
    const glsl = [
      ...streams('../gl/glsl/tools.glsl', /^const uint (STEER|TOOL|SHRINK|BLOCK|STARVE|RESPAWN) = (\d+)u;/gm),
      ...streams('../gl/glsl/growth.glsl', /^const uint (GROW|BIRTH|PLACE_ORDER|SHADE|PAID_KEY) = (\d+)u;/gm),
      ...streams('../gl/glsl/territory.frag', /^const uint (PUSH) = (\d+)u;/gm),
    ];
    expect(Object.fromEntries(glsl)).toEqual(Object.fromEntries(wgsl));
    // The start draws from the streams 7 + round · 65536 (init.wgsl, init.frag): no draw of a step uses one of them.
    // With stream 7, the draw of starvation in step 0 was the first draw of the agent's start (review of 2026-11-13).
    for (const [name, n] of wgsl) expect(n % 0x10000, name).not.toBe(7);
    // The push of strain s draws from PUSH + 65536 · s (ADR 0068): below 65536 it is no other stream, so none of the
    // four streams is another stream or one of the start. The CPU copy takes its number from territory.ts. The key of
    // a paid birth draws from PAID_KEY (ADR 0071), which is no stream of the push: the CPU copy takes it from paid.ts.
    expect(Object.fromEntries(wgsl).PUSH).toBe(PUSH);
    expect(Object.fromEntries(wgsl).PAID_KEY).toBe(PAID_KEY);
    expect(PAID_KEY % 0x10000).not.toBe(PUSH);
  });

  it('seeds every draw of a shader with a named stream, and the start with its own streams', () => {
    const names = [
      'BIRTH',
      'BLOCK',
      'GROW',
      'PAID_KEY',
      'PLACE_ORDER',
      'RESPAWN',
      'SHADE',
      'SHRINK',
      'STARVE',
      'STEER',
      'TOOL',
    ];
    // The push of the territory names its stream with the strain (ADR 0068).
    names.push('PUSH + 0x10000u * s');
    const calls = (dir: string) =>
      readdirSync(new URL(dir, import.meta.url))
        .filter((f) => /\.(wgsl|glsl|frag|vert)$/.test(f))
        .flatMap((f) =>
          [...read(dir + f).matchAll(/^(?!\s*(?:fn|uint) rngSeed).*\brngSeed\([^,]+,\s*([^)]+)\)/gm)].map(
            (m) => [f, (m[1] ?? '').trim()] as const,
          ),
        );
    const all = [...calls('./'), ...calls('../gl/glsl/')];
    // Both backends draw in the same places: 15 calls each (agents, growth, the start, the push of the territory, and
    // the key and the cell of a child of the births that the flux pays).
    expect(all.length).toBe(30);
    for (const [file, stream] of all) {
      if (file.startsWith('init.')) expect(stream, file).toBe('7u + round * 0x10000u');
      else expect(names, `${file}: ${stream}`).toContain(stream);
    }
  });
});
