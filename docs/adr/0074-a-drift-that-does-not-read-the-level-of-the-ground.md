# 0074: A drift that does not read the level of the ground

- Status: proposed. The coordinator set the task on 2026-11-20: part E2d of stage 4, the second open point of
  ADR 0072. The research and the proposal are an agent's, under the owner's delegation of 2026-11-12. The choice of
  the form is the owner's: every form changes what the weights of the drift give (ADR 0065, decision 6; Open points).
- Date: 2026-11-20
- Extends [ADR 0072](0072-a-sink-lies-on-a-tube-that-carries-flux-to-it.md) (finding 3, open points),
  [ADR 0065](0065-the-growth-front-takes-the-flow-a-prototype.md) (decision 1, the drift; decision 6, its forms) and
  [ADR 0073](0073-a-colony-with-the-rules-starts-as-the-app-starts.md) (the start).
- Accepted by the owner on 2026-11-20: `take`; the engine builds it in
  [ADR 0075](0075-the-drift-take-in-the-engine.md).
- Extended by [ADR 0075](0075-the-drift-take-in-the-engine.md) (the drift `take` in the engine).
- Extended by [ADR 0076](0076-the-crown-at-the-head-of-a-tube.md) (the forms of the drift with `take`).
- In short: [`research/front/the-drift-and-the-ground.md`](../../research/front/the-drift-and-the-ground.md) tells the
  story on one page; [`research/front/E2d-NOTES.md`](../../research/front/E2d-NOTES.md) has the commands, the folders
  and every number.

## Context

The drift of stage 4 lets a sensor read minus a weight times the mean pressure of the four lanes of its strain at the
cell of the sensor (ADR 0065, decision 1; `agents.wgsl`, `agents.frag`, `sense()` of `research/front/sim.ts`). The flow
is solved on every open cell, and a cell without a tube joins its neighbours only through the ghost conductance of
10⁻⁵. So Kirchhoff's law fixes the pressure of a network only up to a constant against the ground beside it, and the
sensors at the front read that ground. ADR 0072 (finding 3) found that this level decides the growth: a shift of
every tube cell by ±200 changed the agents of the prototype's dish at step 1,500 from 381 to 519 to 202 to 1,311, and a
strain of the start scene of the engine ends step 1,503 with 124 to 1,593 agents. The one form tried that does not
read the level, `driftOn=net`, grew a quarter as much and lost the crown. All runs below start as the app does and
have the test of the tube of a sink (`scent=0 sinkTube=1`, ADR 0073), with the rule set of ADR 0067.

## Findings

1. **The ground keeps the first steps of the flux.** When the sinks of a young network start, its pressure falls by
   several hundred (774 in seed 1 of the dish), and the ground keeps that value while the network comes back: the
   damped iteration of the solver forgets a change of the ground by 1/e in about 1,000 steps in the dish of 160 cells
   (an estimate on a network of radius 10). Seed 4 of the dish then reads its ground 224 below the agents at its sinks
   at step 100 and grows to 1,643 agents at step 1,500; seed 2 reads it 15 above and has 229 (`reads.ts`). With the
   prototype's own start, 300 steps of food scent, the ground lay 4 to 13 above the agents at the sinks in each of the
   seeds 1 to 4 at the steps 100 to 1,000: the records of ADR 0065 grew on that level.
