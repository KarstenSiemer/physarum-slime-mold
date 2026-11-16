// The configuration of start.spec.ts (README.md): the options of the e2e tests, this folder as the only project, and
// no retry. The server serves the built site from the root of the repository.
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config';

const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error('playwright.config.ts has one web server');

export default defineConfig({
  ...base,
  testDir: '.',
  projects: [{ name: 'start', testDir: '.', testMatch: 'start.spec.ts' }],
  retries: 0,
  reporter: 'list',
  webServer: { ...server, cwd: fileURLToPath(new URL('../..', import.meta.url)) },
});
