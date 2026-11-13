import { defineConfig, mergeConfig } from 'vitest/config';
import vite from '../vite.config.ts';
import { browser } from '../vitest.config.ts';

// The measurements of the real engine for an ADR (research/flow/README.md): runs in a headless browser that take
// minutes to hours and write gigabytes. They are not tests of the app. So they have this configuration of their own,
// and only a command that names it starts them:
//
//   npx vitest run --config research/vitest.config.ts research/flow/engine/<file>
//
// The configuration of the repository (vitest.config.ts) does not hold these files: `npx vitest run` with or without
// a project, `npm test` and `npm run test:gpu` cannot start a measurement.
export default mergeConfig(
  vite,
  defineConfig({
    test: {
      include: ['research/**/*.gpu.test.ts'],
      // One run at a time: the runs share the GPU, and a run measures time.
      fileParallelism: false,
      browser: browser(),
    },
  }),
);
