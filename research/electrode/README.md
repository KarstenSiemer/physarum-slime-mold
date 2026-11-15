# The Electrode tool and the scene Electrotaxis: how they came about, and how to check them

This folder belongs to [ADR 0047](../../docs/adr/0047-an-electrode-tool-and-the-scene-electrotaxis.md). The first
part of this page tells in plain words how the tool and the scene came about. The rest is a reference: one command
for each check.

## The story in one page

**The question.** The owner asked for electric current as another tool, like light and food. A real slime mold on a
gel with a current grows toward the cathode: 13 of 16 pieces did so in a paper of Tsuda, Jones, Adamatzky and Mills
(2011). The same paper has a model for it, built on Jones' agents. Does the app run that model, and do its agents go
to the cathode?

**Step 1: the rule of the paper.** In the paper's model the agents sense one map. The trail of the agents is in it.
A current sink, the cathode, adds 255 to its cells in every step. A current source, the anode, takes 255 away. In
every step the map takes the mean of 15 × 15 cells, times a damping. Agents turn toward higher values, so they leave
the anodes and go to the cathodes.

**Step 2: where the poles live.** The Jones model of the app has food as a source above 0 and a repellent as a source
below 0. So the poles could have been food and repellent with another strength. They are not, because food is more
than a source in the app: the flow in the tubes runs between foods, covered food releases less, a colony can start
on food, and the picture draws an oat flake. A cathode is none of that. Each cell has four bytes for walls, food and
light, and the fourth was free. The poles use it: 255 is a cathode, 128 an anode. This costs no memory.

**Step 3: the tool.** The tool Electrode paints the pole that the user selects beside the brush. The setting
Electrode strength is 1 for the paper's 255, and goes down to 0. A link holds the strokes; its format has a new
version for that.

**Step 4: the scene.** The paper starts 1,500 agents in a vertical line between five sources and five sinks. It gives
no size of its grid, no positions and no value of the damping. So the scene has a grid of 250 × 240 cells, the line
in the middle, the anodes 20 cells right of it and the cathodes 100 cells left of it. The damping is 0.01: with it
the field stops changing after about 400 steps, the time that the paper gives its field to settle.

**Step 5: the measurement.** Ten runs with ten seeds on each backend. In every run the agents go toward the
cathodes, and they never turn back. After 450 steps they are half way, and after 800 steps a third of them stand at
the cathodes. Three checks show that the electrodes cause this. With the poles swapped the agents go the other way.
With a strength of 0 they stay. With the small mean of 3 × 3 cells they stay too: the field of the electrodes then
does not reach them.

**What the app does not do.** In the paper the field settles for 400 steps before the agents start. The app has no
such phase: field and agents start together. A run that copies the settled field in first is faster (two thirds of
the way after 450 steps, in place of half), and goes the same way. The agents of the paper keep their heading when
they are blocked; the agents of the app take a random one. And the paper's second figure, with two more sources in
the way, was not run.

**What is not exact.** The organism has one number here, 13 of 16 pieces after six hours. The model has no chance
in its direction, so it gives 10 of 10. The paper's grid is not known, so the speed compares with nothing.

## The numbers

The table of the ADR, made by `tables.ts` from the logs. "Way": how far the mean x of the agents went toward the
cathodes, in cells; the line starts 100 cells from them (20 cells with the poles swapped). "Toward the cathodes": a
way above 10 cells. "At a cathode": agents within 12 cells of the middle of a cathode, of 1,500. "Largest way back":
the largest step of the mean x toward the anodes between two samples, 25 steps apart.

