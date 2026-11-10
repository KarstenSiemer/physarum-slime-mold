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

| Layer       | Tool                                                                 | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static      | `tsc`, ESLint (type-checked), Prettier, `svelte-check`               | types, bugs, style                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Unit        | Vitest in Node                                                       | parameter schema, URL parsing with fuzzed input, presets, colors, RNG, CPU reference model, frame budget, startup grid check                                                                                                                                                                                                                                                                                                           |
| GPU         | Vitest browser mode (Playwright, Chromium, `--enable-unsafe-webgpu`) | shaders compile; each pass matches the CPU reference on small inputs; invariants; determinism, also with the agent sort; exact WebGL2 counts without float blending (and no blending into 32-bit float targets there), readback without stalls; gel height field in place, and its colours against a CPU evaluation of the old shader; memory: a rebuild frees the old simulation first, a failed WebGL2 allocation frees its textures |
| E2E         | Playwright test                                                      | app boots without console errors, canvas not blank, tools and presets work, URL round trip, axe accessibility scan; hostile links are fitted to the device memory; "Start fresh" drops the shared settings                                                                                                                                                                                                                             |
| Visual      | Playwright screenshots, fixed seed and exposure                      | reviewed by eye in the development loop                                                                                                                                                                                                                                                                                                                                                                                                |
| Performance | timestamp queries on a real GPU                                      | GPU time per compute pass (render passes by wall time: Metal render-pass timestamps over-count), paired in one page, local only ([webgpu-platform](../knowledge-base/webgpu-platform.md#cost-per-pass-on-metal-measured-2026-11-10))                                                                                                                                                                                                   |

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
  on 96 × 80 cells, the start test of the mixed layout 29 491 agents on 512 × 288 without a
  step, the WebGL2 counting tests in `gl/sim.gpu.test.ts` up to 100 000 agents on one cell),
  `engine.gpu.test.ts` and the e2e tests (1280 × 720 viewport) 512 × 288 cells, the engine tests
  also 236 × 512 (a 9:19.5 phone). The
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
  builds a first simulation under a 180 s timeout; the WebGL2 counting tests share one context
  per counting path (compiling the programs takes seconds per context there). In the CI image
  (`mcr.microsoft.com/playwright:v1.64.1-noble`, 4 CPUs) the GPU project (103 tests) took 192 s
  on 2026-11-10 (171 s for the 30 tests before the sort and WebGL2 tests); apart from Fig. 10 no
  test took more than 33 s. The e2e suite took 2.9 min there, its slowest test 40 s of 120 s
  (the boot test's wait for step 100: 26 s of 60 s).
- GitHub runners are slower than that image for the app's frame loop: on 2026-11-10 SwiftShader
  drew about one frame per second there (3.9 in the image), and the frame budget then runs one
  step per frame, so the boot test reached step 57 of 100 in its 60 s wait and failed. In the
  image, each extra step in a frame cost about 150 ms (1, 4 and 16 steps per frame gave 3.9,
  1.4 and 0.4 fps), so the budget's choice of one step is right there, and e2e tests wait for
  few steps: the boot test for 30, because its contrast check passes from step 10 on.
- In the CI image (`mcr.microsoft.com/playwright:v1.65.0-noble`, 4 CPUs, 2026-11-10, another test
  run on the same host) a new WebGPU device on SwiftShader built its pipelines in 14 to 16 s, 12
  to 14 s before the start placement and the wall walk of ADR 0019 (runs alternating with the
  base). The engine GPU tests therefore share one backend per API, built under a 180 s limit:
  with one device per test, two of them had taken 56 and 59 s of their 60 s. The GPU project
  (187 tests) then took 224 s, its base (105 tests) 223 s; Fig. 10 on WebGPU 106 s. The e2e suite
  (28 tests) took 10.2 and 13.3 min in two runs and its base (26 tests) 9.0 min between them: every
  test needs 16 to 20 s there to start the app. The slowest was "a preset chosen while the engine
  starts", 44 to 66 s of 120 s; the boot test waits up to 60 s for the engine to exist.
- After the review fixes of ADR 0019 (same image, 2026-11-10, one other test container on the
  host): the GPU project (209 tests) took 192 s, Fig. 10 on WebGPU 84 s of 600 s, and no other test
  more than 18 s (the WebGL2 counting test without float blending, 4.9 s on GitHub for the base).
  The e2e suite (28 tests) took 7.7 min without a retry. Its waits for the started app took 11 to
  23 s of their 60 s, and the two tests that start the app twice 32 and 33 s of 120 s. Measured
  paired with the base in fresh containers, a new WebGPU backend and its first simulation (every
  pipeline) took 9.3 to 10.1 s against 8.8 to 9.5 s (3 runs), and "a preset chosen while the engine
  starts" reached step 5 after a median of 14.8 and 14.9 s against 14.4 and 15.1 s for its two page
  loads (6 runs). The boot waits keep their 60 s; a review run beside more containers saw one of
  them reach 60 s once, and its retry passed.
