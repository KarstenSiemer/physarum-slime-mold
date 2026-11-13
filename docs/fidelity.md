# How close the model comes to the slime mold

Status: 2026-11-13, `main` at `e3bbefc`. The rules of the model are in [model.md](model.md). The measurements are in
the ADRs that each row names. Decision: [ADR 0030](adr/0030-model-specification-and-fidelity.md).

## Two questions

1. **Does the app compute the model of its paper?** The scenes of Jones are measured against the figures of Jones
   2010, and the flow against the model of Tero et al. A match shows that the app is true to the model.
2. **Does the model behave like the organism?** Only a comparison with measurements of _Physarum polycephalum_ answers
   this. Jones' figures are pictures of his model, not of the organism.

This file keeps the two apart. Most of the app's measurements answer question 1. Few answer question 2.

## Status words

| Status                 | Meaning                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Matches in numbers     | A number of the organism and a number of the model; the model lies in the organism's spread.   |
| Fitted                 | A constant was chosen so that this number matches. The match then says nothing about the rule. |
| Matches the model only | The app matches Jones' figures or Tero's model. The docs hold no number of the organism.       |
| Looks similar          | Seen by eye. One side or both have no number.                                                  |
| Partly                 | One part is reproduced, another part is not, or is not measured.                               |
| Not measured           | The model has a mechanism for it, and nobody measured the result.                              |
| Not modelled           | The model has no mechanism for it.                                                             |

Marks on the organism's facts, as in [flow-in-the-tubes.md](knowledge-base/flow-in-the-tubes.md): **[V]** read in the
full text; **[H]** a helper read the copy at PubMed Central (results and captions, not the methods); **[J]** read in
Jones 2010 (journal pages); **none** the docs hold no source.

## Summary

| #   | Behaviour of the organism                        | Status                                  | Scenes                                |
| --- | ------------------------------------------------ | --------------------------------------- | ------------------------------------- |
| 1   | Tokyo network: length, distance, fault tolerance | Matches in numbers (MD, FT); TL fitted  | Tokyo rail network                    |
| 2   | Dead ends lose their tube                        | Partly                                  | Maze                                  |
| 3   | Tubes with much flow get thicker                 | Partly                                  | Maze, Tokyo rail network              |
| 4   | Time scales of a tube                            | Fitted                                  | every scene with the flow             |
| 5   | Shortest path through a maze                     | Partly (one route only)                 | Maze                                  |
| 6   | Growth front and its speed                       | Partly: about ten times too fast        | Tokyo rail network, Foraging maze     |
| 7   | Speed of the flow                                | Fitted with the time scale              | Tokyo rail network                    |
| 8   | Network formation and minimisation               | Matches the model only                  | Transport network, Minimizing network |
| 9   | Shortest path and Steiner tree between foods     | Matches the model only                  | Shortest path, Steiner tree           |
| 10  | The sheet shrinks onto the food                  | Matches the model only                  | Shrinking plasmodium                  |
| 11  | Wound healing                                    | Partly, against the model only          | Wound healing                         |
| 12  | Chemotaxis toward food                           | Looks similar                           | every scene with food                 |
| 13  | Avoidance of light                               | Looks similar                           | Fleeing light                         |
| 14  | Answer to new food within about 15 min           | Not measured                            | none                                  |
| 15  | Memory in the tube network                       | Not measured                            | none                                  |
| 16  | Tubes break and form again within hours          | Partly: they break, but form again late | every scene with the flow             |
| 17  | Shuttle streaming, a period of about 2 min       | Not modelled                            | none                                  |
| 18  | Food is eaten                                    | Not modelled                            | none                                  |
| 19  | Pattern classes after the life conditions        | Not measured                            | none                                  |

Behaviours of the model without a counterpart in the organism: Turing spots and stripes (chemorepulsion) match Jones'
figures (ADR 0027, Measurements: stripes 15.7 cells against 16.2, 19.7 spots against 20). Several strains with a table
of attraction (Fogleman 2020) are an extension for the look, not biology.

## The rows

