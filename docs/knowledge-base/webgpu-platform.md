# WebGPU platform facts

## Verified locally (2026-11-08)

Probe: Playwright 1.65.0 (Chromium 158.0.8127.18), page served from `http://localhost`.
Script kept in the session scratchpad; the same probe now lives in the e2e test setup.

| Environment                                                          | Launch                                                         | Adapter                                 | Notes                                                                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| macOS 26.6, Apple M3 Pro                                             | headless shell, no flags                                       | `null`                                  | WebGPU blocked in headless shell by default                                                                            |
| macOS                                                                | headless shell, `--enable-unsafe-webgpu`                       | SwiftShader (`isFallbackAdapter: true`) | CPU emulation                                                                                                          |
| macOS                                                                | `channel: 'chromium'` (new headless), `--enable-unsafe-webgpu` | **Apple `metal-3`**, real GPU           | `shader-f16`, `subgroups`, `timestamp-query`, `float32-filterable`, `texture-formats-tier2`, max storage binding 4 GiB |
| Linux container `mcr.microsoft.com/playwright:v1.65.0-noble`, no GPU | headless shell or new headless, `--enable-unsafe-webgpu`       | SwiftShader                             | `timestamp-query`, `float32-filterable`, `subgroups`, max storage binding 1 GiB, 256 invocations/workgroup             |

Facts learned:

- `navigator.gpu` exists only in **secure contexts**. `about:blank` in a fresh Playwright page
  has no `navigator.gpu`; `http://localhost` works.
- `--enable-unsafe-webgpu` is required in headless Chromium to get any adapter.
- SwiftShader gives a functional WebGPU device on GPU-less Linux CI. Expect it to be slow:
  keep CI scenes small.
- `maxComputeWorkgroupStorageSize` is 32 KiB on both SwiftShader and Apple. The WebGPU default
  limit is 16 KiB; shaders that stay ≤ 16 KiB work everywhere without raising limits.
- Preferred canvas format: `bgra8unorm` on both.

## Canvas presentation on GPU-less Linux (research, confirmed locally 2026-11-08)

- With only `--enable-unsafe-webgpu`, compute works on SwiftShader, but `getCurrentTexture()`
  destroys the device ("A valid external Instance reference no longer exists") and the canvas
  stays blank.
- Working set: `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader
--use-angle=swiftshader`. Adding `--disable-vulkan-surface` breaks screenshots in new headless.
  Our e2e test passes with this set in `mcr.microsoft.com/playwright:v1.64.1-noble`
  (24 s for a 512-cell scene).
- macOS arm64 runners have a paravirtual Metal GPU; Chromium uses it only with
  `channel: 'chromium'` (new headless) and `--ignore-gpu-blocklist`.
- `--disable-gpu-watchdog` keeps slow SwiftShader shaders from being killed.
- `ubuntu-latest` moves to 26.04 by 2026-11-19; workflows pin `ubuntu-24.04`.

## Headless Chromium under memory pressure (observed locally 2026-11-08)

- With swap almost full (9.9 of 10 GB) and a busy Docker VM, headless Chrome for Testing
  (Playwright 1.64.1, Metal) lost its GPU process on scenes with about 3 million agents or more:
  first Chromium's own compositor device ("[Device] is lost", `dawn_context_provider.cc`), then
  "Restarting GPU process due to unrecoverable error", exit code 8704. The page then sees
  "A valid external Instance reference no longer exists".
- Metal API validation (`MTL_DEBUG_LAYER=1`) and Dawn backend validation reported no error, and
  every shader loop has a fixed bound. The same preset (cyclones, 5.2 to 6.3 million agents)
  ran without loss in the desktop app's Chromium. Earlier the same day, with less load, the
  headless gallery rendered large scenes.
- Workaround for the gallery: `GALLERY_RESOLUTION=1024` (or lower), or render in a normal
  browser window. The README images were made that way.
- In a Docker VM that shares its CPUs with a busy kind cluster, Vitest's browser page needed
  more than 60 s to connect (now `browser.connectTimeout: 180_000` in `vitest.config.ts`), and
  the app's engine was still not ready after 10 minutes. Chromium's compositor drew no frame
  after the first 9 s, so its GPU process was busy; the cause inside it was not measured.

## SwiftShader and the tiled diffuse pass (measured 2026-11-09)

