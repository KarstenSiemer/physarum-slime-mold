# 0063: A switch to one agent per cell gives a dense scene Jones' population

- Status: accepted. Decision of an agent under the owner's delegation of 2026-11-12. Built 2026-11-19.
- Date: 2026-11-19
- Extends [ADR 0008](0008-collision-mode.md) (the rule of one agent per cell and its switch) and
  [ADR 0022](0022-jones-and-extended-model.md) (the switch to the Jones model, which turns the rule on).

## Context

The owner wrote on 2026-11-19 (translated from German): in the scene Two strains, with One agent per cell switched
on, the agents do not behave like the slime mold: they form no tubes at all.

What the code did:

- Agents per cell has two meanings. Without the rule it is how many agents share a cell: the scenes without the rule
  hold 1 to 8. With the rule it is the share of the cells that hold an agent: Jones uses 0.03 to 0.15 for a network
  (Jones 2010, Table 1, %p).
- `constrain()` caps Agents per cell at 1 with the rule. So a switch to the rule in a scene with 2 agents per cell
  gave 1: an agent in every cell.

Measured in the owner's link, Two strains with the rule, on a grid of 768 × 576 cells:

- 435,750 agents on 442,368 cells: 98.5 % of the cells held an agent.
- 5 % of the agents moved in a step, each inside its own cell. No agent can enter a cell that holds another one, so
  no agent went anywhere, and no network formed.
- With growth on, the first shrinkage test kills every agent with more than 20 agents in its 5 × 5 window. With the
  settings of the owner's other link (Three strains in a dish of 260,576 cells, seed 1) the scene started with
  211,973 agents. After the first step 2,553 were alive: a ring along the rim. The colony then grew back from the
  rim, with 11,473 agents at step 28.

## Options

1. **Leave the cap at 1 and show a hint** beside Agents per cell. The scene still starts frozen.
2. **Give the scene Jones' population at the switch**: 0.15, when it holds 1 agent per cell or more. A switch back
   puts the value of before back.
3. **Cap Agents per cell below 1 with the rule**, at 0.9 or at Jones' 0.5 of Fig. 21. A link that holds a higher
   value would then run with another one than it was made with.
4. **Scale the value**, a third of it or a tenth. No factor has a meaning: the two values count other things.

## Decision

Option 2.

1. `withRule()` in `src/model/params.ts` turns the rule on. Settings without the rule that hold 1 agent per cell or
   more get 0.15 (`JONES_DENSITY`): Jones' population of Fig. 4 and 5, and the value of this app's scenes with his
   agent. A value below 1 stays: it is a share of the cells with the rule too.
2. The panel's switch of the rule and the switch to the Jones model both use it (`setRule()` and `setModel()` in
   `src/ui/state.svelte.ts`, `toJones()`). A notice names the change.
3. A switch back to no rule puts the Agents per cell of before back, while the value is still the 0.15 that the
   switch set. A value that the user set meanwhile stays. A new scene or a link forgets the value of before.
4. `constrain()` and a link stay as they are. A link that holds the rule and 1 agent per cell runs as it was made.
   The Jones model keeps the rule on, so its values are the user's or the scene's.

Why 1 and not a lower limit: at 1 the cap of the rule changes the value anyway, so the value is no longer the
user's. Below 1 the user or the scene chose a share of the cells, and Jones himself uses 0.5 for a sheet (Fig. 21).

## Results

In the app: Two strains, then a tick of One agent per cell. Agents per cell goes from 2 to 0.15, and the notice says
so. After 400 steps both strains hold a network of tubes, and 40 % of the agents move in a step. A second click
gives 2 agents per cell again.

Tests: `src/model/params.test.ts` (`withRule()`, `toJones()`) and `src/ui/state.test.ts` (the switch of the rule: on,
off again, a share below 1, a value of the user, a new scene, a link, the switch to the Jones model, and the notices).
The wrong rules `DR1` to `DR11` of `research/flow/engine/mutate.ts` each fail at least one of them.
[`research/flow/README.md`](../../research/flow/README.md), part 24, has the commands and the record.

## Consequences

- A switch of the rule on and off again gives the scene of before. Before, it left 1 agent per cell.
- The notice of the switch to the Jones model names 0.15 where it named 1.
- A share between 0.15 and 1 stays at the switch. Above about 0.8 few agents can move: that is the user's value.
- Growth still needs room: with the default Capacity the scene holds only its start population, and the panel
  offers to raise Capacity, as before.