### 1. Tokyo network

- **Organism** [V]: Tero et al. 2010, p. 440, 21 runs: TL 1.75 ± 0.30, MD 0.85 ± 0.04. A cut link separates a part in
  20 ± 13 % of the cases without light and in 14 ± 4 % with light on the mountains, so FT is 0.80 and 0.86. The rail
  network: TL about 1.8, MD 0.85, FT 0.96. TL and MD are over the values of the minimum spanning tree; FT is
  1 − the share of single cuts that separate a part. The paper labels FT as normalised by the MST (p. 440), but its
  numbers are the plain FT: a tree has FT 0 (Fig. S1).
- **Model**: extended model, growth (Jones 2011) and the flow with a strength of 1.4; 36 foods, measured on the 33 of
  Fig. 2.
- **Measured** (ADR 0029, The Tokyo rail network; `92a63e7`, WebGPU, 10 seeds): at step 48,000 TL 1.77 ± 0.15, MD
  0.84 ± 0.03, FT 0.90 ± 0.05. WebGL2, 2 seeds at step 24,000: TL 1.72 and 1.91, MD 0.82 and 0.83.
- **Limits**:
  - The flow strength was chosen from 1, 1.4 and 2 because 1.4 gives the organism's TL (ADR 0029, decision 12). So
    TL is fitted. MD and FT were not fitted.
  - The positions of the cities are fitted to the figures (ADR 0024). The network is the trail above 1.5, thinned to
    lines. That threshold is this app's, and nobody measured how the numbers depend on it.
  - Only the protocol without light is built. The second protocol of the paper (a sheet first, then all foods) ran
    only in a CPU prototype with 2 seeds (ADR 0029, prototype (b)).
  - Nobody compared the network with the lines of the rail map. The paper calls the organism's network comparable
    to the railway; its FT is 0.80 to 0.86 against 0.96.

### 2. Dead ends lose their tube

- **Organism** [V]: a tube with an open end tends to disappear (Tero et al. 2007, Sec. 2). A dangling end vanishes or
  grows, and is never stable (Marbach et al. 2023).
- **Model**: the flow (ADR 0029). A dead end carries no flux, its flow memory falls, and its agents starve.
- **Measured** (ADR 0029, The Maze; 10 seeds on WebGPU, 3 on WebGL2, 3 without the flow): the trail in the dead ends
  over the trail of the route falls from 0.54 at step 1,000 to 0.000 at step 5,000. Without the flow it stays at 0.60
  to 0.91.
- **Limits**: the time of the decay is not compared with the organism. No measurement follows one dead end from the
  moment its flux stops.

### 3. Tubes with much flow get thicker

- **Organism**: of two tubes between the same two foods, the longer one tends to disappear (Tero et al. 2007, Sec. 2)
  [V]. Near a new food the tubes dilate up to twofold (Kramar and Alim 2021) [H].
- **Model**: the thickness of a tube is the number of agents across it, not a radius. Dead agents come to life on a tube
  of their own strain where the flow memory of their strain is above 0.5 (ADR 0029, decision 8; ADR 0031, decision 2).
- **Measured**: a stronger flow gives a wider tube in the Maze: about 2,060 agents at a strength of 4 and about 9,600
  at 16 (2 seeds each, ADR 0029). The width of a tube against its own flux is not measured. The competition of two
  routes is not measured in the app; the prototype tested it only on Tero's ring (ADR 0029, prototype).

### 4. Time scales of a tube

- **Organism** [V] (Marbach et al. 2023): the flow changes within 1 to 2 min; a vein answers with a delay of 1 to 3 min;
  it adapts within 10 to 100 min; veins vanish in 15 to 40 min.
- **Model**: 30 steps are one minute. The constants of the flow give 1.7 min for the body, 11 min for the adaptation
  and 33 min for a tube without flux (ADR 0029, decision 10).
- **Limits**: the time scale, 30 steps per minute, was set so that these constants give the organism's times (ADR 0029,
  decision 10). No run measured the life of one tube as a result.

### 5. Shortest path through a maze

