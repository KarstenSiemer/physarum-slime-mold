# Part E2d of stage 4: notes on the forms of the drift (2026-11-20)

The brief of the coordinator: find a form of the drift whose results do not change when the level of a network against
its ground shifts (ADR 0072, finding 3), and that keeps the targets of ADR 0065 (the forms of decision 6, the speed of
the front, the Y-maze, the dish with slime everywhere). Prototype only. These notes hold what this part found, so that a
fresh agent can go on from them. ADR 0074 records the result.

Every run here starts as the app does (no food scent before the colony, ADR 0073) and has the test of the tube of a
sink (`scent=0 sinkTube=1`), on top of the rule set of step 9 (README.md). Commands run from the root; the records go to
`research/front/out/` (git ignores it), the raw logs to the archive (`logs/engine/drift-0074/`).

## The forms (`driftOn` of sim.ts)

A sensor on a tube cell reads its pressure in every form. The forms differ off the tubes:

- `all` (ADR 0065): the pressure of the cell, also on the ground. The ground gets its pressure only through the ghost
  conductance and keeps it for about 1,500 steps in the dish: it reads the level.
- `net` (ADR 0072): the pressure of the agent's cell, so no pull at all off the tubes.
- `mirror`: the pressure continued along the line through the agent: 2 · p(agent) − p(the cell as far behind it).
- `take`: p(agent) less the sensor offset times what the sink at the agent's cell takes over its conductivity.
- `sinks`: the mean pressure of the sinks, weighted by what each takes. `rim`: the mean of the tube cells beside ground.
- `leak`: as `all`, but after each solve the ground moves so that no flux leaks through the ghost conductance.
- `extend`: as `all`, but after each solve the ground is solved to its steady state (conjugate gradients; a check, no
  form of a GPU: 10 times slower).

With every form but `all`, `leak` and `extend` an agent on a cell without a tube reads no drift (as `net`); such agents
are few (0 to 18 of up to 3,000, `reads.ts`).

## 1. The shift test (`shift.sh shift1`, then `shift.ts research/front/out/shift1`)

The dish of 160 cells, drift 1.5, seeds 1 to 10, 3,000 steps; a shift of every tube cell by ±200 at step 100 or 1,000.
Agents at step 1,500, median (least to most), and Mann-Whitney's p against no shift:

| Form   | No shift          | +200 at 100                  | −200 at 100              | +200 at 1,000 | −200 at 1,000 |
| ------ | ----------------- | ---------------------------- | ------------------------ | ------------- | ------------- |
| all    | 405 (229–1,643)   | 1,176 (1,013–1,734), p 0.010 | 257 (168–1,573), p 0.028 | 697, p 0.096  | 334, p 0.17   |
| net    | 150 (60–396)      | 167, p 0.60                  | 116, p 0.82              | 146, p 0.88   | 136, p 0.82   |
| mirror | 1,024 (912–1,162) | 1,006, p 0.79                | 1,084, p 0.33            | 1,017, p 0.94 | 1,035, p 0.79 |
| take   | 377 (287–454)     | 381, p 0.85                  | 382, p 0.71              | 376, p 0.91   | 375, p 0.85   |
| sinks  | 69 (52–201)       | 77, p 0.21                   | 69, p 0.88               | 91, p 0.33    | 79, p 0.62    |
| rim    | 85 (69–157)       | 123, p 0.11                  | 82, p 0.73               | 93, p 0.91    | 80, p 0.26    |
| leak   | 674 (483–959)     | 751, p 0.20                  | 659, p 0.82              | 743, p 0.60   | 620, p 0.29   |
| extend | 667 (508–813)     | 724, p 0.27                  | 686, p 0.33              | 668, p 0.91   | 665, p 0.76   |

At step 3,000 only `all` (p 0.013 to 0.082) and `leak` (+200 at 100: 2,194 against 2,065, p 0.034) leave the spread.
`leak` fixes only the level of the ground; the ground keeps the shape of its history. Seeds 11 to 20 of `leak` run in
`out/shift2`. The prototype's own start (300 steps of scent) gave 381 to 519 agents at step 1,500 with `all`.

## 2. What the front reads (`reads.ts`)

For agents on a tube cell beside ground, what the sensors off the tubes read under each form against the agent's own
cell. With `all` at the app's start the sign is a lottery of the first steps: seed 4 reads its ground 224 below the
agent at step 100 (1,643 agents at step 1,500), seed 2 reads it 15 above (229 agents). With the prototype's own start
the ground lay 4 to 13 above the agents at the sinks in every seed at steps 100 to 1,000: the old records grew with a
ground above the front. `sinks` and `rim` read above most sinks (the mean takes the sinks of the last 100 steps, which
lie behind the front, and the sides of the tubes), so they hold the front back. Nearly every agent that pushes the
territory sits on a tube cell (`all`: 193 of 194 at step 3,000 of seed 3).

## 3. Pictures (`shots.ts scene=dish side=160 pics=3000,6000 ... scent=0`)

`out/pics/<form>-d<drift>/look-*.png`. In the open dish every form spreads a sheet with veins from the food. `mirror`
covers the dish by about step 3,000 and then draws back into a few tubes (agents 3,158 at step 3,000, 1,884 at
6,000); at drift 5 it leaves a sparse net. `leak` at drift 5 turns the full dish into a net of loops by step 6,000.
`take` keeps a sheet, as `all` does.

Not a candidate after round 1: `net`, `sinks` and `rim` grow a seventh to a third of what the records grew.

## 4. Round 2 (`out/r2pool.jobs`, 175 jobs, 50 minutes of the machine)

