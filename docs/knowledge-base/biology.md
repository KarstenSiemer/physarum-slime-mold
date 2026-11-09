# Physarum polycephalum: biology in brief

Sources: Jones 2010, p. 128–130 and 142 (see [jones-2010-model.md](jones-2010-model.md));
Nakagaki, Yamada & Tóth, _Maze-solving by an amoeboid organism_, Nature 407: 470 (2000);
Tero et al., _Rules for biologically inspired adaptive network design_, Science 327: 439–442
(2010).

- _Physarum polycephalum_ ("many-headed slime") is a **plasmodial (acellular) slime mold**,
  phylum Myxomycota. Cellular slime molds (Dictyosteliomycota) are a different group (p. 129).
- The feeding stage, the **plasmodium**, is one cell with many nuclei (a syncytium). It is
  usually bright yellow and flat, so a 2-D model is a good approximation (p. 130, footnote 1).
- Inside, a gel phase (actin-myosin sponge) contracts rhythmically. The thickness oscillates
  with a period of about 2 minutes and pushes the sol (liquid protoplasm) back and forth:
  **shuttle streaming** (p. 129).
- It moves toward food by **chemotaxis**: it senses nutrient gradients, the membrane softens
  on that side, and protoplasm flows there (p. 129). It avoids light and dryness.
- After it finds food, it keeps **tubes (veins)** between food sources and removes the rest.
  Tubes with more flux get thicker, tubes with less flux shrink (Tero's flux model, p. 130).
  The result balances short transport paths against fault tolerance.
- Famous experiments: shortest path through a maze (Nakagaki 2000); a network similar to the
  Tokyo rail system when oat flakes sit at city positions (Tero 2010).
- Pattern classes in the model map to life conditions (p. 142): reticular (rich food),
  labyrinthine/dendritic (low food), isolated islands (hostile conditions, sclerotium stage).
- Model simplification: one diffusing chemical stands for both food signals and internal
  protoplasm flux (p. 133).

What the simulator can show with these facts:

| Biological fact        | Model mechanism                        | Interactive control              |
| ---------------------- | -------------------------------------- | -------------------------------- |
| Chemotaxis toward food | Food cells project chemoattractant     | Food brush, food strength        |
| Light avoidance        | Repellent field sensed by agents       | Light brush                      |
| Network minimization   | Trail feedback, surface-tension effect | Food + shrinkage experiment      |
| Shuttle streaming      | Agents move back and forth along paths | Agent view, slow speed           |
| Damage repair          | Agents re-enter a cleared area         | Cut tool                         |
| Competing strains      | Several species, attraction table      | Strain cards, interaction matrix |