- In new headless mode (`channel: 'chromium'`), `--use-webgpu-adapter=swiftshader` selects
  SwiftShader instead of Metal on macOS: `google swiftshader` with `isFallbackAdapter: true`.
- The diffuse pass (`diffuse.wgsl`) loads a 16 × 16 tile with a 1-cell halo into workgroup
  memory and waits at `workgroupBarrier()`. For comparison, a plain variant let each invocation
  load its own 3 × 3 neighbourhood: same math and summation order, no workgroup memory, no
  barrier. After 200 steps (200 × 200 cells, 6000 agents, collisions) both gave identical trails
  for wrap, box and dish, on SwiftShader and on Metal.
- Setup: Apple M3 Pro, macOS 26.6.2, Chromium 156.0.8078.4 (Playwright 1.64.1), Vitest browser
  mode. Time per step: N steps after 5 warm-up steps, from the first submit to
  `device.queue.onSubmittedWorkDone()`, divided by N (N = 60 on SwiftShader, 200 or 300 on
  Metal). Two rounds each. An "empty, 1 agent" step runs the diffuse pass, a pass for one agent
  and two buffer clears.

  | Adapter     | Scene                                           | Tiled        | Plain      |
  | ----------- | ----------------------------------------------- | ------------ | ---------- |
  | SwiftShader | 200 × 200, empty, 1 agent                       | 16.3–16.5 ms | 2.7–2.8 ms |
  | SwiftShader | 200 × 200, Fig. 10 (collisions, 6000 agents)    | 18.1–19.9 ms | 4.1 ms     |
  | Metal       | 1536 × 1024, empty, 1 agent                     | 1.9–2.1 ms   | 2.7–2.8 ms |
  | Metal       | 2048 × 2048, empty, 1 agent                     | 5.0–5.2 ms   | 6.7–6.8 ms |
  | Metal       | 1536 × 1024, 1.57 million agents, no collisions | 12.3–12.5 ms | 13.0 ms    |

- On Metal the tile saves about 25 % of an "empty, 1 agent" step and about 4 % of the step with
  1.57 million agents, so the app keeps it. Other GPUs were not measured.
- One command buffer for 100 steps instead of one per step (timed to `readTrail()`) changed
  little on SwiftShader: 18.6 against 19.0 ms per step.
- CI (Linux x86-64 SwiftShader) was not profiled, so the share of the tile in the CI time is
  unknown. There the Fig. 10 test (2000 WebGPU steps) took 102, 204, 213 and over 240 s on
  identical code (2026-11-08 and 09). Its WebGL2 run, which has no workgroup tile, took 31 to
  69 s. The test's timeout is now 600 s (ADR 0010).

## Cost per pass on Metal (measured 2026-11-10)

- Setup: Apple M3 Pro (18-core GPU), macOS 26.6.2, Chromium 156.0.8078.4 (Playwright 1.64.1) in
  new headless mode with the flags of `tests/browser.ts`, production builds served locally,
  viewport 1280 × 720. Default scene (three strains): grid 1536 × 864, 3 981 312 agents,
  diffusion 2, seed fixed by a seeded `Math.random`. Other sessions used the GPU throughout (46
  to 98 % device utilisation with the page idle, from `ioreg`), so every comparison ran paired:
  in one page at the same simulation state, or, for the frame loop and `alive()`, with both
  builds alternating in one browser page (base, new, new, base), each run from step 0 with the
  same seed.
- Compute passes: timestamp queries, one pass per dispatch while measuring. They agree with wall
  time (the research found within about 5 %).
- Render passes: wall time only. Metal render-pass timestamps over-count: for the 10 render
  passes of one frame they summed to 50.3 ms, against 2.2 ms of wall time (the research saw
  about 10×).

GPU time per step, ms. "Init order" is the agent buffer in id order, the layout of `main` before
the sort (ADR 0005); "sorted" is the app's sort every 32 steps, its cost included.

| Step | Step, init order | Step, sorted | Agent pass, init order | Agent pass, sorted | Diffusion (2 passes) | Sort, per step |
| ---- | ---------------- | ------------ | ---------------------- | ------------------ | -------------------- | -------------- |
| 0    | 7.6              | 4.7          | 6.2                    | 2.8                | 2.0–2.5              | 0.07           |
| 1000 | 11.0             | 4.8          | 7.8                    | 2.5                | 2.0–2.2              | 0.07           |
| 3000 | 17.3             | 5.2          | 14.8                   | 3.0                | 2.1–2.4              | 0.06           |
| 5000 | 20.4             | 5.4          | 16.6                   | 3.0                | 2.4–2.5              | 0.06           |

