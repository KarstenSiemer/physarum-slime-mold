# 0036: The reach of the food scent as a setting

- Status: accepted (owner decision, 2026-11-14), built 2026-11-14 (the amendment below)
- Date: 2026-11-14

## Context

The owner asked on 2026-11-14 to set the radius of the scent of food in the UI.

What sets the reach today:

- In the extended model the food scent is a field of its own. Its reach follows from the setting Scent decay and from
  the number of diffusion passes. `emissionScale()` scales the source with the decay, so a large food reaches the same
  plateau at every decay ([model.md](../model.md), section 6.4; ADR 0022).
- In the Jones model the food scent is part of Jones' one trail map. It decays with the strain, and the model holds
  only Jones' published rules (ADR 0022, the owner's decision "Jones streng" of 2026-11-11).
- A measurement of 2026-11-12: the agents follow food only to about 12 to 14 cells from it in every model, also where
  the scent reaches farther at a low decay (ADR 0009, decision 6 of the amendment on the line where food steers). So a
  wider scent alone did not steer agents from farther away.

## Options

1. A setting of the reach in cells, from which the app computes the scent decay. It needs the relation of reach,
   decay and diffusion passes, measured on the grid.
2. Keep Scent decay as the setting, and show the reach in cells that it gives.
3. A source of the food scent of its own, for example a disc of a set radius. A new rule of the extended model.

## Decision