- **Organism**: Nakagaki, Yamada and Tóth 2000 is the first maze experiment. The docs hold none of its numbers, and
  nobody read the paper for this project. Ma et al. 2013 (Sec. 1) [V]: in a maze of the Towers of Hanoi only the
  shortest path was left after 12 h.
- **Model**: the Maze with the flow.
- **Measured**: one tube remains, 1.10 times as long as the shortest route at step 15,000 (ADR 0029, The Maze).
- **Limits**: every wall of the Maze touches the edge of the box or a wall that does (`src/model/presets.ts:428-432`).
  So the free space has one route only, and the scene shows how the dead ends die and the tube pulls tight. It does not
  show a choice between two routes.

### 6. Growth front and its speed

- **Organism**: the plasmodium grows out from Tokyo and covers the land in about 11 to 16 h; its network stands at
  26 h (Tero et al. 2010, Fig. 1 [V]; the hours are a reading of the times of the panels, not a number of the text).
- **Model**: growth and shrinkage of Jones 2011 (ADR 0025).
- **Measured**: the Tokyo colony reaches all 36 foods by step 2,000, which is 1.1 h of model time, in 10 of 10 seeds
  (ADR 0029). So it grows about ten times as fast as the organism. Jones' growth rule has no speed of its own to set.
  The Foraging maze reaches its far food in 10 of 10 seeds, in a median of 3,151 to 4,601 steps sensing first (ADR
  0027, Growth after the merge of ADR 0025); it has no length or time scale.
- **Limits**: the front of the organism is a fan of fine veins. The app does not draw one (ADR 0025, decision 28).

### 7. Speed of the flow

- **Organism** [V]: about 1 mm/s (Tero et al. 2007, Sec. 2).
- **Model**: an agent moves one cell per step. On the Tokyo scene a cell is 0.54 mm and a step 2 s, so an agent moves
  0.27 mm/s (ADR 0029, decision 10). The flux of the model has no physical unit.
- **Limits**: decision 10 uses this very comparison to justify the time scale, so the row is not an independent check.
  It also compares the speed of an agent with the speed of the flow, and a blocked agent moves less than one cell per
  step.

### 8. Network formation and minimisation

- **Organism** [J]: the plasmodium grows in a reticulated way and keeps veins between food sources (Jones 2010, p.
  130). Tero et al. 2010, Fig. 1 shows a sheet that thins to a network [V]. The docs hold no time series of numbers.
- **Model**: Jones' agents, one agent per cell.
- **Measured against Jones** (ADR 0027, The scenes of Jones against their figures): the lacunae of the Transport
  network at steps 99, 512, 1,740 and 4,151 are 50.4, 24.5, 12.0 and 6.7 (Fig. 4: 56, 23, 12, 8). The Minimizing
  network ends with 1.6 to 2.0 lacunae at step 31,190 (Fig. 5: 1). The scale grows with SO (Fig. 10), a GPU test in
  `src/engine/sim.gpu.test.ts`.

### 9. Shortest path and Steiner tree between foods

- **Organism**: the docs hold no number. The scene text of Shortest path names the real slime mold without a source.
- **Measured against Jones** (ADR 0027): Shortest path gives one band without a loop in 20 of 20 runs. Steiner tree
  gives a tree in 20 of 20 runs at step 12,000, with a bridge of 10 to 15 cells in 14 of 20, as in Fig. 19.
- **Not measured**: the angles at the junctions (Plateau's 120°), and Fig. 20 (a high food weight turns the Steiner
  tree into the minimum spanning tree).

### 10. The sheet shrinks onto the food

- **Organism** [J]: after it covers the dish, the plasmodium shrinks to veins between the foods (Jones 2010, p. 147).
  The docs hold no source that ties the shrinkage to a lack of food.
- **Model**: in the Jones model each agent dies with a fixed chance per step. The removal is random, not tied to food.
  In the extended model the flow lets agents starve where no flux passes.
- **Measured against Jones** (ADR 0027): the sheet tears in 0 of 31 runs by step 2,800, and the network is nearly the
  same in each run (IoU 0.84 to 0.85 at step 10,000).

