# 0042: A second Tokyo scene, with light on the mountains and the lakes

- Status: accepted (decisions of the coordinator and of its helpers, 2026-11-15, under the owner's delegation of
  2026-11-12), built 2026-11-15
- Date: 2026-11-15
- Extends [ADR 0029](0029-flow-in-the-tubes.md) (decision 20 of its amendment of 2026-11-14) and
  [ADR 0024](0024-scenes-from-later-papers.md) (the Tokyo scene).
- Changes [ADR 0021](0021-links-carry-food-light-and-walls.md): a link of version 3.
- Extended by ADR 0050 (2026-11-16): light stops growth, the scene runs it at 1, and two cells of the coast are dark
  (51 lit cells).
- In short: [`research/flow/README.md`](../../research/flow/README.md), part 14, has the commands and the tables.

## Context

Tero et al. 2010 (Science 327: 439–442) ran the Tokyo experiment also with light. Read in the paper on 2026-11-15
(p. 440 and the caption of Fig. 2):

- The plasmodium avoids bright light. A mask of light kept its growth to the more shaded areas, which stand for the
  low ground. The sea and the lakes got strong light. Fig. 2B shows a network on this mask; the mask has shades.
- The paper gives one TL and one MD for all its networks: TL 1.75 ± 0.30 (n = 21) and MD 0.85 ± 0.04. It says that
  the TL of the networks with light lies nearer to that of the railway (about 1.8), and gives no number for it.
- A cut link separates a part in 14 ± 4 % of the cases with light and in 20 ± 13 % without: FT 0.86 and 0.80.

The scene Tokyo rail network is the protocol without light, and every number of ADR 0029 is measured on it. Decision
20 of ADR 0029 (2026-11-14) planned a second scene with light and left open: the data and its licences, and light of
one strength or light that grows with the altitude.

Light in this app (ADR 0007, `docs/model.md`, sections 6.4 and 6.7): a lit cell holds one byte and releases a
repellent that spreads and fades like the food scent. A sensor reads the trail less this repellent. The brush sets the
byte to 255 within 0.3 of its radius and lets it fall to 0 at its radius. No other rule reads light: an agent divides
and dies on lit ground as on dark ground.

## Options

The light:

1. One strength: every lit cell holds the full byte. No new rule.
2. Light that grows with the altitude, as the shades of the mask. The byte could hold it, but the brush paints full
   light only, so the scene would need its own way to paint, and a rule for the shade of an altitude.

The shapes of the mountains, for option 1:

- a. One disc per lit cell of the grid of elevations, as the specification of 2026-11-11 drew it (radius 0.024, half
  the diagonal of a cell). The brush gives the full byte to 3.7 % of the land and some light to 24.0 %: this is not
  light of one strength.
- b. Rows of thin strokes that fill each lit cell. The full byte on 20.1 % of the land, some light on 23.9 %. It
  takes 264 strokes where (a) takes 53.

The link, because (b) gives the scene 501 shapes (42 foods, 185 walls, 274 strokes of light): a link of versions 1 and
2 writes the number of a scene's shapes in one byte (`packDrawing()` in `src/model/link.ts`). `Writer.byte()` keeps
the low 8 bits, so a scene with more than 255 shapes wrote a wrong number, the decoder refused it, and the link opened
with its settings alone. The random round trips of `link.test.ts` found it when the scene joined the list. No scene
had more than 255 shapes (the Tokyo rail network has 227).

- c. Fewer shapes: one stroke per run of lit cells needs a radius of 0.06 for its full band, and its fading edge then
  lights 0.042 units, more than a cell, of the low ground around it.
- d. A new version of the link that writes the number as a varint.

## Decision

1. **A second scene, Tokyo with light (`tokyo-light`).** It has the food, the walls and the settings of the scene
   Tokyo rail network, and light after them. The scene Tokyo rail network keeps its bytes, and so does every other
   scene (the digests below).
2. **Light of one strength (option 1).** The coordinator's choice: a light cell is one byte that the
   brush sets to full (ADR 0007), and a shade per altitude is a new rule. The mask of the paper is graded; the scene
   says so in its text.
3. **The mountains** (`TOKYO_MOUNTAINS` in `src/model/tokyo.ts`): a grid of 20 × 20 cells over the map, 9.1 × 10.3 km
   each. A cell is lit when the SRTM 90 m sample at its centre is 200 m or more above the sea: 59 cells. 6 of them
   are dark, because a disc of half their diagonal would reach a food source (Hitachi, Maebashi, Kiryu twice, Odawara,
   Ito): 53 lit cells. From 200 m on, because at 100 or 150 m cells under cities would be lit that Fig. 2B shows dark
   (the helper's reading; the specification of 2026-11-11 is not in the repository). SRTM is public domain (NASA and
   USGS).
4. **The lakes** (`TOKYO_LAKES`): Lake Kasumigaura as 10 strokes along the middle of its three parts, Nishiura, its
   north arm and Kitaura. © OpenStreetMap contributors, Open Database License 1.0 (relations 253637 and 19725922),
   named in the file, in Learn and in the README as the coast is. The sea needs no light: the coast is a wall.
5. **Filled cells (option b).** A helper's choice of 2026-11-15. Reason: only (b) is light of one strength. Measured
   with (a), 2 seeds: the colony first builds a denser mesh on the mountains (186 and 200 links at step 1,000, against
   111 and 96 with (b)); from step 4,000 on the networks do not differ beyond the spread of the seeds.