- One sort at 4 million agents: count 0.5–0.7 ms, prefix sum 0.06 ms, scatter 1.1–1.5 ms
  (medians at steps 0 to 5000). It moves about 190 MB, close to what the memory bandwidth
  allows. A variant with one atomic per run of equal tiles instead of one per agent was not
  faster. A frame with a sort took 1.4–2.4 ms longer at 1280 × 720 and 1.7–4.2 ms at
  3024 × 1890 (wall time, one step and a draw).
- Draw: 2.2 ms per frame with bloom at 1280 × 720; the main render pass alone 1.35 ms (glow),
  1.7 ms (gel). At 2560 × 1600: glow 1.8 ms, gel 2.25 ms, and the gel before its height pass
  (ADR 0009) 8.0 ms.
- Food, light and walls (ADR 0009, amendment 2026-11-10), paired in one page against the render
  pass before it, at the same state, 2560 × 1600, median of the paired differences of 21 rounds of
  20 passes (wall time), two runs: with nothing painted the pass costs less, 0.015–0.19 ms on
  WebGPU and 0.025–0.115 ms on WebGL2, because it no longer reads `env` per pixel. With the walls
  and food of Maze, Shortest path or Shrinking plasmodium it costs 0.115–0.275 ms more fitted and
  0.24–0.35 ms more zoomed 6× onto food (WebGL2: 0.11–0.40 and 0.22–0.36 ms). Presence adds at
  most 0.05 ms. The brush's outline pass adds 0.025–0.3 ms per stroke of radius 60 to 400 cells
  (WebGL2 0.025–0.58 ms).
- Integer remainders are slow in shaders on Metal: wrapping each of the 3 × 3 cells around a
  pixel with `((c % s) + s) % s` (two remainders per axis and cell) cost 1.3 ms per frame at
  2560 × 1600 in the Transport network (1024 grid). Wrapping the middle cell once and its
  neighbours with comparisons cost 0.1 ms. The outline pass, which looks up to 120 cells of `env`
  around a cell, went from 127 to 71 ms for 4096 batched strokes the same way.
- A branch does not save the remainder (measured 2026-11-12, ADR 0028). On WebGL2, ANGLE over
  Metal, a wrap that takes the remainder only outside one period of the grid cost as much as the
  plain remainder when every lookup of a pixel ran it: 4.1 to 4.3 ms a frame at 1.01 cells per
  pixel (16 lookups a pixel, 2560 × 1600), against 1.9 ms with no remainder in the shader. On
  WebGPU the same wrap cost 1.97 against 1.69 ms. So wrap once per pixel or per lookup, and take
  the neighbours by comparison.
- Reads far apart miss the cache: 16 cells of the trail per pixel, 8 cells apart from those of
  the next pixel, cost 27.7 ms a frame; the 3 × 3 texels of a map of the mean, next to those of
  the next pixel, 1.9 ms (ADR 0028). The same holds for a texture of zeros as large as the grid:
  the scent read of 3 sensors per agent and of the diffusion cost 13 to 15 % of a step until it
  came from a texture of one texel.
- The largest number of agents of one strain that moved into one cell in a step: 29 083 at step
  600 (sampled every 50 steps), about 4100 at step 1000 and 800 to 950 from step 3000 on.
- The research (2026-11-09, same machine, without the sort) measured the agent pass at 3.1 ms at
  step 100 and 20–21 ms at steps 3000 to 4000; a second measurement found the late values 30 to
  45 % lower. Late, memory-bound timings swing between runs, which is why only paired numbers
  count here.

Real frame loop, 60 s per run, headless (rAF at 60 Hz): `main` (79b6679) against this branch,
alternating in one browser page as above, two runs of each. The page reports itself hidden, so
neither build's startup check changes the grid. A fifth series, the default scene at
1280 × 720 with the check on, gave the same numbers, and the branch kept its grid.

