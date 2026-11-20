# The engine of stage 4: state and handover

The rules of stage 4 (ADR 0065, decision 1) come into the engine in parts, in the forms of ADR 0067. This page says
what each part holds, and what the next agent needs to know. The rules in force are in `docs/model.md`, sections 6.10,
6.11, 8.7 and 9.1; the decisions of the parts are in ADR 0068, ADR 0069, ADR 0070, ADR 0071 and ADR 0072.

## The parts

| Part | What                                                                                     | State           |
| ---- | ---------------------------------------------------------------------------------------- | --------------- |
| E1   | the territory: moves, respawn and births onto it, the owners, the push, the start disc   | done (ADR 0068) |
| E2a  | the sinks: the corner of the push, sink test, mean sink rate, sums R, C, N, the state    | done (ADR 0069) |
| E2b  | the pressure with sinks and sources, the adaptation while the front took flux, the drift | done (ADR 0070) |
| E3   | the paid births: the keys in `test`, the new pass `rank`, the budget in the state        | done (ADR 0071) |
| E2c  | the tube of a sink; the gap between the backends was a chance of six seeds               | done (ADR 0072) |
| E4   | scenes turn the rules on, the panel, digests, measures, the e2e tests of Reid et al.     | next            |

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

| What                | WebGPU (`src/engine/sim.ts`)                                      | WebGL2 (`src/engine/gl/sim.ts`)                     |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| territory, 2 copies | `territory.textures`: `r32uint`, 4 cells per texel, `territoryT`  | `territory.copies`: `R8UI`, one byte per cell, `tt` |
| owners              | `territory.owners`: buffer, 4 cells per word, `atomicOr`          | `territory.owners`: `R8UI`, a point per agent       |
| disc of the start   | `territory.disc`: a uniform of 16 B                               | the uniform `disc` of PASS 1                        |
| sink rates          | `sinks.rates`: `f32`, strain · W · H + cell, in place             | `sinks.rates[s]`: `R32F`, 2 copies, `sr`            |
| sums R, C, N        | `sinks.sums`: 4 `u32` per strain, atomics, cleared each step      | `sinks.levels[s]`: pyramid of `RGBA32UI`, its top   |
| state               | `sinks.state`: 2 vec4 per strain, in place                        | `sinks.state`: `RGBA32F`, 2 × strains, 2 copies     |
| pressure (E2b)      | the flow's `pressureArrays`, a layer per strain, to `claim`       | the 4 targets of the flow, `flowPressure` to `…3`   |
| counts F, K (E3)    | `sinks.state` from `PAID_COUNTS_BYTE`, atomics, cleared each step | `sinks.counts`: `RGBA32F`, 2 × 1, a lane per strain |
| keys (E3)           | `sinks.state` from `PAID_KEYS_BYTE`, a float by id                | `sinks.keys`: `R32F`, a texel per agent             |

- The territory and the owners hold one byte per cell, bit s for strain s. In the texture of WebGPU cell (x, y) is
  byte x mod 4 of texel (x / 4, y): `inTerritoryAt()` in `agents.wgsl`, `inTerritory()` in `growth.wgsl`.
- A sink rate is a float that holds a whole number of steps of 2^-24 exactly, with a minus sign while the cell is a
  sink of the step, on both backends. A reader takes its size; `abs(r) · 2^24` gives the whole number back.
- The sums per strain: R low, R high (R in steps of 2^-16), C, N (`SINK_SUM_WORDS`). The state per strain
  (`SINK_STATE_LANES`): R as a float in the unit of the rate, C, N, the covered ports; then 1 while the front takes
  flux, the budget of the paid births, F and K of the step (`BUDGET_LANE`, `FRONT_LANE`, `CLAIMS_LANE` in
  `src/engine/paid.ts`). On WebGPU the buffer of the state holds room for 4 strains, then the counts, then the keys:
  `readSinkState()` gives the lanes of the strains of the settings only.
- The order in a step: the agent passes and growth read the current copy of the territory; in a growth step `test`
  writes the keys and counts F, then `rank` (WebGPU after `test`; WebGL2 PASS 5 and the points of `paid.vert`) claims
  and counts K, then `win`; the owners pass runs after growth (and after the occupancy points on WebGL2); then the
  diffusion, the stamps of the slime and the flow. In the loop of the flow each strain runs `update`, then `sinks` and
  `state` (ADR 0069, decision 2), then its pressure; `state` turns F and K into the budget. The push runs last and
  flips the copy of the territory. WebGL2 flips the copies of the rates and of the state after the last strain.
