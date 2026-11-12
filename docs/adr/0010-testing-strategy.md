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
  20 s); the wait at `scenes.spec.ts:434` took 11.7 of its 20 s, the 12 s of the notice it waits
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
  took 13 to 36 s of their 60 s (PR 2 alone 14 to 25 s), and the wait at `scenes.spec.ts:434` 12.0
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
  60 s, median 18.9 s (before medians 15.1 to 22.0 s), and the wait at `scenes.spec.ts:434` 11.6 of
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
- After walls block sensors (ADR 0020, on PR 2 without PR 3; same image, 2026-11-10), first with the
  pipelines for walls built at the start and no other test container on the host (its load stayed at
  8 to 13 from other work): the GPU project (247 tests) took 303 s. The hooks of `sim.gpu.test.ts`,
  which now also compile two other versions of the agent shader, took 57 s against 40 s in the run
  above, and Fig. 10 on WebGPU 93 s of 600 s. The e2e suite (28 tests) took 8.9 min without a retry
  (7.7 min above). Its waits for the started app took 13.6 to 18.4 s of their 60 s, median 15.2 s
  (above 10.7 to 22.7 s, median 12.4 s). Paired with the base in one container (6 runs, another test
  container on the host), the first page load of "a preset chosen while the engine starts" reached
  the engine after a median of 20.9 s against 18.3 s.
- So the pipelines for walls are now built at the first wall (ADR 0020). On that code (same image,
  another test container on the host for 5 of the 14 min) the GPU project (249 tests) took 282 s.
  Its 40 new tests took 64 s together and at most 6.9 s each (the WebGL2 test against the source
  without the sensor check, three strains on 160 × 144 cells). The test of when the passes for walls
  are built compiles pipelines or programs of its own: 2.2 s on WebGPU, 3.9 s on WebGL2. The hooks
  took 50 s, Fig. 10 on WebGPU 94 s. The e2e suite took 9.2 min without a retry, its waits for the
  started app 11.2 to 24.6 s, median 15.0 s. The 15 small WebGPU tests of walls (one or a few
  agents) took 0.03 to 7.0 s in the first run and 0.03 to 5.0 s in the last; 5 and 8 of them took
  more than 1 s, 3 of them in both runs. A start A/B of scenes without walls on that code ran beside
  another test container: its paired differences spread from −89 to +100 s, so it gives no result.
  ADR 0020 has the compile times, paired in one page. On GitHub the last run on `main` took 5.1 min
  for the GPU project and 6.9 min for the e2e suite, in a job limited to 30 min.
- After the review of ADR 0020 (same image, 2026-11-10, commit `738e0ab`, load of the Docker VM
  median 6.2): the GPU project (261 tests) passed in 338 s. The 12 tests added by the review took
  1.6 s together, at most 0.85 s each. Fig. 10 took 114 s on WebGPU and 39 s on WebGL2 of 600 s,
  the hook that builds the WebGPU backend 54.5 s of 180 s. The e2e suite (28 tests) passed in
  8.3 min without a retry.
- Many waits use more than a quarter of their limit, the share at which a wait is at risk on GitHub,
  whose runners draw frames about 4 times slower than the image (above). In that run the waits for
  the started app (step 5 within 60 s: `tests/e2e/helpers.ts`, `scenes.spec.ts`, `app.spec.ts`) took
  11.1 to 23.3 s, median 13.4 s, 7 of 28 above 15 s. The notice wait in `scenes.spec.ts`
  (`toBeHidden` within 20 s) took 12.1 s, because the notice stays for 12 s
  (`src/ui/state.svelte.ts`). The WebGL2 counting test without float blending (`gl/sim.gpu.test.ts`)
  took 15.6 s of 60 s, and the hook that builds the WebGPU backend 30 % of its limit. The code
  before ADR 0020 shows the same: a review ran it paired with this code in two containers at once
  (load of the VM median 13.7). Its start waits took a median of 20.5 s (21 of 28 above 15 s, the
  longest 37.4 s), against 21.0 s (24 of 28, the longest 30.6 s) for this code, and the counting
  test 19.1 s against 18.8 s. Paired by test, this code waited a median of 1.2 s longer, and longer
  in 16 of 28 waits: the start A/B that the run above could not give shows no measurable change. In
  a run of this code in that review, beside more load, one start wait reached 60.3 s and failed, and
  the counting test failed at 68.1 s of 60 s. On GitHub the run of `main` at 2026-11-10 13:44 UTC
  took 6.3 min for its GPU project (105 tests) and 7.9 min for its e2e suite (26 tests), so an e2e
  test took about as long there as in the image. There Fig. 10, which runs 2,000 steps, took 271 s
  of 600 s on WebGPU, 2.4 times as long as in the run above, and the counting test 5.0 s. Whether to
  give these waits longer limits, wait for fewer steps or give the tests less work is an owner
  decision (TODO.md).