| Scene                              | Canvas      | `main`: fps, steps/s, steps per frame      | `main`: longest frame | Branch: fps, steps/s, steps per frame | Branch: longest frame |
| ---------------------------------- | ----------- | ------------------------------------------ | --------------------- | ------------------------------------- | --------------------- |
| Default, density 3 (4.0 million)   | 1280 × 720  | 13.4, 74, 5.5 (last 30 s: 7.5 fps)         | 233 ms                | 60.0, 120, 2.0                        | 16.8 ms               |
| Default, density 3 (4.4 million)   | 3024 × 1890 | 10.8–10.9, 66, 6.1 (last 30 s: 6 fps)      | 250 ms                | 60.0, 120, 2.0                        | 16.8 ms               |
| Default, density 1 (1.3 million)   | 1280 × 720  | 46–48, 120, 2.5–2.6 (last 30 s: 38–40 fps) | 67 ms                 | 60.0, 120, 2.0                        | 16.8 ms               |
| Cyclones (1024 × 576, 4.7 million) | 1280 × 720  | 6.6–6.7, 79–80, 11.9                       | 367–383 ms            | 60.0, 120, 2.0                        | 16.8 ms               |

On `main`, 300 to 620 frames per run took longer than 20 ms; on the branch none did.

Startup check under a browser frame cap (2026-11-10, same machine, page visible, default scene
at 1280 × 720, 18 s per run): an init script let every animation frame wait one more vsync, so
the page got 30 fps, as in iOS Safari's Low Power Mode. `main` and the branch before the browser
rate counted (`src/ui/tune.ts`) both lowered the grid from 1536 to 1024 and then to 768,
although the GPU kept up. With it, every frame started with the GPU idle (rate 30 fps), and the
grid stayed at 1536 with 4 steps per frame, 120 steps/s. Uncapped (60 fps), no build changed the
grid.

WebGL2 (`?backend=webgl2`, same machine, paired as above, 16 calls per run): `alive()` blocked
the main thread for 90–93 ms per call at 1 million agents (median; 42–43 fps) and 570–575 ms at
4 million (1.8 fps). Now a call takes 0.1–0.3 ms and resolves 7–8 ms (1 million) or 158–161 ms
(4 million) later, without blocking; at 1 million agents the frame loop runs at 60 fps and
120 steps/s, at 4 million at 46–48 fps with one step per frame.

## Many small passes (measured 2026-11-10)

Same machine (M3 Pro, Metal), Chromium of Playwright 1.65.0, paired in one page with the GPU shared
with other work. The replay of ADR 0019 paints up to 100,000 brush segments in one call, each with
an outline (ADR 0009, item 11).

- WebGPU runs the dispatches of a compute pass one after another. A paint dispatch over a box of
  about 26 × 26 cells took 2.9 µs, an outline dispatch that returned at once 2.0 µs more (20,000
  segments, grid 1536 × 864). So two dispatches per segment cost about 0.5 s per 100,000 segments
  before any work in them.
- Loads in a loop with early exits run one after another: the outline pass searched up to 5 rings
  of `env` (120 cells per layer) and the cone of the shadow (25 cells) for each cell, and took
  12.5 µs per dispatch. Loading the 16 × 16 cells of a workgroup and 5 cells around them into
  workgroup memory once, and taking the nearest cell of a layer from a Chebyshev distance along
  the rows and then the columns of that tile, gave the same bytes and made a replay of 100,000
  strokes 0.73 s instead of 1.49 s.
- WebGL2 (ANGLE on Metal): a draw into the target that the last draw used costs little (PR 2
  painted 100,000 scissored strokes in 0.06 s), but a draw into another target that reads the one
  before as a texture costs about 55 µs for the change and back. So WebGL2 draws the outlines of a
  run of segments after the paint draws of the run, and combines them with `MIN` and `MAX` blending,
  which give the same bytes in any order.
- Timing single strokes: the fence that `finish()` polls resolves in steps of about 1 ms, and a wait
  for the GPU costs about 0.12 ms on WebGL2 and 0.04 to 0.09 ms on WebGPU before any work. So a
  stroke is timed as 32 calls at different places along a drag, each as a frame paints it, and one
  wait after them. In blocks of 16 strokes with a wait each, PR 2's paint alone came out at 3.4 to
  3.8 ms per stroke at every radius and grid: the cost of the block, not of the stroke (review,
  2026-11-10). `EXT_disjoint_timer_query_webgl2` around every draw gave 11 to 28 ms per draw for
  strokes that take 1 to 4 ms in all: the queries change how ANGLE submits the draws.
