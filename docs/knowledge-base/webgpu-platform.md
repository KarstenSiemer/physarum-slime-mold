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
