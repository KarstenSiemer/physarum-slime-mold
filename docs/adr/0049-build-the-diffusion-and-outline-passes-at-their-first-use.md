# 0049: Build the diffusion and outline passes at their first use

- Status: accepted (decision of a helper, 2026-11-16, under the owner's delegation of 2026-11-12), built 2026-11-16
- Date: 2026-11-16
- Extends ADR 0010 (the time of the e2e tests in CI) and ADR 0020 (passes built at their first use).

## Context

The job `verify-e2e (1/2)` of CI has a limit of 30 minutes. It grew close to it, and over it:

- On `main` it took 21 min at `6d8d23a` and 26 min at `e3f5c30`, for the same code (`6d8d23a` changed only TODO.md).
  The runners of GitHub differ that much.
- PR #91 (the Electrode tool) took 29.3 min: 42 tests in 27.8 min (run 43771412317). PR #92 (the scene Voronoi
  diagram) was cancelled at 30 min, with no failed test (run 43772140287). Shard 2 took 14 to 19 min.

Where the time goes, measured in the image of CI on 4 cores of an M3 Pro on 2026-11-16 (`research/start/`):

- All 83 tests took 67.2 min. The median test took 44.2 s. A test of the panel that runs no step of its own, such as
  "keyboard shortcuts pause, step and switch tools", took 40.3 s.
- Of that, the start of the WebGPU engine took 36.6 to 38.1 s: from the page load to the engine. Its first 5 steps
  took 2 s more. The whole start on WebGL2 took 5.0 s. Every e2e test starts the app at least once.
- The start builds 30 compute pipelines (`Kernels.build` in `sim.ts`). Built one at a time, the ten diffusion passes
  (`diffuse.wgsl`, every pass of 0 to 4 passes in both orders of a step) took 3.8 to 4.4 s each, 39.5 s of 51.5 s. The
  six outline passes (`paint.wgsl`) took 1.1 to 2.0 s each, 9.6 s. The other 14 took 0.6 s or less each, 2.4 s in all.
- A step runs one to three of the ten diffusion passes. A scene without food, light or walls paints no outline.
- Every other pass that not every step runs is already built at its first use: the passes for walls (ADR 0020), for
  covered food, for the view, for a mean window above 3 × 3 (ADR 0046), for growth and for the flow.
- No cache helps. A second start took as long as the first, 36.6 to 37.7 s: the same page again, a new page of the
  same context, a profile on disk, the same profile in a new browser, and with the flags `disable_robustness` or
  `skip_validation` of Dawn or the feature `WebGPUBlobCache` of Chromium.
- The two shards are uneven. Playwright shares the tests out by their count, in the order of the files
  (`filterForShard` in `playwright/lib/runner`). Shard 1 holds the files `app` to `link` and most of `scenes`, with the
  tests that wait for steps and the tests that start the app twice.

So each new feature that changes `diffuse.wgsl` made every e2e test slower, ten times over. ADR 0046 and ADR 0047 both
changed it.

## Options

1. **Build the diffusion and outline passes at their first use**, as the other passes. Every start is shorter, for
   every test and on every slow device. The bytes stay: the passes are the same pipelines with the same constants. The
   first step that needs a pass waits for its compiler: on SwiftShader about 4 s, once per pass and device.
2. **Share one page load between tests** (serial groups). The tests then depend on the state that the tests before
   them left, and a failure hides the checks after it.
3. **Run the tests of the panel on WebGL2** (5.0 s a start). They then no longer test the WebGPU engine, which most
   people run.
4. **More shards or a longer limit** (`.github/`, the owner's review). The start stays slow, and every new pass still
   adds to every test.
5. **Balance the shards by the order of the files.** It helps where option 1 does not: on GitHub the steps, not the
   start, take the time of the tests that wait for steps. But the total time stays, and new tests move the split.

## Decision

Options 1 and 5. `Kernels.diffuse()` and `Kernels.outline()` build a pass at its first use and keep it, as
`Kernels.covered()` does. `Kernels.build()` builds the other 14 passes at the start, as before. WebGL2 is
unchanged: its engine existed 0.8 s after the page load, with all its programs.

With option 1 alone, shard 1 still took 25.3 min on GitHub (below). So `tests/e2e/flow.spec.ts` is now
`tests/e2e/tubes.spec.ts`. It sorts after `scenes.spec.ts`, and four of its five tests, which wait for 30 steps of a
scene with the flow, run in shard 2 beside the short tests of `ui.spec.ts`.

The e2e test of the Electrode tool read the address once a drawing had more than one stroke. A drag records a dab and
its segments, so that read could come before the anode, and it did in both runs of the test on `main` in the image
of CI. It now waits until the address holds both poles.

## Consequences

The e2e tests in the image of CI, `main` (`83d5fc2`) against option 1 (`7a71a45`, before the new name of the file),
the first run of each test:

| Tests             | Count | `main` (min) | Here (min) |
| ----------------- | ----: | -----------: | ---------: |
| `app.spec.ts`     |     4 |          3.7 |        1.0 |
| `flow.spec.ts`    |     5 |          6.0 |        3.2 |
| `growth.spec.ts`  |     4 |          3.3 |        1.0 |
| `lattice.spec.ts` |    10 |          5.6 |        1.6 |
| `link.spec.ts`    |     4 |          4.9 |        1.6 |
| `scenes.spec.ts`  |    19 |         16.0 |        5.7 |
| `ui.spec.ts`      |    37 |         27.8 |        8.5 |
| shard 1 of 2      |    42 |         36.6 |       13.2 |
| shard 2 of 2      |    41 |         30.6 |        9.5 |
| all               |    83 |         67.2 |       22.6 |

- The engine exists 1.8 to 3.1 s after the page load, against 36.6 to 38.1 s. The first 5 steps end about 6 s
  later: the first step builds its diffusion pass.
- The median test took 13.2 s, against 44.2 s. "Keyboard shortcuts pause, step and switch tools" took 8.6 s.
- On GitHub, option 1 helped less (PR #94, run 43793768936). Shard 2 took 10.6 min (41 tests in 9.4 min; `ui.spec.ts`
  8.7 min, against 17.0 on PR #91). Shard 1 took 25.3 min (42 tests in 23.9 min; `flow.spec.ts` 9.3 min, against
  8.2). GitHub compiled the start faster than the image, so it saved less, and it ran the steps about three times
  slower: the five tests of `flow.spec.ts` took 3.2 min in the image.
- With the new name, the same tests split 11.2 and 11.5 min in the image. On GitHub the run of CI of this change gives the number.
- The bytes stay: the digests of every scene after 500 steps on both backends equal those of `main` (48 of 48 runs, M3
  Pro, `research/flow/engine/digest.gpu.test.ts`).
- A GPU test checks that a new simulation builds no diffusion and no outline pass, and that a step and a stroke build
  each pass they use once (`sim.gpu.test.ts`, "build the diffusion and outline passes at their first use").
- To watch: a pass that every start builds adds to every e2e test. Build a pass at its first use unless every step
  runs it. The split by count moves with every new test: a new file of tests that wait for steps, or many new tests
  at the end of the order, can tip the shards again. More shards (`.github/`, the owner's review) would make that
  harder.