- A condition that is the same for a whole pipeline is best an override constant. The outline pass
  of WebGPU with run-time tests for the tile, the core of a wide eraser and the search of a stroke's
  own cells took 10 to 14 % longer for replays of walls and erasers than the pass before those
  tests; as six pipelines with the conditions fixed, 3 % less to 1 % more (ADR 0009, item 11). The
  search, which never runs on the periodic grid, made every dispatch slower by its registers alone.
- On the periodic grid both paint passes measure a cell against the 9 copies of its segment once
  the brush reaches past an edge. Measuring only the copies whose box, grown by the reach, holds
  the cell (one or two per axis) made large brushes no faster on either backend (within 3 % at a
  radius of 1,000 cells, paired against the code before), and 7 to 37 % slower at 1,920 cells: the
  loop with bounds per cell costs more than the distances it saves. The 9 copies stay.
- SwiftShader (the CI image) runs workgroup barriers on the CPU: a GPU test that paints 5000
  strokes in one call took 0.53 to 0.69 s with the outline pass reading `env` directly and 2.41 to
  3.37 s with workgroup memory (three runs each). Workgroup memory pays off on a real GPU only.
  With food and light outlined without it, the test took 1.44 to 1.62 s on WebGPU (1.93 to 1.96 s
  before, in the same containers), and 4.65 to 5.18 s on WebGL2 (3.21 to 3.45 s), where SwiftShader
  runs the larger fragment shader of the outlines on the CPU.
- Other work on the host slows both sides of a pair, not one: with a load average of 5 to 7 (other
  test runs and a virtual machine), every replay of 100,000 strokes in ADR 0019 took 30 to 60 %
  longer than the same replays measured earlier that day, the JavaScript part on WebGL2 most. Two
  source trees with the same paint code still came out within 3 % of each other in one page.
  Compare ratios measured in one page, not times measured at different hours.
- SwiftShader compiles a compute pipeline in about 1.3 s when it holds the outline pass: a new
  WebGPU device with every pipeline and a first simulation took 16.2 to 16.8 s with six outline
  pipelines and 9.4 to 10.4 s with one. On Metal both took 6 to 18 ms, with Chrome's shader cache.

## WebGL2 point passes on a tile-based GPU (measured 2026-11-12)

- Setup: Apple M3 Pro, headed Chromium 158 (Playwright 1.65), WebGL2 on ANGLE over Metal, production builds served
  locally, canvas 2560 × 1600. The start scene (Three strains) on a grid of 1536 × 960 with 4,194,304 agents (the
  WebGL2 limit of 2^22). Other sessions used the GPU at the same time, so each comparison ran in one page, the variants
  in a rotating order, the median of three passes over them. Times are wall time of 8 draws between fences.
- `EXT_disjoint_timer_query_webgl2` is there, but its times overlap: the queries of the draws of one step summed to
  60 ms against 27 ms of wall time, also with `gl.flush()` around each query. Per pass, ADR 0028 uses the wall time of a
  step that runs only that pass.
- The deposit (`points.vert` kind 0): one 1-pixel point per agent into the `RGBA32F` counts with additive blending,
  in the order of the agents' indices. 13.3 to 15.3 ms one step after a reset, 15.7 to 22.2 ms after 400 steps.
- After 400 steps 7.0 to 7.5 % of the cells hold the agents that moved: 38 to 41 per cell on average, a median of 5 to
  6, a 99th percentile of 504 to 563, and up to 4211 to 9602 in one cell.

| Variant of the deposit, after 400 steps                                   | ms per draw      |
| ------------------------------------------------------------------------- | ---------------- |
| as in the app                                                             | 15.7–22.2        |
| without blending                                                          | 19.4             |
| into `R32F`, `RGBA16F`, `RGBA8`                                           | 19.8–22.6        |
| a vertex shader for the deposit only; the strain as `uint`; no varying    | 19.8–21.2        |
| every point culled in the vertex shader                                   | 1.1–1.3          |
| point k to pixel k mod cells: neighbours in the order lie side by side    | 3.1–4.2          |
| each point to a random pixel of its own 32 × 32 tile                      | 21.1             |
| each point to a random pixel anywhere                                     | 26.7             |
| every point to one pixel                                                  | 357              |
| agents reordered on the CPU: by cell; by 32 × 32 tile and cell; at random | 58.5; 52.9; 41.1 |