2. **Eight forms, one test.** On a tube cell every form reads the pressure of the cell; off the tubes they differ
   (`driftOn` of `sim.ts`): `all` (ADR 0065) the ground; `net` (ADR 0072) the agent's own cell; `take` the agent's cell
   less the sensor offset times what the sink of that cell takes over its conductivity; `mirror` the pressure
   continued along the line through the agent (2 · p(agent) − p(the cell as far behind it)); `sinks` the mean pressure
   of the sinks, weighted by what each takes; `rim` the mean pressure of the tube cells beside ground; `leak` the
   ground after a shift that lets no flux leak through the ghost conductance; `extend` the ground solved to its steady
   state after each solve (conjugate gradients, a check). The shift test, the dish, drift 1.5, seeds 1 to 10, agents
   at step 1,500 (`shift.sh`; Mann-Whitney's p against no shift):

   | Form   | No shift          | +200 at step 100           | −200 at step 100       | Passes                      |
   | ------ | ----------------- | -------------------------- | ---------------------- | --------------------------- |
   | all    | 405 (229–1,643)   | 1,176 (1,013–1,734), 0.010 | 257 (168–1,573), 0.028 | no                          |
   | net    | 150 (60–396)      | 167, 0.60                  | 116, 0.82              | yes                         |
   | sinks  | 69 (52–201)       | 77, 0.21                   | 69, 0.88               | yes                         |
   | rim    | 85 (69–157)       | 123, 0.11                  | 82, 0.73               | yes                         |
   | take   | 377 (287–454)     | 381, 0.85                  | 382, 0.71              | yes                         |
   | mirror | 1,024 (912–1,162) | 1,006, 0.79                | 1,084, 0.33            | yes                         |
   | leak   | 674 (483–959)     | 751, 0.20                  | 659, 0.82              | no: 5 % (20 seeds, p 0.037) |
   | extend | 667 (508–813)     | 724, 0.27                  | 686, 0.33              | yes                         |

   The shifts at step 1,000 and the agents at step 3,000 give the same verdicts. `leak` fixes the level of the ground
   but not its shape, which keeps its history: over 20 seeds +200 at step 100 gives 2,152 agents at step 3,000 against
   2,058 (p 0.037); `all` gives 2,277 against 1,234.

3. **A form that passes no longer cares how the colony starts.** With the prototype's own start, agents at step 1,500:
   `take` 372 (377 with the start of the app), `mirror` 1,012 (1,024), `extend` 741 (667); `all` 502 (405), from 344
   to 1,135.
4. **How much each form grows.** `net`, `sinks` and `rim` grow a seventh to a third of what the records grew (the
   prototype's own start with `all`: 502 agents at step 1,500): the mean level of the sinks holds the sinks of the last
   100 steps behind the front, and the rim holds the sides of the tubes, so both lie above most sinks and hold the front
   back. `take` grows three quarters of what the records grew. `extend`, the ground that the solver would reach, grows
   1.3 to 1.5 times as much. `mirror` grows twice as much: it continues the steep drop of the pressure toward a sink
   beyond the sink.
5. **The targets of ADR 0065** for `take`, `mirror`, `leak` and `all`, drift 1.5 and 5 (`forms.sh`):
   - The Y-maze, 40 seeds per case: every form takes the blank arm 40 : 0, and shows no preference with slime on both
     arms or without slime (binomial p 0.081 or more). The first food comes after 3,025 to 3,439 steps without slime
     (the organism: 2,400 to 7,200), 1.02 to 1.07 times later with slime on both arms. Against `all`, `take` reaches the
     first food as early (0.97 to 1.02 times, p 0.23 or more), `leak` 0.95 to 1.02 times (p 0.063 or more), `mirror`
     0.89 to 0.95 times (p 0.017 or less).
   - The lane of 80 × 300 cells of `shots.ts`, 10 seeds: the front runs 0.0129 cells per step with `all` at drift 1.5
     (0.0133 with the own start), 0.0142 with `take`, 0.0145 with `leak`, 0.0160 with `extend` and 0.0190 with
     `mirror`; at drift 5 0.0143, 0.0170, 0.0166 and 0.0203. That is 1.3 to 2.0 cm/h; the organism runs 1 to 3 cm/h.
     The veins lie along the flow in every form (mean |cos| 0.93 to 0.99).
   - The dish of 160 cells, 10 seeds, 20,000 steps, for `take`, `mirror` and `all`: with slime everywhere each covers
     half of the dish as fast as without slime (0.97 to 1.04 times, p 0.11 or more), and no colony dies. Half of the
     dish without slime, median (least to most): `all` 5,501 (3,664–6,448) at drift 1.5 and 4,218 (2,831–4,548) at 5;
     `take` 5,883 (5,303–6,150) and 3,668 (3,558–3,727); `mirror` 3,162 (3,064–3,267) and 2,588 (2,555–2,686). The
     records (own start) took 5,139 and 4,160. In the full dish at drift 1.5 `take` keeps fewer agents at step 20,000
     than `all` (medians 619 without slime and 643 with it, against 844 and 717; p 0.0052 and 0.049) and has half the
     births of the last 5,000 steps; at drift 5 it keeps as many (914 and 994, against 800 and 930).
   - The forms of decision 6: the widths of `crown()` do not tell the forms apart, because from step 4,000 on the
     colony fills the width of the lane in every form. In the pictures of the Y-maze and of the dish (`ypics.ts`,
     `shots.ts`) `take` looks as `all` does at each weight. `mirror` covers the dish by step 3,000 and then draws back
     into a few tubes; at drift 5 it leaves a sparse net.
6. **The dish of the start scene** (`e2c-proto.ts layout=scene`: 384 cells, the 12 foods, one strain on the food of
   strain A or B, seeds 1 to 6, drift 1.5): agents at step 1,500 from 125 to 1,421 with `all`, as in the engine (124
   to 1,593 per strain at step 1,503, ADR 0072), from 284 to 435 with `take` and from 826 to 1,198 with `mirror`.

## Options

1. **Keep `all`.** The records stay, but the growth stays a lottery of the first steps of the flux.
2. **`take`**: the flux that a sink takes goes on into the fresh ground; no ground pressure is read. It grows as the
   records did and keeps every target; its spread is small. In the full dish at drift 1.5 it keeps fewer agents than
   `all`. The engine needs the take of the agent's cell in the agents pass.
3. **`mirror`**: the pressure continued past the agent. It keeps every target but grows twice as fast and changes the
   look of the dish. The engine needs two more reads per sensor and nothing new.
4. **`extend`**: the ground that the solver would reach. Level-free, but it needs the ground solved to its end in each
   step: no form of a GPU.
5. **`leak`**: the level of the ground fixed by the ghost flux. It still reads 5 % of the level, and the engine needs a
   sum over the rim of each network and a shift of its ground in each step.
6. **`net`, `sinks`, `rim`**: level-free, but they grow a seventh to a third as much.

## Decision

**The agent proposes `take`** (option 2): a sensor on a cell without a tube of its strain reads the pressure of the
agent's cell less the sensor offset times what the sink of the agent's cell takes over the conductivity of that cell.
The reasons: it reads no level (the shift test and both starts), it follows the organism (the front is a sink, fresh
ground holds no pressure, and what draws the plasm onto fresh ground is the flux that the front takes), and of the forms
that pass it keeps the records closest: the growth of the dish, the Y-maze, the speed of the front within 1.2 times, and
the look. It has no number of its own to tune. The choice is the owner's (Open points); until then no scene changes.

## What part E2e builds in the engine

- The agents pass, while the rules of stage 4 run: a sensor whose cell holds a tube of the strain (a body of 0.05 or
  more) reads the pressure there, as now. A sensor whose cell holds none reads the pressure of the agent's cell less
  `sensorOffset · take / G`: `take` is what the sink of the agent's cell takes, S · r / R as the flow of the step before
  took it (S the norm times the flow strength, r the sink rate of the cell as the sums count it, R their sum), and G the
  conductivity of that cell. An agent on a cell without a tube reads no drift. The pressure of the agent's cell is read
  once per agent.
- The agents pass binds 8 storage buffers already, the most that every WebGPU device has: `take / G` must reach it
  through a texture, for example one that the pass of the sinks writes, not through a ninth buffer. WebGL2 the same in
  GLSL.
- A CPU copy of the reads, GPU tests that compare both backends with it, wrong rules in `mutate.ts`, `docs/model.md`,
  and the digests of every scene: behind the setting `territory`, which no scene turns on, so no scene changes.

## Consequences

- With the proposed form the growth of a colony no longer depends on the history of the solver: the dish covers half of
  its cells within 5,303 to 6,150 steps at drift 1.5 (`all`: 3,664 to 6,448).
- `sim.ts` keeps every form as an option of `driftOn`; `all` stays the default, so every record of ADR 0065 to 0073
  runs as before.
- Not changed: the engine, the scenes, `docs/model.md`; no scene changes its bytes.

## Open points

- **The form of the drift** (for the owner). Every form changes what the weights 0, 1.25 to 1.5 and 5 of decision 6
  give, except at 0, where no form reads the pressure. The numbers for each choice, at drift 1.5 and 5 (agents of the
  dish at step 1,500; half of the dish without slime; the front in the lane):
  - `all` (as built): 405 agents, from 229 to 1,643 by the level; half after 5,501 and 4,218 steps; 0.0129 and 0.0143
    cells per step.
  - `take` (proposed): 377 (287–454); 5,883 and 3,668 steps; 0.0142 and 0.0170.
  - `mirror`: 1,024 (912–1,162); 3,162 and 2,588 steps; 0.0190 and 0.0203; the dish draws back into tubes when it is
    full.
  - `extend` (no form of a GPU): 667 (508–813); 0.0160 at drift 1.5.
- Not measured: `take` in the engine; the Tokyo scenes, the mazes and the start scene with three strains; the
  look of `take` against `all` side by side for the owner in the app; Murray's exponent.
