import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { webgpuLaunch } from './tests/browser.ts';
import vite from './vite.config.ts';

// Kept apart from vite.config.ts, so the production build loads no test tooling (docs/adr/0014-ci-hardening.md).
export default mergeConfig(
  vite,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.gpu.test.ts'], environment: 'node' },
        },
        {
          extends: true,
          test: {
            name: 'gpu',
            include: ['src/**/*.gpu.test.ts'],
            testTimeout: 60_000,
            // One file at a time on CI, as the e2e tests: files that run at once share SwiftShader and wait on each
            // other's GPU work. A test then took up to 2,600 times as long as alone, and the part no less (ADR 0010).
            fileParallelism: !process.env.CI,
            browser: {
              enabled: true,
              headless: true,
              provider: playwright({ launchOptions: webgpuLaunch }),
              instances: [{ browser: 'chromium' }],
              // The first page load transforms every module; on a busy or GPU-less machine it took over 60 s.
              connectTimeout: 180_000,
            },
          },
        },
      ],
    },
  }),
);
