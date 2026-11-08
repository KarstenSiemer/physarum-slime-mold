import { sanitize, type Settings } from './params';

// Shared links carry the full settings as deflated JSON in the URL hash: #s=<base64url>.
const MAX_HASH = 8192;
const MAX_JSON = 64 * 1024; // stops decompression bombs

const toB64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('settings too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export async function encodeSettings(s: Settings): Promise<string> {
  const json = new Blob([JSON.stringify(s)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toB64url(await readAll(json, MAX_JSON));
}

/** Untrusted input: returns sanitized settings, or undefined for anything malformed. */
export async function decodeSettings(encoded: string): Promise<Settings | undefined> {
  if (encoded.length > MAX_HASH || !/^[\w-]*$/.test(encoded)) return undefined;
  try {
    const stream = new Blob([fromB64url(encoded)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const json = new TextDecoder().decode(await readAll(stream, MAX_JSON));
    return sanitize(JSON.parse(json));
  } catch {
    return undefined;
  }
}
