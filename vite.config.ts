import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

// Delivered as <meta> because GitHub Pages cannot set response headers (docs/adr/0013-security.md).
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  // Only Svelte's own template policy may create HTML from strings (node_modules/svelte/.../reconciler.js).
  "require-trusted-types-for 'script'",
  'trusted-types svelte-trusted-html',
].join('; ');

const csp = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// Build and dev server only. Test settings live in vitest.config.ts, so the deployed build runs no test code.
export default defineConfig({
  base: './',
  plugins: [svelte(), csp()],
  build: { target: 'es2023', sourcemap: true },
});
