# The engine of stage 4: state and handover

The rules of stage 4 (ADR 0065, decision 1) come into the engine in parts, in the forms of ADR 0067. This page says
what each part holds, and what the next agent needs to know. The rules in force are in `docs/model.md`, sections 6.10,
6.11, 8.1, 8.7 and 9.1; the decisions of the parts are in ADR 0068, ADR 0069, ADR 0070, ADR 0071, ADR 0072, ADR 0075,
ADR 0086, ADR 0087 and ADR 0088.

## The parts

| Part | What                                                                                     | State           |
| ---- | ---------------------------------------------------------------------------------------- | --------------- |
| E1   | the territory: moves, respawn and births onto it, the owners, the push, the start disc   | done (ADR 0068) |
| E2a  | the sinks: the corner of the push, sink test, mean sink rate, sums R, C, N, the state    | done (ADR 0069) |
| E2b  | the pressure with sinks and sources, the adaptation while the front took flux, the drift | done (ADR 0070) |
| E3   | the paid births: the keys in `test`, the new pass `rank`, the budget in the state        | done (ADR 0071) |
| E2c  | the tube of a sink; the gap between the backends was a chance of six seeds               | done (ADR 0072) |
| E2e  | the drift `take` of ADR 0074: a sensor off the tubes reads the ground of the agent       | done (ADR 0075) |
| E4   | scenes turn the rules on, the panel, digests, measures, the e2e tests of Reid et al.     | Reid (ADR 0088) |
| E5a  | the levers of the crown: the flow over 8 neighbours, the base conductance, the flux k    | done (ADR 0086) |
| E5b  | the crown scene, the panel controls and the help in Learn for the levers                 | done (ADR 0087) |

## The setting

- `Settings.territory` (`src/model/params.ts`), off by default and in every scene but the Crown of veins (ADR 0087)
  and the four scenes of Reid et al. 2012 (ADR 0088), with its switch Rules of the growth front in the Flow section of
  the panel. It turns on every rule of stage 4:
  each part adds its rules to it and needs no switch of its own.
- `Settings.drift` (`globalSpec.drift`): the weight of the pressure in the sensors, 0 to 5, one value for all strains,
  1.5 by default. The default is provisional (ADR 0070, decision 5): the five scenes with the rules have 1.5 (ADR
  0087, ADR 0088); whether each strain gets its own is open. `packParams()` writes it into the lane of each strain of `P.drift`, the slot after
  every slot of before. A link holds it only while the rules are on, and the Jones model sets its default. The panel
  shows it while the rules are on, and Learn lists its help (ADR 0087).
- `territoryOn(s)` (`src/engine/territory.ts`): the setting in the extended model with growth (so with one agent per
  cell) and the flow. Every pass of stage 4 runs only then. Use it, not `s.territory`.
- A link holds the setting only while it is on (`linkSettings()` in `src/model/url.ts`). The Jones model sets it off
  (`asJones()`).
- A change of `territoryOn()` restarts the run (`apply()` in `src/engine/engine.ts`).

## The levers of the crown (E5a, ADR 0086)

The crown of ADR 0084 (case `none` of `research/front/e2n.sh`) runs the rules of stage 4 with three levers more. Each
is a setting in `src/model/params.ts` whose default keeps the bytes of every scene but the Crown of veins, which has
the values of the crown (E5b, ADR 0087).

| Setting     | Default, range          | In force                  | In the passes                                                |
| ----------- | ----------------------- | ------------------------- | ------------------------------------------------------------ |
| `flowEdges` | 4; 4 or 8               | every scene with the flow | the variant EIGHT of the update, the pressure and the stream |
| `flowBase`  | 0.02; 0.001 to 0.1, log | every scene with the flow | `U.b.x` of the block of the flow (packFlow())                |
| `frontFlux` | 1; 0.25 to 16, log      | the rules of stage 4      | `U.take.x` = 2 k (packSinks()); the budget `U.take.y` stays  |

- The crown of ADR 0084 is `flowEdges` 8, `flowBase` 0.002 and `frontFlux` 2 (`norm=4 paid=40`), with the rules on.
- The pattern of `drift` and `territory`: the Jones model sets the defaults (`asJones()`); a link holds `flowEdges`
  and `flowBase` only while the flow is on, and `frontFlux` only while `territory` is on (`linkSettings()`); a link
  without them runs with the defaults. The panel and Learn show them (E5b), and the notice of a switch to Jones skips
  the base conductance with the flow strength, and the flux to the front and the drift with the rules
  (`jonesChanges()` in `src/ui/state.svelte.ts`).
- `flowEight(s)` (`src/engine/flow.ts`): the setting 8 while the flow runs. Both sims pick the passes by it in every
  step, so a change acts at the next step and restarts nothing.
