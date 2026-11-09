# 0005: Simulation data layout and determinism

- Status: accepted
- Date: 2026-11-08

## Context

Agents deposit into the cell they move to. Many agents can hit one cell in the same step.
WGSL has no float atomics and no texture atomics. Tests need reproducible results. Jones uses
decay values down to 0.0001 (Fig. 12).

## Options

1. Deposit as float with a compare-exchange loop — slow under contention, order-dependent
   rounding, not deterministic.
2. Deposit as fixed-point `atomicAdd` — deterministic, but scale and overflow must be tuned.
3. **Count agents per cell and strain with `atomicAdd(1)`**, multiply by the strain's deposit
   amount in the diffuse pass — deterministic, no overflow in practice (2³² agents per cell),
   and the counts double as the "agents" view and as occupancy data.
4. Render-pass point sprites with additive blending — needs float blending, no determinism.

Trail precision: `rgba16float` halves memory, but `x · 0.9999` rounds back to `x` for half
floats (10-bit mantissa, relative step ≈ 0.001), so slow decay stops working.

## Decision

- Option 3 for deposit.
- Trail: two `rgba32float` textures (ping-pong), one lane per strain. Scent: two `rg32float`
  textures (ping-pong; `r` food, `g` light, ADR 0007). Read with `textureLoad`; manual bilinear
  filtering where needed, so `float32-filterable` is optional.
- Agents: one storage buffer, 16 bytes each: `pos: vec2f`, `heading: f32`, `meta: u32`
  (strain in bits 0–1, alive in bit 2).
- Environment: one `u32` per cell with packed bytes (wall, food, light), painted by a compute
  pass.
- Random numbers: PCG hash of `(seed, step, agent index, purpose)`. No RNG state in memory.
- Agent dispatch is 2-D when it needs more than 65 535 workgroups.

## Consequences

- A step is deterministic for a given seed on a given GPU and driver. Tests compare buffers
  bit by bit between two runs.
- Memory per cell: 32 B trail + 16 B scent + 16 B counts + 4 B env = 68 B, plus 12 B of
  collision buffers (ADR 0008), which WebGPU allocates even with collisions off
  (`src/engine/sim.ts:76–77`). A 2048² grid needs about 320 MiB; the budget estimate of 84 B per
  cell adds the bloom chain (ADR 0013, `src/engine/sizing.ts:29`). The grid size must follow
  the adapter limits and the device class.
