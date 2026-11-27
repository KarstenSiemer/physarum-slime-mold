# 0068: The territory of each strain in the engine

- Status: accepted. The coordinator set the task on 2026-11-20: the first of four parts of the engine of stage 4, in
  both backends, behind one setting that no scene turns on yet. The rules are those of ADR 0065 (decision 1), the
  forms those of ADR 0067 (decisions 4 and 6 to 9). The choices below are an agent's, under the owner's delegation of
  2026-11-12.
- Date: 2026-11-20
- Extends [ADR 0065](0065-the-growth-front-takes-the-flow-a-prototype.md) (decision 1: the territory and its push)
  and [ADR 0067](0067-the-rules-of-stage-4-in-the-forms-of-a-gpu.md) (decisions 4 and 6 to 9).
- Extended by ADR 0069 ([the sinks of each strain](0069-the-sinks-of-each-strain-in-the-engine.md); it closes open
  point 1, the corner of the push).
- In short: [`docs/model.md`](../model.md), section 6.10, has the rule; [`research/front/ENGINE.md`](../../research/front/ENGINE.md)
  has the state of the four parts and what the next part needs.

## Context

The engine of stage 4 comes in four parts (`research/front/ENGINE.md`). This first part holds the territory: an agent
moves, comes to life and is born only onto the territory of its strain; the push grows the territory; the owners feed
the push; the start layout Food writes the start territory. The prototype `research/front/sim.ts` has one strain, so
some forms for several strains are new.

## Decision

1. **The setting is `territory`**, named for the first rule of stage 4, on which the others build: every sink sits at
   the edge of the territory (ADR 0065, decision 8), and the births that the flux pays come at the sinks. It turns on
   every rule of stage 4; the next parts add theirs to it. The word front names the front field of the picture (ADR
   0060, `showFront`), so neither the setting nor a pass nor a buffer takes it.
2. **The rules run only with growth and the flow** (`territoryOn()` in `src/engine/territory.ts`): in the extended
   model with growth, and so with one agent per cell, and with the flow, as the rule set of ADR 0065 has them. The
   constants ride in the uniform block of the flow (ADR 0067, decision 9), which exists only with the flow, and the
   owners and the push count one agent per cell. The Jones model never has them, and a link holds the setting only
   while it is on, so every link of before keeps its bytes.
3. **The push draws once for each cell and strain**, from the stream 11 + 65536 · s, with the index of the cell in
   place of the id. The prototype has one strain and one draw per cell; one draw for all strains would make two
   territories join a cell together whenever the one with fewer agents beside it joins.
4. **n counts every agent of the strain among the 8 neighbours.** The prototype counts only those on a cell of the
   territory. Both are the same while every agent stands on the territory of its strain; they differ only for an agent
   that a tool put outside it, whose cell joins in the push of its step (ADR 0067, decision 6).
5. **The chances 1 − (1 − 0.004)^n for n = 1 to 8 ride in the block as 8 float32 numbers** (`PUSH_CHANCES`,
   `packTerritory()`), in place of the speed and a `pow` in the passes: `pow` is not exact in WGSL or GLSL, and with
   the table both backends and the CPU copy decide alike for every draw. They take 2 slots after the 64 sites, so no
   pass of the flow reads another layout.
6. **The owners are bits, as the territory is**: bit s for an alive agent of strain s, so a cell that holds an agent
   joins the territory by one OR. On WebGPU `atomicOr` fills a buffer of 4 cells per word; on WebGL2 one point per
   agent writes into a target of unsigned bytes, which takes no blending: with one agent per cell no two points meet.
7. **A move inside the own cell needs no territory**: it goes onto no other cell. The claim of a move checks the
   territory (`canClaim()`), and a respawn checks it before it draws its chance, which changes no other draw.
8. **The push has no rule for a corner**, as in the prototype: a diagonal neighbour between two walls counts. No move
   and no birth passes such a corner, so a cell beyond it can join, but no agent reaches it there.
9. **The engine writes the start territory of a strain just before the step that places its colony**
   (`Sim.addTerritory()`, a pass over the cells): the open cells within √(100 / π) + 3 ≈ 8.64 cells of its start, the
   nearest copy on the periodic grid. No agent of the strain lives before that step, so the steps of the strains
   before it change nothing of its territory. A reset clears the territory.
10. **A switch of the rules restarts the run**, also when growth or the flow turns them on or off: the territory starts
    from the start territory, and only a reset writes it.

The bytes per cell follow ADR 0067, decision 7: 3 B on both backends (`TERRITORY_BYTES_PER_CELL`). The bindings follow
its decision 8: `claim` binds 5 storage buffers and `settle` 8, `test` 6 and `win` 8 of growth, each with the
territory as a texture more; the agent pass of WebGL2 samples 12 textures, and the next part adds the 4 pressures.

## Results

- **The CPU copy** (`territory-reference.ts`, `growth-reference.ts`): both backends agree with it, with two strains in
  every test (`territory.gpu.test.ts`, 20 tests): the moves of 336 agents (over 80 blocked, over 80 onto the
  territory), a respawn of 3,000 dead agents (over 1,000 draws refused), a growth step (over 100 children), the owners
  and the push in 6 steps in a periodic grid, a box and a dish with walls, and the start territory in each arena.
- **A territory of every cell** for both strains gives the agents of a run without the rules, bit for bit.
- **The Y-maze with the rules** (`engine.gpu.test.ts`, seed 3, M3 Pro): the colony starts in its start territory of
  241 cells, and in 300 steps the territory grows to 266 cells on WebGPU and 269 on WebGL2, with every agent on it.
- **The wrong rules** TY1 to TY38 of `research/flow/engine/mutate.ts` each fail at least one test, and so do S1 and L3,
  whose texts follow the code now (`research/flow/logs/engine/territory-0068/mutations.txt`).
- **No scene changes**: the digests of every scene after 500 steps on both backends, with the state of the flow, equal
  those of `main` in 62 of 62 runs (`research/flow/README.md`, part 27).

## Consequences

- No scene runs the rules yet. Part 4 turns them on in scenes, with the panel, the digests and the measures.
- Not measured: the time of a step with the rules, and any run of a scene with them beyond the 300 steps above.

## Open points

- The corner of decision 8: a territory can reach a cell that no agent can enter. A rule as for a move would need a
  test of the two cells beside each diagonal neighbour.
- A start layout without a disc starts without a territory (ADR 0067, open points): the first push gives each agent its
  cell, and the colony waits for the pushes around it. Not measured.
