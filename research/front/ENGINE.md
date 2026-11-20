# The engine of stage 4: state and handover

The rules of stage 4 (ADR 0065, decision 1) come into the engine in parts, in the forms of ADR 0067. This page says
what each part holds, and what the next agent needs to know. The rules in force are in `docs/model.md`, sections 6.10,
6.11 and 8.7; the decisions of the parts are in ADR 0068, ADR 0069 and ADR 0070.

## The parts

| Part | What                                                                                     | State           |
| ---- | ---------------------------------------------------------------------------------------- | --------------- |
| E1   | the territory: moves, respawn and births onto it, the owners, the push, the start disc   | done (ADR 0068) |
| E2a  | the sinks: the corner of the push, sink test, mean sink rate, sums R, C, N, the state    | done (ADR 0069) |
| E2b  | the pressure with sinks and sources, the adaptation while the front took flux, the drift | done (ADR 0070) |
| E3   | the paid births: the keys in `test`, the new pass `rank`, the budget in the state        | next            |
| E4   | scenes turn the rules on, the panel, digests, measures, the e2e tests of Reid et al.     | after E3        |

## The setting

- `Settings.territory` (`src/model/params.ts`), off by default and in every scene. It turns on every rule of stage 4:
  each part adds its rules to it and needs no switch of its own.
- `Settings.drift` (`globalSpec.drift`): the weight of the pressure in the sensors, 0 to 5, one value for all strains,
  1.5 by default. The default is provisional (ADR 0070, decision 5): E4 picks the value of each scene and decides
  whether each strain gets its own. `packParams()` writes it into the lane of each strain of `P.drift`, the slot after
  every slot of before. A link holds it only while the rules are on, the Jones model sets its default, and Learn shows
  no help for it (`Learn.svelte`) until the panel offers it.
- `territoryOn(s)` (`src/engine/territory.ts`): the setting in the extended model with growth (so with one agent per
  cell) and the flow. Every pass of stage 4 runs only then. Use it, not `s.territory`.
- A link holds the setting only while it is on (`linkSettings()` in `src/model/url.ts`). The Jones model sets it off
  (`asJones()`).
- A change of `territoryOn()` restarts the run (`apply()` in `src/engine/engine.ts`).

## The state on the GPU

| What                | WebGPU (`src/engine/sim.ts`)                                     | WebGL2 (`src/engine/gl/sim.ts`)                     |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| territory, 2 copies | `territory.textures`: `r32uint`, 4 cells per texel, `territoryT` | `territory.copies`: `R8UI`, one byte per cell, `tt` |
| owners              | `territory.owners`: buffer, 4 cells per word, `atomicOr`         | `territory.owners`: `R8UI`, a point per agent       |
| disc of the start   | `territory.disc`: a uniform of 16 B                              | the uniform `disc` of PASS 1                        |
| sink rates          | `sinks.rates`: `f32`, strain · W · H + cell, in place            | `sinks.rates[s]`: `R32F`, 2 copies, `sr`            |
| sums R, C, N        | `sinks.sums`: 4 `u32` per strain, atomics, cleared each step     | `sinks.levels[s]`: pyramid of `RGBA32UI`, its top   |
| state               | `sinks.state`: 2 vec4 per strain, in place                       | `sinks.state`: `RGBA32F`, 2 × strains, 2 copies     |
| pressure (E2b)      | the flow's `pressureArrays`, a layer per strain, to `claim`      | the 4 targets of the flow, `flowPressure` to `…3`   |

- The territory and the owners hold one byte per cell, bit s for strain s. In the texture of WebGPU cell (x, y) is
  byte x mod 4 of texel (x / 4, y): `inTerritoryAt()` in `agents.wgsl`, `inTerritory()` in `growth.wgsl`.
- A sink rate is a float that holds a whole number of steps of 2^-24 exactly, with a minus sign while the cell is a
  sink of the step, on both backends. A reader takes its size; `abs(r) · 2^24` gives the whole number back.
- The sums per strain: R low, R high (R in steps of 2^-16), C, N (`SINK_SUM_WORDS`). The state per strain
  (`SINK_STATE_LANES`): R as a float in the unit of the rate, C, N, the covered ports; then 1 while the front takes
  flux, and three lanes that E2a keeps for E3 (the budget).
- The order in a step: the agent passes and growth read the current copy of the territory; the owners pass runs after
  growth (and after the occupancy points on WebGL2); then the diffusion, the stamps of the slime and the flow. In the
  loop of the flow each strain runs `update`, then `sinks` and `state` (ADR 0069, decision 2), then its pressure. The
  push runs last and flips the copy of the territory. WebGL2 flips the copies of the rates and of the state after the
  last strain.
