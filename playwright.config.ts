import { defineConfig } from '@playwright/test';
import { webgpuLaunch } from './tests/browser';

const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'tests',
  projects: [
    { name: 'e2e', testDir: 'tests/e2e' },
    { name: 'gallery', testDir: 'tests/gallery' },
  ],
  fullyParallel: true,
  // One browser at a time on CI: parallel WebGPU browsers are flaky on SwiftShader.
  ...(ci ? { workers: 1 } : {}),
  // SwiftShader renders on the CPU in CI: allow for slow frames.
  timeout: ci ? 120_000 : 30_000,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    channel: webgpuLaunch.channel,
    launchOptions: { args: webgpuLaunch.args },
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: !ci },
});