1. **The panel gets a setting for the reach of the food scent** (owner, 2026-11-14).
2. **Only in the extended model** (my choice under the owner's delegation of 2026-11-12): in the Jones model a reach
   of its own would break Jones' one map, against the owner's decision of 2026-11-11.
3. **The form is open.** Before it is chosen: measure the reach of the scent against the decay and the passes, and
   whether the agents follow food from farther away with it (the item of the steering reach in `TODO.md`). Option 1
   or 2 changes no rule; option 3 does, and then `docs/model.md` changes in the same pull request.

## Consequences

- A scene keeps its bytes as long as its setting keeps its value.
- If the agents still follow food only to 12 to 14 cells, a larger reach shows in the scent view but steers no farther.
  Then the setting needs a rule of steering too, or a text in the UI that says so.

## Amendment 2026-11-14: Scent reach, as built

The owner asked to work on without him on the night of 2026-11-14. So I chose the form under the delegation of
2026-11-12, after the measurement of decision 3.

### The measurement

`research/scent/profile.gpu.test.ts` paints one food on a square box of 512 × 512 cells in the extended model, with no
agent alive (the start layout Empty), and runs 12 / d steps, at most 40,000, until the scent no longer changes. It
reads the food scent along the axes from the food: once for a dab of radius 3 cells, once for a line of food across the
whole box. Scent decays 0.3 to 0.0003, with 1, 2 and 4 diffusion passes. `research/scent/README.md` has the story and
the commands.

The theory: a 3 × 3 mean filter scales the mode e^(−κ x), the same along y, by (1 + 2 cosh κ) / 3. Once the scent no
longer changes, the decay d and p passes leave that mode as it is, so (1 − d) ((1 + 2 cosh κ) / 3)^p = 1. Beside a long
line of food the scent is this mode. Around a dab it spreads in two directions and falls faster, like K0(κ r), that is
e^(−κ r) / √r far from the dab.

Beside the line, κ of the formula and κ measured agree within 0.5 % down to a decay of 0.001 (`κ measured` is the
slope of ln s over 4 to 4 + 3/κ cells from the edge). At 0.0003 the box is too small for 2 and 4 passes: the scent
reaches its walls. "1/3" and "1/10" are the distances from the edge of the food at which the scent falls to a third
and to a tenth of its value at the edge, and "Below 0.01" the distance at which it falls below 0.01, where the glow of
the scent view ends.

| Backend | Food | Passes | Scent decay | κ measured | κ formula | Reach, ln 10 / κ | Edge  | 1/3  | 1/10  | Below 0.01 |
| ------- | ---- | ------ | ----------- | ---------- | --------- | ---------------- | ----- | ---- | ----- | ---------- |
| webgpu  | line | 1      | 0.3         | 1.0806     | 1.0806    | 2.1              | 41.48 | 1.0  | 2.2   | 7.8        |
| webgpu  | line | 1      | 0.1         | 0.5696     | 0.5696    | 4.0              | 44.56 | 1.9  | 4.1   | 14.8       |
| webgpu  | line | 1      | 0.03        | 0.3034     | 0.3034    | 7.6              | 42.11 | 3.7  | 7.6   | 27.5       |
| webgpu  | line | 1      | 0.01        | 0.1739     | 0.1739    | 13.2             | 34.28 | 6.3  | 13.3  | 46.8       |
| webgpu  | line | 1      | 0.003       | 0.0950     | 0.0950    | 24.2             | 23.81 | 11.6 | 24.3  | 81.9       |
| webgpu  | line | 1      | 0.001       | 0.0548     | 0.0548    | 42.0             | 15.65 | 20.1 | 42.0  | 134.2      |
| webgpu  | line | 1      | 0.0003      | 0.0300     | 0.0300    | 76.7             | 9.31  | 36.6 | 76.7  | 221.7      |
| webgpu  | line | 2      | 0.3         | 0.7471     | 0.7478    | 3.1              | 43.84 | 1.7  | 3.3   | 11.4       |
| webgpu  | line | 2      | 0.1         | 0.4001     | 0.4002    | 5.8              | 44.21 | 2.8  | 5.8   | 21.0       |
| webgpu  | line | 2      | 0.03        | 0.2142     | 0.2142    | 10.8             | 37.61 | 5.2  | 10.8  | 38.5       |
| webgpu  | line | 2      | 0.01        | 0.1229     | 0.1229    | 18.7             | 28.19 | 9.0  | 18.8  | 64.7       |
| webgpu  | line | 2      | 0.003       | 0.0671     | 0.0671    | 34.3             | 18.40 | 16.4 | 34.3  | 112.0      |
| webgpu  | line | 2      | 0.001       | 0.0387     | 0.0387    | 59.4             | 11.67 | 28.4 | 59.5  | 182.1      |
| webgpu  | line | 2      | 0.0003      | 0.0215     | 0.0212    | 108.5            | 6.76  | 51.5 | 107.7 | —          |
| webgpu  | line | 4      | 0.3         | 0.5225     | 0.5230    | 4.4              | 45.81 | 2.4  | 4.7   | 16.4       |
| webgpu  | line | 4      | 0.1         | 0.2820     | 0.2820    | 8.2              | 41.51 | 4.0  | 8.3   | 29.7       |
| webgpu  | line | 4      | 0.03        | 0.1513     | 0.1513    | 15.2             | 31.83 | 7.4  | 15.3  | 53.4       |
| webgpu  | line | 4      | 0.01        | 0.0868     | 0.0868    | 26.5             | 22.29 | 12.7 | 26.6  | 88.8       |
| webgpu  | line | 4      | 0.003       | 0.0475     | 0.0475    | 48.5             | 13.87 | 23.2 | 48.6  | 152.4      |
| webgpu  | line | 4      | 0.001       | 0.0275     | 0.0274    | 84.1             | 8.56  | 40.1 | 84.0  | 231.9      |
| webgpu  | line | 4      | 0.0003      | 0.0163     | 0.0150    | 153.5            | 4.81  | 71.3 | 146.4 | —          |

Beside a dab of radius 3 cells the scent falls faster than beside the line, the more so at a low decay. And the dab is
weaker at its edge at a low decay, because the extended model scales the source so that a large food keeps its
plateau (`emissionScale()`): beside the line the edge stays at 41 to 46.

| Backend | Food | Passes | Scent decay | κ measured | κ formula | Reach, ln 10 / κ | Edge  | 1/3  | 1/10 | Below 0.01 |
| ------- | ---- | ------ | ----------- | ---------- | --------- | ---------------- | ----- | ---- | ---- | ---------- |
| webgpu  | dab  | 1      | 0.3         | 1.0772     | 1.0806    | 2.1              | 36.46 | 1.0  | 2.0  | 7.2        |
| webgpu  | dab  | 1      | 0.1         | 0.5664     | 0.5696    | 4.0              | 32.32 | 1.7  | 3.6  | 13.0       |
| webgpu  | dab  | 1      | 0.03        | 0.3005     | 0.3034    | 7.6              | 23.03 | 2.8  | 6.2  | 22.6       |
| webgpu  | dab  | 1      | 0.01        | 0.1711     | 0.1739    | 13.2             | 13.90 | 4.4  | 10.0 | 35.5       |
| webgpu  | dab  | 1      | 0.003       | 0.0926     | 0.0950    | 24.2             | 6.75  | 7.0  | 16.7 | 55.7       |
| webgpu  | dab  | 1      | 0.001       | 0.0528     | 0.0548    | 42.0             | 3.13  | 10.5 | 26.5 | 80.6       |
| webgpu  | dab  | 1      | 0.0003      | 0.0286     | 0.0300    | 76.7             | 1.24  | 16.2 | 43.9 | 114.1      |

WebGL2 gives the same table for the dab, to the last digit printed (`research/scent/research.test.ts` checks it).

### Decision

1. **Scent reach is a second way to set Scent decay**, in cells: the distance over which the scent beside a long food
   falls to a tenth, ln(10) / κ (`scentReach()` and `decayForReach()` in `src/model/params.ts`). Option 1 of this ADR.
   Reason: the formula holds within 0.5 %, so the setting needs no table and no new rule, and a scene and a link keep their
   bytes. The line of food is the case in which a distance in cells means one thing; around a dab the help says that
   the scent falls faster.
2. **No setting of its own.** The panel shows Scent reach under Scent decay, in the extended model only, and both move
   together; a link and a scene hold the decay alone. Reason: one value with two names would let a link carry two
   values that disagree. The range of Scent reach is that of Scent decay, so it depends on the passes: 0.7 to 133
   cells with one pass, 1.4 to 266 with four. With 0 passes the scent does not spread, and the panel hides Scent
   reach. More passes at the same decay give a longer reach: the decay stays, and Scent reach shows the new reach.
3. **The help says what the reach does not do.** A longer reach widens the scent, but in the measurements of 2026-11-12
   food steered agents only up to about 12 to 14 cells from it, at every decay (ADR 0009, the amendment of the line
   where food steers). A higher Trail saturation lets a strand hold an agent less, so food steers it from farther away
   (ADR 0022: with Trail saturation 30 and a decay of 0.003 the network reached a dab 20 cells away in 10 of 10 seeds,
   with the defaults in 3 of 10). The repellent of light shares the decay, so it has the same reach. A rule that makes
   a longer reach steer from farther away (option 3) stays open; `TODO.md` has the topic of the steering reach.
4. **The help of Scent decay gets measured numbers.** It said that the scent falls to a third within 2 cells at 0.1
   and within about 9 cells at 0.003. With one pass it falls to a third within 1.7 and 7.0 cells of a dab of radius 3
   and within 1.9 and 11.6 cells of a line, so "about 9" fit neither. Now it says: beside a long food the scent falls
   to a tenth within 4 cells at 0.1 and within 24 cells at 0.003.

### Consequences

- No rule changes: `docs/model.md` stays as it is, and every scene keeps its bytes.
- Tests: `params.test.ts` (the reach of four settings, 0 without diffusion, the way back to the decay, the range);
  `tests/e2e/ui.spec.ts` (Scent reach sets Scent decay and follows it, and is hidden without diffusion and in the
  Jones model); `research/scent/research.test.ts` (the tables above from the archive of the logs).
