// Small WebGL2 helpers: programs, float render targets, uniform blocks.

export type GL = WebGL2RenderingContext;

export function program(gl: GL, vertex: string, fragment: string): WebGLProgram {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error('createShader failed');
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`GLSL compile error: ${gl.getShaderInfoLog(s) ?? ''}`);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`GLSL link error: ${gl.getProgramInfoLog(p) ?? ''}`);
  return p;
}

/** A texture with its framebuffer, so it can be both drawn into and read. */
export interface Target {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  format: number;
  /** Depth and stencil buffer, if the target has one (stencilTarget()). */
  depthStencil?: WebGLRenderbuffer;
}

const FORMATS: Record<number, [number, number]> = {
  [WebGL2RenderingContext.RGBA32F]: [WebGL2RenderingContext.RGBA, WebGL2RenderingContext.FLOAT],
  [WebGL2RenderingContext.RG32F]: [WebGL2RenderingContext.RG, WebGL2RenderingContext.FLOAT],
  [WebGL2RenderingContext.R32F]: [WebGL2RenderingContext.RED, WebGL2RenderingContext.FLOAT],
  [WebGL2RenderingContext.RGBA16F]: [WebGL2RenderingContext.RGBA, WebGL2RenderingContext.HALF_FLOAT],
  [WebGL2RenderingContext.RGBA8]: [WebGL2RenderingContext.RGBA, WebGL2RenderingContext.UNSIGNED_BYTE],
};

export function target(gl: GL, width: number, height: number, format: number, linear = false): Target {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    throw new Error(`Render target ${width}×${height} is incomplete (status 0x${status.toString(16)})`);
  }
  return { texture, fbo, width, height, format };
}

/** A target with an 8-bit stencil (in a depth-stencil renderbuffer, the most widely supported kind). */
export function stencilTarget(gl: GL, width: number, height: number, format: number): Target {
  const t = target(gl, width, height, format);
  const depthStencil = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthStencil);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depthStencil);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteRenderbuffer(depthStencil);
    destroyTarget(gl, t);
    throw new Error(`Stencil target ${width}×${height} is incomplete (status 0x${status.toString(16)})`);
  }
  return { ...t, depthStencil };
}

export function clear(gl: GL, t: Target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.viewport(0, 0, t.width, t.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

export function destroyTarget(gl: GL, t: Target) {
  gl.deleteTexture(t.texture);
  gl.deleteFramebuffer(t.fbo);
  if (t.depthStencil) gl.deleteRenderbuffer(t.depthStencil);
}

/** Reads a whole target (rows from y = 0). */
export function readTarget(gl: GL, t: Target): Float32Array | Uint8Array {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  if (t.format === gl.RGBA8) {
    const out = new Uint8Array(t.width * t.height * 4);
    gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }
  const out = new Float32Array(t.width * t.height * 4);
  gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.FLOAT, out);
  return out;
}

/**
 * Resolves once the GPU has run every command issued so far: a fence, polled without blocking. A fence
 * cannot signal within the task that made it (WebGL 2.0 spec, 5.27), so polling starts in the next task.
 * Resolves false if the context is lost.
 *
 * The polls run about 1 ms apart. A chain of timers that each start the next is clamped to 4 ms after
 * five levels (HTML timer rules); in Chromium that made the polls 5 ms apart from about 7 ms on, so the
 * frame budget saw the GPU finish up to 5 ms late. Each poll's timer therefore starts from a message
 * task, which keeps its nesting level at 1.
 */
export function fence(gl: GL): Promise<boolean> {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    const finish = (ok: boolean) => {
      port1.close();
      resolve(ok);
    };
    const poll = () => {
      if (!sync || gl.isContextLost()) {
        finish(false);
        return;
      }
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) {
        port2.postMessage(undefined);
        return;
      }
      gl.deleteSync(sync);
      finish(status !== gl.WAIT_FAILED);
    };
    port1.onmessage = () => {
      setTimeout(poll, 1);
    };
    setTimeout(poll, 0);
  });
}

/**
 * Reads a float target without stalling the main thread: the GPU copies it into a pixel-pack buffer,
 * and the CPU reads that buffer once a fence says the copy is done.
 */
export async function readTargetAsync(gl: GL, t: Target): Promise<Float32Array> {
  const out = new Float32Array(t.width * t.height * 4);
  const pbo = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, out.byteLength, gl.STREAM_READ);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.FLOAT, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  try {
    if (!(await fence(gl))) throw new Error('The WebGL context was lost.');
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return out;
  } finally {
    gl.deleteBuffer(pbo);
  }
}

/** Uploads texels into a target (rows from y = 0). */
export function writeTarget(gl: GL, t: Target, x: number, y: number, w: number, h: number, data: ArrayBufferView) {
  const [format, type] = FORMATS[t.format] ?? [gl.RGBA, gl.FLOAT];
  gl.bindTexture(gl.TEXTURE_2D, t.texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, format, type, data);
}

/** Uniform block bound to a binding point, filled from the same packing as WebGPU (std140 = WGSL here). */
export function uniformBlock(gl: GL, size: number, binding: number): WebGLBuffer {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
  gl.bufferData(gl.UNIFORM_BUFFER, size, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, binding, buffer);
  return buffer;
}

export function bindBlock(gl: GL, p: WebGLProgram, name: string, binding: number) {
  const i = gl.getUniformBlockIndex(p, name);
  if (i !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, i, binding);
}

/** Binds textures to units 0…n and sets the sampler uniforms of the same names. */
export function textures(gl: GL, p: WebGLProgram, list: Record<string, WebGLTexture>) {
  Object.entries(list).forEach(([name, tex], unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(p, name), unit);
  });
}
