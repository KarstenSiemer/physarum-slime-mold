# 0087: The crown as a scene, with its levers in the panel

- Status: accepted. The owner asked on 2026-11-21 that the best crown form of the prototype can be made in the app,
  "mindestens eine neue Szene und das Verhalten einstellbar" (at least one new scene, and the behaviour adjustable).
  The coordinator set the task on the same day, part E5b of stage 4: the scene, its comparison with the prototype, the
  panel controls, the tests and the time of a step. Decisions 1, 3 and 4 and the order of the work are the
  coordinator's; the other choices are an agent's. Both under the owner's delegation of 2026-11-12.
- Date: 2026-11-21
- Extends [ADR 0085](0085-the-crown-so-far.md) (the best form so far, now a scene),
  [ADR 0086](0086-three-levers-of-the-crown-as-settings.md) (its levers, now in the panel and in Learn) and
  [ADR 0076](0076-the-crown-at-the-head-of-a-tube.md) (finding 3: what the drift gives, now in its help).
- In short: [`research/front/ENGINE.md`](../../research/front/ENGINE.md) has the part E5b;
  [`research/flow/README.md`](../../research/flow/README.md), part 34, has the checks and their commands. The records
  are in the archive under `logs/engine/crown-scene-0087/`.

## Context

The best crown form of the prototype is the case `none` of `research/front/e2n.sh` (ADR 0084, ADR 0085): a colony
grows out of a narrow neck as one half disc with a few main veins that fork toward its rim. The rules of stage 4 are in
the engine behind the setting `territory` (ADR 0068 to ADR 0075), and its three levers since ADR 0086 (`flowEdges`,
`flowBase`, `frontFlux`). No scene turned them on, and the panel showed none of them.

## Decisions

1. **A scene `crown`, "Crown of veins"** (the coordinator), in the group Experiments, source "Made for this app". Its
   texts say what it shows (the veins of a crown in one sheet) and what it lacks (a lobed rim, a crown that moves on
   ahead of its tube), as ADR 0085 does. It names no ADR and no prototype.
2. **The layout of the prototype, cell for cell.** The neck of `research/front/layouts.ts` (`neck()`) with the words
   of `crowns.ts`: a closed box of 520 × 340 cells on every screen (the lattice, as the Corn maze has one), its first
   40 rows wall but for a channel 14 cells wide (the columns 253 to 266), the food of radius 5 around (260, 8), the
   colony on the food (`CROWN` and `crownShapes()` in `src/model/presets.ts`). The 20,240 wall cells and the 80 food
   cells are those of `neck()` (`presets.test.ts`). A wall is a stroke, and the picture lights a wall by the distance
   to the outline of its strokes (`paint.wgsl`): a block of thin strokes, one per 3 rows, showed a rib per stroke. So
   each block is thick strokes of 8 cells, whose outline lies on the edges of the block, and two thin strokes fill the
   corner at the mouth that their round ends leave open. Every cell of a block lies at least 4 cells (the depth that
   the picture lights) inside one stroke, or as deep as inside the block, but in the two corners of 8 × 8 cells at the
   mouth, which look a little rounded. No cell lies within 0.05 cells of the edge of a stroke.
3. **The settings of the case `none`, word for word** (the coordinator: the lines `RULES` and `BIG` of `e2n.sh` with
   `jones=all`, and the agent of `params()` of `research/front/sim.ts`). The table below maps each word. Every word has
   its equal in the engine. Two forms differ: the two tests of a sink follow paths over open cells, where the words
   `fresh=box` and `sinkAt=edge` of the prototype take squares (ADR 0067, decision 10); the comparison below shows no
   effect of them. `forager()` gives the agent, so the scene has the settings of the Corn maze but for the lattice,
   the rules and the levers (`presets.test.ts`).
4. **The panel shows each control only where it acts** (the coordinator). In the Flow section, below Flow strength:
   the switch Flow over 8 neighbours and the slider Base conductance while the flow is on; the switch Rules of the
   growth front while growth (and so one agent per cell) is on too; and the sliders Drift and Flux to the front while
   the rules are on. Each has its help. A change of the neighbours, the base, the drift or the flux acts at the next
   step; a switch of the rules restarts the scene (ADR 0068). The link holds what it held (ADR 0086): a link of the
   scene opens it unchanged (`state.test.ts`).
5. **Learn lists them** in the order of the panel, after Flow strength. The help of the rules is new
   (`territoryHelp`); the help of the neighbours, the base and the flux to the front name the scene.
