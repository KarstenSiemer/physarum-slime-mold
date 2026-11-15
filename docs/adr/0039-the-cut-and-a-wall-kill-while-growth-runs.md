# 0039: The cut and a painted wall kill while growth runs

- Status: accepted (decision of the coordinator, 2026-11-15, under the owner's delegation of 2026-11-12), built
  2026-11-15
- Date: 2026-11-15
- Extends ADR 0023 (the Cut tool) and ADR 0038 (an agent under a painted wall).

## Context

The Cut tool moves the alive agents of its wound to random open points outside the wound, anywhere on the grid
(ADR 0023; `placement()` in `src/engine/shaders/agents.wgsl` and `src/engine/gl/glsl/tools.glsl`). An agent tries up
to 8 points, and with one agent per cell a loser stays where it was. ADR 0038 places an alive agent under a painted
wall the same way (`underWall()`, the flag `wallOverAgents`). The placement comes from Jones 2010 (Artificial Life
16(2), Sec. 4.3, p. 148): the agents removed from the damaged area were seeded at random positions outside it, so the
number of particles stays. That fits Jones' population, which nothing creates or removes there.

Found on 2026-11-15 (PR #77, ADR 0029, amendment 2026-11-15 (2), "The Cut tool on the Tokyo map"): on the Tokyo map
these random points lie also in the sea beyond the coast wall and on starved land. With growth such agents become
colonies there. 100 steps of the Cut over four cities at step 24,000 turned 3,997 agents into 19,946, and left trail
in 50,001 cells of the sea, 6,475 of them still at step 48,000. The same amendment measured that with growth the
colony joins a region whose network was taken off again within 7 to 13 min of model time.

When growth runs, read in the code on 2026-11-15:

- `growthOn(s)` is `s.growth && s.collisions` (`src/engine/pack.ts:150`). `Engine.fit()` switches the rule off where
  the backend has none (`src/engine/engine.ts:301`–`303`: WebGL2 without float blending), so growth is off there too.
- The growth test runs on the steps with t mod Gf = 0, only while `growthOn()` holds and Gf > 0 (`growthTests()`,
  `pack.ts:158`). `packParams()` packs `P.growth.x` = Gf while `growthOn()` holds, else 0 (`pack.ts:247`). So
  `P.growth.x > 0` holds exactly while a child can be born at some step. With Gf = 0 ("0 turns the growth test off",
  the help of Growth test every) the switch can be on and no agent divides.

How an agent dies today, read on the same day:

- `shrinkage()` clears the bit ALIVE (`agents.wgsl:216`, `agents.frag:165`). On WebGPU `claim` writes the agent back
  after it (`agents.wgsl:381`), and `settle` reads the bit (`agents.wgsl:392`): a dead agent claims no cell, does not
  move, adds nothing to the occupancy of the next step and is not counted (`count(alive, s)`, `agents.wgsl:425`). On
  WebGL2 mode 1 writes the bits (`agents.frag:215`), and the claim points (`points.vert:25`, `points.vert:41`) and
  mode 2 (`agents.frag:226`–`229`) read them.
- Growth takes the dead agents by that bit: `dead[id]` (`growth.wgsl:216`), `growth.frag:167` and `:210`. Inoculate
  and respawn take an agent that is dead after `shrinkage()` (`placement()`), also one that died in this step.

So an agent that `shrinkage()` kills is a dead agent like any other for growth, inoculate, respawn, the occupancy and
every count. No scene uses the Cut tool, and only a wall painted during a run puts an alive agent under a wall
(ADR 0038, Context).

## Options

1. Keep the placement in every case. The colonies in the sea stay.
2. Kill the agent while growth runs, and place it without growth.
3. Kill it always. The population of Jones 2010 shrinks, also in the scene Wound healing (Jones 2010, Fig. 22), and
   without growth nothing brings it back (ADR 0038, option 2).
4. Place it only on ground that the colony can reach (`TODO.md` of PR #77). That needs a map of the reachable cells
   and still moves plasm that a wound takes away.

## Decision

The coordinator's decision of 2026-11-15, under the owner's delegation of 2026-11-12:

1. **Option 2. While growth runs, an alive agent in the wound of a held cut dies, and an alive agent under a painted
   wall dies too.** Reason: the owner wants the model to behave like the real slime mold. A wound removes the plasm;
   it does not move it elsewhere, and the colony grows back from the margin of the wound by growth. Measured in PR #77:
   with growth the colony joins a region whose network was taken off again within 7 to 13 min of model time.
2. **Without growth both keep the placement** (the Jones model, and the extended model with growth off). Reason: the
   owner wants the Jones presets to follow their papers, and Jones 2010, Sec. 4.3 keeps the population.
3. **No scene may change its bytes.** No scene uses the Cut, and only a wall painted during a run puts an agent under
   a wall. Checked with the digests of every scene (Consequences).

My own choices, under the same delegation:

4. **Growth runs while `P.growth.x > 0`: growth on, one agent per cell, and Gf > 0.** Reason: with Gf = 0 no child is
   ever born, so the reason of decision 1 (the colony grows back) does not hold and that of decision 2 does: nothing
   would bring the agents back but inoculate and, with the flow, respawn. `growthOn()` alone would kill also with Gf = 0. The rule is the same in
   both models: it asks for growth, not for the model, as decisions 1 and 2 do. A Jones model with growth switched on
   kills too; no scene of Jones has growth (`src/model/presets.ts`).
5. **The death is a part of `shrinkage()`**, after random shrinkage and starvation (`removed()`, `agents.wgsl:209` and
   `:225`; `tools.glsl:96`, `agents.frag:175`; model.md 7.1, item 3). Reason: both backends kill there already, and
   every later reader takes its result: `settle`, mode 2, the claim points, `placement()` and growth. `placement()`
   keeps its code: a dead agent never enters the loop of the cut (`agents.wgsl:292`, `tools.glsl:121`), so while growth
   runs the loop places none, and without growth it runs as before. The order of the three tests changes no result:
   each reads only the agent as the step found it, random shrinkage and starvation draw from streams of their own, and
   the new test draws no number.
6. **The test reads the agent as the step found it**: its position for the cut, its cell for the wall, as the
   placement did. An agent that walks into the wound during a step dies at the start of the next one.
7. **A killed agent stays where it was, with its heading**, as an agent that shrinkage kills. It is a dead agent like
   any other: inoculate, respawn and a birth of growth can bring it back to life, also in the step in which it died,
   as they can an agent that random shrinkage killed in that step (model.md 7.1). Reason: the task asked for a normal
   dead agent, and a rule of its own for these agents would be a second kind of death.
8. **The tooltip of the Cut tool** reads "Wound the network: moves the agents in an area away. With Growth and
   shrinkage, they die instead, and the colony grows back from the edge. In the extended model the area also loses its
   trail." (`src/ui/state.svelte.ts:60`). The help of Growth test every says what Gf = 0 does to the Cut tool and a
   wall, and the help of the switch Growth and shrinkage what the switch does to them (`src/model/params.ts:236`,
   `:436`). Reason: the tooltip names the switch the user sees; the case Gf = 0 belongs to its slider. `docs/design.md`
   (the tools) and `docs/fidelity.md` (row 11, Wound healing) say the same. Learn.svelte has no text that says the cut
   moves agents: it lists the help of the switch and the sliders.
9. **Tests on both backends**, in "agent tools (ADR 0023)" of `src/engine/sim.gpu.test.ts`, so that the wrong rules
   of ADR 0038 and of this ADR run the same tests. The colony runs in a box of 64 × 48 cells with a closed room of
   19 × 19 open cells in a corner, behind a wall 3 cells thick, so that only a placement can put an agent there. The
   wound has a radius of 8.13 cells.
   - Density 0.3 and twice as many agents, half of them dead at the start, so that growth has dead agents to take. A
     first version had only the alive ones: on WebGPU the colony was then full by the end of the hold, and the wound
     still held no agent 60 steps after the release. With twice as many, 45 and 49 agents were back in the wound
     60 steps after the release (WebGPU, WebGL2).
   - Growth every 5 steps with Gmax 40, so that the colony divides wherever a neighbour is free.
   - Shrinkage tests every 3 steps that kill no agent (Smax 225): only the cut and the wall change the population
     between growth steps, and the shrinkage interval is packed while Gf = 0 (wrong rules K4 and K9).

## Consequences

- No scene changes a byte. The digests of `research/flow/README.md` part 6 (`digest.gpu.test.ts`: the default
  settings and the 20 scenes, 500 steps, WebGPU and WebGL2, M3 Pro, 2026-11-15) of this branch against `main` at
  `71b0161`, both made on the same machine, once before and once after the merge of `main` at `281d69e` (PR #77
  changed no file of the app but a test): 42 of 42 equal with the flow off (`VITE_PATCH='{"flow":false}'`), and
  42 of 42 equal with the flow as each scene has it, with the digests of the memory and the pressure of the flow
  (`VITE_FLOW=1`). The files of both sides are equal byte for byte. The five scenes with growth (`foraging-maze`,
  `tokyo`, `food-ring`, `rival-networks`, `tokyo-rivals`) run the new test in every step and find no agent to kill:
  no tool is held, and no wall was painted over their agents.
- The Tokyo case of PR #77 again on this branch (2026-11-15, WebGPU, seed 1, the Cut tool over the disc around four
  cities from step 24,000 to 24,100, `VITE_CUT` of `research/flow/engine/dump.gpu.test.ts`, the lines of
  `measure-tokyo.ts`). Up to step 24,000 the run gives the numbers of PR #77 (3,997 agents, TL 1.78), as it must: the
  rule acts only while the tool is held.

  | Step   | Agents, PR #77 | Agents, this branch | Cells of the sea with trail, PR #77 | The same, this branch | Stations joined (33), this branch |
  | ------ | -------------- | ------------------- | ----------------------------------- | --------------------- | --------------------------------- |
  | 24,000 | 3,997          | 3,997               | 0                                   | 0                     | 33                                |
  | 24,100 | 19,946         | 3,594               | 50,001                              | 0                     | 29                                |
  | 24,300 | 21,135         | 3,898               | 49,624                              | 0                     | 31                                |
  | 24,600 | 18,887         | 4,004               | 45,270                              | 0                     | 33                                |
  | 27,000 | 7,399          | 4,000               | 18,155                              | 0                     | 33                                |
  | 48,000 | 4,933          | 4,170               | 6,475                               | 0                     | 33                                |

  The sea holds no trail at any of the 15 dumped steps up to 48,000. After the hold 3,594 agents live, 403 fewer than
  before it, and the network joins all 33 stations again by step 24,600, 500 steps (17 min of model
  time) after the start of the cut; PR #77 found them joined by step 25,000. The log is in `research/flow/logs.tar.gz`
  (Consequences, last item).

- While growth runs, a held cut empties its wound at every step and puts no agent elsewhere; a wall painted over a
  colony kills the agents under it in the next step. The colony grows back from the margin once the tool is released.
  Without growth, or with Gf = 0, the cut and a wall place their agents as before.
- Tests (`sim.gpu.test.ts`, "the cut and a painted wall while growth runs", both backends; WebGL2 without float
  blending has no growth and skips them):
  - "kills the alive agents in the wound of a held cut": in the first step of the cut every agent of the wound is dead
    where it was, with its strain and heading, every other agent lives, and the count of the stats falls by the dead.
    For 40 more steps of the cut, also on growth steps, no agent reaches the closed room, every agent alive in the
    wound at the start of a step is dead after it (or, on a growth step, a child elsewhere), and between growth steps
    the population falls by these agents (an agent within 0.001 cells of the rim may go either way). 60 steps after
    the release, more than a quarter of the agents that the cut killed live again, and agents are back in the wound.
  - "places the agents of the wound elsewhere", with growth off and with Gf = 0: the population stays for 10 steps of
    the cut, and more than 5 agents land in the closed room.
  - "kills an alive agent under a painted wall", without and with the cut held over a part of the wall, in the Jones
    model: every agent under the wall, and every agent of the wound, is dead where it was, no agent is left in a wall,
    and the count falls by them.
  - The tests of ADR 0023 and ADR 0038 run without growth and hold as before.
- `research/flow/engine/mutate.ts` holds the wrong rules K1 to K10. Each one fails at least one test (runs of
  2026-11-15 on the branch before and after the merge of `main` at `281d69e`, with the same results):

  | Rule                                                             | Fails                                                                      |
  | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
  | K1 wgsl, K6 glsl: the cut and a wall kill without growth too     | 6 tests: the cut of ADR 0023, three of ADR 0038, both "places … elsewhere" |
  | K2 wgsl, K7 glsl: with growth the cut places its agents          | 2 tests: "kills the alive agents …", the wall with the cut held            |
  | K3 wgsl, K8 glsl: with growth an agent under a wall is placed    | 2 tests: both "kills an alive agent under a painted wall"                  |
  | K4 wgsl, K9 glsl: the switch kills also with Gf = 0              | 1 test: "places … elsewhere with the growth test off (Gf 0)"               |
  | K5 wgsl, K10 glsl: no kill on one backend, only on the other one | 3 tests: "kills the alive agents …", both walls                            |

  U1 to U8 of ADR 0038 still fail 1 to 7 tests each in the same run; U2, U5, U7 and U8 also fail the new tests of the
  wall.

- Cost: `removed()` reads one uniform for each alive agent in the passes that call `shrinkage()` (`advance` and
  `claim` on WebGPU, modes 0 and 1 on WebGL2), and only while growth runs the tool, and the wall byte while the flag
  of ADR 0038 is set. Measured after the merge on a free GPU (the check below): no cost that the runs show.
- Found on the way, not changed: respawn (flow on) draws its point anywhere on the grid, also in the wound of a held
  cut, and the cut does not clear the flow memory or the tube body there (`respawn()` in `agents.wgsl`; in the fields the
  cut clears only the chemicals, `diffuse.wgsl:79`–`83`). So while the cut is held over a tube, a dead agent can come to life
  in the wound. While growth runs it dies at the start of the next step without a move or a deposit; without growth
  the cut moves it to a random point of the grid in the next step. How often this happens is not measured
  (`TODO.md`).
- The logs are in `research/flow/logs.tar.gz`, folder `logs/engine/cut-growth/`: the digests of `main` at `71b0161`
  (`digest-main*.jsonl`) and of the branch merged with `main` at `281d69e` (`digest-branch*.jsonl`), the run of the
  wrong rules on that code (`mutations.txt`), and the Tokyo case (`tokyo-cut.txt`, the lines of `measure-tokyo.ts`;
  `tokyo-cut.jsonl`, the log of the run). The commands: `research/flow/README.md`, part 6 for the digests, part 7 for
  the wrong rules, part 13 for the Tokyo case.

## Check of 2026-11-15: the cost on a free GPU

The coordinator measured the step after the merge, on a free GPU: 24 runs from 10:02 to 10:08, M3 Pro, and in each of
the 24 checks before a run no other Vitest ran (load 3.7 to 5.0). `research/flow/engine/turns.sh` ran
`bench.gpu.test.ts` in a checkout of `281d69e` (`main` just before this ADR) and of `9c0c405` (this ADR, merged), and
of `9c0c405` with `VITE_WALL=1`, which sets the flag of ADR 0038, 8 rounds in turns. A run is the Maze, the Foraging
maze and the Tokyo rail network with the flow off, seed 1, a canvas of 1280 × 800, 3,000 steps, then the median of 21
batches of 50 steps. Growth runs in the Foraging maze and in the Tokyo scene, so there `removed()` also reads the tool,
and with the flag the wall byte.

ms per step, the median over the rounds (least to most), and per round the time of a build over the time of `281d69e`
in the same round, the median (least to most):

| Scene         | Backend | `281d69e`           | `9c0c405`           | flag set            | after / before      | flag set / before   |
| ------------- | ------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| Maze          | WebGPU  | 0.188 (0.186–0.198) | 0.188 (0.182–0.198) | 0.188 (0.184–0.198) | 1.000 (0.968–1.032) | 1.000 (0.939–1.021) |
| Foraging maze | WebGPU  | 0.344 (0.338–0.366) | 0.346 (0.336–0.368) | 0.346 (0.342–0.370) | 1.008 (0.934–1.030) | 1.006 (0.956–1.024) |
| Tokyo         | WebGPU  | 0.466 (0.450–0.494) | 0.464 (0.452–0.480) | 0.457 (0.450–0.462) | 0.996 (0.951–1.027) | 0.983 (0.919–1.013) |
| Maze          | WebGL2  | 0.396 (0.378–0.428) | 0.394 (0.388–0.422) | 0.394 (0.394–0.398) | 0.990 (0.934–1.048) | 0.997 (0.930–1.042) |
| Foraging maze | WebGL2  | 0.651 (0.634–0.680) | 0.631 (0.628–0.656) | 0.652 (0.630–0.674) | 0.968 (0.957–1.028) | 1.008 (0.935–1.037) |
| Tokyo         | WebGL2  | 0.715 (0.708–0.808) | 0.711 (0.704–0.810) | 0.713 (0.710–0.732) | 0.994 (0.983–1.014) | 1.000 (0.899–1.011) |

In every run all builds ended with the same number of alive agents (13,130, 17,840 and 7,491 on WebGPU; 13,130, 17,230
and 7,978 on WebGL2). The rule costs no time that these runs show, with growth and without it, with the flag clear or
set: every median lies within 4 % of 1, and on both sides of it. Not measured: another GPU. The 144 lines of the runs
and the log of each check are `logs/engine/cut-cost/` in the archive.
