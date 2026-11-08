import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain } from './params';
import { decodeSettings, encodeSettings } from './url';

describe('URL settings', () => {
  it('round-trips settings', async () => {
    const s = defaultSettings();
    s.strains = [defaultStrain(0), { ...defaultStrain(1), sensorOffset: 33, color: '#123456' }];
    s.boundary = 'dish';
    const encoded = await encodeSettings(s);
    expect(encoded).toMatch(/^[\w-]+$/);
    expect(await decodeSettings(encoded)).toEqual(s);
  });

  it('rejects malformed, oversized and non-base64url input', async () => {
    expect(await decodeSettings('not base64!')).toBeUndefined();
    expect(await decodeSettings('AAAA')).toBeUndefined();
    expect(await decodeSettings('a'.repeat(10_000))).toBeUndefined();
  });

  it('stops a decompression bomb', async () => {
    const bomb = new Blob([' '.repeat(5_000_000)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(bomb).arrayBuffer());
    const encoded = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    expect(encoded.length).toBeLessThan(8192);
    expect(await decodeSettings(encoded)).toBeUndefined();
  });

  it('sanitizes hostile values', async () => {
    const hostile = { ...defaultSettings(), density: 1e9, strains: [{ color: 'javascript:alert(1)' }] };
    const encoded = await encodeSettings(hostile as never);
    const s = await decodeSettings(encoded);
    expect(s?.density).toBe(8);
    expect(s?.strains[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
