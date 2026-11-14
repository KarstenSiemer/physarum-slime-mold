export class GpuUnavailableError extends Error {
  override name = 'GpuUnavailableError';
}

/** The GPU could not allocate the buffers for a simulation. */
export class OutOfMemoryError extends Error {
  override name = 'OutOfMemoryError';
}

export interface Gpu {
  device: GPUDevice;
  info: GPUAdapterInfo;
}

/** Requests a device with the largest buffer limits the sim can use (capped at 1 GiB). */
export async function initGpu(): Promise<Gpu> {
  if (!('gpu' in navigator)) {
    throw new GpuUnavailableError('This browser does not support WebGPU.');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new GpuUnavailableError('No WebGPU adapter is available on this device.');
  const cap = (v: number) => Math.min(v, 2 ** 30);
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: cap(adapter.limits.maxStorageBufferBindingSize),
      maxBufferSize: cap(adapter.limits.maxBufferSize),
    },
  });
  return { device, info: adapter.info };
}
