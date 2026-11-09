# 0003: Browser support and a WebGL2 fallback

- Status: accepted (revised 2026-11-09: fences, readback without stalls, exact counts)
- Date: 2026-11-08

## Context

Requirement: run in all state-of-the-art browsers. WebGPU status on 2026-11-08
([gpuweb Implementation-Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status),
browser sources, [web3dsurvey](https://web3dsurvey.com/webgpu)):

| Platform      | Chrome / Edge                                                          | Safari                          | Firefox (stable 159)                         |
| ------------- | ---------------------------------------------------------------------- | ------------------------------- | -------------------------------------------- |
| Windows x64   | yes (113)                                                              | –                               | yes (141)                                    |
| Windows ARM64 | flag only                                                              | –                               | yes (141)                                    |
| macOS         | yes (113)                                                              | yes from 26.0, macOS Tahoe only | Apple Silicon yes (147); Intel: Nightly only |
| Linux         | Intel Gen12+ (144), NVIDIA on Wayland (147); AMD and others: flag only | –                               | Nightly only                                 |
| Android       | most devices (121)                                                     | –                               | flag only                                    |
| iOS / iPadOS  | –                                                                      | yes from 26.0                   | –                                            |

Devices with a working WebGPU adapter: 82.6 %; with WebGL2: 98.2 % (web3dsurvey). About one
device in six, and most Linux desktops, have WebGL2 but no WebGPU.

## Options

1. WebGPU only, with an explanation page — excludes Firefox on Linux, Chrome on AMD Linux,
   Windows on ARM and macOS before Tahoe.
2. **WebGPU first, WebGL2 fallback** — a second backend that implements the same model with
   fragment shaders.
3. WebGL2 only — no compute shaders or atomics everywhere, gives up the better path.

## Decision

Option 2. The WebGL2 backend keeps the same parameters, presets, UI and tests:

- Agents live in `RGBA32F` textures, updated by a full-screen fragment pass (ping-pong).
- Deposit: agents are drawn as 1-pixel points into a counts texture with additive blending.
  Counts are integers, so blending order does not change the result (deterministic).
- Diffusion, decay and scents: one fragment pass with two render targets.
- Collisions (ADR 0008): claims with `MAX` blending of unique float keys (< 2²⁴, exact in
  float32); needs `EXT_float_blend`, otherwise the switch is disabled.
- Needs `EXT_color_buffer_float`. Without WebGL2 and that extension, the page explains which
  browsers work.
- `finish()` puts a fence (`fenceSync`) into the command stream and polls it with
  `clientWaitSync(…, 0)` from timers; a fence cannot signal within the task that made it. So the
  frame budget (`src/engine/budget.ts`) sees on WebGL2 too when the GPU falls behind.
- Readback without stalls: `alive()` sums the alive agents per strain into a 128 × 128 target
  (agent _i_ into pixel _i_ mod 16 384, so at most 1024 per pixel for 2²⁴ agents, exact in half
  floats too), copies it into a pixel-pack buffer and reads that after a fence; the CPU adds the
  pixels. The auto-levels sample grid uses the same readback. Before, `alive()` drew every agent
  into one pixel and called a synchronous `readPixels`, which blocked the main thread for about
  87 ms twice per second at 1 million agents.

The engine picks WebGPU when `requestAdapter()` returns an adapter and the device starts;
otherwise WebGL2. `?backend=webgl2` forces the fallback for testing.

## Consequences

- Every model change needs a WGSL and a GLSL change. The GPU test suite runs the same
  invariant tests against both backends, so they cannot drift apart silently.
- The fallback has no GPU timestamps and no HDR output. Feature checks happen at runtime.
- Feature data in MDN is wrong for several WebGPU cells (per the research); the code detects
  features instead of trusting tables.
