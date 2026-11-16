# How close the model comes to the slime mold

Status: the scenes and measurements of `main`; a pull request that changes a measured behaviour changes its row
here too (ADR 0030). The rules of the model are in
[model.md](model.md). The measurements are in the ADRs that each row names. Decision:
[ADR 0030](adr/0030-model-specification-and-fidelity.md).

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
Jones 2010 (journal pages); **[S]** only the summary of a web search gave it, and nobody of this project read the
page; **none** the docs hold no source.

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
| 8   | Network formation and coarsening                 | Partly: coverage, degree, β; not widths | Coarsening network, Transport network |
| 9   | Shortest path and Steiner tree between foods     | Matches the model only                  | Shortest path, Steiner tree           |
| 10  | The sheet shrinks onto the food                  | Matches the model only                  | Shrinking plasmodium                  |
| 11  | Wound healing                                    | Partly, against the model only          | Wound healing                         |
| 12  | Chemotaxis toward food                           | Looks similar                           | every scene with food                 |
| 13  | Avoidance of light                               | Partly: growth keeps off, no time scale | Fleeing light, Tokyo with light       |
| 14  | Answer to new food within about 15 min           | Not measured                            | none                                  |
| 15  | Memory in the tube network                       | Not measured                            | none                                  |
| 16  | Tubes break and form again within hours          | Partly: they form again on one map only | every scene with the flow             |
| 17  | Shuttle streaming, a period of about 2 min       | Not modelled                            | none                                  |
| 18  | Food is eaten                                    | Not modelled                            | none                                  |
| 19  | Pattern classes after the life conditions        | Not measured                            | none                                  |
| 20  | Two plasmodia that do not fuse stay two bodies   | Partly                                  | Rival networks, Tokyo, two networks   |
| 21  | Growth toward the cathode of a current           | Partly: the direction only              | Electrotaxis                          |
| 22  | A network around repellents: a Voronoi diagram   | Matches the model only                  | Voronoi diagram                       |

Behaviours of the model without a counterpart in the organism: Turing spots and stripes (chemorepulsion) match Jones'
figures (ADR 0027, Measurements: stripes 15.7 cells against 16.2, 19.7 spots against 20). Several strains with a table
of attraction (Fogleman 2020) are an extension for the look, not biology; row 20 has what the flow does with them.

## The rows

### 1. Tokyo network

- **Organism** [V]: Tero et al. 2010, p. 440, 21 runs: TL 1.75 ± 0.30, MD 0.85 ± 0.04. A cut link separates a part in
  20 ± 13 % of the cases without light and in 14 ± 4 % with light on the mountains, so FT is 0.80 and 0.86. The rail
  network: TL about 1.8, MD 0.85, FT 0.96. TL and MD are over the values of the minimum spanning tree; FT is
  1 − the share of single cuts that separate a part. The paper labels FT as normalised by the MST (p. 440), but its
  numbers are the plain FT: a tree has FT 0 (Fig. S1).
- **Model**: extended model, growth (Jones 2011) and the flow with a strength of 1.4; 36 foods, measured on the 33 of
  Fig. 2.
- **Measured** (ADR 0029, amendment 2026-11-14 (2), with the food sites of decision 17; WebGPU, 10 seeds): at step
  48,000 TL 1.89 ± 0.13, MD 0.84 ± 0.05, FT 0.91 ± 0.04, and over the samples from step 16,000 to 48,000 a mean TL of
  1.84. With the sites before it (`92a63e7`): TL 1.77 ± 0.15, MD 0.84 ± 0.03, FT 0.90 ± 0.05, and 1.80. WebGL2, 3 seeds
  at step 24,000: TL 1.93, 2.04 and 1.77, MD 0.83, 0.83 and 0.91 (2 seeds before: TL 1.72 and 1.91, MD 0.82 and 0.83).