### 11. Wound healing

- **Organism**: the docs hold no measurement of the organism.
- **Model**: the Cut tool. In the Jones model the wound keeps its trail; in the extended model the cut clears it.
  Jones kept agents out of the wound until all were placed elsewhere; the app lets them back as soon as the tool is
  released.
- **Measured against Jones**: the spot pattern before the cut is less regular than Fig. 22: a spacing variation of
  9.3 ± 3.4 % (WebGPU) and 8.8 ± 3.5 % (WebGL2) at step 2,650 against about 3 to 5 % (ADR 0027). Its cause is not
  found. The time until the wound closes (about 275 steps in Jones, p. 148) is not measured, and Fig. 23 (a wound in a
  network made by attraction) never ran.

### 12. Chemotaxis toward food

- **Organism** [J]: the plasmodium senses nutrients, its membrane softens on that side, and protoplasm flows there
  (Jones 2010, p. 129). The docs hold no number for the reach of the sense. ADR 0022 names "millimetres to
  centimetres" without a source.
- **Model**: food releases a scent that spreads and decays (model.md, The fields).
- **Measured**: a food steers agents from about 12 to 14 cells in both models (ADR 0009, amendment 2026-11-12;
  measured before ADR 0027 changed the order of the Transport network). Outside Tokyo a cell has no length, so the
  reach is not compared with the organism.

### 13. Avoidance of light

- **Organism**: Tero et al. 2010 (p. 440) state that the plasmodium avoids bright light, and used light of graded
  intensity for mountains and lakes [V, read 2026-11-13]. Jones 2010, p. 142 names light as a trigger of the
  sclerotium [J]. The docs hold no measurement of the avoidance itself.
- **Model**: extended model only. Lit cells release a repellent that spreads like the food scent. This is this app's
  rule (ADR 0007). Jones' light of 2017 dampens what a sensor reads and is not built (ADR 0022).
- **Measured**: nothing. No ADR has a number for Fleeing light.

### 14. Answer to new food within about 15 min

- **Organism** [H]: after a food stimulus the tubes near the food dilate up to twofold within about 15 min, the
  dilation spreads at 15 μm/s, and the pattern lasts at least 45 min (Kramar and Alim 2021).
- **Model**: a newly covered food gets a role in the flow, and the flow memory adapts with a time of 11 min.
- **Measured**: nothing. A test would add a food to a settled network and measure the width of the tubes over time.

### 15. Memory in the tube network

- **Organism** [H]: the title of Kramar and Alim 2021 names memory encoded in the hierarchy of tube diameters. The docs
  hold only that the pattern lasts to the end of their experiment, 45 min.
- **Model**: the flow memory D, with a time of 11 min after the flux stops (ADR 0029, decision 7).
- **Measured**: nothing.

### 16. Tubes break and form again within hours

- **Organism** [V]: tubes take apart and form again within a few hours (Tero et al. 2007, Sec. 1).
- **Model**: a tube without flux starves in about 33 min, and new tubes form on fresh ground by growth and respawn. But
  ground that starved is fresh again only after about 33,000 steps, 18 h of model time (ADR 0029, decision 7), so a
  colony does not grow back into a region it lost within hours. This is an open owner decision in `TODO.md`.

### 17. Shuttle streaming

- **Organism**: the plasm streams back and forth with a period of about 2 minutes (Jones 2010, p. 129 [J]; Tero et al.
  2007, Sec. 2 [V]; Marbach et al. 2023: 1 to 2 min [V]; Kramar and Alim 2021: 100 to 250 s [H]).
- **Model**: none. The flow is a mean over the period, as in Tero et al. 2007 (Sec. 6). The roles of the foods change
  every 300 steps, 10 min. Jones' Fig. 7 shows one tracer agent that moves back and forth; Jones gives random differences in the
  strength of the path and collisions between agents as the cause (p. 137), not a period. The app has no tracer (`TODO.md`, Later).

### 18. Food is eaten

