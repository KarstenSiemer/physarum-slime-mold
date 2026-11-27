# The drift without the level of the ground (stage 4, part E2d)

This page belongs to [ADR 0074](../../docs/adr/0074-a-drift-that-does-not-read-the-level-of-the-ground.md). It tells
in plain words why the drift of stage 4 read a number that the history of the solver sets, which forms of the drift
were tried, and what each gave. The numbers come from the prototype on the CPU (`sim.ts`), with the start of the app
and the test of the tube of a sink (ADR 0072, ADR 0073). [E2d-NOTES.md](E2d-NOTES.md) has the commands and the folders.

**The drift.** A sensor of an agent reads the trail, the food scent, and minus a weight times the pressure of its
strain at the cell of the sensor (ADR 0065, decision 6). So the plasm streams down the pressure, from the food to the
sinks at the front. The weight sets the form: 0 a tree, 1.25 to 1.5 a crown, 5 a fan.

**The problem.** The flow is solved on every open cell. A cell without a tube joins its neighbours only through the
ghost conductance, 10⁻⁵, so that its pressure is defined. Kirchhoff's law fixes the pressure of a network only up to a
constant against that ground, and the ground relaxes slowly: in the dish of 160 cells the solver forgets a change of the
ground by 1/e in about 1,000 steps (an estimate). So the first steps of the flux set the level: the pressure of a young
network falls by several hundred when its sinks start (774 in seed 1), and the ground keeps the low value while the
network comes back. A sensor at the front reads the ground as it reads the tubes. Where the ground lies below the front,
the front grows; where it lies above, the front holds back. In the dish, seed 4 read its ground 224 below the agents at
its sinks at step 100 and had 1,643 agents at step 1,500; seed 2 read it 15 above and had 229. A shift of every tube
cell by +200 at step 100 gives 1,176 agents at step 1,500 in place of 405, and −200 gives 257 (10 seeds each). The
prototype's own start, with 300 steps of food scent before the colony, set the ground 4 to 13 above the sinks in each of
the seeds 1 to 4: the records of ADR 0065 grew on that level.

**What the organism does.** The plasm streams through the tubes to the front. The front takes it: it is a sink of the
flow. Fresh ground holds no plasm and no pressure. So a sensor on fresh ground should read no pressure of the ground;
what draws the plasm onto it is the flux that the front takes.

**The forms tried.** On a tube cell every form reads the pressure of the cell. Off the tubes:

- `all`, the rule of ADR 0065: the pressure of the ground.
- `net` (ADR 0072): the pressure of the agent's own cell: no pull off the tubes.
- `take`: the pressure of the agent's cell less the drop that the flux of the sink at that cell would have over the
  sensor offset at the conductivity of the cell. An agent at a sink is drawn onto the fresh ground as strongly as its
  sink takes flux; an agent elsewhere reads its own cell, as with `net`.
- `mirror`: the pressure continued along the line through the agent, from the cell as far behind it as the sensor lies
  ahead: the flux that reaches the agent goes on past it.
- `sinks`: the mean pressure of the sinks, weighted by what each takes: the front meets the fresh ground at one level.
- `rim`: the mean pressure of the tube cells beside ground.
- `leak`: the pressure of the ground, after the ground has moved so that no flux leaks through the ghost conductance.
- `extend`: the pressure of the ground, solved to its steady state after each solve. This is the ground that the
  solver would reach if it ran to the end; a check, ten times slower, with no form of a GPU.

An agent on a cell without a tube reads no drift in every form but `all`, `leak` and `extend`. Such agents are few: 0 to
18 of up to 3,000.

**The shift test.** The dish, drift 1.5, seeds 1 to 10; agents at step 1,500, and Mann-Whitney's p of the shift
against no shift (also at step 3,000, and with the shift at step 1,000):

| Form   | No shift          | +200 at step 100           | −200 at step 100       | Passes                |
| ------ | ----------------- | -------------------------- | ---------------------- | --------------------- |
| all    | 405 (229–1,643)   | 1,176 (1,013–1,734), 0.010 | 257 (168–1,573), 0.028 | no                    |
| net    | 150 (60–396)      | 167, 0.60                  | 116, 0.82              | yes                   |
| sinks  | 69 (52–201)       | 77, 0.21                   | 69, 0.88               | yes                   |
| rim    | 85 (69–157)       | 123, 0.11                  | 82, 0.73               | yes                   |
| take   | 377 (287–454)     | 381, 0.85                  | 382, 0.71              | yes                   |
| mirror | 1,024 (912–1,162) | 1,006, 0.79                | 1,084, 0.33            | yes                   |
| leak   | 674 (483–959)     | 751, 0.20                  | 659, 0.82              | no: 5 % at step 3,000 |
| extend | 667 (508–813)     | 724, 0.27                  | 686, 0.33              | yes                   |

