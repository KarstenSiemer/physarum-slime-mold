import { describe, expect, it } from 'vitest';
import type { EnvEdit } from '../engine/environment';
import { packDrawing, unpackDrawing, type Drawing } from './link';
import { constrain, defaultSettings, defaultStrain, type Settings } from './params';
import { presetById, shapeRevision } from './presets';
import { decodeLink, decodeSettings, encodeLink, encodeSettings } from './url';

/** Bytes or text as a part of the hash: deflate-raw and base64url, as url.ts makes it, but without its limits. */
async function hashPart(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const deflated = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(deflated).arrayBuffer());
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

describe('URL settings', () => {
  it('round-trips settings', async () => {
    const s = defaultSettings();
    s.strains = [defaultStrain(0), { ...defaultStrain(1), sensorOffset: 33, color: '#123456' }];
    s.boundary = 'dish';
    Object.assign(s, { model: 'extended', coveredFood: true, coveredFoodFactor: 0.01, trailSaturation: 40 });
    const encoded = await encodeSettings(s);
    expect(encoded).toMatch(/^[\w-]+$/);
    expect(await decodeSettings(encoded)).toEqual(s);
  });

  // ADR 0025: growth, its values and the capacity travel with the link.
  it('round-trips growth, shrinkage and the capacity', async () => {
    const s = { ...defaultSettings(), collisions: true, density: 0.05, model: 'jones' as const, growth: true };
    Object.assign(s, { capacity: 0.8, growthEvery: 5, growthMax: 15, shrinkEvery: 10, shrinkWindow: 9, shrinkMax: 80 });
    const decoded = await decodeSettings(await encodeSettings(s));
    expect(decoded).toEqual(constrain(s));
    expect(decoded?.growth).toBe(true);
    expect(decoded?.capacity).toBe(0.8);
  });

  // ADR 0026: a link holds the lattice, and a link made before lattices opens on the grid shaped like the screen of
  // its resolution, as it was made.
  it('round-trips the lattice, and opens a link without one on a grid shaped like the screen', async () => {
    const shrinking = presetById('shrinking')?.settings() ?? defaultSettings();
    expect(shrinking.lattice).toEqual([300, 300]);
    expect(await decodeSettings(await encodeSettings(shrinking))).toEqual(shrinking);
    const old: Record<string, unknown> = { ...shrinking };
    delete old.lattice;
    const opened = await decodeSettings(await hashPart(JSON.stringify(old)));
    expect(opened).toEqual({ ...shrinking, lattice: null });
  });

  // ADR 0022: a link made before the model switch holds no model, covered food or trail saturation. It opens with the
  // Jones model if its values fit Jones' rules, and with the extended model else: then it runs as it was made.
  it('opens links made before the model switch with the Jones model only if they fit it', async () => {
    const strip = (s: Settings) => {
      const { model, coveredFood, coveredFoodFactor, trailSaturation, ...old } = s;
      expect([coveredFood, coveredFoodFactor, trailSaturation]).toEqual([false, 0.001, 0]);
      return { model, old };
    };
    const ext = strip({ ...defaultSettings(), scentDecay: 0.01 });
    expect(ext.model).toBe('extended');
    expect(await decodeSettings(await hashPart(JSON.stringify(ext.old)))).toEqual({
      ...defaultSettings(),
      scentDecay: 0.01,
    });
    const network = presetById('network')?.settings();
    if (!network) throw new Error('no preset network');
    const jones = strip(network);
    expect(jones.model).toBe('jones');
    expect(await decodeSettings(await hashPart(JSON.stringify(jones.old)))).toEqual(network);
  });

  // The reviewer's case: Extended, K 30, then back to Jones. A Jones link holds no K.
  it('drops trail saturation from a Jones link', async () => {
    const network = presetById('network')?.settings();
    if (!network) throw new Error('no preset network');
    const s = await decodeSettings(await hashPart(JSON.stringify({ ...network, trailSaturation: 30 })));
    expect(s).toEqual(network);
  });

  it('rejects malformed, oversized and non-base64url input', async () => {
    expect(await decodeSettings('not base64!')).toBeUndefined();
    expect(await decodeSettings('AAAA')).toBeUndefined();
    expect(await decodeSettings('a'.repeat(10_000))).toBeUndefined();
  });

  it('stops a decompression bomb at 64 KiB, also one that would decode', async () => {
    // JSON.parse takes the whitespace after the settings: only the limit on the inflated size refuses the second.
    const json = JSON.stringify(defaultSettings());
    expect(await decodeSettings(await hashPart(json + ' '.repeat(60_000)))).toEqual(defaultSettings());
    const bomb = await hashPart(json + ' '.repeat(5_000_000));
    expect(bomb.length).toBeLessThan(8192);
    expect(await decodeSettings(bomb)).toBeUndefined();
  });

  it('sanitizes hostile values', async () => {
    const hostile = { ...defaultSettings(), density: 1e9, strains: [{ color: 'javascript:alert(1)' }] };
    const encoded = await encodeSettings(hostile as never);
    const s = await decodeSettings(encoded);
    expect(s?.density).toBe(8);
    expect(s?.strains[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

/** A seeded random source, so a failure repeats (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const maze = presetById('maze');
const mazeShapes = maze?.env?.map(() => true) ?? [];
const dab = (x: number, y: number, kind: EnvEdit['kind'] = 'food'): EnvEdit => ({
  kind,
  from: [x, y],
  to: [x, y],
  radius: 3,
  grid: [512, 320],
  boundary: 'box',
});

describe('URL links with food, light and walls', () => {
  it('round-trip the settings, the scene, its shapes and the strokes', async () => {
    const s = maze?.settings() ?? defaultSettings();
    const drag: EnvEdit = { ...dab(10, 10, 'wall'), to: [40.5, 12.25] };
    const drawings: Drawing[] = [
      { scene: 'maze', revision: 0, origins: [0], shapes: mazeShapes, strokes: [] },
      {
        scene: 'maze',
        revision: 0,
        origins: [-1],
        shapes: mazeShapes.map((_, i) => i > 0),
        strokes: [dab(100, 50), drag],
      },
      { scene: '', revision: 0, origins: [], shapes: [], strokes: [dab(1, 2, 'erase')] },
    ];
    for (const d of drawings) {
      const { hash, dropped } = await encodeLink(s, d);
      expect(dropped).toBe(false);
      expect(hash).toMatch(/^s=[\w-]+&e=[\w-]+$/);
      expect(await decodeLink(hash)).toEqual({ settings: s, drawing: d });
    }
    // Without a scene and strokes, the link holds the settings alone, as links did before.
    const plain = await encodeLink(s, { scene: '', revision: 0, origins: [], shapes: [], strokes: [] });
    expect(plain).toEqual({ hash: `s=${await encodeSettings(s)}`, dropped: false });
    expect(await decodeLink(plain.hash)).toEqual({ settings: s });
  });

  // ADR 0027 (owner, 2026-11-12): a link from before the step orders gets the order of its scene's paper, and one
  // without a scene, or with a scene this app does not know, senses first as the code before did. A link that names
  // its order keeps it.
  it("give a link without a step order its scene's order, and sense first without a scene", async () => {
    // A link of `scene` with its newest shapes, from before the step orders: its settings hold no step order.
    const old = async (scene: string, settings: Settings) => {
      const { stepOrder: _, ...raw } = settings;
      const p = presetById(scene);
      const drawing = p && { scene, revision: shapeRevision(p), origins: [0], shapes: (p.env ?? []).map(() => true) };
      const bytes = packDrawing({ scene: '', revision: 0, origins: [], shapes: [], ...drawing, strokes: [] });
      const e = scene && bytes ? `&e=${await hashPart(bytes)}` : '';
      const link = await decodeLink(`s=${await hashPart(JSON.stringify(raw))}${e}`);
      return [link?.drawing?.scene ?? '', link?.settings.stepOrder];
    };
    const scene = (id: string) => presetById(id)?.settings() ?? defaultSettings();
    for (const id of ['network', 'shortest-path', 'steiner', 'wound'])
      expect(await old(id, scene(id)), id).toEqual([id, 'move-first']);
    for (const id of ['three-strains', 'maze', 'foraging-maze', 'dunes'])
      expect(await old(id, scene(id)), id).toEqual([id, 'sense-first']);
    // Without a scene, or with one this app does not know (the drawing is lost), sense first.
    expect(await old('', scene('network'))).toEqual(['', 'sense-first']);
    expect(await old('', defaultSettings())).toEqual(['', 'sense-first']);
    // A link that names its order keeps it, whatever its scene.
    for (const stepOrder of ['move-first', 'sense-first'] as const) {
      const d = { scene: 'network', revision: 0, origins: [0], shapes: [], strokes: [] };
      const { hash } = await encodeLink({ ...scene('maze'), stepOrder }, d);
      expect((await decodeLink(hash))?.settings.stepOrder).toBe(stepOrder);
    }
  });

  it('still open links with settings only', async () => {
    const s = { ...defaultSettings(), boundary: 'dish' as const };
    expect(await decodeLink(`s=${await encodeSettings(s)}`)).toEqual({ settings: s });
  });

  it('keep the settings and the scene without a part of a drawing that is too large', async () => {
    const r = random(5);
    // Dabs at random places on a large grid do not compress: about 4,000 do not fit in 8,192 characters.
    const strokes = Array.from({ length: 4000 }, () => ({
      ...dab(Math.floor(r() * 4096 * 16) / 16, Math.floor(r() * 2304 * 16) / 16),
      grid: [4096, 2304] as [number, number],
    }));
    const s = maze?.settings() ?? defaultSettings();
    const { hash, dropped } = await encodeLink(s, {
      scene: 'maze',
      revision: 0,
      origins: [0],
      shapes: mazeShapes,
      strokes,
    });
    expect(dropped).toBe(true);
    expect(hash.length).toBeLessThanOrEqual(8192);
    expect(await decodeLink(hash)).toEqual({
      settings: s,
      drawing: { scene: 'maze', revision: 0, origins: [0], shapes: mazeShapes, strokes: [] },
    });
    // Without a scene, the settings alone.
    const none = await encodeLink(s, { scene: '', revision: 0, origins: [], shapes: [], strokes });
    expect(none).toEqual({ hash: `s=${await encodeSettings(s)}`, dropped: true });
    // 4,096 strokes of 16 bytes each, which compress well: the receiver would refuse more than 64 KiB inflated.
    const far = Array.from({ length: 4096 }, (_, i): EnvEdit => {
      const at = i % 2 ? 1e6 : -1e6;
      return {
        ...dab(at, at),
        to: [at + 1, at],
        radius: i % 2 ? 0.8125 : 0.75,
        grid: i % 2 ? [4095, 4095] : [4096, 4096],
      };
    });
    expect((await encodeLink(s, { scene: '', revision: 0, origins: [], shapes: [], strokes: far })).dropped).toBe(true);
    // A list that cannot go in a link at all (a value off the steps) is dropped the same way, without an error.
    const off = await encodeLink(s, {
      scene: 'maze',
      revision: 0,
      origins: [0],
      shapes: mazeShapes,
      strokes: [dab(NaN, 1)],
    });
    expect(off.dropped).toBe(true);
  });

  it('fill the hash up to its 8,192 characters, and the longest link opens exactly', async () => {
    const s = maze?.settings() ?? defaultSettings();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = random(seed);
      // Dabs and short drags at random places on the Maze's grid: a few characters each, far below the caps.
      const strokes = Array.from({ length: 4096 }, (): EnvEdit => {
        const at: [number, number] = [Math.floor(r() * 512 * 16) / 16, Math.floor(r() * 288 * 16) / 16];
        const to: [number, number] = r() < 0.5 ? [at[0] + 3, at[1] + 1.5] : at;
        return { ...dab(...at), to, radius: 3 + (seed % 3), grid: [512, 288] };
      });
      const drawing = (n: number) => ({
        scene: 'maze',
        revision: 0,
        origins: [0],
        shapes: mazeShapes,
        strokes: strokes.slice(0, n),
      });
      let [fits, over] = [0, strokes.length];
      expect((await encodeLink(s, drawing(over))).dropped).toBe(true);
      while (over - fits > 1) {
        const mid = (fits + over) >> 1;
        if ((await encodeLink(s, drawing(mid))).dropped) over = mid;
        else fits = mid;
      }
      const { hash } = await encodeLink(s, drawing(fits));
      expect(hash.length, `seed ${seed}`).toBeLessThanOrEqual(8192);
      expect(hash.length, `seed ${seed}`).toBeGreaterThan(8192 - 64);
      expect(await decodeLink(hash)).toEqual({ settings: s, drawing: drawing(fits) });
    }
  });

  it('refuse a drawing that inflates to more than 64 KiB, even a valid one', async () => {
    // 4,096 strokes of 16 bytes each, far apart, on two grids: within the caps, and 4 bytes above 64 KiB.
    const strokes = Array.from({ length: 4096 }, (_, i): EnvEdit => {
      const at = i % 2 ? 1e6 : -1e6;
      return {
        ...dab(at, at),
        to: [at + 1, at],
        radius: i % 2 ? 0.8125 : 0.75,
        grid: i % 2 ? [4095, 4095] : [4096, 4096],
      };
    });
    const bytes = packDrawing({ scene: '', revision: 0, origins: [], shapes: [], strokes }) ?? new Uint8Array();
    expect(bytes.length).toBeGreaterThan(64 * 1024);
    expect(unpackDrawing(bytes)?.strokes).toHaveLength(4096);
    const s = defaultSettings();
    const hash = `s=${await encodeSettings(s)}&e=${await hashPart(bytes)}`;
    expect(hash.length).toBeLessThan(8192);
    expect(await decodeLink(hash)).toEqual({ settings: s, drawingLost: true });
    // A bomb in the drawing part: the settings alone.
    const bomb = `s=${await encodeSettings(s)}&e=${await hashPart(new Uint8Array(4 * 1024 * 1024))}`;
    expect(bomb.length).toBeLessThan(8192);
    expect(await decodeLink(bomb)).toEqual({ settings: s, drawingLost: true });
  });

  it('give each strain no scene role when the origins do not match the strains', async () => {
    const s = { ...defaultSettings(), strains: [defaultStrain(0), defaultStrain(1)] };
    const { hash } = await encodeLink(s, { scene: 'maze', revision: 0, origins: [0], shapes: mazeShapes, strokes: [] });
    expect((await decodeLink(hash))?.drawing?.origins).toEqual([-1, -1]);
  });

  it('decode hostile hashes without throwing: settings or nothing, and a drawing only when it is valid', async () => {
    const s = maze?.settings() ?? defaultSettings();
    const good = await encodeLink(s, {
      scene: 'maze',
      revision: 0,
      origins: [0],
      shapes: mazeShapes,
      strokes: [dab(100, 50), { ...dab(30, 40, 'light'), boundary: 'wrap' }],
    });
    const r = random(6);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=&%.';
    const results: (Awaited<ReturnType<typeof decodeLink>> | 'threw')[] = [];
    const tryDecode = async (hash: string) => {
      results.push(await decodeLink(hash).catch(() => 'threw' as const));
    };
    for (let i = 0; i < 200; i++) {
      await tryDecode(
        Array.from({ length: Math.floor(r() * 200) }, () => alphabet[Math.floor(r() * alphabet.length)]).join(''),
      );
    }
    for (let n = 0; n < good.hash.length; n += 3) await tryDecode(good.hash.slice(0, n));
    for (let i = 0; i < 200; i++) {
      const chars = good.hash.split(''); // base64url and '&', '=': ASCII only
      chars[Math.floor(r() * chars.length)] = alphabet[Math.floor(r() * 64)] ?? 'A';
      await tryDecode(chars.join(''));
    }
    expect(results).not.toContain('threw');
    for (const link of results) {
      if (!link || link === 'threw' || !link.drawing) continue;
      expect(presetById(link.drawing.scene)?.id ?? '').toBe(link.drawing.scene);
      for (const e of link.drawing.strokes)
        for (const v of [...e.from, ...e.to, e.radius]) expect(Number.isFinite(v)).toBe(true);
    }
    // The settings part alone still loads when the drawing part is broken, and the link says it lost its drawing.
    const [settingsPart = ''] = good.hash.split('&');
    expect(await decodeLink(`${settingsPart}&e=AAAA`)).toEqual({ settings: s, drawingLost: true });
    expect(await decodeLink(`${settingsPart}&e=`)).toEqual({ settings: s, drawingLost: true });
    // Too long, or no settings.
    expect(await decodeLink(`${good.hash}&x=${'A'.repeat(8192)}`)).toBeUndefined();
    expect(await decodeLink(good.hash.split('&')[1] ?? '')).toBeUndefined();
  });

  it('sanitize settings with NaN, Infinity and prototype keys, and leave Object.prototype alone', async () => {
    const json =
      '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"density":1e999,"speed":"NaN"}';
    const link = await decodeLink(`__proto__=x&constructor=y&s=${await hashPart(json)}`);
    expect(link?.settings.density).toBe(defaultSettings().density);
    expect(link?.settings.speed).toBe(defaultSettings().speed);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(link?.drawing).toBeUndefined();
  });
});

// Owner rule of 2026-11-11 (ADR 0022): a link from before the model switch opens as Jones only if the Jones model runs
// it as it was made, and a link that claims Jones cannot run rules that are not Jones' under that label.
describe('URL links and the model', () => {
  const network = presetById('network')?.settings() ?? defaultSettings();
  const spots = presetById('spots')?.settings() ?? defaultSettings();
  /** A link made before the model switch: no model, covered food or trail saturation, and food weighed +1. */
  const before = (s: Settings, patch: Partial<Settings> = {}) => {
    const { model: _, coveredFood: __, coveredFoodFactor: ___, trailSaturation: ____, ...old } = { ...s, ...patch };
    return { ...old, strains: old.strains.map((st) => ({ ...st, food: 1 })) } as unknown as Settings;
  };
  const open = async (s: Settings, strokes: EnvEdit[] = [], scene = '') => {
    const p = presetById(scene);
    const shapes = p?.env?.map(() => true) ?? [];
    const revision = p ? shapeRevision(p) : 0;
    const origins = scene ? s.strains.map((_, i) => i) : [];
    const { hash } = await encodeLink(s, { scene, revision, origins, shapes, strokes });
    const link = await decodeLink(hash);
    if (!link) throw new Error('no link');
    return link.settings;
  };
  const wrap = (kind: EnvEdit['kind']): EnvEdit => ({ ...dab(30, 40, kind), boundary: 'wrap' });

  it('from before the switch open as Jones when the Jones model runs them as they were made', async () => {
    expect(await open(before(network))).toEqual(network);
    expect(await open(before(network), [wrap('food')], 'network')).toEqual(network);
    // Light without an effect, and a trail decay of its own without food: the scent is 0, and Jones binds it.
    expect((await open(before(network, { lightStrength: 0 }), [wrap('light')])).model).toBe('jones');
    const slow = await open(before(network, { strains: [{ ...network.strains[0], decay: 0.05 } as never] }));
    expect([slow.model, slow.scentDecay]).toEqual(['jones', 0.05]);
    // Chemorepulsion without food: Jones weighs food as the own trail, −1, and the run has no food.
    expect(await open(before(spots), [], 'spots')).toEqual(spots);
    expect((await open(before(spots), [wrap('erase')], 'spots')).model).toBe('jones');
  });

  it('from before the switch open as Extended when the Jones model would run them otherwise', async () => {
    const extended = async (s: Settings, strokes: EnvEdit[] = [], scene = '') => (await open(s, strokes, scene)).model;
    // Walls: only the extended model's sensors check walls on their way (ADR 0020). The Maze has walls.
    expect(await extended(before(network), [wrap('wall')])).toBe('extended');
    expect(await extended(before(presetById('maze')?.settings() ?? network), [], 'maze')).toBe('extended');
    // Light with an effect: Fleeing light, and light painted on a scene of Jones.
    expect(await extended(before(presetById('light')?.settings() ?? network), [], 'light')).toBe('extended');
    expect(await extended(before(network), [wrap('light')], 'network')).toBe('extended');
    // Food with a scent decay of its own, or weighed other than the own trail.
    expect(await extended(before(network, { scentDecay: 0.01 }), [wrap('food')], 'network')).toBe('extended');
    expect(await extended(before(spots), [wrap('food')], 'spots')).toBe('extended');
    // Values that the Jones model does not have.
    for (const patch of [{ collisions: false }, { diffusion: 0 }, { diffusion: 2 }])
      expect(await extended(before(network, patch)), JSON.stringify(patch)).toBe('extended');
    // No link before the switch held K, but a link without a model can.
    expect(await extended({ ...before(network), trailSaturation: 30 })).toBe('extended');
    const own = (w: number) => ({ strains: [{ ...network.strains[0], attraction: [w, 0, 0, 0] } as never] });
    expect(await extended(before(network, own(0.5)))).toBe('extended');
    expect(await extended(before(network, own(-0.5)))).toBe('extended');
    // And it runs as it was made: the extended model keeps the values.
    const kept = await open(before(network, { scentDecay: 0.01 }), [wrap('food')], 'network');
    expect([kept.scentDecay, kept.strains[0]?.food]).toEqual([0.01, 1]);
  });

  it('that claims Jones runs Jones’ rules only: Extended for what changes the run, Jones’ values for the rest', async () => {
    const claims = (patch: Record<string, unknown>) => open({ ...network, ...patch });
    for (const patch of [
      { strains: [network.strains[0], defaultStrain(1)] },
      { collisions: false },
      { diffusion: 0 },
      { diffusion: 2 },
      { strains: [{ ...network.strains[0], attraction: [0.5, 0, 0, 0] }] },
    ])
      expect((await claims(patch)).model, JSON.stringify(patch)).toBe('extended');
    const bound = await claims({
      trailSaturation: 30,
      lightStrength: 0.3,
      scentDecay: 0.01,
      strains: [{ ...network.strains[0], attraction: [-1, 0, 0, 0], food: 0.4, light: 2, share: 0.5 }],
    });
    expect(bound).toEqual({ ...network, strains: [{ ...network.strains[0], attraction: [-1, 0, 0, 0], food: -1 }] });
    // Its walls and light stay drawn: Jones' obstacles, and light without an effect (packParams()).
    expect((await open(network, [wrap('wall'), wrap('light')])).model).toBe('jones');
  });

  it('keeps a scent decay that the Jones model bound below 0.001 in the extended model', async () => {
    const strain = { ...defaultStrain(0), decay: 0.0005 };
    const s = { ...network, model: 'extended' as const, scentDecay: 0.0005, strains: [strain] };
    expect(await open(s)).toEqual(s);
  });
});
