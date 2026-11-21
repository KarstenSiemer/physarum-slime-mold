# 0067: The rules of stage 4 in the forms of a GPU, measured on the CPU

- Status: accepted. The coordinator set the task on 2026-11-19: the rule set of ADR 0065 stays, the drift becomes a
  setting, every rule of stage 4 is off unless a setting turns it on, two candidates for the paid births, and no rule
  tuned to a number. The forms, the passes and the buffers are choices of an agent. Both under the owner's delegation
  of 2026-11-12. The form of the paid births is none of the two candidates but the order itself (decision 1): the
  first candidate cost the tree births, and the agent did not build the second. The coordinator's review of
  2026-11-20 added decision 10, the second word of R in decision 3 and the cost of `rank` in decision 1.
- Date: 2026-11-19; the last runs and the review on 2026-11-20.
- Extends [ADR 0065](0065-the-growth-front-takes-the-flow-a-prototype.md) (its decision 1, the rule set, and its open
  point on the paid births).
- Extended by ADR 0069 ([the sinks of each strain in the engine](0069-the-sinks-of-each-strain-in-the-engine.md)).
- Extended by ADR 0070 ([the flow takes the sinks of each strain in the engine](0070-the-flow-takes-the-sinks-in-the-engine.md)).
- Extended by ADR 0071 ([the births that the flux pays in the engine](0071-the-births-that-the-flux-pays-in-the-engine.md)).
- Extended by ADR 0089 ([the rules stay in their five scenes for now](0089-the-rules-of-the-growth-front-stay-in-their-five-scenes-for-now.md)).
- In short: [`research/front/README.md`](../../research/front/README.md), step 9, tells the story and has the
  commands. No engine code yet: the engine follows this design in a later pull request.

## Context

ADR 0065 decided the rules of stage 4 for the engine. Three parts of the prototype `research/front/sim.ts` had no form
that a GPU can run: (a) the births that the flux pays go in one weighted random order over all agents of the front;
(b) the distance to ground without slime comes from two passes of a chamfer transform that run in sequence over the
grid; (c) the shares of the sinks and of the sources need sums over all cells. The stage also needs buffers within
the limits of the passes. WebGPU gives a shader 8 storage buffers by default (`src/engine/gpu.ts` asks for no more),
and `settle` and `win` bind 8 already (`GROWTH_BINDINGS` in `src/engine/sim.ts`). WebGL2 gives a fragment shader at
least 16 samplers, and the agent pass samples 11. The start scene has 3 strains (`three-networks`).

## Decision

1. **The paid births: the order of ADR 0065 itself, with a key per agent** (`paidBy=rank`). In a growth step, after
   Jones' births, an agent of the front lies at the rim, on a cell with a sink rate above 0 and a flow memory of at
   least `half`, and is no parent of Jones' rule in this step. Each of them with a free cell of the territory beside
   it draws a key −ln(1 − u) / r, u a draw of its own and r the sink rate of its cell, and the whole part of the budget
   B of them with the least keys claim a child. That is the order of Efraimidis and Spirakis that the prototype runs,
   so it gives the same births in distribution; only the draws differ. As with the order, a budget below 1 pays
   nothing, and after the claims B becomes min(B − the claims, the agents of the front). The flux of a step adds
   2 · I0 / 20, as before.
   - A GPU writes the key of every agent by its slot in `test` (an infinite key for an agent that cannot claim), and
     counts the agents of the front with atomics. In a new pass `rank` each agent with a key counts the agents of its
     strain with a smaller key (the same key and a smaller id counts too), and stops when the count reaches the whole
     part of B: below it, the agent claims the cell of its child as a parent of Jones' rule does, and counts the claim.
     Let b be the whole part of B and n the agents. An agent with q smaller keys stops after about b · n / q keys,
     and the b agents with the least keys read all n keys. So a growth step reads about b · n · (1 + ln(F / b))
     keys, F the agents with a key, and `rank` lasts as long as one agent takes to read all n keys. `win` needs no
     new input: the key of a claim is unique for an agent and a step, so an agent without a
     child of Jones' rule is a paid parent exactly when the cell that its paid child would take holds its key.
   - The first candidate of the coordinator, a chance per agent min(1, B · r / P) with P the sum of the sink rates of
     these agents (`paidBy=chance`), spends less than the order where few agents can claim a child and one of them has
     most of the sink rate: its chance stops at 1, and the others keep theirs. The tree then reached the food 1.13 times
     later with slime on both arms (p 0.00032), and ended in an open dish with 0.69 times the territory (p 0.0025).
     Chances that add up to the budget (`paidBy=fill`, found in up to 8 rounds of counts) keep the Y-maze and the crown
     and the fan, but the tree in an open dish with slime everywhere ends with 0.83 times the territory (p 0.0075, 40
     runs) and grows less than without slime (0.81 times, p 0.0097): the order spreads its births more widely.
   - Three tries with marks per cell, drawn after the step before a growth step, lost births where few agents can
     claim one (README.md, step 9; `research/front/NOTES.md`, notes 20 to 22). The second of them stays as
     `paidBy=ahead`: it kept the Y-maze, but at drift 0 the open dish ended with 0.74 to 0.78 times the territory.
   - The second candidate, a store of flux per sink, is not built: the order needs no store, and the rank keeps every
     result (decision 5).