- `Sim.addTerritory()`, `readTerritory()`, `readOwners()`, `writeTerritory()`, `readSinks()`, `readSinkSums()`,
  `readSinkState()`, `writeSinks()`, `writeSinkState()` and `readPaidKeys()` are in `src/engine/types.ts`; the CPU
  sim of the engine tests records the discs (`CpuSim.territories`).
- The flow reads the sinks (E2b): per strain the update reads the flag of the step before (WebGPU: the state in place,
  before `state` runs; WebGL2: the current copy `st`), and the pressure reads the rates and the state of the step
  (WebGPU: in place; WebGL2: the next copies, `flip(sr)` and `flip(st)`). The sensors of `claim` read the pressure that
  the flow of the step before left (`flowP`).

## The shaders

- WGSL: `shaders/territory.wgsl` (`fillOwners`, `push`, `addDisc`) and `shaders/sinks.wgsl` (`sinks`, `state`;
  `tubeOut()`, the tube of a sink, reads the ports of the step, ADR 0072). The
  lines between `//#if TERRITORY` and `//#endif` in `agents.wgsl` (binding 14) and `growth.wgsl` (binding 17). Without
  TERRITORY each source is the one of before, character for character; TERRITORY always comes with FLOW
  (`Kernels.flowing()`, `Kernels.growth()`).
- GLSL: `gl/glsl/territory.frag` (PASS 0 push, 1 disc, 2 the fragment of the owners), `gl/glsl/owners.vert`,
  `gl/glsl/sinks.frag` (PASS 0 sinks, with the ports for the tube of a sink; 1 the first level of the pyramid, 2 a
  level above, 3 the state).
- GLSL with the rules: `#if TERRITORY` in `tools.glsl` (the sampler and `inTerritory()`), `agents.frag` and
  `growth.frag`. The programs are `Programs.territory()`, `Programs.sinks()` and `Programs.flowing(…, territory)` in
  `gl/programs.ts`.
- The constants of stage 4 ride in the uniform block of the flow after its 64 sites: `FLOW_TERRITORY_SLOT` with 4 slots
  (`flow.ts`): the 8 chances of the push, then `FLOW_SINK_SLOT` (the steps 6 and 2 of the paths, the 100 steps of the
  mean, the weight on slime in steps of 2^-24), then `FLOW_TAKE_SLOT` (x: 2, what the sinks take in units of I0; y: the
  growth of the budget in a step, 2 · I0 / 20 as float32, `packPaid()`; z and w are 0 and free). `packTerritory()`
  writes them after `packFlow()` in both sims. A pass that reads them declares the whole block: a to g,
  `sites: array<vec4f, 64>`, `push`, `sinks`, then `take` (see `sinks.wgsl`, `sinks.frag`, and the TERRITORY lines of
  `flow.wgsl` and `flow.frag`).
- E2b: the lines between `//#if TERRITORY` and `//#endif` in `flow.wgsl` (bindings 13 `rates` and 14 `states`,
  `sinksAndSources()`, the flag in `fed()`) and `agents.wgsl` (binding 15 `pressure`, the sensor `sense()` that wraps
  `sensed()`); `#if TERRITORY` in `flow.frag` (samplers `state` and `rates`) and `agents.frag` (samplers
  `flowPressure` to `flowPressure3`). The pipelines are `Kernels.flowPasses(true)` and `Programs.sinks().update` and
  `.pressure`. The CPU copy is `flowStep(…, sinks)` and `drifted()` in `src/engine/flow-reference.ts`.
- E3: the lines between `//#if TERRITORY` and `//#endif` in `growth.wgsl`: bindings 18 `rates` and 19 `paid` (the
  buffer of the state of the sinks: `states`, `counts`, `keys`), `paidTest()` at the end of `test`, the entry point
  `rank`, and the search for the key of a paid parent in `win`; the budget in `state` of `sinks.wgsl` (its binding 10
  is the struct `States`, and it binds the parameters now). GLSL: PASS 2 of `growth.frag` writes the keys into its
  second target (`paidKey`) and marks `FRONT`; PASS 5 is `rank` and marks `GROWS | PAID` with the neighbour of the
  child; `paid.vert` counts `FRONT` and `PAID` into `sinks.counts`; PASS 3 of `sinks.frag` reads them. The programs
  are `Programs.territory().test`, `.rank` and `.paid`; the pipeline is `Kernels.growth(true, true).rank`. The CPU
  copy is `paidClaims()` in `src/engine/growth-reference.ts` (with `GrowthInput.paid`), `nextBudget()` and
  `paidKey()` in `src/engine/paid.ts`, and `sinkState(…, budget)` in `sinks-reference.ts`.
- `sinks.wgsl` and `sinks.frag` hold the paths in rows of bits (`load()`, `spread()`), 13 rows of 13 bits; a reach of
  the block above 6 would leave the window (`SINK_WINDOW`).