- **Model**: food never runs out. Covered food (Adamatzky and Jones 2010) lowers the scent of a food while agents
  cover it, comes back when they leave, and is off in every scene (ADR 0022).

### 19. Pattern classes after the life conditions

- **Jones** [J]: reticular patterns resemble growth on rich food, labyrinthine ones low food, islands hostile
  conditions (Jones 2010, p. 142). This is Jones' analogy, without a measurement of the organism.
- **Model**: the classes come from SA and RA (Fig. 13 and 14). No parameter is tied to food or light. Nobody measured
  the classes, not even against Jones.

## What the model does not do

- No oscillation and no shuttle streaming (row 17).
- Food is never eaten (row 18).
- A length and a time scale exist only in part. Thirty steps are one minute for the rules of the flow only; the help of
  Flow in the tubes states it (`flowHelp` in `src/model/params.ts`). A cell has a length only on the Tokyo scene (0.54
  mm). The Maze, the Foraging maze and the scenes of Jones have no length, and the scenes of Jones have no time.
- The growth of Jones 2011 has no speed to set: on the Tokyo scene the colony reaches the foods about ten times as fast
  as the organism, and its network stands after 7 to 13 h of model time against 26 h (row 6).
- The thickness of a tube is a count of agents, not a radius. The flux runs on the grid cells, not on a graph of tubes,
  and all foods that a strain covers give or take at once, in the flow of that strain, where Tero et al. 2010 draw one
  pair per step. So the flow is this app's rule, built from Tero's model, and its strength has this app's unit
  (ADR 0029, Consequences).
- The local pressure solver is off the exact flux: 3 to 7 % per cell in a settled network, 9 to 25 % after a new draw
  of roles, and far off while the colony grows fast (ADR 0029, decision 6).
- The front of the growth is not a fan of fine veins (row 6).
- Light is this app's repellent, not the light of Jones' papers (row 13). Dryness is not modelled.
- Two strains never fuse. With the flow every strain is a plasmodium of its own, and no flux passes between strains
  ([ADR 0031](adr/0031-a-flow-for-every-strain.md), decision 4). Two plasmodia of _Physarum polycephalum_ fuse only when
  they are alike at all of several loci; that line comes from the summaries of a web search, the papers were not read
  ([flow-in-the-tubes.md](knowledge-base/flow-in-the-tubes.md), "Two plasmodia"). Every scene with the flow has one
  strain.
- The Jones model never runs the flow (ADR 0029, decision 1). Rows 1 to 7 and 14 to 16 hold for the extended model
  only.
- The app differs from Jones 2010 in one point: agents update in parallel, where Jones picks them in random order (ADR
  0008). Where Jones 2011 is silent, the app chose: a growth count includes the agent itself, and a child gets a random
  heading (ADR 0024, decision 6; ADR 0025).

## Open measurements

The organism has a number in the docs, and the model was never measured:

- the answer to a new food, its time and its width (row 14; Kramar and Alim 2021);
- the life of one tube after its flux stops, and the delay of its answer (row 4; Marbach et al. 2023);
- the longer of two tubes between two foods disappears (row 3; Tero et al. 2007);
- the coverage of the land over time against the panels of Fig. 1, the second protocol and the protocol with light
  (row 1 and 6; Tero et al. 2010).

The model has a number, and the docs hold none of the organism:

- the scenes of Jones (rows 8 to 11), the reach of the food scent (row 12), the times of the Foraging maze, and the
  Maze, until someone reads Nakagaki et al. 2000 (row 5).

Neither side is measured, not even against Jones: Plateau's angles, Jones' Fig. 6, 9, 11 to 14, 20 and 23, the time
until a wound closes, the tracer of Fig. 7, and Fleeing light.

## How to add a row or a number

- An organism's number names its paper, page, section or figure, and its mark [V], [H] or [J]. A number without a
  source stays out.
- A model number names its ADR section, the commit, the seeds, the backend and the scene's settings.
- A constant that was chosen to give a number makes that number "Fitted".
- A new measurement updates its row here in the same pull request.