- **Limits**:
  - The flow strength was chosen from 1, 1.4 and 2 because 1.4 gives the organism's TL (ADR 0029, decision 12). So
    TL is fitted. MD and FT were not fitted. The choice was made with the food sites before decision 17. Measured again
    with them (ADR 0029, amendment 2026-11-15, 10 seeds each): at step 48,000 the flux 1 gives TL 1.69, MD 0.82 and FT
    0.87, and 1.4 gives 1.89, 0.84 and 0.91, both within one standard deviation of the organism in every measure. 1 is
    a little nearer in TL, but not by more than two sets of ten seeds differ, and it leaves a food source without a tube
    in 9 of 80 samples (1.4: 2). The scene keeps 1.4. The radius of the pressure solver was measured on the same day
    and stays.
  - The positions of the cities are fitted to the figures (ADR 0024). The network is the trail above 1.5, thinned to
    lines. That threshold is this app's, and nobody measured how the numbers depend on it.
  - The protocol with light is the scene Tokyo with light (ADR 0042, with Light stops growth at 1 since ADR 0050;
    WebGPU, 10 seeds on the first map of ADR 0050, with 53 lit cells): at step 48,000 TL 1.69 ± 0.13, MD 0.83 ± 0.01 and FT 0.85 ± 0.02, and over the samples from step
    16,000 on TL 1.73 and FT 0.86 against 1.84 and 0.91 without light. Before ADR 0050 the scene gave TL 1.78 ± 0.07
    and FT 0.88 ± 0.04. The differences are no larger than two sets of seeds of one rule differ, so the runs do not
    show that light changes the measures. On that map Ito stayed unjoined; the scene has 51 lit cells now, and one seed
    joins all 36 foods with TL 1.68 and FT 0.85 at step 48,000. The paper gives no TL or MD of its own for
    the runs with light; its FT with light is 0.86 ± 0.04. The light of the scene has one strength, the mask of the
    paper has shades, and the large food source outside the map is not built. Row 13 has the avoidance.
  - The second protocol of the paper (a sheet first, then all foods) ran only in a CPU prototype with 2 seeds
    (ADR 0029, prototype (b)).
  - Nobody compared the network with the lines of the rail map. The paper calls the organism's network comparable
    to the railway; its FT is 0.80 to 0.86 against 0.96.

### 2. Dead ends lose their tube

- **Organism** [V]: a tube with an open end tends to disappear (Tero et al. 2007, Sec. 2). A dangling end vanishes or
  grows, and is never stable (Marbach et al. 2023).
- **Model**: the flow (ADR 0029). A dead end carries no flux, its flow memory falls, and its agents starve.
- **Measured** (ADR 0029, The Maze; 10 seeds on WebGPU, 3 on WebGL2, 3 without the flow): the trail in the dead ends
  over the trail of the route falls from 0.53 at step 1,000 to 0.000 at step 5,000 (median on WebGPU, with the food
  sites of the amendment 2026-11-14 (2); 0.54 with the sites before it). Without the flow it stays at 0.60 to 0.91.
- **Limits**: the time of the decay is not compared with the organism. No measurement follows one dead end from the
  moment its flux stops.

### 3. Tubes with much flow get thicker

- **Organism**: of two tubes between the same two foods, the longer one tends to disappear (Tero et al. 2007, Sec. 2)
  [V]. Near a new food the tubes dilate up to twofold (Kramar and Alim 2021) [H].
- **Model**: the thickness of a tube is the number of agents across it, not a radius. Dead agents come to life on a tube
  of their own strain where the flow memory of their strain is above 0.5 (ADR 0029, decision 8; ADR 0031, decision 2).
  The view can draw a radius: the picture of the tubes draws a disc on every cell of a tube, with a radius that grows
  with the fourth root of its conductivity, as Poiseuille's law gives it (ADR 0034). That changes the picture only.
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
- **Measured**: one tube remains, 1.10 times as long as the shortest route at step 15,000 (ADR 0029, The Maze; the
  same with the food sites of the amendment 2026-11-14 (2), 10 seeds on WebGPU).