## The paid births (E3) in numbers

- The budget grows by 2 · I0 / 20 per step while the front takes flux: 0.8 births at the flow strength 8 of the start
  scene, 2.4 per growth step of every third step. In the start scene at step 1,504 with the rules (capacity 1) the
  strains had 19, 65 and 39 agents of the front, 14, 37 and 27 of them with a key, and budgets of 1.2 to 1.8.
- The time of `rank` (ADR 0071, the time of `rank`): 0.74 ms per growth step on WebGPU and 0.047 ms on WebGL2 at
  147,456 agents, 0.16 and 0.018 ms at the 36,864 of the scene's capacity 0.25; it follows n, the agents of a strain,
  and hardly b. A whole step of the start scene at capacity 1: 3.24 ms with the rules and 2.89 ms without on WebGPU,
  7.69 and 3.76 ms on WebGL2 (M3 Pro). The command:
  `VITE_NAME=rank npx vitest run --config research/vitest.config.ts research/front/rank.gpu.test.ts`; it writes
  `research/front/out/rank.jsonl`.

## Traps for E4

- **Bind groups** of WebGPU are cached by key. A key of a group that holds the territory must contain `terr`
  (`dropTerritory()` deletes those), one that holds a buffer of the flow must contain `flow` (`dropFlow()`), one that
  holds the slime field must start with `slime` (`dropSlime()`), and one that holds a buffer of the sinks must contain
  `sinks` (`dropSinks()`). The group of the pass `sinks` holds all four: `slime-sinks${strain}-${next}-terr${t}-flow`;
  the groups of growth with the rules end in `terr${t}-sinks`.
- **Names in WGSL**: an entry point and a variable of the module may not share a name (`state` is the pass, `states`
  the buffer). An error of WGSL makes the passes of the step do nothing, and no test prints the message: read
  `getCompilationInfo()` of the module when every test of WebGPU reads zeros.
- **Limits**: `settle` and growth `win` bind 8 storage buffers, the default limit, and `test` 8 now; `rank` binds 5,
  `sinks` 6 (the ports for the tube of a sink, ADR 0072), `state` 3, the flow `update` 3 and `pressure` 4. WebGL2
  samples 16 textures in the agent pass, the minimum of a device, 13 in the test of growth, 10 in `rank`, 7 in the
  sinks (PASS 0) and 4 in the state.
- **The variants**: `variant.test.ts` lets TERRITORY replace lines only after a `//#else`: one line in `agents.wgsl`
  (the name of `sensed()`), none in `growth.wgsl` and `flow.wgsl`. A rule that must change what an old line computes
  needs the same form, and the test then names the new count. It counts 15 calls of `rngSeed()` on each backend.
- **The block of the flow**: z and w of `FLOW_TAKE_SLOT` are free; more constants need a slot more (raise
  `FLOW_TERRITORY_SLOTS`) and an extension of `packTerritory()` and its unit tests (`territory.test.ts`,
  `sinks.test.ts`, `paid.test.ts`). `packFlow()` clears the whole block first.
- **Random streams**: 0 to 10 and 7 + 65536 · k belong to the agents and the start, 11 + 65536 · s to the push, 12 to
  the key of a paid birth (`docs/model.md`, 7.7). A new draw needs a stream of its own.
- **The state on WebGPU** holds room for 4 strains (`STATE_STRAINS`), then the counts (`PAID_COUNTS_BYTE`), then the
  keys (`PAID_KEYS_BYTE`); the step clears the counts with `clearBuffer`. `writeSinkState()` writes the lanes of the
  strains of the settings: a test sets the budget there (`BUDGET_LANE`).
- **The keys are floats of `log`**: the two backends and the CPU differ in their last bits, so two keys that close can
  rank otherwise, and a scene with the rules can differ between the backends in a birth. Compare keys with a
  tolerance and rank the keys of the GPU (`GrowthInput.paid.keys`); everything after the rank compares exactly.
- **A claim key of 0** on WebGPU (one id in 2^32 per step) gets no key and no paid child (`paid.gpu.test.ts` finds
  such a seed with the inverse of pcg).
- **The level of a network against its ground** (ADR 0072): the drift reads the pressure of a sensor's cell on the
  network and on the ground alike, and Kirchhoff's law fixes the level of a network against the ground beside it only
  through the ghost conductance. The history of the iteration sets it, and it decides whether a front grows: a strain
  of the start scene ends step 1,503 with 124 to 1,593 agents. Compare scenes over 18 seeds or more; six seeds split by
  chance (ADR 0072, finding 1). The cell that the pressure recentres by does not change it.
