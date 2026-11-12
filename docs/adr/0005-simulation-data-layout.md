# 0005: Simulation data layout and determinism

- Status: accepted (revised 2026-11-09: agent ids and a spatial sort)
- Date: 2026-11-08

## Context

Agents deposit into the cell they move to. Many agents can hit one cell in the same step.
WGSL has no float atomics and no texture atomics. Tests need reproducible results. Jones uses
decay values down to 0.0001 (Fig. 12).

The GPU runs agents in buffer order. Once the network spreads over the grid, neighbours in the
buffer sit far apart on the grid, and nearly every sensor read and deposit misses the cache. In
the default scene (4 million agents, Apple M3 Pro) the agent pass in init order took 6.2 ms per
step at step 0 and 14.8 to 16.6 ms from step 3000 on. The same agents in 8 × 8 tile order took
2.5 to 3.0 ms. Atomic contention was not the cause: contended deposits as a separate pass cost
about 1 ms ([webgpu-platform](../knowledge-base/webgpu-platform.md#cost-per-pass-on-metal-measured-2026-11-10)).

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
- Capacity (2026-11-11, ADR 0025): the agent buffers hold the capacity, the most agents alive and dead. The first agents
  of each strain's ids, as many as Agents per cell gives, start alive (`P.startEnd`); the others start dead. The dead
  agents are the free list: Inoculate (ADR 0023) and growth bring them to life, by id, never by slot. Without a
  capacity above the start population the buffers hold the start population, as before.
- Growth and shrinkage (2026-11-11, ADR 0025) keep their own buffers while growth is on: the window counts, the claims
  and the births per cell, a flag per agent id for the dead agents, and two pyramids of sums over the births and the
  dead flags. A birth matches the dead agent of its rank, so ids stay a permutation and no agent is lost or doubled.

## Consequences

- A step is deterministic per agent id for a given seed on a given GPU and driver. The order
  within a tile after a sort depends on atomic timing, so slots are not reproducible. The model
  does not see them: it reads ids, integer sums and the maximum of unique keys. A GPU test runs
  two scenes unsorted and sorted every 1, 8 and 32 steps, in both collision modes, and compares
  agents and trails bit by bit: a periodic grid, and a closed box with a wall, shrinkage and
  both agent tools, with agent counts and a grid that are not multiples of the workgroup size
  and the tile. It fails when any random stream (STEER, TOOL, SHRINK, BLOCK) or the claim key
  uses the slot, and when the sort counts invocations past the last agent. Further tests use
  buffer 1 as the current one: `writeAgent`, switching collisions on (the occupancy rebuild) and
  `reset()`.
- `readAgents()` returns the agents in id order. `writeAgent(i, …)` replaces the agent with id
  `i` wherever the sort has put it (a compute pass finds it) and keeps the id, so ids stay
  unique. WebGL2 has no compute shaders and does not move its agents: there slot and id are the same. Since ADR 0028
  (decision 14 of 2026-11-12) it sorts only the order in which its point passes draw the agents, every 32 steps, by
  64 × 64 tiles: every point pass sums integers or takes a maximum, so no order changes a result.
- 32 B per agent on both backends (two copies), as the memory estimate assumes. WebGL2 holds 22 B more for the order
  of its point passes since ADR 0028 (54 B, `BYTES_PER_AGENT_GL`).
- Memory per cell: 32 B trail + 16 B scent + 16 B counts + 4 B env + 4 B outline distances for
  the renderer (ADR 0009) = 72 B, plus 12 B of collision buffers (ADR 0008), which WebGPU
  allocates even with collisions off (`src/engine/sim.ts:137–138`). A 2048² grid needs about
  336 MiB; the budget estimate of 90 B per cell adds the bloom chain and the gel height field
  (ADR 0009, ADR 0013, `BYTES_PER_CELL` in `src/engine/sizing.ts`). WebGL2 without float blending
  needs 110 B per cell for its exact counts (ADR 0003). Since ADR 0028 (amendment of 2026-11-12)
  the estimates are 98 B and 118 B: they count the two coarse maps of the view. The grid size must follow the adapter
  limits and the device class.