- The cost follows the order of the points on the screen. Blending, the target format and the vertex work change it by
  less than the spread of the runs. Points that follow each other in scattered tiles are slow, points that follow each
  other in a band of neighbouring pixels are fast. Apple GPUs sort the primitives of a render pass into screen tiles
  before they shade them (tile-based deferred rendering). The binning of scattered points is the likely cause; GPU
  counters that would show it were not available. A second cost comes from many points on one pixel, which blend one
  after the other: in an order sorted by cell the agents of a dense cell follow each other, and that is slower than
  the scattered order.
- The deposit in k draws, each drawing only the points inside one block of the grid (the vertex shader culls the
  others): 15.5, 17.3 and 25.2 ms for 4, 8 and 16 bands against 15.7 ms. Less the 1.3 ms of vertex work per draw, the
  binning part falls from 14.4 to 10.3, 6.9 and 4.3 ms: fewer tiles in a draw cost less.
- An order through an index texture (`R32F`, read in the vertex shader), sorted on the CPU by a bucket, stable inside
  the bucket. Through the texture in the agents' own order: 22.5 ms (base 20.2). By bands of 480, 240, 120, 60, 32 and
  16 rows: 18.7, 15.2, 13.2, 12.7, 11.1 and 12.3 ms. By square tiles of 128, 64, 32, 16 and 8 cells: 10.0, 9.2, 10.3,
  14.7 and 18.7 ms: small tiles put the many agents of a dense cell close together in the order.
- The agents of a cell spread over M texels by index, then a pass sums them: without an order no gain (16.4 to 16.5 ms
  for 2 texels, 21.4 to 22.3 for 4, 28.8 to 35.0 for 8, against 19.4 with the clear). With the order by 64 × 64 tiles
  (one run, 22.8 ms as in the app): the order alone 9.2, with 2 texels side by side 6.5, with 2 grid copies 7.1, with
  4 texels 7.4, with 8 texels 10.0 ms. Tiles of 128: 8.1 (2 texels). Tiles of 32: 6.8 (4 texels).
- The sort of the order in fragment passes (`order.frag`, an LSD radix sort of 2 bits a pass over 361 keys: 5 passes).
  With a pyramid of a fan-in of 16 the whole sort took 30 to 36 ms, 27 to 28 of them in the gathers, which read up to
  15 children per level one after the other. All children read first: 41 ms. One sampler per level in place of a
  choice between six: 30 ms (gathers 24). A fan-in of 4 with one sampler per level: 24 ms (gathers 12, the 55 level
  passes 7.7, the keys 1.5 to 1.9). The counts were equal bit for bit in every variant.
- In the app's step the 2 texels gave nothing (8 paired rounds, ADR 0028 decision 14): the deposit 0.57 ms less, the
  wider clear 0.23 ms and the sum pass 0.64 ms more, the step × 0.995 (0.93 to 1.05). The app deposits into one texel
  per cell.
- How the order ages, in the app's build (one texel per cell, 3 rounds): the deposit with its clear, some steps after a
  sort, 6.4–7.5 ms at once, 8.0–9.4 after 16 steps, 8.3–9.0 after 32, 10.7–11.3 after 64 and 11.6–12.7 after 128,
  against 14.4–16.2 ms in the agents' own order. In the lab with 2 texels per cell: 7.7–8.8 after 8 steps against
  18.9–20.6 ms, 8.4–9.5 after 32, 10.0–11.4 after 64, 11.6–14.3 after 128.
- Not measured: a GPU that renders without tiles (desktop GPUs of other makers). There the scattered order may cost
  less, and the sort costs its 0.6 ms per step all the same.

## Feature availability (web3dsurvey share of WebGPU devices)

| Feature                                      | Chrome | Safari 26–27                 | Firefox         |
| -------------------------------------------- | ------ | ---------------------------- | --------------- |
| `timestamp-query`                            | 99.5 % | 92.4 %                       | 99.96 %         |
| `shader-f16`                                 | 93.1 % | 99.99 %                      | 92.2 %          |
| `float32-filterable`                         | 95.5 % | 60 % (iOS 57 %)              | 99.4 %          |
| `subgroups`                                  | 84 %   | not in stable                | not implemented |
| `rgba16float` canvas + extended tone mapping | 129+   | code path exists, unverified | no              |

`maxStorageBufferBindingSize`: only 128 MiB is guaranteed without `requiredLimits`; 92 % of
devices allow ≥ 1 GiB, iOS at most 1 GiB, 38 % of Android devices ≥ 1 GiB.
