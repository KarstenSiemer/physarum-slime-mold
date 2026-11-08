// WebGL2 resource handling in a real browser (ADR 0003, ADR 0010).
import { expect, it } from 'vitest';
import { defaultSettings } from '../../model/params';
import { WebGl2Backend } from './backend';

/** A canvas whose WebGL2 context counts live textures and framebuffers and can fail a completeness check. */
function countingCanvas() {
  const live = { textures: 0, framebuffers: 0 };
  let checks = 0;
  let failAt = Infinity;
  const canvas = document.createElement('canvas');
  const getContext = canvas.getContext.bind(canvas);
  const wrap = (gl: WebGL2RenderingContext) =>
    new Proxy(gl, {
      get(t, key) {
        switch (key) {
          case 'createTexture':
            return () => (live.textures++, t.createTexture());
          case 'deleteTexture':
            return (x: WebGLTexture | null) => {
              if (x) live.textures--;
              t.deleteTexture(x);
            };
          case 'createFramebuffer':
            return () => (live.framebuffers++, t.createFramebuffer());
          case 'deleteFramebuffer':
            return (x: WebGLFramebuffer | null) => {
              if (x) live.framebuffers--;
              t.deleteFramebuffer(x);
            };
          case 'checkFramebufferStatus':
            return (target: number) => (++checks === failAt ? 0 : t.checkFramebufferStatus(target));
        }
        const v: unknown = Reflect.get(t, key);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  canvas.getContext = ((type: string, attrs?: WebGLContextAttributes) => {
    const gl = getContext(type, attrs);
    return gl instanceof WebGL2RenderingContext ? wrap(gl) : gl;
  }) as unknown as typeof canvas.getContext;
  return { canvas, live, failAt: (n: number) => (failAt = checks + n) };
}

it('frees every texture and framebuffer of a half-built simulation', async () => {
  const { canvas, live, failAt } = countingCanvas();
  const backend = WebGl2Backend.create(canvas);
  const before = { ...live };
  let failures = 0;
  // Fail the 1st, 2nd, ... render target until the simulation is complete.
  for (let n = 1; n < 64; n++) {
    failAt(n);
    let sim;
    try {
      sim = await backend.createSim(defaultSettings(), 64, 32, 100);
    } catch {
      failures++;
      expect(live, `failed at render target ${n}`).toEqual(before);
      continue;
    }
    sim.destroy();
    expect(live).toEqual(before);
    break;
  }
  failAt(Infinity);
  expect(failures).toBeGreaterThanOrEqual(8); // agents ×2, trail ×2, scent ×2, counts, env (+ tally, collisions ×3)
  backend.destroy();
});
