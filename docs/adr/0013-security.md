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
   A link's scene with its food, light and walls (`e`, ADR 0021) goes through `unpackDrawing()`
   in `src/model/link.ts`, which never throws: it gives a drawing only when every number is finite
   and in range, the kinds and arenas come from their fixed sets and the scene's id names a
   preset, and else undefined, and the settings then load alone with a notice. The hash's parts go
   into a `Map`. Unit tests fuzz it with random, truncated and changed bytes and hashes, huge
   counts, NaN and Infinity, and `__proto__` and `constructor` keys, and check the 8,192 characters
   and the 64 KiB at their edges.
4. **Resource limits for hostile links**: `Engine.fit()` runs before every allocation, the
   first one included (`Engine.create`). It lowers the grid until the estimated GPU memory fits
   a budget of one eighth of the device memory hint, at most 1 GiB (512 MiB when unknown), and
   until the largest buffer fits the device's per-buffer and texture-size limits. Estimate:
   86 B per cell (WebGPU: trail 32, scent 16, counts 16, environment 4, collision buffers 12,
   bloom chain about 2.7, gel height field about 2; WebGL2 with float blending the same or less,
   without it 106 B: no collision buffers, but 32 B of counting panels, ADR 0003) and 32 B per
   agent. A rebuild frees the old simulation before it allocates the new one, so memory never
   holds two. Allocations run inside a WebGPU `out-of-memory` error scope (WebGL2:
   `OUT_OF_MEMORY`); a failure frees the partial allocation and steps the grid down instead of
   losing the device. The URL decoder caps the hash at 8,192 characters and each inflated part
   at 64 KiB. A link's drawing holds at most 4,096 strokes and asks for at most 64 passes over
   4,096 × 4,096 cells of paint work, a bound for every grid (`MAX_STROKES`, `MAX_WORK` and
   `workOf()` in `src/model/link.ts`). Measured on an M3 Pro, such a link paints in at most 83 ms
   on the GPU and takes up to 77 ms of main-thread time in `Engine.load`, which builds the
   sweep's `Placement`. Every new simulation paints it again, and a new grid builds the `Placement`
   again (ADR 0021). If the simulation still fails, the error offers "Start fresh", which reloads
   without the shared link (a plain reload would replay it). An e2e test opens a 2048-cell link with a faked
   0.25 GB device and checks the fitted grid.
5. **No runtime third parties**: no CDN, analytics, fonts or embeds.
6. **Supply chain**: ADR 0011 (npm hardening), ADR 0014 (CI), ADR 0015 (Renovate).
7. The engine is exposed as `globalThis.physarum` for tests and curious users; it holds no
   secrets and grants nothing the page cannot already do.

## Consequences

- Browsers without Trusted Types (check per release) ignore the directive; the other layers
  still apply.
- A CSP delivered by `<meta>` cannot set `frame-ancestors` or reporting (ADR 0018).