- ADR 0020 joined onto PR 3 (2026-11-10) did not run in the image: by the owner's decision of that
  day, GitHub CI times it after the push. On the M3 Pro its GPU project (419 tests) passed in 17 s.
- Longer limits, by the owner's decision of 2026-11-10 (TODO.md): each wait that used more than a
  quarter of its limit in a run of that day now has twice that limit. Above a quarter, a busy host
  or a slower runner can make the wait fail (above). The times come from two sources. The CI-image
  runs above logged every test, hook and e2e step; only the runs with one backend per API in the
  engine tests count (PR 2 and later). The verify jobs on GitHub of PR 2, 3, 5 and 6 (#18 to #21)
  and of `main` give every GPU test of more than 300 ms, but no e2e times. These limits replace the
  limits in the notes above.

  | Wait                                                                                                                      | Limit            | Longest                                                                                                 | Run                                                                                |
  | ------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
  | `tests/e2e/helpers.ts:31`, the start of the app in most e2e tests                                                         | 60 → 120 s       | 63.7 s, failed                                                                                          | image, review of PR 3 on PR 2 (`3a961ce`) beside other containers                  |
  | `scenes.spec.ts:54`, the start scene                                                                                      | 60 → 120 s       | 59.9 s                                                                                                  | image, review of ADR 0020 beside more load                                         |
  | `scenes.spec.ts:254`, "a preset chosen while the engine starts"                                                           | 60 → 120 s       | 53.7 s                                                                                                  | image, PR 2 alone (`a5631bc`) in the review of PR 3 on PR 2                        |
  | `app.spec.ts:92` and `app.spec.ts:100`, the starts before and after "Start fresh"                                         | 60 → 120 s       | 45.0 and 49.9 s                                                                                         | image, `3a961ce`, and a review of PR 2 beside more containers                      |
  | `app.spec.ts:9`, the engine of the boot test                                                                              | 60 → 120 s       | 36.8 s                                                                                                  | image, review of ADR 0020 beside more load                                         |
  | `app.spec.ts:67`, the start after the grid is fitted to the device memory                                                 | 60 → 120 s       | 33.5 s                                                                                                  | image, `3a961ce`                                                                   |
  | `app.spec.ts:39`, 60 steps on WebGL2                                                                                      | 60 → 120 s       | 24.8 s                                                                                                  | image, review of ADR 0020 beside more load                                         |
  | `app.spec.ts:15`, 30 steps of the boot test                                                                               | 60 → 120 s       | 17.1 s                                                                                                  | image, review of ADR 0020 beside more load                                         |
  | `ready()` at `scenes.spec.ts:306`, after both page loads of "a boundary or a Clear chosen while the engine starts"        | 60 → 120 s       | not timed: the same start as line 254                                                                   | no timed run had this test                                                         |
  | `link.spec.ts`, the six waits for an engine and its environment (PR 5, #21)                                               | 60 → 120 s       | over 60 s, failed twice on `main` (`9c1f56a`): a new page that opens the link, beside the sender's page | GitHub, run 42970155117                                                            |
  | `engine.gpu.test.ts`, the inoculate tool at 60 and 120 frames per second (PR #26), WebGPU: running / paused               | 60 → 360 / 300 s | 82.0 / 56.8 s on #28 (59.7 / 32.3 s on #26)                                                             | GitHub, PR #26 and #28 (2026-11-11)                                                |
  | `sim.gpu.test.ts`, "give the agents, trail and scent of the sources without the switch while it changes nothing" (PR #28) | 60 → 300 s       | 62.8 s, failed                                                                                          | GitHub, PR #28 (2026-11-11)                                                        |
  | `sim.gpu.test.ts`, "give the agents and trail of the source without the sensor check while no wall is painted"            | 60 → 120 s       | 27.6 s                                                                                                  | GitHub, PR #28 (2026-11-11)                                                        |
  | `sim.gpu.test.ts`, "keep the plateau of a large food at every scent decay in the extended model" (PR #28)                 | 60 → 120 s       | 25.5 s                                                                                                  | GitHub, PR #28 (2026-11-11)                                                        |
  | `sim.gpu.test.ts`, "places agents on free cells only" (PR #26)                                                            | 60 → 120 s       | 24.0 s                                                                                                  | GitHub, PR #28 (2026-11-11)                                                        |
  | `sim.gpu.test.ts`, "keep trail + scent equal to Jones' one trail map" (PR #28)                                            | 60 → 120 s       | 20.4 s                                                                                                  | GitHub, PR #28 (2026-11-11)                                                        |
  | `scenes.spec.ts:434`, the notice of the missing rule (it stays 12 s)                                                      | 20 → 40 s        | 12.1 s                                                                                                  | image, PR 2 in the review of ADR 0020                                              |
  | Each e2e test on CI (`playwright.config.ts`)                                                                              | 120 → 240 s      | 1.4 min; 22 of the 28 timed tests above 30 s                                                            | image, `3a961ce` and `a5631bc`                                                     |
  | `gl/sim.gpu.test.ts`, "counts alive agents exactly", without float blending                                               | 60 → 120 s       | 68.1 s, failed                                                                                          | image, review of ADR 0020 beside more load                                         |
  | `gl/sim.gpu.test.ts`, "counts deposits exactly far above 2048 agents", without float blending                             | 60 → 120 s       | 27.4 s                                                                                                  | image, review of ADR 0020 beside more load                                         |
  | `gl/sim.gpu.test.ts`, "never blends into a 32-bit float target"                                                           | 60 → 120 s       | 30.5 s                                                                                                  | image, `3a961ce`                                                                   |
  | `gl/sim.gpu.test.ts`, "finish() resolves only after the GPU has run the work"                                             | 60 → 120 s       | 26.0 s; on GitHub 22.0 s                                                                                | image, PR 3 on PR 2 after its review fixes (`59a66ee`); GitHub, `main` (`7ac3981`) |
  | `engine.gpu.test.ts`, "switching one agent per cell restarts the population"                                              | 60 → 120 s       | 26.9 s                                                                                                  | image, `59a66ee`                                                                   |
  | `engine.gpu.test.ts`, "keep the outlines on the side of env across arena switches", WebGL2                                | 60 → 120 s       | 21.5 s                                                                                                  | GitHub, PR 6 (`17197ac`)                                                           |
  | `sim.gpu.test.ts`, "paints 5000 strokes in one call", WebGPU                                                              | 60 → 120 s       | 20.3 s; on GitHub 16.1 s                                                                                | image, `3a961ce`; GitHub, PR 3 (21:44 UTC)                                         |
  | `sim.gpu.test.ts`, "build the passes for walls at the first wall", WebGL2                                                 | 60 → 120 s       | 16.6 s                                                                                                  | image, review of ADR 0020 beside more load                                         |
  | `sim.gpu.test.ts`, Fig. 10, WebGPU                                                                                        | 600 → 1,200 s    | 271.3 s                                                                                                 | GitHub, `main` (`5e4d934`)                                                         |
  | `sim.gpu.test.ts`, the hook that builds the backend, WebGPU                                                               | 180 → 360 s      | 109.2 s                                                                                                 | image, review of ADR 0020 beside more load                                         |
  | `engine.gpu.test.ts`, the hook that builds both backends                                                                  | 180 → 360 s      | 106.5 s                                                                                                 | image, review of ADR 0020 beside more load                                         |
  | `lattice.gpu.test.ts`, each test (ADR 0026, new)                                                                          | 240 s            | at most 26.8 s; 21.1 s in the review, 38.0 s for an earlier, heavier version                            | SwiftShader on an M3 Pro (macOS) beside other work, 2026-11-11                     |
  | `sim.gpu.test.ts`, "release the covered-food factor of the scent where an agent covers it", in each order (ADR 0027)      | 60 → 120 s       | 3.9 s, 15.6 s at four times                                                                             | SwiftShader on an M3 Pro (macOS), alone, 2026-11-12                                |
  | `lattice.gpu.test.ts`, the hook that builds both backends (ADR 0026, new)                                                 | 360 s            | about 24 s; about 21 s in the review                                                                    | SwiftShader on an M3 Pro (macOS) beside other work, 2026-11-11                     |
  | `tests/e2e/lattice.spec.ts`, each test (ADR 0026, new)                                                                    | 240 s (CI)       | at most 39.8 s (the pointer on 1280 × 720, WebGPU)                                                      | SwiftShader on an M3 Pro (macOS) beside other work, 2026-11-11                     |
  | `sim.gpu.test.ts`, growth and shrinkage, the hook that builds the passes of growth, a capacity and walls (ADR 0025, new)  | 180 s            | 4.7 s (WebGL2), 2.0 s (WebGPU)                                                                          | SwiftShader on an M3 Pro (macOS) beside other work, 2026-11-11                     |
  | `sim.gpu.test.ts`, the hook of the start passes without the capacity (ADR 0025, new)                                      | 180 s            | 4.4 s (WebGL2), 2.0 s (WebGPU)                                                                          | SwiftShader on an M3 Pro (macOS) beside other work, 2026-11-11                     |
  | `sim.gpu.test.ts`, "keeps one agent per cell and the alive count of the stats after every step" (ADR 0025, new)           | 150 s            | 4.6 s in the review (WebGL2), 2.1 s after the hooks                                                     | SwiftShader on an M3 Pro (macOS) under load, 2026-11-11                            |
  | `engine.gpu.test.ts`, "starts about 50 agents on the bottom-right food of the Foraging maze" (ADR 0025, new)              | 150 s            | 7.6 s (WebGL2), 5.0 s (WebGPU); 6.3 and 2.6 s in a later run                                            | SwiftShader on an M3 Pro (macOS) beside other work, 2026-11-11                     |
  | `tests/e2e/growth.spec.ts`, the start of the app in each test (ADR 0025, new)                                             | 150 s            | 32.0 s in the review; each whole test at most 27.0 s of 240 s (the Foraging maze)                       | SwiftShader on an M3 Pro (macOS) beside other work, 2026-11-11                     |
  | `tests/e2e/lattice.spec.ts`, the read of the painted food cell under the pointer (ADR 0026)                               | 5 → 60 s         | one read 3.6 s; failed on WebGPU and WebGL2 at 1280 × 720, as only one read fit in 5 s                  | GitHub, PR #32 (run 43113320425, 2026-11-11)                                       |
  | `tests/e2e/growth.spec.ts`, the buffer after the rebuild for a new Capacity (ADR 0025)                                    | 5 → 120 s        | not timed: a rebuild is a start of the simulation (the starts above: up to 32 s)                        | from the starts above                                                              |

  Each GPU test in the table gets its limit as the third argument of `it()`, so `testTimeout` in
  `vitest.config.ts` stays 60 s for the other tests. A limit on a line in `describe.each` applies to
  each backend or counting path: Fig. 10 on WebGL2 (at most 88 s) and the hook for WebGL2 (under
  1 s) also get the longer limits. `ready()` also serves the two waits after a rebuild in its test,
  so they get 120 s too. The e2e limit is in `playwright.config.ts`, for every test: each e2e test
  starts the app, and in all tests but one the start alone may now take 120 s, the old limit of a
  whole test. "without the rule in this browser" calls `test.slow()` and so gets 720 s. These waits
  stayed below a quarter and keep their limits: the WebGL2 start at `scenes.spec.ts:426` (4.4 s of
  60 s), the notices at `app.spec.ts:66` and `scenes.spec.ts:46` (under 1 s), the other waits for a
  new grid and the polls of the environment (at most 3.5 s of 30 or 60 s), the default 5 s of
  `expect` (at most 1.1 s), the other GPU tests (at most 14.4 s of 60 s), the hook of the other
  agent shaders (3.3 s of 180 s), and on GitHub the connection of the test browser (under 6 s of
  180 s) and the start of the preview server for the e2e tests (under 3 s of 60 s).

  The other GPU tests of growth and shrinkage (ADR 0025) keep 60 s: at most 2.4 s on SwiftShader on
  an M3 Pro beside other work (2026-11-11), once the two hooks above have built the passes that the
  first test paid for before (12.8 s in the review). The four growth steps against the CPU copy took
  0.2 s, and their limit of 150 s went back to 60 s.

- The verify job keeps its limit of 30 min (`.github/workflows/ci.yml`). A limit adds no time to a
  wait that passes. On GitHub the verify jobs of PR 2, 3, 5 and 6 took 12.8 to 18.0 min. PR 6 on
  PR 3 (`f099dd1`) took 12.9 min: its GPU project (419 tests) 281 s, Fig. 10 on WebGPU 92 s and its
  e2e suite 7.1 min. The longer limits only let a slow run go on longer before a test fails. In the
  slowest of these runs (18.0 min, of which Fig. 10 took 3.4 min), the job's limit ends a run whose
  Fig. 10 takes more than about 15 min, before the test's own limit of 20 min. An e2e test that runs
  into its limit now costs up to 8 min with its retry, against 4 min before: one such test fits in
  that run, two do not.