- `Sim.addTerritory()`, `readTerritory()`, `readOwners()`, `writeTerritory()`, `readSinks()`, `readSinkSums()`,
  `readSinkState()`, `writeSinks()` are in `src/engine/types.ts`; the CPU sim of the engine tests records the discs
  (`CpuSim.territories`).
- The flow reads the sinks (E2b): per strain the update reads the flag of the step before (WebGPU: the state in place,
  before `state` runs; WebGL2: the current copy `st`), and the pressure reads the rates and the state of the step
  (WebGPU: in place; WebGL2: the next copies, `flip(sr)` and `flip(st)`). The sensors of `claim` read the pressure that
  the flow of the step before left (`flowP`).

## The shaders

- WGSL: `shaders/territory.wgsl` (`fillOwners`, `push`, `addDisc`) and `shaders/sinks.wgsl` (`sinks`, `state`). The
  lines between `//#if TERRITORY` and `//#endif` in `agents.wgsl` (binding 14) and `growth.wgsl` (binding 17). Without
  TERRITORY each source is the one of before, character for character; TERRITORY always comes with FLOW
  (`Kernels.flowing()`, `Kernels.growth()`).
- GLSL: `gl/glsl/territory.frag` (PASS 0 push, 1 disc, 2 the fragment of the owners), `gl/glsl/owners.vert`,
  `gl/glsl/sinks.frag` (PASS 0 sinks, 1 the first level of the pyramid, 2 a level above, 3 the state).
- GLSL with the rules: `#if TERRITORY` in `tools.glsl` (the sampler and `inTerritory()`), `agents.frag` and
  `growth.frag`. The programs are `Programs.territory()`, `Programs.sinks()` and `Programs.flowing(…, territory)` in
  `gl/programs.ts`.
- The constants of stage 4 ride in the uniform block of the flow after its 64 sites: `FLOW_TERRITORY_SLOT` with 4 slots
  (`flow.ts`): the 8 chances of the push, then `FLOW_SINK_SLOT` (the steps 6 and 2 of the paths, the 100 steps of the
  mean, the weight on slime in steps of 2^-24), then `FLOW_TAKE_SLOT` (x: 2, what the sinks take in units of I0; y, z
  and w are 0 and free for E3). `packTerritory()` writes them after `packFlow()` in both sims. A pass that reads them
  declares the whole block: a to g, `sites: array<vec4f, 64>`, `push`, `sinks`, then `take` (see `sinks.wgsl`,
  `sinks.frag`, and the TERRITORY lines of `flow.wgsl` and `flow.frag`).
- E2b: the lines between `//#if TERRITORY` and `//#endif` in `flow.wgsl` (bindings 13 `rates` and 14 `states`,
  `sinksAndSources()`, the flag in `fed()`) and `agents.wgsl` (binding 15 `pressure`, the sensor `sense()` that wraps
  `sensed()`); `#if TERRITORY` in `flow.frag` (samplers `state` and `rates`) and `agents.frag` (samplers
  `flowPressure` to `flowPressure3`). The pipelines are `Kernels.flowPasses(true)` and `Programs.sinks().update` and
  `.pressure`. The CPU copy is `flowStep(…, sinks)` and `drifted()` in `src/engine/flow-reference.ts`.
- `sinks.wgsl` and `sinks.frag` hold the paths in rows of bits (`load()`, `spread()`), 13 rows of 13 bits; a reach of
  the block above 6 would leave the window (`SINK_WINDOW`).

## Traps for E3

- **Bind groups** of WebGPU are cached by key. A key of a group that holds the territory must contain `terr`
  (`dropTerritory()` deletes those), one that holds a buffer of the flow must contain `flow` (`dropFlow()`), one that
  holds the slime field must start with `slime` (`dropSlime()`), and one that holds a buffer of the sinks must contain
  `sinks` (`dropSinks()`). The group of the pass `sinks` holds all four: `slime-sinks${strain}-${next}-terr${t}-flow`.
- **Names in WGSL**: an entry point and a variable of the module may not share a name (`state` is the pass, `states`
  the buffer). An error of WGSL makes the passes of the step do nothing, and no test prints the message: read
  `getCompilationInfo()` of the module when every test of WebGPU reads zeros.
- **The budget of E3** rides in the three free lanes of the second vec4 of the state (`SINK_STATE_LANES`): the pass
  `state` keeps them (`kept.yzw` in `sinks.wgsl`, `stateIn` in `sinks.frag`). The flux that the sinks take in a step
  is S = `take.x` · I0 while the flag is 1 (ADR 0070); every 20 of it is one birth (ADR 0065, decision 7). The flux of
  a birth can ride in `take.y`.
