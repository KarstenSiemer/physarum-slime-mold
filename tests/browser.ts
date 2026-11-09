// Real WebGPU in tests: the GPU locally, SwiftShader on GPU-less Linux CI (docs/adr/0010-testing-strategy.md).
// Without the Vulkan/ANGLE SwiftShader flags, presenting a canvas on Linux destroys the device.
const swiftshader = ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader'];

/** Chromium launch options for Vitest browser mode and Playwright. */
export const webgpuLaunch = {
  channel: 'chromium',
  args: [
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--disable-gpu-watchdog',
    ...(process.platform === 'linux' ? swiftshader : []),
  ],
};