6. **Light strength 0.05, the default of the app.** Measured with 0.02, 0.2 and 0.5 (2 seeds each) beside 0.05 (10
   seeds): the share of the network on lit ground from step 16,000 on is 4.5, 3.8 and 5.1 % against 4.6 %. No
   strength is better, so the scene keeps the default.
7. **A link of version 3 (option d).** A helper's choice of 2026-11-15. Version 3 writes the number of the scene's
   shapes as a varint. The decoder reads versions 1 and 2 with one byte, as before, and version 3 with a varint, and
   refuses every other version. The writer always writes version 3. Reason: a varint holds every number, and (c)
   lights low ground. A number below 128 keeps its one byte, so such a link differs from version 2 only in its first
   byte; a link of the Tokyo rail network is one byte longer. Old links open as before (`link.test.ts`: a link of
   version 2 of the Tokyo scene, with the byte 227, opens; the bytes of version 3 under the version byte 2 are
   refused). A link of version 3 does not open in an app from before this change, which refuses the version.
8. **The figure link** of the scene is Fig. 2B at the DOI of the paper (ADR 0037, ADR 0043): a link only.

## Results

WebGPU, seeds 1 to 10, to step 48,000, measured as in ADR 0029 on the 33 food sources of Fig. 2. "Without light" is
the record of ADR 0029 with the same code (`tokyo-flux1.4-sites.txt`). "From 16,000": the 50 samples of steps 16,000
to 48,000. "On lit ground": the share of the cells of the network whose light byte is above 0; for the scene without
light, where the light would be (seeds 1 to 3, 15 samples). The light covers 23.9 % of the land.

| Measure                    | With light         | Without light       | The organism                   |
| -------------------------- | ------------------ | ------------------- | ------------------------------ |
| TL at 48,000               | 1.78 ± 0.07        | 1.89 ± 0.13         | 1.75 ± 0.30 (all 21 runs)      |
| MD at 48,000               | 0.83 ± 0.01        | 0.84 ± 0.05         | 0.85 ± 0.04 (all networks)     |
| FT at 48,000               | 0.88 ± 0.04        | 0.91 ± 0.04         | 0.86 ± 0.04 (0.80 ± 0.13 dark) |
| TL, MD, FT from 16,000     | 1.77, 0.83, 0.88   | 1.84, 0.83, 0.91    |                                |
| Links, agents from 16,000  | 54.2, 4,077        | 53.9, 4,010         |                                |
| All 36 joined, of 80       | 73                 | 78                  | all                            |
| On lit ground, step 2,000  | 15.9 % (13 to 18)  | 21.2, 23.8, 24.7 %  |                                |
| On lit ground, from 16,000 | 4.6 % (1.3 to 8.7) | 9.1 % (6.2 to 16.2) |                                |

- **The network keeps off the lit ground, in part.** From step 16,000 on it holds about half as many of its cells
  there as the network without light holds in the same place: 4.6 against 9.1 %. No sample is free of them (the
  least is 1.3 %).
- **The colony first grows over the lit ground.** At step 2,000 16 % of the network lies there, against 21 to 25 % without
  light, which is the share of the land. Then these tubes go first. The reason, read in the rule and not measured: inside a filled lit area
  the repellent is the same in every cell, so the three sensors of an agent read the same loss and the light turns it
  only at the edge; and growth does not read light. In the paper the mask kept the growth of the organism to
  the shaded areas.
- **TL, MD and FT do not change in a way that the runs show.** Over the seeds, the mean TL from step 16,000 on is 0.06
  lower with light and the mean FT 0.02 lower, each about two standard errors. Two sets of ten seeds of one rule
  differed by up to 0.07 in TL (ADR 0029). Every measure is within one standard deviation of the organism's. The check
  of the specification (TL 1.45 to 2.05, MD 0.77 to 0.93, FT at least 0.78 with light) holds in 10 of 10 seeds at
  steps 24,000 and 48,000.
- **WebGL2**, seeds 1 to 3 at step 24,000: TL 1.67, 1.71 and 1.76, MD 0.82 to 0.84, FT 0.84 to 0.89, and 3.5 to 6.4 %
  on lit ground, within the range of the ten seeds on WebGPU (TL 1.54 to 2.04).
- **The bytes of the other scenes.** The digests of the agents, the trail, the scent, the environment and the state
  of the flow after 500 steps are those of `main` at `8ad6dc7` for the default settings and every scene of `main` on
  both backends: 42 of 42 runs equal. The scene Tokyo rail network also gives the lines of the record of ADR 0029 to
  step 48,000 (seed 1, every number).

Checked on 2026-11-15 against the sources: the 400 samples of SRTM 90 m at the centres of the cells (Open Topo Data)
give 59 cells of 200 m or more, the lowest at 211 m, and the highest dark cell lies at 191 m; the 53 lit cells are
these less the six named above. The two relations of OpenStreetMap are Lake Kasumigaura (Nishiura) and Lake Kitaura.
The lines and widths of the lakes were not compared with their outlines.

## Consequences

- The app has a scene for the second protocol of the paper's Fig. 2. `docs/fidelity.md` rows 1 and 13 have its
  numbers: the avoidance of light now has a number, and it is partly that of the organism.
- A link made from now on is of version 3. An app from before this change does not open it.
- Open, in `TODO.md`: the colony grows over lit ground before it leaves it. A light that stops growth, or a graded
  light, would be a new rule and is the owner's decision. The large food source outside the map (LFS in Fig. 2A) is
  not built.
- The scene has 501 shapes, more than twice those of the Tokyo rail network. Its light is painted once at load.