6. **The help of the drift says what the drift `take` gives** (ADR 0076, finding 3): 0 a tree, 1.25 to 5 a sheet at
   the head of a tube whose width the weight sets, and no crown that moves on. It said "1.25 to 1.5 a tube with a crown,
   and 5 a fan", the forms of the drift `all` of ADR 0065; ADR 0076 found them sheets with `take`, and its help waited
   for the owner. The owner paused the crown research with these rules (ADR 0085), so the help now says what they give.
7. **The notice of a switch to the Jones model names the rules** ("It removed the flow in the tubes and the rules of
   the growth front"), and skips the drift and the flux to the front as it skips the flow strength and the base:
   without the rules they mean nothing.
8. **The texts that said that no scene has the rules** now name the scene: `docs/model.md` (6.10, 6.11, 8.1, 8.7 and
   9.1), the comments of `params.ts`, `sim.ts` and `programs.ts`, and the tests that held every scene to the defaults
   (`params.test.ts`). No rule changes. The fit of the grids of ADR 0058 holds 31 scenes, 3,456 cases, and the scene
   keeps its grid in every case (`research/electrode/README.md`).
9. **The e2e test does not wait for the colony to leave the neck** (an agent's choice: the coordinator asked for a
   test that waits for it).
   The colony leaves the neck after 1,150 to 1,450 steps (below), and SwiftShader, the GPU of CI, runs the scene at
   0.96 steps per second in the app and at 1.98 steps per second without the picture, in the image of CI on 4 cores
   of an M3 Pro: 10 to 25 minutes for the wait, and GitHub is about three times slower (ADR 0010). A shard of the e2e
   tests stops after 30 minutes (ADR 0061). So the test waits 30 steps, as the other tests of the flow do: the scene
   loads from the panel, the Flow section shows its rules and levers with their values, the colony grows by more than
   20 agents and its front has sinks, the link holds the settings, and each control goes where it does not act. In 12
   runs on the M3 Pro the colony grew by 27 to 38 agents from step 10 to step 40 and had 16 to 29 sinks at step 30.
   The exit from the neck is measured on the GPU of the M3 Pro, on both backends (`e5b.sh neck`). The test is the last
   one of `tests/e2e/tubes.spec.ts`, so CI runs it in shard 3 of 4; the first test of the Tokyo scene moves to shard 2.

| `e2n.sh`, case `none`                 | The engine                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `layout=neck side=520 long=340`       | `lattice` [520, 340], `boundary` box, `crownShapes()`, `layout` food (dec. 2)  |
| `speed=0.004 speedOn=push`            | the push, `TERRITORY.speed` 0.004 (`docs/model.md` 6.10)                       |
| `reach=6 fresh=box`                   | `SINKS.fresh` 6, over paths of open cells, not the square (ADR 0067, dec. 10)  |
| `sinkAt=edge`                         | `SINKS.edge` 2, the edge of the territory (6.11), over paths too               |
| `slimeWeight=0.025`                   | `SINKS.slime` 0.025                                                            |
| `rim=1`                               | an agent of the front lies at the rim, and its child goes out (9.1)            |
| `colony=1`                            | the colony pays while it covers no food (8.7)                                  |
| `paidOn=sinks paidBy=rank sums=fixed` | the paid births (9.1) and the sums of 6.11                                     |
| `sinkTube=1`                          | the tube of a sink (6.11, ADR 0072)                                            |
| `solver=app`                          | 16 iterations per step (8.3)                                                   |
| `scent=0`                             | the app starts without a food scent                                            |
| `driftOn=take drift=1.5`              | the drift `take` (8.7, ADR 0075), `drift` 1.5                                  |
| `stencil=8`                           | `flowEdges` 8                                                                  |
| `base=0.002`                          | `flowBase` 0.002                                                               |
| `norm=4 paid=40`                      | `frontFlux` 2: S = 2 k · I0 = 4 · I0, a birth for 20 k = 40 of flux (ADR 0086) |
| `jones=all`                           | Jones' births wherever the window allows them, as in every scene (section 9)   |
| `every`, `steps`, `pics`, `dump`      | the records of a run, no rule                                                  |

- `crowns.ts` gives the neck its defaults, `neckWide` 14 and `neckLong` 40, and the food [`side` / 2, 8, 5].
- The defaults of `noFront()` that act: `tau` 100 (`SINKS.tau`), `start` disc (the start territory of 6.10, the disc
  and 3 cells), `bodyOn` trail (the tube body of 8.1), `sinkOn` all and `shareOn` equal (every sink with its weight),
  `fluxOn` sum (Q of 8.4), `refOn` roles (the zero point of 8.3). The others (`sink`, `unit`, `hold`, `young`,
  `jonesAge`) act on no run with `paid` above 0, `speed` above 0 and `reach` above 0.
- `params()`, the agent: I0 8, a slime life of 144 hours, sensor offset 7, angles 22.5° and 45°, step 1, deposit 5,
  decay 0.1, food weight 1, food strength 0.03, scent decay 0.1, covered food 1 (no rule), capacity 0.25 of the cells,
  50 start agents on a disc of about 100 cells. `forager()` has the same values; the start layout food places about
  50 agents there (section 10). The random streams of the two differ, so a seed gives another run in each.

## The comparison with the prototype

The engine runs the scene with `research/front/e5b-crown.gpu.test.ts` and saves the fields that the measures of the
crown read, in the format of the prototype; `research/front/e5b.ts` gives them the form of a campaign of `crowns.ts`,
and `e2n.ts` measures them as it measured the prototype. The engine counts the step that places the colony as its
first step: its step k + 1 is the prototype's step k.

**Both backends, seeds 1 to 6, to step 1,500** (the coordinator's rule after a gap of 2 that pass tests missed): the
means over the seeds, and the least and the most.

| Step 1,500      | Live agents      | Reach of the tube body (cells) | Territory (cells) | Sinks      |
| --------------- | ---------------- | ------------------------------ | ----------------- | ---------- |
| WebGPU          | 318 (297 to 337) | 36.0 (33.9 to 37.8)            | 606 (568 to 636)  | 31 (23–50) |
| WebGL2          | 316 (299 to 337) | 36.1 (34.7 to 38.2)            | 610 (582 to 648)  | 28 (13–38) |
| WebGL2 / WebGPU | 0.99             | 1.00                           | 1.01              | 0.92       |

The records of steps 500 and 1,000 agree as closely (ratios 0.99 to 1.03, but 0.86 and 1.04 for the sinks). The colony
leaves the neck at step 1,100 to 1,350 (its territory), 1,150 to 1,400 (its first agent below the neck) and 1,150 to
1,450 (its tube body), in 12 runs of both backends (records every 50 steps).

**The growth to step 16,000**, WebGPU seeds 1 and 2 and WebGL2 seed 1, against the prototype's seeds 1 and 2 (the
records of ADR 0084): live agents / reach in cells.

| Step   | Prototype s1 | Prototype s2 | WebGPU s1   | WebGPU s2   | WebGL2 s1   |
| ------ | ------------ | ------------ | ----------- | ----------- | ----------- |
| 2,000  | 476 / 45     | 477 / 46     | 506 / 46    | 505 / 48    | 482 / 44    |
| 4,000  | 1,634 / 82   | 1,512 / 80   | 1,572 / 79  | 1,567 / 80  | 1,569 / 79  |
| 8,000  | 4,078 / 128  | 3,906 / 128  | 3,950 / 129 | 4,015 / 130 | 4,022 / 126 |
| 12,000 | 5,803 / 172  | 5,772 / 170  | 5,763 / 169 | 5,960 / 171 | 5,934 / 168 |
| 16,000 | 7,328 / 209  | 7,235 / 210  | 7,207 / 209 | 7,223 / 210 | 7,471 / 214 |

**The measures of the crown** (ADR 0084, `e2n.ts`) at step 16,000; at step 8,000 they agree as closely:

| Step 16,000                                     | Prototype s1; s2                         | WebGPU s1; s2                            | WebGL2 s1           |
| ----------------------------------------------- | ---------------------------------------- | ---------------------------------------- | ------------------- |
| Form                                            | sheet; sheet                             | tubes; sheet                             | sheet               |
| Flux per rim sink                               | 0.030; 0.031                             | 0.030; 0.031                             | 0.031               |
| Heads (rim cells)                               | 1 (746); 1 (752)                         | 1 (753); 1 (753)                         | 1 (769)             |
| Off-vein agents 0–10, 10–20, 20–40, 40–80 cells | 0.47 0.18 0.07 0.03; 0.48 0.17 0.06 0.03 | 0.48 0.16 0.06 0.03; 0.48 0.17 0.06 0.03 | 0.48 0.19 0.07 0.03 |
| First veins behind the rim (cells)              | 23; 22                                   | 23; 22                                   | 22                  |
| Veins on the arcs at 20 to 170 cells            | 4 4 5 5 6 9 9 11 1; 4 5 6 6 6 7 8 11 1   | 4 4 5 7 7 8 9 11 1; 4 4 4 4 6 7 8 10 0   | 4 4 4 5 5 10 11 8 2 |

The form "tubes" of WebGPU seed 1 is the threshold of `form()` in `crown-table.ts`: a sheet needs agents on 0.08 of
the old ground, and that run has 0.079; the prototype's runs have 0.089 and 0.085, the engine's others 0.082 and
0.091. The largest difference: WebGL2 seed 1 has a rim of 769 cells and a reach of 214 cells, against 746 to 753
cells and 209 to 210 cells of the other four runs, 2 % more.

![The prototype and the app, seed 1, steps 8,000 and 16,000](../images/crown-app.jpg)

**The picture.** Seed 1, step 8,000 above and 16,000 below. From the left: the look of the prototype and the look of
the app (WebGPU, its default style), then D of the prototype and D of the engine, in the frame of the pictures of ADR
0085 (`bash research/front/e5b.sh montage`; the app's pictures come from `tests/pictures/crown.spec.ts`). To see: the
same half disc with main veins from the neck that fork toward the rim; at step 16,000 the forks of step 8,000 have
gone, and new ones lie at the new rim; one smooth rim. The two looks differ in their renderers, not in the colony.

## The time of a step

`bench.gpu.test.ts` in turns (`bash research/front/e5b.sh times`), 4 rounds, each the median of 21 samples of 50
steps, on an M3 Pro, with the Corn maze as the reference: a box of 480 × 320 cells with the flow over 4 neighbours and
without the rules. Round 1 ran at a load of 3.7:

| Steps 3,000 to 4,050, round 1 | WebGPU  | WebGL2  |
| ----------------------------- | ------- | ------- |
| Crown of veins (1,585 agents) | 2.85 ms | 6.18 ms |
| Corn maze (9,719 and 11,942)  | 1.42 ms | 1.87 ms |

From round 2 on the machine ran both scenes 2 to 3 times slower (the Corn maze 3.9 to 4.1 ms on WebGPU in rounds 3
and 4, and 6.0 to 6.2 ms on WebGL2 in rounds 2 to 4), with no other Vitest process and a load of 2 to 7. Those rounds
do not give the time of the scene, and the coordinator's budget left no time to run them again. In that state a step of
the scene from step 15,000 on, with 7,341 and 7,496 agents, took 6.2 to 7.0 ms on WebGPU and 13.0 to 14.8 ms on
WebGL2, as from step 3,000 (5.9 to 6.8 and 13.3 to 13.9 ms): the time of a step hardly grows with the colony. The
rules of stage 4 cost most on WebGL2, as in the start scene (ADR 0075).

## Checks

- **The bytes of the scenes**: the digests of every scene after 500 steps, both backends, with the state of the flow,
  against the record of ADR 0086: 62 of 62 runs are equal. The two runs of the scene are new (`research/flow/README.md`,
  part 34).
- **The walls**: `research/front/e5b-walls.ts` and `presets.test.ts` (decision 2).
- **Unit tests**: the scene (its group, its settings against the Corn maze, its cells against `neck()`, its texts),
  the scene in the lists of the scenes with growth, with the flow and with the rule, the rules and the levers of every
  scene (`params.test.ts`), a link of the scene, and the notice of a switch to Jones (`state.test.ts`).
- **The e2e test** (decision 9) passes in the image of CI in 1.3 minutes; the other tests of the flow there take 0.3
  to 1.0 minutes. The pictures of the app: `tests/pictures/crown.spec.ts`.
- **No rule changes**, so no wrong rule is new; `mutate.ts check` finds the code of all 991 wrong rules.
- `npm run lint`, `npm run check`, `RESEARCH=full npm test` (1,003 tests), `npm run test:gpu` (1,442 tests on both
  backends) and the 85 e2e tests pass on the M3 Pro; the e2e tests ran on port 4391, as `npm run verify` would start
  its server on port 4173, which this machine keeps free.

## Not measured

- More than 2 seeds to step 16,000 on WebGPU and 1 on WebGL2; the scene on SwiftShader beyond the e2e test.
- The scene on a portrait screen, where the lattice turns, and on a device that cannot hold the lattice.
- The look in the styles glow and paper, and the look of the two corners of the mouth up close.
- What the drift, the base, the flux and the neighbours give in this scene at other values: the panel offers them, and
  only the values of the case `none` are measured here.
- Each strain with a drift of its own (ADR 0070, decision 5): the setting stays one value for all strains.
