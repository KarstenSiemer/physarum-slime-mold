# 0013: Application security

- Status: accepted
- Date: 2026-11-08

## Context

The page runs code on the visitor's GPU, reads state from the URL (shared links) and ships
third-party code (Svelte runtime) in its bundle. There is no backend, no login and no cookie.
Threats that remain: script injection, a compromised dependency in the bundle, and hostile
URL state (huge values that exhaust GPU memory, prototype pollution).

## Decision

1. **CSP** as the first element of `<head>`, injected at build time:
   `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:;
connect-src 'self'; font-src 'self'; manifest-src 'self'; base-uri 'none';
form-action 'none'; require-trusted-types-for 'script'; trusted-types svelte-trusted-html`.
   No inline script or style, no third-party origin. `connect-src 'self'` blocks `fetch`,
   XHR, WebSocket and beacons to other origins. It does not stop a compromised bundled
   dependency from sending data by navigation, `window.open` or WebRTC; the page holds no
   user data, so little is at stake.
   **Trusted Types** are enforced: Svelte 5 creates its templates through its own module-private
   policy `svelte-trusted-html` (`svelte/src/internal/client/dom/reconciler.js`), so every
   other string-to-HTML sink throws.
   Dynamic styles use Svelte's `style:` directive, which writes through the CSSOM
   (`style.setProperty`, `style.cssText`) and is allowed by `style-src 'self'`; static
   `style="…"` attributes are not used because they would be inline styles.
2. **No HTML from strings**: ESLint `svelte/no-at-html-tags` is an error; no `innerHTML`.
3. **Untrusted input** (the URL) goes through `sanitize()` in `src/model/params.ts`: only
   known keys, numbers clamped to their spec, enums checked, colors matched by regex, at most
   4 strains. Agent count is capped by the device's buffer limit. Unit tests fuzz it.
4. **Resource limits for hostile links**: `Engine.fit()` runs before every allocation, the
   first one included (`Engine.create`). It lowers the grid until the estimated GPU memory fits
   a budget of one eighth of the device memory hint, at most 1 GiB (512 MiB when unknown), and
   until the largest buffer fits the device's per-buffer and texture-size limits. Estimate:
   84 B per cell (WebGPU: trail 32, scent 16, counts 16, environment 4, collision buffers 12,
   bloom chain about 2.7; WebGL2 with float blending the same or less, without it 104 B: no
   collision buffers, but 32 B of counting panels, ADR 0003) and 32 B per agent. A rebuild frees the old
   simulation before it allocates the new one, so memory never holds two. Allocations run inside
   a WebGPU `out-of-memory` error scope (WebGL2: `OUT_OF_MEMORY`); a failure frees the partial
   allocation and steps the grid down instead of losing the device. The URL decoder caps the hash
   at 8 KiB and the inflated JSON at 64 KiB. If the simulation still fails, the error offers
   "Start fresh", which reloads without the shared settings (a plain reload would replay them).
   An e2e test opens a 2048-cell link with a faked 0.25 GB device and checks the fitted grid.
5. **No runtime third parties**: no CDN, analytics, fonts or embeds.
6. **Supply chain**: ADR 0011 (npm hardening), ADR 0014 (CI), ADR 0015 (Renovate).
7. The engine is exposed as `globalThis.physarum` for tests and curious users; it holds no
   secrets and grants nothing the page cannot already do.

## Consequences

- Browsers without Trusted Types (check per release) ignore the directive; the other layers
  still apply.
- A CSP delivered by `<meta>` cannot set `frame-ancestors` or reporting (ADR 0018).
