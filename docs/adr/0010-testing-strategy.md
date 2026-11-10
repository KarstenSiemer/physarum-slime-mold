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

| Layer       | Tool                                                                 | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static      | `tsc`, ESLint (type-checked), Prettier, `svelte-check`               | types, bugs, style                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Unit        | Vitest in Node                                                       | parameter schema, URL parsing with fuzzed input, presets, colors, RNG, CPU reference model, frame budget, startup grid check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GPU         | Vitest browser mode (Playwright, Chromium, `--enable-unsafe-webgpu`) | shaders compile; each pass matches the CPU reference on small inputs; invariants; determinism, also with the agent sort; exact WebGL2 counts without float blending (and no blending into 32-bit float targets there), readback without stalls; gel height field in place, and its colours against a CPU evaluation of the old shader; the outline distances of food and walls against `env` and a CPU model, also after the boundary changes, beside the edges of a box and the rim of the dish, and under erasers wide enough to skip whole workgroups, one call of the batched paint against one call per stroke and per segment, byte for byte, for `env` and the outlines, and no outline byte changed outside a stroke's outline box or by a stroke that paints no cell, and how food, light and walls look (food below the trail, also below the thick trail of the gel style, agents on food, blocked agents in the agents style, round outlines and seamless rims, the grain across the wrap seam, anti-aliased arena edges, outlines whole up to the edge of a closed arena, food and holes thinner than a cell, light without steps at cell edges, the trail up to walls, thin walls without beads, nothing left after erasing at every zoom); with nothing painted, the pass without food, light and walls, and its colours in every style against a CPU evaluation of the pass before them; memory: a rebuild frees the old simulation first, a failed WebGL2 allocation frees its textures |
| E2E         | Playwright test                                                      | app boots without console errors, canvas not blank, tools and presets work, URL round trip, axe accessibility scan; hostile links are fitted to the device memory; "Start fresh" drops the shared settings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Visual      | Playwright screenshots, fixed seed and exposure                      | reviewed by eye in the development loop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Performance | timestamp queries on a real GPU                                      | GPU time per compute pass (render passes by wall time: Metal render-pass timestamps over-count), paired in one page, local only ([webgpu-platform](../knowledge-base/webgpu-platform.md#cost-per-pass-on-metal-measured-2026-11-10))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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
- With the outline and look tests of ADR 0009 (2026-11-10, in
  `mcr.microsoft.com/playwright:v1.65.0-noble` with 4 CPUs, the host shared with other work) the
  GPU project (189 tests, 84 of them new) took 220 s against 225 s for the 105 tests before them
  in a run the same day; the new tests took 9.7 s together, at most 1.2 s each. The e2e suite took
  453 s against 478 s, all 26 tests at the first try; single tests moved by up to 8 s either way.
  The waits for a started engine (`helpers.ts:31`, 60 s) took 11 to 21 s, as on the base (12 to
  20 s); the wait at `scenes.spec.ts:301` took 11.7 of its 20 s, the 12 s of the notice it waits
  out (`state.svelte.ts`, `noteMissingRule`), as on the base. The engine test that switches one
  agent per cell took 42 s of its 60 s in the GPU project (32 s on the base, 39 and 41 s in two
  earlier runs of the branch). Run alone, four times each and alternating with the base, it took
  13 to 18 s on both: the tests running beside it in the other files make up the rest. SwiftShader
  compiles a render pass at its first draw: the first frame with food or walls took about 1 s
  longer on WebGPU and 1 to 2 s longer on WebGL2, once per page. SwiftShader also runs both sides
  of a branch, so a large function called at two places runs twice per pixel: while the render
  pass called `scene()` at two places, it took 1.65 to 2 times as long there, and the e2e suite
  627 s. It now calls it once.
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
- With PR 3 joined onto PR 2 (the outlines in the batched paint, ADR 0009 item 11; same image,
  2026-11-10, git-archive copies, two runs of the branch with PR 2 alone between them, another
  agent's test container on the host during the first): the GPU project (321 tests, 112 of them
  new or from PR 3) took 292 and 268 s, PR 2 alone (209 tests) 212 s. The new tests took 59 s
  together; the slowest, the holds after erasers on WebGPU, 5.7 to 12.8 s per boundary with 12
  seeds, now 6 seeds. "Paints 5000 strokes in one call" took 9.5 to 10 s on WebGPU against 0.3 s
  for PR 2 alone: SwiftShader runs the workgroup barriers of the outline pass on the CPU, and in
  three runs of that test alone it took 0.53 to 0.69 s with the outline pass before workgroup
  memory and 2.41 to 3.37 s with it. On the M3 Pro the same change halves a replay. Over a quarter
  of the 60 s limit apart from Fig. 10: the WebGL2 counting test without float blending that
  compiles every program (19.1 and 30.1 s, PR 2 alone 17.9 s) and once the test that never blends
  into 32-bit float targets (15.4 s, then 9.8 s; PR 2 alone 9.2 s). The e2e suite (28 tests)
  passed at the first try in 719 and 574 s, PR 2 alone in 673 s. The waits for the started app
  took 13 to 36 s of their 60 s (PR 2 alone 14 to 25 s), and the wait at `scenes.spec.ts:340` 12.0
  of 20 s, the 12 s timer of the notice, as before.
- After the review fixes of the join (59a66ee, same image, 2026-11-10, a git-archive copy, other
  work on the host at times): the GPU project (357 tests, 36 of them new) took 250 s, against 292
  and 268 s for the join before the fixes (321 tests) and 212 s for PR 2 alone. The new tests took
  27 s together, at most 11.5 s each (wide erasers on the periodic grid, WebGPU). Over a quarter of
  60 s apart from Fig. 10 (82 s of 600 s): "switching one agent per cell restarts the population",
  26.9 s (before 7.5 to 10.3 s), the first test of its file that builds a WebGPU device, which now
  compiles six outline pipelines (ADR 0009, item 11). In the image alone, a new WebGPU device with
  its first simulation took 16.2 to 16.8 s against 9.4 to 10.4 s before (four rounds each in two
  containers per commit, alternating); WebGL2 took 0.07 to 0.27 s for both. Also over a quarter:
  the WebGL2 tests "finish() resolves only after the GPU has run the work" without float blending,
  26.0 s, and "never blends into a 32-bit float target", 15.9 s (before 6.3 to 9.2 and 9.2 to
  15.4 s). The first shares the compile of every program and the load of the files beside it with
  "counts alive agents exactly", 11.9 s now and 17.9 to 30.1 s before: 37.9 s together against 25.4
  to 39.3 s. "Paints 5000 strokes in one call" took 9.1 s on WebGPU (before 9.5 to 10 s); alone in
  the image 1.44 to 1.62 s on WebGPU (before 1.93 to 1.96 s) and 4.65 to 5.18 s on WebGL2 (before
  3.21 to 3.45 s), where SwiftShader runs the larger `shape.frag` on the CPU. GitHub runs
  SwiftShader's WebGPU compute up to 1.9 times slower than the image (review, 2026-11-10), so this
  test can pass a quarter of its limit there. The e2e suite (28 tests) passed at the first try in
  636 s (before 719 and 574 s, PR 2 alone 673 s). Its waits for the started app took 18 to 22 s of
  60 s, median 18.9 s (before medians 15.1 to 22.0 s), and the wait at `scenes.spec.ts:340` 11.6 of
  20 s, the 12 s timer of the notice: these are the only waits over a quarter of their limit, as
  before.
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