- The 8 edges: `//#if EIGHT` in `shaders/flow.wgsl` (`diagonalXY()`, `diagonalFlux()`, AXIS and DIAG; the update, and
  the pressure with one line after a `//#else`) and in `shaders/tubes.wgsl` (`flowOpen()`, the stream); `#if EIGHT` in
  `gl/glsl/flow.frag` and `gl/glsl/tubes.frag`. Without EIGHT each source is the one of before. The pipelines are
  `Kernels.flowPasses(sinks, true)` and `Kernels.tubeStreamEight()`; the programs `Programs.flowEight(sinks)` and
  `Programs.tubeStreamEight()`. The stream over 8 binds the wall bytes (`shape`, binding 2 on WebGPU).
- The CPU copy reads the edges from the block: `U.g.w` is 1 with 8 edges (packFlow()), and no pass reads it
  (`eightOf()` in `src/engine/flow-reference.ts`). `tubeStream(…, eight)` in `src/engine/tubes-reference.ts`.
- Readers of the edges that stay as they are, as the prototype has them: the tube of a sink (`tubeOut()`, 4
  neighbours), the drift (`takes`, take / G), the ports, the roles and the paths of the sinks.

## The crown scene and the panel (E5b, ADR 0087)

- The scene `crown`, "Crown of veins" (`src/model/presets.ts`, group Experiments): the case `none` of
  `research/front/e2n.sh` word for word, the table of ADR 0087. `CROWN` holds its lattice of 520 × 340 cells and its
  neck; `crownShapes()` paints the cells of `neck()` of `research/front/layouts.ts`, cell for cell, with thick strokes
  so that the walls show no ribs (ADR 0087, decision 2). It is the one scene with `territory`, 8 neighbours, the base
  0.002 and k = 2.
- The panel (`src/ui/Panel.svelte`, the Flow section below Flow strength): the switch Flow over 8 neighbours and the
  slider Base conductance while the flow is on; the switch Rules of the growth front (`territoryHelp` in `params.ts`)
  while growth is on too; Drift and Flux to the front while the rules are on. Learn lists them in this order.
- The notice of a switch to Jones names the rules (`jonesChanges()`), and skips the drift and the flux to the front.
- The engine compares with the prototype through `research/front/e5b-crown.gpu.test.ts`, which saves the fields of
  `CrownFields` in the format of `saveState()`, and `research/front/e5b.ts`, which turns them into a campaign of
  `crowns.ts` for `e2n.ts`; `bash research/front/e5b.sh backends|neck|long|measure|montage` runs it all. The engine
  counts the step that places the colony as its first step: its step k + 1 is the prototype's step k.
- The pictures of the app: `tests/pictures/crown.spec.ts`; the montage `docs/images/crown-app.jpg`.
- The e2e test: the last test of `tests/e2e/tubes.spec.ts`, in shard 3 of 4 with three tests of the flow and 17 of
  `ui.spec.ts`. It waits 30 steps: SwiftShader runs the scene at about one step per second in the image of CI, and
  the colony leaves the neck after 1,150 to 1,450 steps (ADR 0087, decision 9).

## The scenes of Reid et al. 2012 and the avoidance of slime (E4, ADR 0088)

- The scenes `y-maze` (Y-maze with slime), `y-maze-both` (Y-maze, both slimed), `y-maze-blank` (Y-maze without
  slime) and `slime-everywhere` run the rules with the drift 1.5, 4 neighbours, the base 0.02 and k = 1
  (`yMazeSettings()` in `src/model/presets.ts`). They meet the targets of the prototype and of the paper on both
  backends (the tables of ADR 0088; `bash research/front/e4.sh table`).
- Two settings took the place of `SINKS.slime` and `SINKS.fresh`: `slimeWeight` (Weight on slime, 0.001 to 1, log,
  0.025) and `freshReach` (Reach to fresh ground, 2 to 6 cells, 6). `slimeWeightOf()` and `freshReachOf()` in
  `sinks.ts` give them in the units of the passes; `packSinks(f, s)` writes them into the lanes w and x of
  `FLOW_SINK_SLOT`; the passes read those lanes as before, and the CPU copy reads `SinkInput.slime` and `.reach`. The
  pattern of the drift holds: a link holds them only while `territory` is on, the Jones model sets the defaults, the
  notice of a switch to Jones skips them, and the panel shows them in the Slime section while the rules run.
- The reach is at least 2: the passes go on from the paths of the edge, and the colony's own slime lies on every cell
  within one step of each sink, so a reach of 1 gives every sink the weight on slime.
- The measure: `research/front/e4-reid.gpu.test.ts` and `research/front/e4.sh`; the story in `E4-NOTES.md`. It steps
  with `Sim.run()`; `VITE_FRAME=1` steps with `Engine.frame()`, which gives the same run.
