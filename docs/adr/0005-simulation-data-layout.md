# 0005: Simulation data layout and determinism

- Status: accepted (revised 2026-11-09: agent ids and a spatial sort)
- Date: 2026-11-08

## Context

Agents deposit into the cell they move to. Many agents can hit one cell in the same step.
WGSL has no float atomics and no texture atomics. Tests need reproducible results. Jones uses
decay values down to 0.0001 (Fig. 12).

The GPU runs agents in buffer order. Once the network spreads over the grid, neighbours in the
buffer sit far apart on the grid, and nearly every sensor read and deposit misses the cache. In
the default scene (4 million agents, Apple M3 Pro) the agent pass grew from about 3 ms to about
20 ms per step by step 3000. The same agents reordered by 8 × 8 tile took 2.7 to 2.9 ms. Atomic
contention was not the cause: contended deposits as a separate pass cost about 1 ms
([webgpu-platform](../knowledge-base/webgpu-platform.md#cost-per-pass-on-metal-measured-2026-11-09)).

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
- Agents: two storage buffers of 16 bytes per agent: `pos: vec2f`, `heading: f32`, `meta: u32`
  (strain in bits 0–1, alive in bit 2, **id** in bits 3–26). The id is the agent's slot at init
  and never changes, so at most 2²⁴ agents (`MAX_AGENTS` in `src/engine/webgpu.ts`).
- Spatial sort: every 32 steps a counting sort by 8 × 8 tiles of the agents' cells
  (`src/engine/shaders/sort.wgsl`: count, a prefix sum in one workgroup, scatter) moves the agents
  from the current buffer into the other one, which then becomes current (ping-pong, no copy).
  Every bind group that holds an agent buffer has the buffer's parity in its cache key. Locality
  halves about 150 steps after a sort, so 32 steps keep it.
- Environment: one `u32` per cell with packed bytes (wall, food, light), painted by a compute
  pass.
- Random numbers: PCG hash of `(seed, step, agent id, purpose)`. No RNG state in memory. The
  collision claim key (ADR 0008) is a hash of `(seed, step, agent id)`. Nothing in the model
  reads the buffer slot.
- Agent dispatch is 2-D when it needs more than 65 535 workgroups.

## Consequences

- A step is deterministic per agent id for a given seed on a given GPU and driver. The order
  within a tile after a sort depends on atomic timing, so slots are not reproducible. The model
  does not see them: it reads ids, integer sums and the maximum of unique keys. A GPU test runs
  the same scene unsorted and sorted every 1, 8 and 32 steps, in both collision modes, and
  compares agents and trails bit by bit; it fails when a random stream or the claim key uses the
  slot.
- `readAgents()` returns the agents in id order. `writeAgent(i, …)` replaces the agent with id
  `i` wherever the sort has put it (a compute pass finds it) and keeps the id, so ids stay
  unique. WebGL2 has no compute shaders and does not sort: there slot and id are the same.
- 32 B per agent on both backends (two copies), as the memory estimate assumes.
- Memory per cell: 32 B trail + 16 B scent + 16 B counts + 4 B env = 68 B, plus 12 B of
  collision buffers (ADR 0008), which WebGPU allocates even with collisions off
  (`src/engine/sim.ts:76–77`). A 2048² grid needs about 320 MiB; the budget estimate of 84 B per
  cell adds the bloom chain (ADR 0013, `src/engine/sizing.ts:29`). The grid size must follow
  the adapter limits and the device class.
