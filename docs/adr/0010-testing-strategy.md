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

| Layer       | Tool                                                                 | What it proves                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static      | `tsc`, ESLint (type-checked), Prettier, `svelte-check`               | types, bugs, style                                                                                                                                                                                         |
| Unit        | Vitest in Node                                                       | parameter schema, URL parsing with fuzzed input, presets, colors, RNG, CPU reference model                                                                                                                 |
| GPU         | Vitest browser mode (Playwright, Chromium, `--enable-unsafe-webgpu`) | shaders compile; each pass matches the CPU reference on small inputs; invariants; determinism; memory: a rebuild frees the old simulation first, a failed WebGL2 allocation frees its textures             |
| E2E         | Playwright test                                                      | app boots without console errors, canvas not blank, tools and presets work, URL round trip, axe accessibility scan; hostile links are fitted to the device memory; "Start fresh" drops the shared settings |
| Visual      | Playwright screenshots, fixed seed and exposure                      | reviewed by eye in the development loop                                                                                                                                                                    |
| Performance | timestamp queries on a real GPU                                      | steps per second per agent count, JSON report, local only                                                                                                                                                  |

GPU checks use invariants, not long exact trajectories:

- diffuse pass equals the CPU result within float tolerance;
- mass balance with periodic boundary: `Σ trail' = (1 − decay)(Σ trail + deposit · Σ counts)`;
- agent count is conserved; at most one agent per cell in collision mode;
- two runs with one seed give identical buffers;
- behaviour metrics: the network forms (the coefficient of variation of the trail rises
  clearly above that of the noise), and the dominant wavelength grows with SO (Jones Fig. 10).

## Consequences

- CI runs real WGSL on SwiftShader; scenes in CI tests stay small (≤ 256² cells, ≤ 64 k
  agents) for speed.
- Real-GPU coverage (Metal) comes from the local loop; performance numbers never gate CI.