- **The keys of E3** read the sink rate of a cell: its size, as R counted it or as it is (the order of ADR 0067,
  decision 1 draws −ln(1 − u) / r with r the sink rate of the cell). Say which one, and why.
- **Limits**: `settle` and growth `win` bind 8 storage buffers, the default limit: new state goes into textures there
  (ADR 0067, decision 8); `test` may bind 8 (the sink rates and the state are the two new ones). `sinks` binds 5
  storage buffers and `state` 3, the flow `update` 3 and `pressure` 4. The agent pass of WebGL2 samples 16 textures
  now, the minimum of a device: no sampler more there. The test of growth of WebGL2 may sample 13, `rank` 10.
- **The variants**: `variant.test.ts` lets TERRITORY replace lines only after a `//#else`: one line in `agents.wgsl`
  (the name of `sensed()`), none in `growth.wgsl` and `flow.wgsl`. A rule of E3 that must change what an old line
  computes needs the same form, and the test then names the new count.
- **The block of the flow**: new constants go after the slot of the sinks; raise `FLOW_TERRITORY_SLOTS` or add a slot
  constant, and extend `packTerritory()` and its unit tests (`territory.test.ts`, `sinks.test.ts`). `packFlow()`
  clears the whole block first.
- **Random streams**: 0 to 10 and 7 + 65536 · k belong to the agents and the start, 11 + 65536 · s to the push
  (`docs/model.md`, 7.7). The sinks draw no number. A new draw needs a stream of its own.
- **One agent per cell**: the owners have one bit per strain and cell; the push and the sinks count cells, which are
  agents only with the rule. `territoryOn()` holds the rule.
- **The start territory** exists only for the start layout Food. Every other layout starts with an empty territory.
- **Wrong rules** of stage 4 use the prefix TY in `research/flow/engine/mutate.ts` (TY1 to TY140 now). When code that
  a wrong rule names changes, run `mutate.ts check` (TY31 followed `packTerritory()` in E2a; TY36 and TY37 the link
  and the Jones model in E2b).
- **Floats that must match**: compare floats of a GPU with a CPU copy exactly only where every operation is exact or
  rounds once (ADR 0069, decision 3): integers, products with powers of 2, and one addition of exact parts. The flow
  itself is compared with a tolerance (`flow.gpu.test.ts`, `flow-sinks.gpu.test.ts`). The sensors compare exactly only
  with pressures of whole numbers (the test of the drift).
- **The research copy**: `research/flow/rules.ts` is a copy of `flowPressure()`, and `bounded.ts` holds it to the CPU
  copy bit for bit without the sinks. Run `RESEARCH=full npm test` after a change of `flow-reference.ts`.

## Tests

- `src/engine/territory.gpu.test.ts`, both backends: moves (a twin with a territory of every cell, and one without
  the rules), respawn (`respawnStep()`), births (`growthStep()` with `territory`), owners and push over 6 steps in
  three arenas (`owners()`, `push()`), the corner of the push beside a thin diagonal wall over 40 steps, the start
  territory (`addDisc()`). All with two strains.
- `src/engine/sinks.gpu.test.ts`, both backends, against `sinks-reference.ts` exactly: one step in three arenas with
  thin walls, the X of two diagonal walls, 9 steps with births and a short slime, the carry of R on 512 × 256 cells,
  no sinks without the rules, a reset and a third strain. The helper `stepOnce()` reads every input of the pass: the
  territory and the rates before the step; the owners, the stamps and the memory after it.
- `src/engine/flow-sinks.gpu.test.ts`, both backends, against `flow-reference.ts` with a tolerance: 5 steps of two
  strains in a dish with walls (a port pays for one, the tube cells for the other; no tube adapts in the first step),
  the frozen memory without a sink, the rates as R counted them, a large R, and the drift (256 agents, drift 1.5 and
  0). `src/engine/flow-reference.test.ts`: the sinks take what the sources give, to 10⁻⁶ of S.
- `src/engine/territory.test.ts`, `sinks.test.ts`, `sizing.test.ts`, `engine.test.ts` ("the memory of the sinks"),
  `engine-env.test.ts` ("the start territory of the rules of stage 4"), `src/model/params.test.ts` and `url.test.ts`
  ("the rules of stage 4").
- The digests of every scene: `research/flow/README.md`, parts 27 to 29; the records are
  `logs/engine/territory-0068/`, `logs/engine/sinks-0069/` and `logs/engine/flow-sinks-0070/` in
  `research/flow/logs.tar.gz`.

## Not measured

- The time of a step with the rules on either backend.
- Any scene with the rules: the speed of the front in the engine, the crown of each drift, the Y-maze, the dish (E4).
- The tests of E2b in the image of CI (SwiftShader).