- **The start of a colony**: the app starts every scene without a food scent, the prototype after 300 steps of it
  (`Params.scentSteps`). The records of ADR 0065 and 0067 have the start of the prototype; `research/front/start.sh`
  runs both starts (ADR 0072, open points).
- **One agent per cell**: the owners have one bit per strain and cell; the push and the sinks count cells, which are
  agents only with the rule. `territoryOn()` holds the rule.
- **The start territory** exists only for the start layout Food. Every other layout starts with an empty territory.
- **Wrong rules** of stage 4 use the prefix TY in `research/flow/engine/mutate.ts` (TY1 to TY213 now). When code that
  a wrong rule names changes, run `mutate.ts check`.
- **Floats that must match**: compare floats of a GPU with a CPU copy exactly only where every operation is exact or
  rounds once (ADR 0069, decision 3): integers, products with powers of 2, and additions that each round once (the
  budget). The flow itself is compared with a tolerance (`flow.gpu.test.ts`, `flow-sinks.gpu.test.ts`), and so are
  the keys.
- **The research copy**: `research/flow/rules.ts` is a copy of `flowPressure()`, and `bounded.ts` holds it to the CPU
  copy bit for bit without the sinks. Run `RESEARCH=full npm test` after a change of `flow-reference.ts`.

## Tests

- `src/engine/territory.gpu.test.ts`, both backends: moves (a twin with a territory of every cell, and one without
  the rules), respawn (`respawnStep()`), births (`growthStep()` with `territory`), owners and push over 6 steps in
  three arenas (`owners()`, `push()`), the corner of the push beside a thin diagonal wall over 40 steps, the start
  territory (`addDisc()`). All with two strains.
- `src/engine/sinks.gpu.test.ts`, both backends, against `sinks-reference.ts` exactly: one step in three arenas with
  thin walls, the X of two diagonal walls, 9 steps with births and a short slime, the carry of R on 512 × 256 cells,
  no sinks without the rules, a reset and a third strain, and the tube of a sink in each arena (ADR 0072): tube on
  half of the cells, patches of a port that keep their sinks, and ports across the seam. The helper `stepOnce()` reads
  every input of the pass: the territory and the rates before the step; the owners, the stamps and the memory after
  it; the ports from the memory before it (`flowPorts()`).
- `src/engine/flow-sinks.gpu.test.ts`, both backends, against `flow-reference.ts` with a tolerance: 5 steps of two
  strains in a dish with walls (a port pays for one, the tube cells for the other; no tube adapts in the first step),
  the frozen memory without a sink, the rates as R counted them, a large R, and the drift (256 agents, drift 1.5 and
  0). `src/engine/flow-reference.test.ts`: the sinks take what the sources give, to 10⁻⁶ of S.
- `src/engine/territory.test.ts`, `sinks.test.ts`, `paid.test.ts`, `sizing.test.ts`, `engine.test.ts` ("the memory
  of the sinks", with the key per agent),
  `engine-env.test.ts` ("the start territory of the rules of stage 4"), `src/model/params.test.ts` and `url.test.ts`
  ("the rules of stage 4").
- `src/engine/paid.gpu.test.ts`, both backends, against `growth-reference.ts` (`paidClaims()`): each case one growth
  step from the moves of a twin without growth, the keys to 10⁻⁵ and the rest exactly: two colonies of two strains
  with starved cells, a thin wall and light, then a step without the growth test and one without a sink rate; tied
  keys and a budget above the agents of the front; the corner between two walls in four directions; a budget below 1;
  on WebGPU a claim key of 0. `src/engine/paid.test.ts`: the constants, the odds of the key, its series in float32,
  the budget, and the CPU copy on cases made by hand. `sinks.gpu.test.ts` checks the budget of the state with F and K
  of the GPU.
- The digests of every scene: `research/flow/README.md`, parts 27 to 31; the records are
  `logs/engine/territory-0068/`, `logs/engine/sinks-0069/`, `logs/engine/flow-sinks-0070/`, `logs/engine/paid-0071/`
  and `logs/engine/tube-0072/` in `research/flow/logs.tar.gz`.
- The diagnosis of ADR 0072: the scripts `research/front/e2c-*` and `research/front/start.sh`, and the story in
  `research/front/E2c-NOTES.md`.

## Not measured

- The time of `test` and `win` with the rules apart from the step; the time of a step with the rules in any scene but
  the start scene.
- Any scene with the rules: the speed of the front in the engine, the crown of each drift, the Y-maze, the dish (E4).
- How often two keys within a few units in the last place change the births between the backends.
- The time of the pass of the sinks with the test of the tube (ADR 0072).
