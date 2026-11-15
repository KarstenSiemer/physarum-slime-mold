# 0041: Respawn skips the wound of a held cut

- Status: accepted (decision of the coordinator, 2026-11-15, under the owner's delegation of 2026-11-12), built
  2026-11-15
- Date: 2026-11-15
- Extends ADR 0039 (the cut and a painted wall kill while growth runs).

## Context

With the flow on, a dead agent draws one random point of the whole grid in every step and comes to life there if the
cell is open and holds a fed tube of its strain (`respawn()` in `src/engine/shaders/agents.wgsl` and
`src/engine/gl/glsl/tools.glsl`; `docs/model.md`, section 7.2). Respawn also runs in a step in which a tool is held
(ADR 0029, decision 8).

The fault, found on 2026-11-15 while ADR 0039 was built (its Consequences, "Found on the way"; `TODO.md`): the point
can lie in the wound of a held cut. In the fields the cut clears only the chemicals of the wound
(`src/engine/shaders/diffuse.wgsl:82`), not the flow memory and not the tube body. So while the cut is held over a
tube, a dead agent comes to life in the wound. While growth runs it dies at the start of the next step, without a move
or a deposit (ADR 0039). Without growth the cut moves it to a random open point of the grid in the next step.

How often: in the test of this ADR (a fed tube on every cell, a wound over 62 % of a grid of 64 × 64 cells, 20,000
dead agents, no rule of one agent per cell) 1,960 dead agents draw a point in the wound that gives them life in one
step, on both backends; the code before this ADR brought them to life there. Not measured in a scene: no scene holds
the cut.

## Options

1. Keep it. With growth the agent lives for one step in a wound that holds no plasm; without growth each such agent
   becomes one more random placement of the cut.
2. A point in the wound of a held cut is no respawn point, as the placement of the cut skips the wound (ADR 0038).
3. The cut clears the flow memory and the tube body of the wound. Then respawn finds no tube there. That changes what
   a cut does to the flow, and how the wound heals after the release: a larger decision than this fault.

## Decision

The coordinator's decision of 2026-11-15, under the owner's delegation of 2026-11-12:

1. **Option 2. While the cut is held (`P.tool.w == 2.0`), a drawn point with
   `toolDistance(p, P.tool.xy) < P.tool.z` gives no respawn**: `respawn()` returns `none`, as for a closed cell
   (`agents.wgsl:255`, `tools.glsl:78`). Reason: the wound holds no plasm while the cut is held. The agent stays dead
   and draws again in the next step.
2. **With and without growth.** Reason: the wound is the same in both; only what the cut does to its alive agents
   differs (ADR 0039).

My own choices, under the same delegation:

3. **The test reads the drawn point `p`, as the loop of the cut does** (`agents.wgsl:300`, `tools.glsl:127`), and not
   `wrapPos(p)`. Both are the same value here. `p` is u · W with u ≤ 1 − 2^−24, and in float32 that product stays
   below W: checked in Node with `Math.fround` for every side W from 1 to 65,536, where the largest draw lies in the
   last cell. So `floor(p)` is a cell of the grid and `wrapPos()` gives `p` back (`common.wgsl:89`). The agent then
   holds exactly `p`, and `removed()` and the cut of the next step compute the same distance from the same bits: an
   agent that comes to life outside the wound is not in the wound of the same cut one step later.
4. **The wound is the disc by position**, as for `removed()` and the placement (ADR 0023, ADR 0039), not the cells
   whose centre lies in the disc, which the fields clear (`diffuse.wgsl:82`). Reason: the next step would kill or move
   an agent by its position.
5. **The test draws no number and sits right after the draw of the point**, before the cell is read. The stream
   respawn of an agent belongs to that agent and that step (`rngSeed(id, RESPAWN)`), so no draw of another agent or of
   another step moves. An agent whose point lies in the wound makes no further draw in that step, as before for a
   closed cell.
6. **Only the cut makes a wound.** A held Inoculate skips nothing: respawn runs under it as ADR 0029, decision 8 says.
7. **Every dead agent**, also one that the cut killed in this step (ADR 0039, choice 7): it can come to life again in
   the same step, but only outside the wound.
8. **Not changed**: the cut still clears neither the flow memory nor the tube body (option 3). After the release
   respawn can pick a cell of the old wound at once, if its memory and body still pass the test. Not measured.

## Consequences

- No scene changes a byte: no scene holds the cut, and without the cut the new test is false before it reads the
  point. The digests of `research/flow/README.md` part 6 (`digest.gpu.test.ts`: the default settings and the 20
  scenes, 500 steps, WebGPU and WebGL2, M3 Pro, 2026-11-15) of this branch against `main` at `b93584e`, both made on
  the same machine: 42 of 42 equal with the flow off (`VITE_PATCH='{"flow":false}'`), and 42 of 42 equal with the flow
  as each scene has it, with the digests of the memory and the pressure of the flow (`VITE_FLOW=1`). The files of
  both sides are equal byte for byte.
- While the cut is held with one agent per cell, the agents that came to life in the wound before no longer claim a
  cell. So in such a step another agent can win a cell that it lost before. Only steps with the cut held differ.
- Tests (`src/engine/flow.gpu.test.ts`, "respawn while the cut is held (ADR 0041)", both backends). The wound has a
  radius of 28.4 cells around (20.3, 40.7) on a periodic grid of 64 × 64 cells: it lies across two edges and covers
  62 % of the grid, and every cell holds a fed tube.
  - "brings no dead agent to life in the wound, and every other one as without the cut": without the rule of one agent
    per cell and without growth, 20,000 dead agents, one step in three runs of the same seed: no tool, the cut, and
    Inoculate on the same disc with the chance 0. With the cut, an agent that comes to life in the wound without a tool
    stays dead where it was; an agent that comes to life outside does so at the same point with the same heading; an
    agent that stays dead without a tool stays dead. Under Inoculate every dead agent does what it does without a
    tool. The births without a tool are 16 % of the dead agents, in the wound and outside by their share of the grid
    (within 6 standard deviations): 1,960 in the wound and 1,233 outside, on both backends.
  - "brings no dead agent to life in the wound while growth runs, in every step of the hold": with one agent per cell
    and growth (a growth test every 50 steps, none in the 6 steps of the hold), 1,000 of 6,000 agents alive at the
    start. No agent that was dead, or alive in the wound, at the start of a step is alive in the wound after it. In
    the 6 steps 635 agents come to life outside on WebGPU and 639 on WebGL2, and the cut kills 925 and 913 (M3 Pro);
    the test asks for more than 300 of each.
  - A point within 0.001 cells of the rim counts as unsure in the tests: the CPU computes the distance in float64.
- `research/flow/engine/mutate.ts` holds the wrong rules N1 to N10. Each fails at least one of the two tests (run of
  2026-11-15, M3 Pro, with the three tests of respawn under a tool on the backend of the rule):

  | Rule                                                             | Fails      |
  | ---------------------------------------------------------------- | ---------- |
  | N1 wgsl, N6 glsl: no skip on this backend, only on the other one | both tests |
  | N2 wgsl, N7 glsl: the skip under every tool, not only the cut    | the first  |
  | N3 wgsl, N8 glsl: the test reads where the dead agent lies       | both tests |
  | N4 wgsl, N9 glsl: the skip only while growth runs                | the first  |
  | N5 wgsl, N10 glsl: the skip only without growth                  | the second |

- Cost: one compare of a uniform for each dead agent in a build with the flow, and the distance only while the cut is
  held. Not measured: another GPU campaign ran on this machine the whole time, and a time measured beside it does not
  count (`AGENTS.md`). `TODO.md` holds the point.
- The logs are in `research/flow/logs.tar.gz`, folder `logs/engine/respawn-wound/`: the digests of `main` and of the
  branch, and the run of the wrong rules (`mutations.txt`).
