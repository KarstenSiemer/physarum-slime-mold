# Jones' later papers: repellents, light, growth sets, and facts of the organism

Read on 2026-11-15 in local copies of the papers. The copies are not in the repository: the papers are copyrighted.
Each fact names the page of the copy (the PDF page, unless it says "printed page"). The rules of this app as they are
now: [model.md](../model.md). The decision that came from these notes:
[ADR 0044](../adr/0044-a-repellent-source-in-the-jones-model.md).

## The papers

| Short name    | Paper                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environmental | J. Jones, "Exploiting Environmental Computation in a Multi-Agent Model of Slime Mould", extended abstract, 4 pages; the copy has no date and cites a paper "submitted, 2014"                   |
| Voronoi       | J. Jones and A. Adamatzky, "Slime Mould Inspired Generalised Voronoi Diagrams with Repulsive Fields", [arXiv:1503.06973](https://arxiv.org/abs/1503.06973) (2015)                              |
| Tsuda         | S. Tsuda, J. Jones and others, "Routing Physarum with electrical flow/current", [arXiv:1204.1752](https://arxiv.org/abs/1204.1752) (2012)                                                      |
| Amoeboid      | J. Jones and A. Adamatzky, "Emergence of self-organized amoeboid movement in a multi-agent approximation of Physarum polycephalum", Bioinspir. Biomim. 7 (2012), proof, 12 pp.                 |
| Baumgarten    | W. Baumgarten, J. Jones and M. J. B. Hauser, "Network coarsening dynamics in a plasmodial slime mould: modelling and experiments", Acta Phys. Pol. B 46 (2015), No 6, proof                    |
| Motorways     | A. Adamatzky, O. Allard, J. Jones and R. Armstrong, "Evaluation of French motorway network in relation to slime mould transport networks", copy after review                                   |
| Logic gates   | J. Whiting, B. de Lacy Costello and A. Adamatzky, "Slime mould logic gates based on frequency changes of electrical potential oscillation", [arXiv:1406.2021](https://arxiv.org/abs/1406.2021) |

## Repellents in Jones' model

- **One lattice for attractants and repellents.** Attractants are a positive displacement of the lattice and
  repellents a negative one, both projected onto the lattice that the agents sense, and both diffuse (Environmental,
  p. 1; the results with repellents are on p. 3 and 4: Voronoi diagrams, and hybrid graphs when attractants and
  repellents have similar concentrations).
- **Sources above and below 0.** Attractant and repellent sources are sources in the same diffusing lattice: a
  source above 0 attracts, a source below 0 repels (Voronoi, Sec. 4.1, p. 7). The map is diffused with a mean filter,
  "typically" 5 × 5, and damped with a value of typically 0.1 (same place). The agents of that paper have SO 5, SA and
  RA 60°, a step of 1 pixel and a deposit of 1 (p. 7).
- **The strength of a repellent.** The repellent nodes of Fig. 14 have weights of 0.005, 0.025, 0.05, 0.075, 0.125,
  0.15, 0.45 and 0.7 (Voronoi, p. 14). A stronger repellent pushes a network farther out (Sec. 5.1, p. 8, Fig. 9).
  The paper does not say how a weight becomes the projected value. ADR 0048 has the reading that a weight is the
  app's strength, and what speaks for it; no run tests it.
- **Current sources and sinks.** A current source projects −255 into the field at every step and a current sink
  +255. The field is the mean of a 15 × 15 window times (1 − d), with a damping d. An agent deposits 5 units
  (Tsuda, p. 10).
- **What this app does** (ADR 0044): the Jones model reads drawn light as such a source below 0. Its strength goes up
  to 0.5 (a source of −127.5), so it holds the weights of Fig. 14 up to 0.45. The mean window of 5 × 5 to 15 × 15
  cells is a setting since ADR 0046, and the scene Voronoi diagram runs the values of the Voronoi paper (ADR 0048).
  The ±255 of Tsuda is the Electrode tool of ADR 0047.
- **The model of Tsuda in full** (Tsuda, p. 8 to 11): the damping d has no value in the paper. The field is diffused
  for 400 steps before the agents start. SA 22.5°, RA 45°, SO 5, a fixed population of 1,500 agents in a vertical
  line just left of the current sources; five sinks on the left and five sources on the right (Fig. 11, pictures at
  235 to 450 steps). The agents are in the oscillatory motor mode: a blocked agent keeps its heading (p. 8). The
  paper gives no lattice and no positions.

## Light and consumption in Jones' model

- **Light is another rule** (Amoeboid, p. 7): an agent in a lit region has its sampled sensor values multiplied by a
  factor below 1 while it stays there. Lower factors give a stronger response. The lit region releases nothing. This
  app does not have this rule. Earlier docs of this app dated it to 2017; the paper is of 2012.
- **Consumption** (Amoeboid, p. 7): the value that a food source projects is decremented while an agent covers the
  source. This app has no such rule: its covered food releases less while it is covered, and releases fully again
  afterwards (Adamatzky and Jones 2010; [model.md](../model.md), section 6.5).

## Sets of growth and shrinkage

Beside the table of [ADR 0025](../adr/0025-growth-and-shrinkage.md) (Context):

| Paper                          | Growth every | Growth window, count | Shrinkage every | Shrinkage window, count |
| ------------------------------ | ------------ | -------------------- | --------------- | ----------------------- |
| Jones and Adamatzky 2015, p. 7 | 3            | 9 × 9, 1 to 10       | 3               | 5 × 5, 0 to 24          |

The readers' notes of 2026-11-15 also name a set of a paper on splines (arXiv:1503.03264, p. 26: every 2 steps, the
same windows). No copy of that paper was at hand when this file was written, so the set is not checked.

## Facts of the organism in these papers

- **Speed of the front**: up to 1 cm/h (Voronoi, p. 2, cited there from Wohlfarth-Bottermann 1986).
- **A plate crossed**: on a plate shaped like France the plasmodium starts in Paris and comes back to Paris on the
  fourth day, after it reached all other cities (Motorways, p. 6). On an agar gel of about 10 × 10 cm (Tsuda, p. 3)
  the front reaches the far electrodes after 21 hours (Tsuda, p. 5).
- **Repellents**: removed substrate, sodium chloride and sugar in a high concentration repel (Tsuda, p. 1), and so
  does white light (Tsuda, p. 2). Salt grains repel (Voronoi, p. 2, Fig. 1).
- **Electric field**: 13 of 16 pieces had grown more toward the cathode than toward the anode after six hours, and no
  piece changed its direction (Tsuda, p. 4).
- **Fusion**: growth fronts of pieces of one culture leave a strip of free substrate between them at 10 h and merge by
  16 h (Voronoi, p. 4, Fig. 3). Eight pieces fuse into one cell within eight hours (Tsuda, p. 5).
- **Networks between cities**: in 12 experiments the graph of all tubes seen at least once is not planar; it becomes
  planar when only tubes seen in 3 or more experiments count, and it splits into four parts at 8 or more (Motorways,
  p. 9). The graph of all tubes contains the relative neighbourhood graph, the Gabriel graph and the spanning tree
  rooted in Paris (p. 13). So the organism builds more than a tree.
- **Coarsening of a network** (Baumgarten, printed pages 1008 to 1016): the widths of the veins are log-normal
  (p. 1008, cited there), and so are their lengths (p. 1012). The nodes have degree 3 (p. 1008). The number of veins
  falls mono-exponentially (p. 1011). The share of the area that the network covers falls to about 0.2 and stays
  there (p. 1016). The mean vein length follows a power of the number of veins with the exponent −0.35 (p. 1014).
  **Jones' model in the same paper**: all strands have one width (p. 1008), nodes of degree up to 5 occur (p. 1008),
  the number of veins falls bi-exponentially (p. 1011 and 1016), the exponent is −0.41 (p. 1014), the lengths are
  log-normal while SO is at most 7 (p. 1012), and the coverage rises again from about 0.2 once a single ring is left
  (p. 1016).
- **Oscillation**: the period of shuttle streaming is 60 to 200 s (Logic gates, p. 1, cited there). An oat flake on
  the electrode raises the frequency of the oscillation by a median of 12.2 % (standard deviation 12.6) in the
  10 minutes after it, against 2.1 % without a stimulus (p. 3 for the 10 minutes, Table 1 on p. 4).

## Not checked

- The set of the paper on splines (above).
- The readers' notes name a paper on the travelling salesman problem that says the organism forms no tour. No copy
  was at hand, so [fidelity.md](../fidelity.md) does not say it.
