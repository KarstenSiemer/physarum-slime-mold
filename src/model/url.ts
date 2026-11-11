import { kindsOf, packDrawing, sceneOnly, unpackDrawing, type Drawing } from './link';
import { sanitize, type Drawn, type Settings } from './params';

// Shared links carry the full settings as deflated JSON in the URL hash, and the scene with its food, light and walls
// as deflated bytes (link.ts): #s=<base64url>&e=<base64url> (docs/adr/0021).
const MAX_HASH = 8192;
const MAX_JSON = 64 * 1024; // stops decompression bombs, for each part

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

const deflate = (data: Uint8Array<ArrayBuffer> | string, limit: number) =>
  readAll(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw')), limit);

/** Inflates a base64url part of the hash: throws for anything malformed or larger than MAX_JSON. */
async function inflate(encoded: string): Promise<Uint8Array> {
  if (encoded.length > MAX_HASH || !/^[\w-]*$/.test(encoded)) throw new Error('not base64url');
  return readAll(
    new Blob([fromB64url(encoded)]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
    MAX_JSON,
  );
}

export async function encodeSettings(s: Settings): Promise<string> {
  return toB64url(await deflate(JSON.stringify(s), MAX_JSON));
}

/**
 * Untrusted input: returns sanitized settings, or undefined for anything malformed. `drawn`: what the link's drawing
 * holds, for a link made before the model switch (sanitize()).
 */
export async function decodeSettings(encoded: string, drawn?: Drawn): Promise<Settings | undefined> {
  try {
    return sanitize(JSON.parse(new TextDecoder().decode(await inflate(encoded))), drawn);
  } catch {
    return undefined;
  }
}

/** What a shared link holds: the settings, and the scene with its food, light and walls when it names them. */
export interface Link {
  settings: Settings;
  drawing?: Drawing;
  /** The link has a drawing (`e`) that this app cannot read: the settings load alone, and the app says so. */
  drawingLost?: true;
}

/**
 * The drawing as the `e` part of the hash in at most `room` characters: '' when there is nothing to hold (no scene,
 * no stroke), undefined when it does not fit (or the receiver could not inflate it).
 */
async function drawingPart(d: Drawing, room: number): Promise<string | undefined> {
  if (!d.scene && d.strokes.length === 0) return '';
  const bytes = packDrawing(d);
  if (!bytes || bytes.length > MAX_JSON) return undefined;
  try {
    const packed = await deflate(bytes, Math.floor((room * 3) / 4));
    return toB64url(packed);
  } catch {
    return undefined; // longer than the room
  }
}

/**
 * The page address hash of a link: `s=<settings>`, and `&e=<drawing>` for a scene or strokes. When the drawing does
 * not fit in MAX_HASH characters or the caps of link.ts, the link holds the settings and the scene as it loads, with
 * no part of the drawing, and `dropped` is true.
 */
export async function encodeLink(settings: Settings, drawing?: Drawing): Promise<{ hash: string; dropped: boolean }> {
  const s = `s=${await encodeSettings(settings)}`;
  const room = MAX_HASH - s.length - '&e='.length;
  const join = (e: string | undefined) => (e ? `${s}&e=${e}` : s);
  const whole = drawing && (await drawingPart(drawing, room));
  if (!drawing || whole !== undefined) return { hash: join(whole), dropped: false };
  const scene = sceneOnly(drawing);
  return { hash: join(scene && (await drawingPart(scene, room))), dropped: true };
}

/**
 * Untrusted input: the hash of a shared link without its '#'. Undefined unless it holds valid settings (`s`). A
 * drawing (`e`) that is malformed, names an unknown scene or exceeds the caps is left out: the settings load alone, as
 * from a link that holds only settings, and `drawingLost` is true. The drawing is read first: what it holds decides
 * the model of a link made before the model switch (ADR 0022).
 */
export async function decodeLink(hash: string): Promise<Link | undefined> {
  if (hash.length > MAX_HASH) return undefined;
  const parts = new Map<string, string>();
  for (const part of hash.split('&')) {
    const [key = '', value = ''] = part.split('=', 2);
    if (!parts.has(key)) parts.set(key, value);
  }
  const [s, e] = [parts.get('s'), parts.get('e')];
  if (s === undefined) return undefined;
  const drawing = e === undefined ? undefined : await decodeDrawing(e);
  const settings = await decodeSettings(s, drawing && kindsOf(drawing));
  if (!settings) return undefined;
  if (e === undefined) return { settings };
  if (!drawing) return { settings, drawingLost: true };
  // Each strain's origin, checked against the settings: one per strain, else none known.
  if (drawing.scene && drawing.origins.length !== settings.strains.length)
    drawing.origins = Array.from({ length: settings.strains.length }, () => -1);
  return { settings, drawing };
}

/** The `e` part, or undefined for anything malformed. */
async function decodeDrawing(encoded: string): Promise<Drawing | undefined> {
  try {
    return unpackDrawing(await inflate(encoded));
  } catch {
    return undefined;
  }
}