`leak` fixes the level of the ground but not its shape, which keeps its history: over 20 seeds +200 at step 100 gives
2,152 agents at step 3,000 against 2,058 (p 0.037). The forms that pass also no longer care how the colony starts: with
the prototype's own start `take` has 372 agents at step 1,500 (377 with the start of the app), `mirror` 1,012 (1,024)
and `extend` 741 (667); `all` has 502 (405), from 344 to 1,135.

**How much each form grows.** `net`, `sinks` and `rim` grow a seventh to a third of what the records grew: the mean
level of the sinks lies above most sinks of the front, because it holds the sinks of the last 100 steps behind it, and
the rim holds the sides of the tubes. `take` grows three quarters of what the records grew (the prototype's own start
with `all`: 502 agents at step 1,500 and 1,507 at step 3,000). `extend` grows 1.3 to 1.5 times as much, `mirror` twice
as much: the drop of the pressure toward a sink is steep, and `mirror` continues it beyond the sink.

**The targets of ADR 0065.** The Y-maze, 40 seeds per case, drift 1.5 and 5: every form takes the blank arm 40 : 0 and
shows no preference with slime on both arms or without slime (p 0.081 or more); the first food comes after 3,025 to
3,439 steps without slime (the organism: 2,400 to 7,200), and 1.02 to 1.07 times later with slime on both arms. The lane
of 80 × 300 cells, 10 seeds: the front runs 0.0129 cells per step with `all` at drift 1.5 (0.0133 with the own start),
0.0142 with `take`, 0.0160 with `extend` and 0.0190 with `mirror`; at drift 5: 0.0143, 0.0170 and 0.0203. That is 1.3 to
2.0 cm/h; the organism runs 1 to 3 cm/h. The veins lie along the flow in every form (|cos| 0.93 to 0.99). The widths of
`crown()` do not tell the forms apart: from step 4,000 on, the colony fills the width of the lane in every form. In the
pictures of the Y-maze and of the dish, `take` looks as `all` does at each weight.

The dish of 160 cells, 10 seeds, 20,000 steps: with slime everywhere `take`, `mirror` and `all` cover half of the dish
as fast as without slime (0.97 to 1.04 times), and no colony dies. Without slime half of the dish is covered after 5,501
steps with `all` at drift 1.5 (3,664 to 6,448), after 5,883 with `take` (5,303 to 6,150) and after 3,162 with `mirror`;
at drift 5 after 4,218, 3,668 and 2,588 steps. The records, with the prototype's own start, took 5,139 and 4,160. When
the dish is full, `take` at drift 1.5 keeps fewer agents than `all` (medians 619 and 643 against 844 and 717) and has
half the births; at drift 5 as many. `mirror` draws back into a few tubes when the dish is full.

In the dish of the start scene (384 cells, 12 foods, one strain on the food of strain A or B, seeds 1 to 6), the
agents at step 1,500 lie between 125 and 1,421 with `all`, as in the engine (124 to 1,593 per strain, ADR 0072),
between 284 and 435 with `take`, and between 826 and 1,198 with `mirror`.

**The proposal.** `take` reads no level and follows the organism: the front is a sink, fresh ground holds no pressure,
and what draws the plasm onto fresh ground is the flux that the front takes. Of the forms that read no level, it keeps
the records closest: the growth of the dish, the Y-maze, the speed of the front within 1.2 times, and the look. It has
no number of its own. `mirror` keeps every target too, but it grows twice as fast and changes the look of the full
dish. The owner chooses: every form changes what the weights 1.25 to 1.5 and 5 give.

**What is not reached or not measured.** No measure of the prototype tells a crown from a fan: the widths of `crown()`
are the width of the lane in every form, so the forms of decision 6 rest on the pictures. In a full dish at drift 1.5
`take` has half the births of `all`. The engine, Tokyo, the mazes and the start scene with three strains are not run
with any new form.
