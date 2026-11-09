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
