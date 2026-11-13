# Jones (2010) agent model

Source: Jeff Jones, _Characteristics of Pattern Formation and Evolution in Approximations of
Physarum Transport Networks_, Artificial Life 16(2): 127–153, 2010,
DOI [10.1162/artl.2010.16.2.16202](https://doi.org/10.1162/artl.2010.16.2.16202).
A local copy, `artl.2010.16.2.pdf` in the root of a checkout, is not in the repository: the paper is copyrighted.
Page numbers below are journal pages (PDF page = journal page − 126). The rules of this app as they are now:
[model.md](../model.md).

## Core idea

A large population of very simple agents ("particles") creates a transport network. Each agent
deposits a chemoattractant into a shared grid (the **trail map**) and steers toward high
chemoattractant values. The trail map diffuses and decays. This positive feedback (deposit →
attract → deposit) together with diffusion gives Turing-like patterns without an explicit
inhibitor (p. 135–136). A single agent stands for a small piece of plasmodium gel/sol; moving
agents are sol flux, blocked agents are the gel matrix (p. 132).

## Layers (p. 131, Fig. 2)

| Layer     | Content                                                                 |
| --------- | ----------------------------------------------------------------------- |
| Data map  | Habitable area, obstacles, food stimuli, agent positions (1 agent/cell) |
| Trail map | Diffusing chemoattractant: agent trails plus projected food stimuli     |
| (Hazard)  | Optional projection of hazardous stimuli (mentioned, not used, p. 131)  |

The framework is _semi-continuous_: agents keep float position and heading; the discrete cell
is the rounded position (p. 132). The app takes the floor of the position, with the centre of cell i at i + ½: the
same rule, with the origin moved by half a cell.

## Agent morphology (p. 133, Fig. 3)

Three forward sensors F (front), FL (front-left), FR (front-right) at distance SO from the agent
center. FL and FR are rotated by ±SA from the heading. Sensor width SW (1 pixel by default).

## Agent algorithm (exact, Fig. 3, p. 133)

```
[Motor stage]
  attempt move forward one step (SS) in current direction
  if moved successfully (next cell not occupied):  deposit depT at new location
  else:                                            choose random new orientation
[Sensory stage]
  sample trail map at F, FL, FR
  if F > FL and F > FR:      keep heading
  else if F < FL and F < FR: rotate randomly left or right by RA
  else if FL < FR:           rotate right by RA
  else if FR < FL:           rotate left by RA
  else:                      keep heading
```

Scheduler (p. 133): every agent first attempts its move (motor stage), then the whole
population runs the sensory stage. Agents are processed in random order in both stages to
avoid order bias. After each system step the trail map is diffused. The app updates all agents at the same time,
with claims for the cells (ADR 0008), and runs this order in the scenes of Jones 2010 (ADR 0027).

Important details:

- Deposit happens **only after a successful move**. Blocked agents do not deposit (p. 133, 134).
- **One agent per grid cell** (collision rule). This approximates conservation of matter and
  matters for high-density patterns (p. 132–133, 139).
- Agents are forward-biased: only front sensors are used (p. 133).
- Large sensor offset (≥ 3 px) is _necessary_ for complex behaviour (p. 132–133).

## Diffusion and decay (p. 132)

A "pseudo-parallel simple mean filter in a 3 × 3 kernel" with an adjustable decay value.
`decayT` is the **fraction removed per step**: Fig. 12 (p. 140) varies it from 0.0001 (strong,
persistent gradients) to 0.5 (weak gradients), and the text says a higher decay value _reduces_
the gradient field (p. 139). Therefore:

```
trail' = mean3x3(trail) · (1 − decayT)
```

## Parameters (Table 1, p. 134)

| Group     | Name     | Typical value | Meaning                                     |
| --------- | -------- | ------------- | ------------------------------------------- |
| Framework | lattice  | 200 × 200 px  | Environment from grayscale image            |
|           | %p       | 3–15          | Population as % of image area               |
|           | diffK    | 3             | Diffusion kernel size                       |
|           | decayT   | 0.1           | Trail decay factor (fraction lost per step) |
|           | wProj    | 0.01–0.1      | Pre-pattern (food) projection weight        |
|           | boundary | periodic      | Diffusion and agent boundary condition      |
| Agent     | SA       | 22.5° or 45°  | FL/FR sensor angle from heading             |
|           | RA       | 45°           | Rotation angle                              |
|           | SO       | 9 px          | Sensor offset distance                      |
|           | SW       | 1 px          | Sensor width                                |
|           | SS       | 1 px/step     | Step size                                   |
|           | depT     | 5             | Chemoattractant deposited per step          |
|           | pCD      | 0             | Probability of a random change in direction |
|           | sMin     | 0             | Sensitivity threshold                       |

Only SA, RA, SO, %p and decayT change the pattern much (p. 134).

## Results to reproduce

| Behaviour            | Settings                                                 | What happens                                                                                            | Ref                    |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| Dynamic network      | RA 45, SA 22.5, SO 9, %p 15                              | Network forms; small cycles contract; new branches sprout; never fully stable                           | Fig. 4, p. 135         |
| Minimizing network   | RA 45, SA 45                                             | Lacunae grow, cycles close; approx. hexagonal tiling                                                    | Fig. 5, p. 136         |
| Surface tension      | any network                                              | Cycles contract, flux rises while closing (Fig. 6)                                                      | p. 136–137             |
| Shuttle streaming    | single tracer agent                                      | Agent moves back and forth along a path                                                                 | Fig. 7, p. 137         |
| Sheets               | RA 45, SA 45, closed boundary, %p 20                     | Network condenses to a sheet with "vacancy islands"; islands fewer/larger as SO grows                   | Fig. 9, p. 138         |
| Scale                | SO 3, 9, 15, 25                                          | SO is the pattern scale; small SO fine mesh, large SO coarse                                            | Fig. 10, p. 139        |
| Density × scale      | %p 10–90, SO 3–27                                        | High %p + large SO: networks → stripes and spots (vacancy islands, needs collisions)                    | Fig. 11, p. 139        |
| Density × decay      | %p 5–60, decayT 1e-4–0.5                                 | More agents: thicker paths, fewer lacunae. Low decay: less connectivity                                 | Fig. 12, p. 140        |
| SA × RA map          | 0–180° in 22.5° steps, %p 15, SO 9                       | Classes: reticular → labyrinthine → islands as SA, RA grow; none at SA 0/180 or RA 0                    | Fig. 13–14, p. 141–142 |
| Chemorepulsion       | agents turn _away_ from trail                            | Turing-like regular spots (RA 45, SA 45) and stripes (RA 67.5, SA 112.5)                                | Fig. 15–16, p. 143–144 |
| Food stimuli         | food projected into trail with wProj 0.01, %p 2          | Network snags on food, minimizes to shortest path / Steiner tree; obeys Plateau's laws (120° junctions) | Fig. 18–19, p. 145–146 |
| Stimulus weight      | wProj 0.05 → 0.01 → 0.5                                  | Low weight loosens, high weight tightens: Steiner tree → minimum spanning tree                          | Fig. 20, p. 146        |
| Plasmodial shrinkage | %p 50 sheet, remove each agent with p = 0.00025 per step | Sheet shrinks onto food; reproducible network                                                           | Fig. 21, p. 147        |
| Wound repair         | remove agents in a square, re-seed them elsewhere        | Repulsion: original pattern regrows. Attraction: branches grow in, new pattern                          | Fig. 22–23, p. 148–149 |

## Food stimuli projection (p. 144)

Food cells are projected into the trail map every step with `stimulus value × wProj`. The
projected value then diffuses and decays exactly like agent trails.

## Biology mapping (p. 129–133, 142)

- Plasmodium = one giant cell with many nuclei; gel (actin-myosin mesh) and sol (flowing
  protoplasm). Thickness oscillates with a period of about 2 minutes ("shuttle streaming").
- Reticular patterns ≈ nutrient-rich growth; labyrinthine ≈ low nutrients (dendritic);
  islands ≈ hostile conditions (sclerotium stage) (p. 142).
- Simplification: food and internal flux use the same chemoattractant (p. 133).