| Run                                           | Seeds | Toward the cathodes at 450 | Way at 450, cells | Toward at 800 | Way at 800, cells | At a cathode at 800      | Largest way back |
| --------------------------------------------- | ----- | -------------------------- | ----------------- | ------------- | ----------------- | ------------------------ | ---------------- |
| the scene, WebGPU                             | 10    | 10 of 10                   | 50.2 to 52.6      | 10 of 10      | 83.8 to 85.7      | 420 to 539 (mean 478)    | 0.00             |
| the scene, WebGL2                             | 10    | 10 of 10                   | 50.1 to 53.4      | 10 of 10      | 83.6 to 86.8      | 424 to 524 (mean 480)    | 0.00             |
| the field settled for 400 steps first, WebGPU | 10    | 10 of 10                   | 66.0 to 70.9      | 10 of 10      | 88.4 to 90.5      | 640 to 752 (mean 705)    | 0.00             |
| the field settled for 400 steps first, WebGL2 | 10    | 10 of 10                   | 65.7 to 72.9      | 10 of 10      | 89.4 to 91.0      | 697 to 785 (mean 726)    | 0.00             |
| the poles swapped                             | 10    | 10 of 10                   | 17.9 to 18.1      | 10 of 10      | 18.6 to 18.9      | 1214 to 1232 (mean 1226) | 0.02             |
| Electrode strength 0                          | 10    | 0 of 10                    | -0.1 to 0.1       | 0 of 10       | -0.2 to 0.1       | 0 to 0 (mean 0)          | 0.07             |
| decay 0.1                                     | 10    | 10 of 10                   | 10.4 to 11.0      | 10 of 10      | 13.7 to 14.3      | 0 to 1 (mean 0)          | 0.00             |
| decay 0.03                                    | 10    | 10 of 10                   | 25.4 to 26.1      | 10 of 10      | 35.6 to 36.7      | 0 to 1 (mean 0)          | 0.00             |
| decay 0.003                                   | 10    | 10 of 10                   | 66.8 to 69.7      | 10 of 10      | 85.1 to 86.7      | 483 to 528 (mean 506)    | 0.00             |
| Mean window 3                                 | 10    | 0 of 10                    | -0.5 to 2.0       | 0 of 10       | 0.0 to 4.6        | 6 to 82 (mean 27)        | 0.38             |

Every sample of a log also holds the field along the middle row at five points (`field`: food scent − repellent).
With the decay 0.01 it reads 44.31, 3.167, −25.59, −17.94, −2.628 at step 400 and 44.30, 3.123, −25.66, −18.02,
−2.661 at step 800: within 1.4 % of each other. With 0.1 it is the same to four digits from step 100 on. With 0.003
it changes by 5 to 40 % between step 400 and 800 (3.708 to 2.139 at the second point).

## The reference

### What you need

Node 26 and the packages of the repository (`npm ci`), and the browser of the tests (`npx playwright install
chromium`).

### The logs

The logs are one archive, `logs.tar.gz`. Unpack it to `research/electrode/logs/`, which git ignores:

```bash
node --import ./research/flow/register.mjs research/electrode/logs.ts unpack
```

`list` shows what the archive holds, and `pack` packs the folder again after a new measurement.

| Files                 | What                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| `logs/*-webgpu.jsonl` | the runs of the table on WebGPU, one line per seed and sample              |
| `logs/*-webgl2.jsonl` | the scene and the settled field on WebGL2                                  |
| `logs/digest-*.jsonl` | the digests of every scene after 500 steps, of `main` (`6d8d23a`) and here |
| `logs/mutations.txt`  | the tests that fail for each of the 21 wrong rules `EL1` to `EL21`         |

### Step 1: the tests

Both backends against the CPU references (10 seconds), and the unit tests of the link, the settings and the scene:

```bash
npx vitest run --project gpu src/engine/sim.gpu.test.ts -t "electrode tool"
npm test
```

The 21 wrong rules (4 minutes). Each block must name at least one test that fails:

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts $(seq -f "EL%g" 1 21)
```

### Step 2: the bytes of the other scenes

On `main` and on the branch, about 90 seconds each. Every scene but Electrotaxis must have the digests of `main`
(`research.test.ts` compares the two logs of the record):

```bash
VITE_NAME=digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

On another GPU make the digests of `main` on that machine too (`research/flow/README.md`, part 6).

### Step 3: the scene over 10 seeds

All runs of the table (2 minutes), then the table:

```bash
research/electrode/campaign.sh
node --import ./research/flow/register.mjs research/electrode/tables.ts research/electrode/out
```

Without a folder the last command reads the logs of the record. `electrotaxis.gpu.test.ts` names its environment
variables: the seeds, the steps, a patch of the settings, the settled field and the swapped poles.
`research.test.ts` checks the record with every `npm test`: it unpacks the archive, makes the table, and compares it
with the table of this page and of the ADR.