- The e2e test: `tests/e2e/y-maze.spec.ts`, the last file, so CI runs it in shard 4 of 4 (ADR 0088, decision 7).
- Left for part 4: the drift of the other scenes and a drift per strain, the other scenes with growth and the flow,
  and a test where a second strain grows on the slime of the first.

## The state on the GPU

| What                | WebGPU (`src/engine/sim.ts`)                                      | WebGL2 (`src/engine/gl/sim.ts`)                     |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| territory, 2 copies | `territory.textures`: `r32uint`, 4 cells per texel, `territoryT`  | `territory.copies`: `R8UI`, one byte per cell, `tt` |
| owners              | `territory.owners`: buffer, 4 cells per word, `atomicOr`          | `territory.owners`: `R8UI`, a point per agent       |
| disc of the start   | `territory.disc`: a uniform of 16 B                               | the uniform `disc` of PASS 1                        |
| sink rates          | `sinks.rates`: `f32`, strain · W · H + cell, in place             | `sinks.rates[s]`: `R32F`, 2 copies, `sr`            |
| sums R, C, N        | `sinks.sums`: 4 `u32` per strain, atomics, cleared each step      | `sinks.levels[s]`: pyramid of `RGBA32UI`, its top   |
| state               | `sinks.state`: 2 vec4 per strain, in place                        | `sinks.state`: `RGBA32F`, 2 × strains, 2 copies     |
| pressure (E2b)      | the flow's `pressureArrays`, a layer per strain, to `claim`       | `sinks.pressures`: `RGBA32F`, the mean, lane s      |
| take / G (E2e)      | `sinks.takes`: `r32float`, a layer per strain, `takes` writes it  | `sinks.takes`: `RGBA32F`, lane s, PASS 5 writes it  |
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
- The order in a step: first, per strain, what the sensors read of the flow of the step before (E2e; WebGPU `takes`
  of `flow.wgsl`, WebGL2 PASS 5 of `flow.frag`); the agent passes and growth read the current copy of the territory;
  in a growth step `test`
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
- The drift `take` (E2e, ADR 0075): `takes` (WebGPU) and PASS 5 (WebGL2) read the memory (`flowM`), the rates and the
  state as the flow of the step before left them (WebGPU: in place; WebGL2: the current copies `sr` and `st`), and on
  WebGL2 the pressure (`flowP`). So they give what the flow of the step before took, and also what a test writes with
  `writeFlow()`, `writeSinks()`, `writeSinkState()` and `writePressure()`. The textures are made anew in each step
  before they are read: no reset clears them.

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
- E2e: the lines between `//#if TERRITORY` and `//#endif` in `flow.wgsl` (`taken()`, which `sinksAndSources()` shares,
  binding 15 `takeOut`, the entry point `takes`) and `agents.wgsl` (binding 16 `takes`, `driftOf()`, `tubeAt()`,
  `meanPressure()`, the sensor `sense()` with the `Drift` of the agent's cell, and the three calls in `steer()` after
  a `//#else`); `#if TERRITORY` in `flow.frag` (PASS 5, `taken()`) and `agents.frag` (samplers `pressures` and `takes`,
  the same functions). The pipeline is `Kernels.flowSinkPasses().takes`; the program `Programs.sinks().drift` draws
  into the two targets of one framebuffer (`driftTarget()`) with `colorMask` on the lane of the strain. The CPU copy
  is `takesOf()`, `meanPressure()`, `groundOf()` and `drifted()` in `src/engine/flow-reference.ts`.
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

- **The levers** (ADR 0086): the groups of the update and the pressure over 8 neighbours end in `-e8` (`flowUpdate…`,
  `flowPressure…`), and so does the group of the stream (`tubeStream…-e8`). `variant.test.ts` lets EIGHT replace one
  line of `flow.wgsl` after a `//#else` (the sum of the pressure) and none of `tubes.wgsl`. The weights are float32
  literals in four files; `flow.test.ts` holds them to `FLOW_EIGHT`.

- **Bind groups** of WebGPU are cached by key. A key of a group that holds the territory must contain `terr`
  (`dropTerritory()` deletes those), one that holds a buffer of the flow must contain `flow` (`dropFlow()`), one that
  holds the slime field must start with `slime` (`dropSlime()`), and one that holds a buffer of the sinks must contain
  `sinks` (`dropSinks()`). The group of the pass `sinks` holds all four: `slime-sinks${strain}-${next}-terr${t}-flow`;
  the groups of growth with the rules end in `terr${t}-sinks`.
- **Names in WGSL**: an entry point and a variable of the module may not share a name (`state` is the pass, `states`
  the buffer). An error of WGSL makes the passes of the step do nothing, and no test prints the message: read
  `getCompilationInfo()` of the module when every test of WebGPU reads zeros.
