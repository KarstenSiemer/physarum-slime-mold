# Physarum polycephalum: biology in brief

Sources: Jones 2010, p. 128–130 and 142 (see [jones-2010-model.md](jones-2010-model.md)); Tero, Kobayashi and Nakagaki
2007 and Tero et al. 2010, and the vein papers of Marbach et al. 2023 and Kramar and Alim 2021 (see
[flow-in-the-tubes.md](flow-in-the-tubes.md), which marks what was read in the full text). Nakagaki, Yamada and Tóth,
_Maze-solving by an amoeboid organism_, Nature 407: 470 (2000), is cited, but nobody read it for this project.

How close the model comes to each fact: [fidelity.md](../fidelity.md).

- _Physarum polycephalum_ ("many-headed slime") is a **plasmodial (acellular) slime mold**, phylum Myxomycota.
  Cellular slime molds (Dictyosteliomycota) are a different group (Jones 2010, p. 129).
- The feeding stage, the **plasmodium**, is one cell with many nuclei (a syncytium). It is thin and flat, so a 2-D
  model is a good approximation (p. 130, footnote 1).
- Inside, a gel phase (actin-myosin sponge) contracts rhythmically. The thickness oscillates with a period of about 2
  minutes and pushes the sol (liquid protoplasm) back and forth: **shuttle streaming** (p. 129; Tero et al. 2007,
  Sec. 2). The flow reaches about 1 mm/s (Tero et al. 2007, Sec. 2).
- It moves toward food by **chemotaxis**: it senses nutrient gradients, the membrane softens on that side, and
  protoplasm flows there (p. 129). Under hostile conditions, dry or exposed to light, it switches to the dense
  patterns of the sclerotium stage (p. 142). Tero et al. 2010 (p. 440) state that the plasmodium avoids bright light,
  and used light of graded intensity for the mountains and lakes of their map. The docs hold no source that measures
  the avoidance.
- After it finds food, it keeps **tubes (veins)** between food sources and removes the rest. A tube with an open end
  tends to disappear, and of two tubes between the same foods the longer one tends to disappear (Tero et al. 2007,
  Sec. 2). Veins without flow vanish in 15 to 40 minutes (Marbach et al. 2023). Tubes near a new food dilate within
  about 15 minutes (Kramar and Alim 2021).
- Known experiments: the shortest path through a maze (Nakagaki et al. 2000), and a network comparable to the Tokyo
  rail system when oat flakes sit at the cities (Tero et al. 2010: total length 1.75 ± 0.30 and mean distance 0.85 ±
  0.04 of the minimum spanning tree).
- Jones relates the pattern classes of his model to life conditions (p. 142): reticular to rich food, labyrinthine or
  dendritic to low food, isolated islands to hostile conditions (the sclerotium stage). This is his analogy; he gives
  no measurement of the organism for it.

What the simulator shows with these facts:

| Biological fact                 | Model mechanism                                                       | Model    | Interactive control             |
| ------------------------------- | --------------------------------------------------------------------- | -------- | ------------------------------- |
| Chemotaxis toward food          | Food releases a scent that spreads and decays                         | both     | Food brush, food strength       |
| Network minimisation            | Trail feedback contracts the network (Jones' surface tension, p. 136) | both     | Shortest path, Steiner tree     |
| Shrinkage onto food             | Random removal of agents (Jones 2010, Fig. 21)                        | both     | Random shrinkage                |
| Growth from a small inoculum    | Growth and shrinkage windows (Jones 2011)                             | both     | Growth and shrinkage, Inoculate |
| Tubes with flow stay, others go | Flux of Tero et al. on the grid; agents starve without flux           | extended | Flow in the tubes               |
| Light restricts where it goes   | Lit cells release a repellent (this app's rule, ADR 0007)             | extended | Light brush                     |
| Damage repair                   | Agents flow back into a cut                                           | both     | Cut tool                        |

Not modelled: shuttle streaming and its period, food that is eaten, dryness. Several strains with a table of
attraction (Fogleman 2020) are not biology.

Model simplification: in the Jones model one diffusing chemical stands for both food signals and the trail of the
agents (p. 133). The extended model keeps the scent of food and light in a field of its own (ADR 0007).
