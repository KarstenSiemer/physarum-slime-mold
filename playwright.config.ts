import { defineConfig } from '@playwright/test';
import { webgpuLaunch } from './tests/browser';

const ci = !!process.env.CI;
// Not 4173, 5173 or 5001: this machine keeps those free (AGENTS.md). E2E_PORT picks another port.
export const port = Number(process.env.E2E_PORT ?? 4219);

export default defineConfig({
  testDir: 'tests',
  // `e2e` runs in CI. `gallery` is the visual review loop (`npm run gallery`). `pictures` holds the tools that make
  // the pictures of the repository and of a record again; a person runs one of them by its file.
  projects: [
    { name: 'e2e', testDir: 'tests/e2e' },
    { name: 'gallery', testDir: 'tests/gallery' },
    { name: 'pictures', testDir: 'tests/pictures' },
  ],
  // Each test is a test of its own for --shard: CI shares them out by their count, in the order of the files. The
  // slowest tests wait for many steps in tubes.spec.ts, which sorts after scenes.spec.ts into the second shard (ADR 0049).
  fullyParallel: true,
  // One browser at a time on CI: parallel WebGPU browsers are flaky on SwiftShader.
  ...(ci ? { workers: 1 } : {}),
  // SwiftShader renders on the CPU in CI: allow for slow frames. Every e2e test starts the app: in the CI image a
  // test took up to 1.4 min of the old limit of 2 min (ADR 0010).
  timeout: ci ? 240_000 : 30_000,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // CI prints a line with the time of each test: the log of a shard shows which tests fill its 30 minutes (ADR 0102).
  reporter: ci ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    channel: webgpuLaunch.channel,
    launchOptions: { args: webgpuLaunch.args },
    trace: 'retain-on-failure',
  },
  // A busy port fails at once (--strictPort, no reuse): the tests never run against another server.
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