- **Limits**: every wall of the Maze touches the edge of the box or a wall that does (the preset `maze` in `src/model/presets.ts`).
  So the free space has one route only, and the scene shows how the dead ends die and the tube pulls tight. It does not
  show a choice between two routes.

### 6. Growth front and its speed

- **Organism**: the plasmodium grows out from Tokyo and covers the land in about 11 to 16 h; its network stands at
  26 h (Tero et al. 2010, Fig. 1 [V]; the hours are a reading of the times of the panels, not a number of the text).
  The front moves at up to 1 cm/h (Jones and Adamatzky 2015, p. 2, cited there from Wohlfarth-Bottermann 1986 [V]). On
  a plate shaped like France the plasmodium is back at its start on the fourth day, after all other cities (Adamatzky
  et al., motorways, p. 6 [V]). On an agar gel of about 10 × 10 cm the front reaches the far electrodes after 21 h
  (Tsuda et al. 2012, p. 3 and 5 [V]). The papers: [jones-later-papers.md](knowledge-base/jones-later-papers.md).
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

### 8. Network formation and coarsening

- **Organism** [J]: the plasmodium grows in a reticulated way and keeps veins between food sources (Jones 2010, p.
  130). Tero et al. 2010, Fig. 1 shows a sheet that thins to a network [V].
- **Organism, the coarsening** [V] (Baumgarten, Jones and Hauser 2015, Acta Phys. Pol. B 46: 1201; a plasmodium on
  agar without food, filmed from 16 h to 20 h): the share of the network's circle that veins cover falls to about 0.2
  and stays (p. 1209); the junctions join three veins (p. 1208); the number of veins falls at one rate, 7.69 per tmax
  (Fig. 6, p. 1212); the mean length grows with the number of veins to the power −0.35 (p. 1214); the widths and the
  lengths of the veins are log-normal, and the mean width stays the same (p. 1208, 1212, 1214).