- **`leak` reads a little of the level.** Seeds 11 to 20 (`out/shift2`) and all 20 seeds pooled (`out/leak20`): at
  step 3,000, +200 at step 100 gives 2,152 agents against 2,058 (p 0.037), −200 at step 1,000 gives 1,908 (p 0.070).
  About 5 %, against 85 % for `all`: the ground keeps the shape of its history. Out by the rule of the brief.
- **The start no longer matters** (`out/own1`, the dish with the prototype's own start, `scent=300 sinkTube=1`, seeds 1
  to 10, agents at step 1,500 and 3,000): `take` 372 and 1,204 (app's start 377 and 1,132), `mirror` 1,012 and 3,067
  (1,024 and 3,015), `leak` 652 and 2,036 (674 and 2,065), `extend` 741 and 2,111 (667 and 2,071), `all` 502 and
  1,507 (405 and 1,234; least to most 344 to 1,135 at step 1,500).
- **The Y-maze keeps every target in every form** (`forms.sh r2`, 40 seeds per case; the start of the app):

  | Form, drift | Slime on one arm | Slime on both arms | No slime          | First food, no slime | Both against none |
  | ----------- | ---------------- | ------------------ | ----------------- | -------------------- | ----------------- |
  | all 1.5     | 40 : 0           | 23 : 17            | 26 : 14           | 3,383                | 1.05 (p 0.064)    |
  | all 5       | 40 : 0           | 19 : 21            | 16 : 24           | 3,343                | 1.05 (p 0.071)    |
  | take 1.5    | 40 : 0           | 18 : 22            | 15 : 24, 1 split  | 3,439                | 1.05 (p 7·10⁻⁶)   |
  | take 5      | 40 : 0           | 23 : 17            | 14 : 26 (p 0.081) | 3,273                | 1.04 (p 3·10⁻⁵)   |
  | mirror 1.5  | 40 : 0           | 26 : 14 (p 0.081)  | 21 : 19           | 3,077                | 1.07 (p 10⁻⁶)     |
  | mirror 5    | 40 : 0           | 20 : 20            | 15 : 25           | 3,025                | 1.03 (p 0.00056)  |
  | leak 1.5    | 40 : 0           | 25 : 15            | 20 : 20           | 3,280                | 1.07 (p 0.00051)  |
  | leak 5      | 40 : 0           | 20 : 20            | 24 : 16           | 3,262                | 1.02 (p 0.25)     |

- **The lane** (`lane.ts`, 80 × 300 cells as shots.ts, 10 seeds, 8,000 steps; the speed of the front from step 1,000):
  drift 0 0.0106 cells per step; `all` 0.0129 (1.5) and 0.0143 (5), with the own start 0.0133 and 0.0147; `take`
  0.0142 and 0.0170; `leak` 0.0145 and 0.0166; `extend` 0.0160 (1.5); `mirror` 0.0190 and 0.0203. The veins lie along
  the flow in every form (|cos| 0.93 to 0.99). The crown of crown() is the whole width of the lane (80) in every form
  from step 4,000 on: this lane does not tell the forms apart.

## 5. Round 3, the dish (`out/r3pool.jobs`, 55 jobs, 45 minutes of the machine)

`forms.sh r3 ... dish`: 10 seeds, 20,000 steps, with slime everywhere and without; `all` at drift 1.5 without slime is
the record `s0-t1-none` of ADR 0072. Half of the dish covered, median (least to most), and the agents at step 20,000:

| Form, drift | Half, no slime      | Slime everywhere against none | Agents at 20,000, none and all |
| ----------- | ------------------- | ----------------------------- | ------------------------------ |
| all 1.5     | 5,501 (3,664–6,448) | 1.04 (p 0.76)                 | 844 and 717                    |
| all 5       | 4,218 (2,831–4,548) | 1.04 (p 0.62)                 | 800 and 930                    |
| take 1.5    | 5,883 (5,303–6,150) | 0.97 (p 0.71)                 | 619 and 643                    |
| take 5      | 3,668 (3,558–3,727) | 1.01 (p 0.17)                 | 914 and 994                    |
| mirror 1.5  | 3,162 (3,064–3,267) | 1.00 (p 0.45)                 | 707 and 859                    |
| mirror 5    | 2,588 (2,555–2,686) | 1.01 (p 0.11)                 | 1,083 and 1,073                |

Against `all` (`compare.ts - - out/r3/<form>/dish out/r3/all/dish`): `take` covers half of the dish 1.07 and 0.87
times as late (p 0.17 and 0.13); at drift 1.5 its full dish keeps fewer agents (p 0.0052 and 0.049) and half the births
of the last 5,000 steps (p 0.0032 and 0.0082). `mirror` covers it 0.55 to 0.61 times as late (p 0.00016).

## 6. The dish of the start scene (`out/scene`)

`e2c-proto.ts layout=scene start=0|1 seeds=s-s steps=1500 scent=0 sinkTube=1 drift=1.5 driftOn=<form>`: one strain on
the food of strain A or B of `three-networks`. Agents at step 1,500 over seeds 1 to 6 and both foods: `all` 125 to
1,421 (the engine: 124 to 1,593 per strain at step 1,503), `take` 284 to 435, `mirror` 826 to 1,198.

## Result

ADR 0074 proposes `take`; the owner chooses the form. The pictures are in `out/pics` (the dish), `out/ypics` (the
Y-maze; `out/ypics/forms.png` puts them side by side). The raw logs are in the archive under `logs/engine/drift-0074/`.
Part E2e builds the chosen form in both backends (ADR 0074 says what).