- **Limits**: `settle` and growth `win` bind 8 storage buffers, the default limit, and `test` 8 now; `rank` binds 5,
  `sinks` 6 (the ports for the tube of a sink, ADR 0072), `state` 3, the flow `update` 3, `pressure` 4 and `takes` 2.
  Of the agent passes `claim`, whose sensors read the drift, binds 5 (agents, env, occ, claims, clearance), `advance`
  6 and `settle` 8. They read take / G through a texture (binding 16 of `claim`, ADR 0075). WebGL2 samples 14
  textures in the agent pass (16 is the minimum of a device; ADR 0075 freed two by the targets of a lane per strain),
  13 in the test of growth, 10 in `rank`, 7 in the sinks (PASS 0), 4 in the state and in PASS 5 of `flow.frag`.
- **The variants**: `variant.test.ts` lets TERRITORY replace lines only after a `//#else`: four lines in `agents.wgsl`
  (the name of `sensed()`, and the three calls of the sensors in `steer()`, ADR 0075), none in `growth.wgsl` and
  `flow.wgsl`. A rule that must change what an old line computes
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
- **The level of a network against its ground** (ADR 0072): Kirchhoff's law fixes the level of a network against the
  ground beside it only through the ghost conductance, and the history of the iteration sets it. Since ADR 0075 the
  drift reads no pressure of the ground: a sensor off the tubes of its strain reads the pressure of the agent's cell
  less what the sink there takes over the conductivity, times the sensor offset, and an agent off the tubes reads no
  drift. A shift of the pressure of every tube cell of a strain moves no agent (`flow-sinks.gpu.test.ts`). The form
  of before, which read the ground, gave a strain of the start scene 124 to 1,593 agents at step 1,503.
- **The start of a colony**: the app starts every scene without a food scent, the prototype after 300 steps of it
  (`Params.scentSteps`). The records of ADR 0065 and 0067 have the start of the prototype; `research/front/start.sh`
  runs both starts (ADR 0072, open points).
- **One agent per cell**: the owners have one bit per strain and cell; the push and the sinks count cells, which are
  agents only with the rule. `territoryOn()` holds the rule.
- **The start territory** exists only for the start layout Food. Every other layout starts with an empty territory.
- **Wrong rules** of stage 4 use the prefix TY in `research/flow/engine/mutate.ts` (TY1 to TY270 now). When code that
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
  the frozen memory without a sink, the rates as R counted them, a large R, the drift `take` (256 agents on and off
  the tubes, drift 1.5 and 0, every value exact), a shift of the tubes that moves no agent, and the memory of the
  drift on each backend (ADR 0075). `src/engine/flow-reference.test.ts`: the sinks take what the sources give, to
  10⁻⁶ of S, and the CPU copy of t / G and of the reads.
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
- The measure of ADR 0075: `research/front/e2e-backends.gpu.test.ts` (the start scene with `take` on both backends)
  and `research/front/e2e-summary.ts`; the commands and the numbers in `research/front/E2e-NOTES.md`.
- The levers (ADR 0086), both backends: `flow.gpu.test.ts` (the CPU copy over 8 neighbours with the base 0.002, a
  diagonal vein over 8 and 4, a wall corner), `tubes.gpu.test.ts` (the stream over 8 in each arena),
  `flow-sinks.gpu.test.ts` (the flow with the sinks and the drift with the levers), `sinks.gpu.test.ts` (the budget at
  k = 2). The CPU copy against the prototype: `research/front/research.test.ts`. The digests, the wrong rules LV1 to
  LV35 and the time of a step: `research/flow/README.md`, part 33.

## Not measured

- The Crown of veins (ADR 0087): more than 2 seeds to step 16,000 on WebGPU and 1 on WebGL2; the scene on SwiftShader
  beyond 30 steps; other values of the levers and of the drift in the scene.
- The time of the stream over 8 neighbours; the 8 edges on SwiftShader beside the GPU tests of CI.

- The time of `test` and `win` with the rules apart from the step; the time of a step with the rules in any scene but
  the start scene.
- The scenes with the rules but the start scene, the Crown of veins and the four scenes of Reid (ADR 0088): the speed
  of the front in the engine, the crown of each drift. The drift `take` at the weights 0 to 5 in the engine; the
  scenes of Reid at other drifts, and the weight on slime and the reach beyond 10 seeds at the reaches 2 and 4 and the
  weight 1.
- The time of `takes` and PASS 5 apart from the step: the step of the start scene at capacity 1 with the rules takes
  about 2 to 3 % more with `take` than with `all` (ADR 0075, finding 4), and the agents differ between the two.
- How often two keys within a few units in the last place change the births between the backends.
- The time of the pass of the sinks with the test of the tube (ADR 0072).