- **Model**: Jones' agents, one agent per cell; in the Coarsening network with his growth and shrinkage.
- **Measured against the organism and the paper's model** (ADR 0045, `research/coarsening/README.md`; the scene's
  settings at sensor distances 3 to 15, WebGPU, seeds 1 to 3, `b93584e` plus the branch of ADR 0045): the lowest
  coverage is 0.14 to 0.22, by the level of the vein mask (organism and paper's model: about 0.2); 99 % of the
  junctions join three veins; the power is −0.38 (paper's model −0.41). The veins fall at two rates, 22.2 and then 5.4
  per tmax (paper's model 31.25 and 6.25). The coarsening time follows the paper's law in 1 / SO², but the app takes
  1.6 to 1.7 times as long at sensor distances 3 to 7 (11,400 ± 2,066 steps at 5 against 6,850).
- **Not reproduced**: the log-normal widths (every vein of the model has one width, in the paper's model too); the one
  rate of the organism; the end (the model's last ring closes to a spot, the plasmodium walks away).
- **Not measured**: the distributions of the lengths and widths, WebGL2, and the extended model with the flow.
- **Measured against Jones** (ADR 0027, The scenes of Jones against their figures): the lacunae of the Transport
  network at steps 99, 512, 1,740 and 4,151 are 50.4, 24.5, 12.0 and 6.7 (Fig. 4: 56, 23, 12, 8). The Minimizing
  network ends with 1.6 to 2.0 lacunae at step 31,190 (Fig. 5: 1). The scale grows with SO (Fig. 10), a GPU test in
  `src/engine/sim.gpu.test.ts`.
- **Not measured**: the numbers of Baumgarten et al. in this app: the count of veins over time, the coverage and the
  exponent.

### 9. Shortest path and Steiner tree between foods

- **Organism**: between cities on a plate shaped like France, in 12 experiments (Adamatzky et al., motorways [V]): the
  graph of all tubes seen at least once is not planar. It is planar when only tubes seen in 3 or more experiments
  count, and it splits into four parts at 8 or more (p. 9). The graph of all tubes contains the relative neighbourhood
  graph, the Gabriel graph and the spanning tree rooted in Paris (p. 13). So the organism builds more than a tree, and
  one run differs from the next. The scene text of Shortest path names the real slime mold without a source.
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
  released. The scene has no growth, so the cut places its agents elsewhere, as Jones did (Jones 2010, Sec. 4.3).
  While growth runs, in other scenes or with the switch on, the cut kills them instead, as a wound takes away the plasm
  of the organism, and the colony grows back from the margin (ADR 0039).
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
  intensity for mountains and lakes [V, read 2026-11-13]. The mask kept the growth to the more shaded areas (caption
  of Fig. 2) [V, read 2026-11-15]; the paper gives no number for it. Jones 2010, p. 142 names light as a trigger of the
  sclerotium [J]. White light repels the plasmodium, and so do sodium chloride, sugar in a high concentration and
  removed substrate (Tsuda et al. 2012, p. 1 and 2 [V]). An electric field is row 21. The docs hold no measurement of how far or how fast the plasmodium leaves light.
- **Model**: lit cells release a repellent that spreads like the food scent. This is the rule of the repellent sources
  in Jones' papers: a source below 0 in the lattice that holds the trail (Jones and Adamatzky 2015, Sec. 4.1, p. 7;
  Tsuda et al. 2012, p. 10 [V]). Both models have it. The Jones model calls it a repellent, as for salt or a current
  source ([ADR 0044](adr/0044-a-repellent-source-in-the-jones-model.md)). To use this rule for light is this app's
  choice (ADR 0007). Jones' own light rule is another one: an agent in a lit region has its sensor values multiplied
  by a factor below 1 (Jones and Adamatzky 2012, p. 7 [V]). It is not built, and it acts only at the edge of a lit
  region too (ADR 0050). In the extended model light can also stop growth: a birth onto a lit cell fails with the
  chance of the setting Light stops growth times the brightness of the cell
  ([ADR 0050](adr/0050-light-stops-growth.md)). This rule is this app's own.
- **Measured** (ADR 0042, the scene Tokyo with light, WebGPU, 10 seeds): the light covers 23.9 % of the land. At step
  2,000 the network holds 15.9 % of its cells on lit ground (13 to 18), against 21 to 25 % where the light would be in
  the scene without light (3 seeds): the colony grows over lit ground almost as over dark ground. From step 16,000 on
  it holds 4.6 % there (1.3 to 8.7) against 9.1 % (6.2 to 16.2). Light strengths of 0.02, 0.2 and 0.5 give 4.5, 3.8
  and 5.1 % (2 seeds each). In the Jones model the agents leave the disc of a repellent source, and the field follows
  Jones' one map with a source below 0 (GPU tests, ADR 0044). No ADR has a number for Fleeing light. With Light stops
  growth at 1 (ADR 0050, 10 seeds, on the first map with 53 lit cells) the network holds 3.3 % of its cells on lit ground at step
  2,000 (2.7 to 4.4) and 1.3 % from step 16,000 on (0.9 to 1.9). At 0.5 it holds 13.0 % at step 2,000 (3 seeds).
- **Limits**: in a filled lit area the repellent is the same in every cell, so by the rule the light turns an agent
  only at the edge of the area (read in the rule, not measured). Light stops births, not moves: agents still walk
  onto lit ground. A food that light encloses stays out of reach, so the scene leaves a dark way to each food. The
  map of the scene as it is now (51 lit cells) is measured with one seed. The paper gives no number for how much of
  the organism lay on lit ground, so the 1.3 % has no value to compare with.

### 14. Answer to new food within about 15 min

- **Organism** [H]: after a food stimulus the tubes near the food dilate up to twofold within about 15 min, the
  dilation spreads at 15 μm/s, and the pattern lasts at least 45 min (Kramar and Alim 2021). An oat flake raises the
  frequency of the oscillation by a median of 12.2 % in the 10 minutes after it, against 2.1 % without a stimulus
  (Whiting et al., logic gates, p. 3 and Table 1 on p. 4 [V]).
- **Model**: a newly covered food gets a role in the flow, and the flow memory adapts with a time of 11 min. The model
  has no oscillation (row 17), so it has no frequency that a food could raise.
- **Measured**: nothing. A test would add a food to a settled network and measure the width of the tubes over time.

### 15. Memory in the tube network

- **Organism** [H]: the title of Kramar and Alim 2021 names memory encoded in the hierarchy of tube diameters. The docs
  hold only that the pattern lasts to the end of their experiment, 45 min.
- **Model**: the flow memory D, with a time of 11 min after the flux stops (ADR 0029, decision 7).
- **Measured**: nothing.

### 16. Tubes break and form again within hours

- **Organism** [V]: tubes take apart and form again within a few hours (Tero et al. 2007, Sec. 1).
- **Model**: a tube without flux starves in about 33 min, and new tubes form on fresh ground by growth and respawn.
  Ground where a tube starved stays closed to growth until its flow memory has grown back: up to 18 h of model time from
  the deepest starvation (ADR 0029, decision 7). A tube that is taken off while its flow memory is above that of fresh
  ground leaves fresh ground at once.
- **Measured** (ADR 0029, amendment 2026-11-15 (2), the Tokyo rail network, seeds 1 to 3, WebGPU): where the network
  around four cities is taken off at step 24,000 (13 h), the colony joins them again within 200 to 400 steps (7 to 13
  min); where their foods are taken away for 100 min and come back, within 300 to 1,000 steps (10 to 33 min) after they
  come back. So tubes break and form again within an hour where a tube is needed. The ground between the tubes stays
  closed for hours; with a time of 12 h or less the mesh of the growth rule comes back there, and the network is longer
  (decision 19).

### 17. Shuttle streaming

- **Organism**: the plasm streams back and forth with a period of about 2 minutes (Jones 2010, p. 129 [J]; Tero et al.
  2007, Sec. 2 [V]; Marbach et al. 2023: 1 to 2 min [V]; Kramar and Alim 2021: 100 to 250 s [H]; 60 to 200 s, cited
  in Whiting et al., logic gates, p. 1 [V]).
- **Model**: none. The flow is a mean over the period, as in Tero et al. 2007 (Sec. 6). The roles of the foods change
  every 300 steps, 10 min. Jones' Fig. 7 shows one tracer agent that moves back and forth; Jones gives random differences in the
  strength of the path and collisions between agents as the cause (p. 137), not a period. The app has no tracer (`TODO.md`, Later).
  The picture of the tubes draws grains that move with the mean flow and swing back and forth once in 2 minutes
  (ADR 0034, amendments of 2026-11-14). The swing is in the picture alone: it has one period and one phase in the
  whole network, and no result depends on it. A model of the pumping is a later step (`TODO.md`, Later).

### 18. Food is eaten

- **Model**: food never runs out. Covered food (Adamatzky and Jones 2010) lowers the scent of a food while agents
  cover it, comes back when they leave, and is off in every scene (ADR 0022).
- **Jones' own rule** [V]: the value that a source projects is decremented while an agent covers the source, until the
  source is consumed (Jones and Adamatzky 2012, p. 7). The app does not have this rule.

### 19. Pattern classes after the life conditions

- **Jones** [J]: reticular patterns resemble growth on rich food, labyrinthine ones low food, islands hostile
  conditions (Jones 2010, p. 142). This is Jones' analogy, without a measurement of the organism.
- **Model**: the classes come from SA and RA (Fig. 13 and 14). No parameter is tied to food or light. Nobody measured
  the classes, not even against Jones.

### 20. Two plasmodia that do not fuse

- **Organism** [S]: two plasmodia of one species do not always fuse when they meet (Masui, Satoh and Seto 2018, on
  _Physarum rigidum_). In _Physarum polycephalum_ they fuse only when they are alike at several loci (Carlile and Dee
  1967). After a fusion of two strains that do not fit, a lethal reaction can follow. The papers were not read:
  [flow-in-the-tubes.md](knowledge-base/flow-in-the-tubes.md), "Two plasmodia". Pieces of one culture do fuse, after a
  delay [V]: their growth fronts leave a strip of free substrate between them at 10 h and merge by 16 h (Jones and
  Adamatzky 2015, p. 4, Fig. 3), and eight pieces on one gel are one cell after 8 h (Tsuda et al. 2012, p. 5).
- **Model**: each strain has a flow of its own, so no flux passes from the tubes of one strain into the tubes of another
  (ADR 0031). The strains keep apart by a negative weight on each other's trail (Fogleman 2020), which is no rule of
  the organism. The model has no fusion and no lethal reaction.
- **Measured** (ADR 0032, again with the food sites of ADR 0029, amendment 2026-11-14 (2); seed 1, WebGPU): in Rival
  networks each of two strains keeps a network on all ten foods from step 4,002 to step 12,002, with 3,749 and 2,994
  agents at the end (2,993 and 2,730 with the sites before). On the Tokyo map each of two strains holds 40 to 42 of the
  42 food sites in every sample from step 2,002 on, and 42 and 42 at step 14,002 (38 to 42 before): a strain now
  covers a food from any of its cells. The docs hold no number of the organism to compare with.

### 21. Growth toward the cathode of a current

- **Organism**: in an electric field 13 of 16 pieces had grown more toward the cathode than toward the anode after
  six hours, and no piece changed its direction (Tsuda, Jones, Adamatzky and Mills 2011, arXiv:1204.1752, p. 4 [V]).
  The other 3 did not grow toward the anode: they grew branches downward (same page). With two more current sources
  in the way the front split in two, the smaller front was gone after 16 hours, and the rest reached the sinks after
  21 hours (p. 5, Fig. 6 [V]).
- **Model**: the Electrode tool ([ADR 0047](adr/0047-an-electrode-tool-and-the-scene-electrotaxis.md)). A cathode is
  a source above 0 and an anode one below 0 of Jones' one map, ±255 per step at Electrode strength 1, as the model of
  the same paper has them (p. 10 [V]). The scene Electrotaxis runs that model with a mean over 15 × 15 cells. The
  lattice, the places of the electrodes and the decay of 0.01 are this app's choice: the paper gives none.
- **Measured** (ADR 0047, the scene Electrotaxis, 10 seeds on each backend, 2026-11-15): the colony moves toward the
  cathodes in 10 of 10 runs and never turns. Its mean is 50 to 53 cells of the 100 to the cathodes at step 450 and 84
  to 87 at step 800. With the poles swapped it goes the other way in 10 of 10 runs, and without the electrodes it
  stays.
- **Limits**: the direction of the model is fixed by the field, so it has no run like the 3 of 16 of the organism
  that grew sideways.
  The model of the paper lets its field settle for 400 steps first and has the oscillatory motor mode; the app has
  neither. The split of the front at more current sources (Fig. 12 of the model) is not measured. The docs hold no
  number of the organism for a time or a speed. In the extended model the tool is this app's reading, measured
  against nothing.

### 22. A network around repellents draws their Voronoi diagram

- **Organism** [V]: a plasmodium that fills a round arena, with repellents put onto it and attractants around the
  border, adapts its network so that it avoids the repellents and stays joined to the border. The network
  approximates the Voronoi diagram of the repellents (Jones and Adamatzky 2015, arXiv:1503.06973, p. 3, Sec. 2.1 and
  Fig. 2, from Shirakawa et al. 2009 and Shirakawa and Gunji 2010, which nobody of this project read). Salt grains
  repel (p. 2, Fig. 1). The paper gives no number for the fit.
- **Model**: the repellent source of the Jones model (row 13, ADR 0044), the mean over 5 × 5 cells (ADR 0046) and
  growth and shrinkage (ADR 0025), with the values of the paper (p. 7). The scene Voronoi diagram has seven repellent
  dots and a ring of food at the rim, read from the paper's Fig. 6a and 10
  ([ADR 0048](adr/0048-the-scene-voronoi-diagram.md)).
- **Measured** (ADR 0048, `research/voronoi/README.md`; step 10,000, 30 seeds on each backend): 0.87 of the network's
  cells lie within 3 cells of an edge of the Voronoi diagram of the dots (WebGL2 0.84; cells at random 0.12), and the
  network covers 0.91 of the length of the edges (0.88). It is the whole diagram, 12 edges and seven cells, in 26 of
  30 runs (21 of 30). With a weaker repellent the network is a hybrid, as in the paper: 6 to 9 of the 12 edges at
  strengths of 0.025 to 0.15. A path between two foods stands 20.8, 34.0 and 50.2 cells off its line with one, two
  and three repellents beside it; the paper's Fig. 8, read from its pixels, has 16.5, 32.5 and 51.
- **Limits**: the comparison is with the geometry and with the figures of the paper's model, not with the organism.
  The paper gives no lattice and no strengths; they are read from its figures or chosen (ADR 0048).

## What the model does not do

- No oscillation and no shuttle streaming (row 17).
- Food is never eaten (row 18).
- A length and a time scale exist only in part. Thirty steps are one minute for the rules of the flow only; the help of
  Flow in the tubes states it (`flowHelp` in `src/model/params.ts`). A cell has a length only on the Tokyo scene (0.54
  mm). The Maze, the Foraging maze and the scenes of Jones have no length, and the scenes of Jones have no time.
- The growth of Jones 2011 has no speed to set: on the Tokyo scene the colony reaches the foods about ten times as fast
  as the organism, and its network stands after 7 to 13 h of model time against 26 h (row 6).
- The thickness of a tube is a count of agents, not a radius; the radius in the picture of the tubes is a drawing of
  the flow memory (ADR 0034). The flux runs on the grid cells, not on a graph of tubes, and all foods that a strain
  covers give or take at once, in the flow of that strain, where Tero et al. 2010 draw one pair per step. So the flow
  is this app's rule, built from Tero's model, and its strength has this app's unit (ADR 0029, Consequences).
- The local pressure solver is off the exact flux: 3 to 7 % per cell in a settled network, 9 to 25 % after a new draw
  of roles, and far off while the colony grows fast (ADR 0029, decision 6). With the food sites of decision 17: 2 to
  10 % from 200 steps after a draw on, 10 to 31 % 100 to 175 steps after it, and about half in the first 50 steps
  (amendment 2026-11-15). A larger radius of its momentum settles a fixed network sooner, but lets the errors of a
  growing colony run off, so the radius stays (same amendment).
- The front of the growth is not a fan of fine veins (row 6).
- Light is a repellent source, the rule of Jones' papers for repellents such as salt. The light rule of Jones'
  papers, weaker sensors on a lit agent, is not built (row 13). Dryness is not modelled.
- Two strains never fuse: no flux passes between strains (row 20; [ADR 0031](adr/0031-a-flow-for-every-strain.md),
  decision 4).
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
- the coverage of the land over time against the panels of Fig. 1, and the second protocol (row 1 and 6; Tero et al.
  2010).

The model has a number, and the docs hold none of the organism:

- the scenes of Jones 2010 (rows 8 to 11; row 8 has the organism's numbers for the Coarsening network only), the reach of the food scent (row 12), the times of the Foraging maze, and the
  Maze, until someone reads Nakagaki et al. 2000 (row 5).

Neither side is measured, not even against Jones: Plateau's angles, Jones' Fig. 6, 9, 11 to 14, 20 and 23, the time
until a wound closes, the tracer of Fig. 7, and Fleeing light.

## How to add a row or a number

- An organism's number names its paper, page, section or figure, and its mark [V], [H] or [J]. A number without a
  source stays out.
- A model number names its ADR section, the commit, the seeds, the backend and the scene's settings.
- A constant that was chosen to give a number makes that number "Fitted".
- A new measurement updates its row here in the same pull request.
