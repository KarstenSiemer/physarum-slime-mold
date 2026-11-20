# The engine of stage 4: state and handover

The rules of stage 4 (ADR 0065, decision 1) come into the engine in four parts, in the forms of ADR 0067. This page
says what each part holds, and what the next agent needs to know. The rule in force is in `docs/model.md`, section
6.10; the decisions of part 1 are in ADR 0068.

## The parts

| Part | What                                                                                     | State           |
| ---- | ---------------------------------------------------------------------------------------- | --------------- |
| E1   | the territory: moves, respawn and births onto it, the owners, the push, the start disc   | done (ADR 0068) |
| E2   | the sinks and the flow: sink test, mean sink rate, sums R, C, N, the state, the pressure | next            |
| E3   | the paid births: the keys in `test`, the new pass `rank`                                 | after E2        |
| E4   | scenes turn the rules on, the panel, digests, measures, the e2e tests of Reid et al.     | after E3        |

E2 also holds: R in two words (ADR 0067, decision 3), the tubes adapt only while the front took flux, and the drift on
the sensor (ADR 0065, decision 6).

## The setting

- `Settings.territory` (`src/model/params.ts`), off by default and in every scene. It turns on every rule of stage 4:
  E2 and E3 add their rules to it and need no switch of their own. The weight of the drift is a value of E2 (ADR
  0065, decision 6; ADR 0067, decision 9).
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

- Both hold one byte per cell, bit s for strain s. In the texture of WebGPU cell (x, y) is byte x mod 4 of texel
  (x / 4, y): `inTerritoryAt()` in `agents.wgsl`, `inTerritory()` in `growth.wgsl`.
- The order in a step: the agent passes and growth read the current copy; the owners pass runs after growth (and
  after the occupancy points on WebGL2); the push runs last and flips the copy.
- `Sim.addTerritory()`, `readTerritory()`, `readOwners()`, `writeTerritory()` are in `src/engine/types.ts`; the CPU
  sim of the engine tests records the discs (`CpuSim.territories`).

## The shaders

- WGSL: `shaders/territory.wgsl` (`fillOwners`, `push`, `addDisc`). The lines between `//#if TERRITORY` and `//#endif`
  in `agents.wgsl` (binding 14) and `growth.wgsl` (binding 17). Without TERRITORY each source is the one of before,
  character for character; TERRITORY always comes with FLOW (`Kernels.flowing()`, `Kernels.growth()`).
- GLSL: `gl/glsl/territory.frag` (PASS 0 push, 1 disc, 2 the fragment of the owners), `gl/glsl/owners.vert`, and
  `#if TERRITORY` in `tools.glsl` (the sampler and `inTerritory()`), `agents.frag` and `growth.frag`. The programs are
  `Programs.territory()` and `Programs.flowing(…, territory)` in `gl/programs.ts`.
- The constants of stage 4 ride in the uniform block of the flow after its 64 sites: `FLOW_TERRITORY_SLOT` and 2
  slots (`flow.ts`), written by `packTerritory()` after `packFlow()` in both sims. A pass that reads them declares the
  whole block: a to g, `sites: array<vec4f, 64>`, then `push` (see `territory.wgsl`, `territory.frag`).

## Traps for E2

- **Bind groups** of WebGPU are cached by key. A key of a group that holds the territory must contain `terr`
  (`dropTerritory()` deletes those), and one that holds a buffer of the flow must contain `flow` (`dropFlow()`).
- **Limits**: `settle` and growth `win` bind 8 storage buffers, the default limit: new state goes into textures there
  (ADR 0067, decision 8). The agent pass of WebGL2 samples 12 textures; 4 pressures make 16, the minimum of a device.
- **The block of the flow**: new constants go after the slots of the territory; raise `FLOW_TERRITORY_SLOTS` or add a
  slot constant, and extend `packTerritory()` and its unit test (`territory.test.ts`). `packFlow()` clears the whole
  block first.
- **Random streams**: 0 to 10 and 7 + 65536 · k belong to the agents and the start, 11 + 65536 · s to the push
  (`docs/model.md`, 7.7). A new draw needs a stream of its own.
- **One agent per cell**: the owners have one bit per strain and cell; the push counts cells, which are agents only
  with the rule. `territoryOn()` holds the rule.
- **The start territory** exists only for the start layout Food. Every other layout starts with an empty territory.
- **Wrong rules** of stage 4 use the prefix TY in `research/flow/engine/mutate.ts`; PR #117 adds FP rules to the same
  list. When code that a wrong rule names changes, run `mutate.ts check` (S1 and L3 were adapted in E1).

## Tests

- `src/engine/territory.gpu.test.ts`, both backends: moves (a twin with a territory of every cell, and one without
  the rules), respawn (`respawnStep()`), births (`growthStep()` with `territory`), owners and push over 6 steps in
  three arenas (`owners()`, `push()`), the start territory (`addDisc()`). All with two strains.
- `src/engine/territory.test.ts`, `sizing.test.ts`, `engine-env.test.ts` ("the start territory of the rules of stage
  4"), `src/model/params.test.ts` and `url.test.ts` ("the rules of stage 4").
- The digests of every scene: `research/flow/README.md`, part 27; the record of E1 is
  `logs/engine/territory-0068/digest-branch.jsonl` in `research/flow/logs.tar.gz`.

## Not measured in E1

- The time of a step with the rules on either backend.
- Any scene with the rules: the speed of the front in the engine, the Y-maze, the dish (E4).
