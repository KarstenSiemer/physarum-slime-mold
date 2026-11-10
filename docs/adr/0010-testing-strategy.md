# 0010: Testing strategy

- Status: accepted
- Date: 2026-11-08

## Context

Most logic runs in WGSL on the GPU, and the system is chaotic: small float differences change
later states. CI runners have no GPU. Verified locally on 2026-11-08
([webgpu-platform](../knowledge-base/webgpu-platform.md)): Playwright Chromium with
`--enable-unsafe-webgpu` gets a SwiftShader adapter on GPU-less Linux, and the real Metal GPU
on macOS with `channel: 'chromium'`.

## Decision

| Layer       | Tool                                                                 | What it proves                                                                                                                                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Static      | `tsc`, ESLint (type-checked), Prettier, `svelte-check`               | types, bugs, style                                                                                                                                                                                                                                                                                                       |
| Unit        | Vitest in Node                                                       | parameter schema, URL parsing with fuzzed input, presets, colors, RNG, CPU reference model, frame budget, startup grid check                                                                                                                                                                                             |
| GPU         | Vitest browser mode (Playwright, Chromium, `--enable-unsafe-webgpu`) | shaders compile; each pass matches the CPU reference on small inputs; invariants; determinism, also with the agent sort; exact WebGL2 counts without float blending, readback without stalls; gel height field in place; memory: a rebuild frees the old simulation first, a failed WebGL2 allocation frees its textures |
| E2E         | Playwright test                                                      | app boots without console errors, canvas not blank, tools and presets work, URL round trip, axe accessibility scan; hostile links are fitted to the device memory; "Start fresh" drops the shared settings                                                                                                               |
| Visual      | Playwright screenshots, fixed seed and exposure                      | reviewed by eye in the development loop                                                                                                                                                                                                                                                                                  |
| Performance | timestamp queries on a real GPU                                      | GPU time per compute pass (render passes by wall time: Metal render-pass timestamps over-count), paired in one page, local only ([webgpu-platform](../knowledge-base/webgpu-platform.md#cost-per-pass-on-metal-measured-2026-11-10))                                                                                     |

GPU checks use invariants, not long exact trajectories:

- diffuse pass equals the CPU result within float tolerance;
- mass balance with periodic boundary: `Σ trail' = (1 − decay)(Σ trail + deposit · Σ counts)`;
- agent count is conserved; at most one agent per cell in collision mode;
- two runs with one seed give identical buffers;
- behaviour metrics: the network forms (the coefficient of variation of the trail rises
  clearly above that of the noise), and the dominant wavelength grows with SO (Jones Fig. 10).

## Consequences

- CI runs real WGSL on SwiftShader, so CI scenes stay small: the model tests in
  `sim.gpu.test.ts` use at most 200² cells and 6000 agents (the sort tests up to 15 360 agents
  on 96 × 80 cells, the WebGL2 counting tests in `gl/sim.gpu.test.ts` up to 100 000 agents on
  one cell), `engine.gpu.test.ts` and the e2e tests (1280 × 720 viewport) 512 × 288 cells. The
  grid-limit tests draw a grid 16 cells by the largest side the backend reports, 64 agents and
  no steps.
- Real-GPU coverage (Metal) comes from the local loop. CI asserts no performance numbers (the
  planned steps/s report is local only), but its time limits fail a run that SwiftShader makes
  too slow (next bullet).
- The Fig. 10 test (200², 2000 WebGPU steps) took 102 to over 240 s on GitHub runners, on
  identical code; CI was not profiled. The old 240 s timeout failed the first CI run on `main`
  (2026-11-09); the timeout is now 600 s. On SwiftShader on macOS a step of this test takes
  19 ms with the tiled diffuse pass and 4.1 ms without the tile. On Metal (M3 Pro) the tile
  saves about 25 % of the diffuse pass and about 4 % of an app-like step, so the app keeps it
  ([webgpu-platform](../knowledge-base/webgpu-platform.md#swiftshader-and-the-tiled-diffuse-pass-measured-2026-11-09)).
- A WebGPU device on SwiftShader needs tens of seconds to compile the simulation pipelines. The
  model, sort and gel tests in `sim.gpu.test.ts` therefore share one backend per API, whose setup
  builds a first simulation under a 180 s timeout. In the CI image
  (`mcr.microsoft.com/playwright:v1.64.1-noble`, 4 CPUs) the GPU project took 183 s on
  2026-11-10 (171 s before the sort and WebGL2 tests); apart from Fig. 10 no test took more than
  36 s.
