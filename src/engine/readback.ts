/** Copies a GPU buffer to the CPU. */
export async function readBuffer(device: GPUDevice, src: GPUBuffer, size = src.size): Promise<ArrayBuffer> {
  const dst = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, dst, 0, size);
  device.queue.submit([enc.finish()]);
  await dst.mapAsync(GPUMapMode.READ);
  const out = dst.getMappedRange().slice(0);
  dst.destroy();
  return out;
}

/** Copies layer `layer` of a float texture to the CPU as tightly packed rows (`channels` floats per texel). */
export async function readTexture(
  device: GPUDevice,
  texture: GPUTexture,
  channels: number,
  layer = 0,
): Promise<Float32Array> {
  const { width, height } = texture;
  const bytes = width * channels * 4;
  const row = Math.ceil(bytes / 256) * 256; // copyTextureToBuffer needs 256-byte rows
  const dst = device.createBuffer({ size: row * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture, origin: [0, 0, layer] }, { buffer: dst, bytesPerRow: row }, [width, height]);
  device.queue.submit([enc.finish()]);
  await dst.mapAsync(GPUMapMode.READ);
  const mapped = dst.getMappedRange();
  const out = new Float32Array(width * height * channels);
  for (let y = 0; y < height; y++) out.set(new Float32Array(mapped, y * row, width * channels), y * width * channels);
  dst.destroy();
  return out;
}

/** Copies an 8-bit RGBA/BGRA texture to the CPU as tightly packed bytes. */
export async function readPixels(device: GPUDevice, texture: GPUTexture): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const { width, height } = texture;
  const row = Math.ceil((width * 4) / 256) * 256;
  const dst = device.createBuffer({ size: row * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture }, { buffer: dst, bytesPerRow: row }, [width, height]);
  device.queue.submit([enc.finish()]);
  await dst.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(dst.getMappedRange());
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) out.set(mapped.subarray(y * row, y * row + width * 4), y * width * 4);
  dst.destroy();
  return out;
}
