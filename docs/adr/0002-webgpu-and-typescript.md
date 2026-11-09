# 0002: WebGPU compute shaders with a TypeScript host

- Status: accepted
- Date: 2026-11-08

## Context

Requirements: performant, large scale, high visual quality, interactive, runs in the browser.
The workload is data-parallel: every step updates every agent and every grid cell
independently ([design §3](../design.md#3-simulation-on-the-gpu)). Sage Jenson ran 5–10 M
agents in real time on a GPU ([variants](../knowledge-base/variants.md#sage-jenson-2019)).
Fogleman's Go CPU version renders still images offline. The host side only issues a few
dispatches per frame, so the speed of the host language does not matter.

## Options

1. **TypeScript + WebGPU (WGSL compute shaders).** Compute passes, storage buffers, integer
   atomics, workgroup memory, timestamp queries. Direct browser API without glue code.
   Small bundle, best debugging and test tooling.
2. **Rust → WebAssembly with wgpu.** Same WebGPU backend in the browser, so no GPU speed gain.
   wgpu's WebGL2 backend has no compute shaders, so it gives no useful fallback either. Adds
   a Rust toolchain, binding glue on every API call, a bigger bundle and slower iteration.
   The UI still needs HTML and JavaScript.
3. **WebAssembly CPU simulation** (SIMD + threads). Threads need `SharedArrayBuffer`, which
   needs COOP/COEP response headers that GitHub Pages cannot set. Even multi-threaded CPU
   code is orders of magnitude slower than a GPU for this workload.
4. **WebGL2 fragment-shader simulation.** Runs everywhere, but has no compute shaders and no
   atomics: no deterministic integer deposit, no collision rule, no GPU histograms. Deposit
   needs point sprites with float blending (an extension).

## Decision

Option 1. All per-agent and per-cell work runs in WGSL. TypeScript only owns state,
parameters, UI and the frame loop. WebAssembly brings no benefit here because the hot loop is
on the GPU.

## Consequences

- The app needs WebGPU; reach and fallback are decided in ADR 0003.
- WGSL shaders are tested in a real browser (ADR 0010); a small TypeScript CPU reference
  model exists only for tests.