2. **Ground without slime: a look at the square around a sink** (`fresh=box`). A sink looks at the 13 × 13 cells
   around it for an open cell without slime. Only "within 6 cells" is read, and the chamfer transform with the unit
   weights of the prototype gives the Chebyshev distance through every cell of the grid, so both forms give the same
   answer on every cell (the unit test) and the same runs. It needs no buffer and no pass: only a sink looks.
   Decision 10 lets the look follow paths over open cells.
3. **The sums: integers** (`sums=fixed`). Each sink rate counts in steps of 2^-16 as an unsigned integer of 32 bits:
   WebGPU adds them with atomics after a sum per workgroup, WebGL2 with a pyramid of `RGBA32UI` targets over squares
   of 4 × 4 cells, and both get the same integer in every order. The sums of a step serve the same step: the pressure
   iterations come after them. Per strain: R and the tube cells C for the shares, and the sinks N for whether the
   front takes flux. A word of 32 bits holds R exactly only below 65,536 times the weight 1. A grid with more open
   cells than that can hold more sinks, and an atomic addition would then wrap without a sign. So R keeps a second
   word: an addition that wraps the first word adds 1 to the second (WebGPU: `atomicAdd` returns the old value;
   WebGL2: each level of the pyramid adds the carries in the fourth lane), and R stays exact in every order of the
   additions (the coordinator's review). Each sink takes its share
   S · r / R with the rate r that R counted, so the sinks take exactly the S that the sources give (10⁻⁹ of the flux,
   as in floats). With its own rate a sink missed S by the rounding of R, up to 8 · 10⁻⁵ of the flux with slime
   everywhere, and the crown in the Y-maze with slime everywhere then took 1.10 times as long, also with the order
   (p 0.0040; NOTES.md, note 26): the ghost conductance of 10⁻⁵ lets no such rest leave the network.
4. **The territory of the start stays the disc of the start and a rim of 3 cells**, as in the prototype: the engine
   writes it from the start spot and the disc of the start layout Food (`docs/model.md`, section 10). A square of
   7 × 7 cells around each start agent (`start=agents`) would need no shape, but it keeps every start agent 4 cells
   from the edge of the territory, and a sink lies within 2 cells of the edge: the tree in an open dish then got 24
   and 26 paid births in its first 500 steps in place of 104 and 119 (NOTES.md, note 24).
5. **The three forms keep the results.** The rule set of ADR 0065 with decisions 1 to 3 against the same without them
   (README.md, step 9): no choice and no time of the Y-maze leaves the spread of the seeds, in 40 runs per case
   (Fisher p 0.22 to 1.0; the first food 0.98 to 1.05 times as late, Mann-Whitney p 0.18 to 0.99) and in 120 runs at
   the drift 1.5 and 5 with slime on both arms, everywhere and none (Fisher p 0.24 to 1.0; 0.99 to 1.02 times, p 0.44
   to 0.95). Slime on one arm gives 36 : 4, 40 : 0 and 40 : 0 (the rule set 31 : 9, 40 : 0 and 40 : 0), and slime
   everywhere is as fast as no slime (1.01, 1.02 and 1.01 times; p 0.61, 0.11 and 0.37). In the dish the crown and the
   fan cover half of it as early (p 0.082 to 0.94), and the tree covers 32 % of it with slime everywhere and 33 %
   without (the rule set 36 % and 40 %; p 0.29 and 0.079; 40 and 20 runs).
6. **The passes, in both backends.** The order of the prototype stays. Per step, while the rules of stage 4 are on:

   | Pass                          | What it does                                                                                     |
   | ----------------------------- | ------------------------------------------------------------------------------------------------ |
   | agents (`claim`, `settle`)    | moves and respawn only onto the territory; a sensor adds −drift · the mean pressure of 4 lanes   |
   | growth (`test`, `win`)        | a child only onto the territory; `test` writes the keys and counts the agents of the front       |
   | growth `rank` (new)           | the rank of decision 1, the claims of the paid children, and their count K                       |
   | owners (new, per agent)       | the strain of the agent of each cell, after the births                                           |
   | flow `update`                 | as now; a tube also adapts while the front of its strain took flux in the step before            |
   | front (new, per cell, strain) | the sink test, the exponential mean of the sink rate, the sums R, C, N                           |
   | state (new, one per strain)   | the covered ports, whether the front takes flux, the budget                                      |
   | flow `pressure`               | Kirchhoff's law with the sinks −S · r / R (r as R counted it) and the sources S / ports or S / C |
   | push (new, per cell)          | the territory grows: 1 − (1 − 0.004)^n for n agents of the strain beside an open cell outside it |

   On WebGL2 each new pass over the cells is a fragment pass, the owners and the counts are points over the agents
   with additive blending, and the sums are the pyramid of decision 3. The push stays the draw per cell of the
   prototype: the owners give the agents of a strain beside a cell. A cell that holds an agent of a strain joins the
   territory of that strain in the push: the prototype never needs it, because its agents step and are born only
   onto the territory, but a tool puts agents anywhere.

7. **The buffers.** One byte per cell holds the territory of each strain (bits 0 to 3), in two copies: the push writes
   the next one. The sink rate of each strain is a float per cell, and the key of the rank a float per agent.

   |                       | WebGPU                                                | WebGL2                                    |
   | --------------------- | ----------------------------------------------------- | ----------------------------------------- |
   | territory             | `r32uint` texture of 4 cells per texel, 2 copies: 2 B | `R8UI` target, 2 copies: 2 B              |
   | owners                | `u32` of 4 cells, set by atomics: 1 B                 | `R8UI` target, a point per agent: 1 B     |
   | sink rate, per strain | `f32` storage buffer, updated in place: 4 B           | `R32F` target, 2 copies: 8 B              |
   | sums, per strain      | 32 B of state                                         | pyramid of `RGBA32UI`: 16 / 15 B per cell |
   | key, per agent        | `f32` in the storage buffer of the state: 4 B         | `R32F` target of the agents: 4 B          |
   | per cell in all       | 3 + 4 · strains B (15 B for the start scene)          | 3 + 9.07 · strains B (30.2 B)             |

   On WebGL2 a sink of the step keeps its sink rate with a minus sign, so that the pyramid counts N without another
   target; a reader takes its size. The counts of the agents of the front and of the claims come from points into a
   target of 2 × 1 texels. The budget, the sums as floats and the flag of the front ride in a state of 2 vec4 per
   strain: a storage buffer on WebGPU, with the keys of the agents after it, and an `RGBA32F` target of 2 texels per
   strain in 2 copies on WebGL2.

8. **The bindings.** The new state rides in textures where a pass is full. WebGPU: `claim` binds 5 storage buffers and
   gains two sampled textures (the territory, and the pressure array that the flow has); `settle` keeps 8 and gains
   the territory texture; `test` binds 8 (the sink rates and the state are the two new ones), and `rank` 5; `win`
   keeps 8 and gains the territory texture; `update` binds 3, `pressure` 4, and the other new passes at most 6. WebGL2:
   the agent pass samples 16 (4 pressures and the territory more), the minimum of every device; the test of growth
   13, `rank` 10.
9. **The settings.** The rules of stage 4 run only while a setting turns them on, so a scene without them keeps its
   bytes, as `//#if FLOW` keeps them for the flow (`src/engine/shaders/variant.ts`). The constants (the speed 0.004,
   6 cells, the weight 0.025, 100 steps, 2 times the flow strength, 20 per birth) ride in the uniform block of the
   flow, and the drift in a lane per strain of the parameters, as the food weight.
10. **Both tests of a sink follow paths over open cells** (the coordinator's review). The edge of the territory
    (open ground outside the territory within 2 cells) and the ground without slime (within 6 cells) count only a
    cell that a path of at most 2 or 6 steps over open cells reaches, without a diagonal step between two walls, as
    for a move. A square alone sees through a thin wall: a sink then pulls flux to a wall that the territory cannot
    cross, and a sink on slime takes the weight 1 from fresh ground behind the wall. The organism meets slime and
    fresh ground only where it can go. In the Y-maze and the dish of the prototype, a path reaches every open cell
    of the square of 5 × 5 and of 13 × 13 cells around every open cell (the unit test), so the paths give the runs of
    decision 5. On a GPU a sink searches its 13 × 13 cells in 6 steps, with a row of bits for each row of cells.

## Consequences

- No scene changes: the engine has none of these rules yet. The engine follows decisions 6 to 9, with a CPU
  reference, wrong rules, `docs/model.md` and the digests of every scene.
- Memory (`research/front/fit.ts`): with the bytes of decision 7, 9 of 936 cases of the 13 scenes with growth and
  the flow get another grid, all in the start scene at a memory hint of 0.5 GB. It has 2 B per cell to spare there
  on WebGPU, and loses its lattice of 384 × 384 (256 cells, 512 on a phone); on WebGL2 three canvases go from 512 to
  256 cells. No other scene and no other hint changes.
- Memory per agent: the keys add 4 B to the 6 B of growth (`GROWTH_BYTES_PER_AGENT`); with them the fit gives the same
  9 cases.
- The prototype keeps the old form of every part: `paidBy`, `fresh` and `sums` take their old words, and the tries
  that lost results stay as `paidBy=chance`, `paidBy=fill`, `paidBy=ahead` and `start=agents`.
- A growth step of the engine gains one pass, `rank`. Its cost grows with the whole part of B times the agents, and
  with the logarithm of the agents with a key (decision 1): the few agents with the least keys read every key. The
  time is not measured; with many agents a pyramid of the least
  keys could cut it.

## Open points

- The start scene at a memory hint of 0.5 GB (the consequence above): the coordinator decides whether it turns the
  rules of stage 4 on there.
- The prototype has one strain. The owners, two strains on one slime and the territory per strain need tests on the
  engine: a second strain that grows on the slime of the first (ADR 0065, open points).
- The territory never shrinks (ADR 0065, decision 1). When a colony has covered a scene, no cell lies at the edge of
  its territory, and the front takes no flux: a long run of the app ends as a scene without stage 4.
- The agent pass of WebGL2 samples 16 textures, the least that a device has. Flow textures of WebGL2 as arrays, as on
  WebGPU, would free 6 samplers.
- One drift for all strains, or one per strain: the panel decides it with the engine.
- A tool that puts agents outside the territory (decision 6) and a start layout without a disc need a territory of
  their own: the cell of the agent joins it, and the agent can move, give birth or be a sink only after the push has
  added a cell beside it. Not measured.
