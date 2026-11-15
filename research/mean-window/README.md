# The mean window: how the setting came about, and how to check it

This folder belongs to [ADR 0046](../../docs/adr/0046-the-mean-window-of-the-jones-model.md). The first part of this
page tells in plain words how the setting came about. The rest is a reference: one command for each check.

## The story in one page

**The question.** In each step the trail map spreads: every cell takes the mean of the cells around it. Jones 2010
takes the mean of 3 × 3 cells, and so did this app. Jones' later papers take a larger square: 5 × 5 as a rule, and
15 × 15 for a field between electrodes. Two planned pieces of work need that: a tool for electrodes and a scene with
Voronoi cells. So the app needs the larger square.

**Step 1: the rule.** The setting Mean window gives the side of the square: 3, 5, 7, 9, 11, 13 or 15 cells. Only the
Jones model has it, and 3 is the default, so every scene runs as before. The larger square has the same rules as the
small one at the edges: a cell outside a closed arena counts as 0, and the sum is always divided by the number of
cells of the square. A wall of the Jones model is a normal cell of the map, as before.

**Step 2: the way to compute it.** A square of 15 × 15 cells has 225 cells. The app does not read 225 cells for each
cell. It first sums 15 cells along the row, for every cell. Then it sums 15 of those sums along the column. That is
the same sum, with 30 reads. A reference on the CPU computes the square both ways and finds the same numbers. The
tests compare both backends with the square as the papers state it, for 3, 5 and 15 cells, in a periodic grid, a box
and a dish with walls.

**Step 3: what it costs.** With the window of 3 the code runs the pass of before, and every scene keeps its bytes:
the digests of the default settings and of all 22 scenes on both backends are those of `main`. A larger window costs time: on a grid of
1024 × 1024 cells a step takes 1.3 to 1.4 times as long on WebGPU and 1.2 to 1.6 times on WebGL2. It needs no
memory for the simulation. Only the view of a scene that moves first needs one more pair of textures, 24 bytes per
cell, which the app counts when it fits the grid to the memory.

**What it does not do.** The extended model keeps 3 × 3. Its walls take in the trail, and a wide window would carry
trail across a thin wall. Its Scent reach is a formula for 3 × 3. Both would need new work.

**What is not exact.** The time was measured on one machine (M3 Pro), while other programs of the owner ran (load
about 4.5), but no other GPU test. No scene uses a larger window yet, so no result of a paper was compared.

## The reference

### What you need

Node 26 and the packages of the repository (`npm ci`), and the browser of the tests (`npx playwright install
chromium`).

### The logs

The 23 logs are one archive, `logs.tar.gz`. Unpack it to `research/mean-window/logs/`, which git ignores:

```bash
node --import ./research/flow/register.mjs research/mean-window/logs.ts unpack
```

`list` shows what the archive holds, and `pack` packs the folder again after a new measurement.

| Files                        | What                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `logs/bench/w*-r*.jsonl`     | the time of a step of Transport network, 200 × 200 cells, three rounds  |
| `logs/bench/big*-r*.jsonl`   | the same on a lattice of 1024 × 1024 cells                              |
| `logs/bench/turns-*.txt`     | the times, the load and the other test runs of each round               |
| `logs/digest/digest-*.jsonl` | the digests of every scene after 500 steps, `main` (`a9afdf4`) and here |
| `logs/mutations.txt`         | the tests that fail for each of the 26 wrong rules `B1` to `B26`        |

### Step 2: the tests

The reference on the CPU against itself (1 second), and both backends against it (10 seconds):

```bash
npx vitest run --project unit src/engine/diffuse-reference.test.ts
npx vitest run --project gpu src/engine/sim.gpu.test.ts -t "mean window"
```

The 26 wrong rules (5 minutes). Each block must name at least one test that fails:

```bash
node --import ./research/flow/register.mjs research/flow/engine/mutate.ts $(seq -f "B%g" 1 26)
```

### Step 3: the bytes of the scenes

On `main` and on the branch, about 80 seconds each, then the comparison. It must print that all 46 runs are equal:

```bash
VITE_NAME=digest-branch npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
node --import ./research/flow/register.mjs research/flow/summary.ts digests research/flow/out/engine/digest-branch.jsonl research/mean-window/logs/digest/digest-main.jsonl
```

On another GPU make the digests of `main` on that machine too (`research/flow/README.md`, part 6).

### Step 3: the time of a step

The scene Transport network (Jones model, moving first) with the windows 3, 5 and 15 in turns, three rounds, on its
lattice and on a lattice of 1024 × 1024 cells (4 minutes). Run it while no other GPU work runs:

```bash
export VITE_SCENES=network VITE_FLOWS=off
research/flow/engine/turns.sh 3 "w3=$PWD:w3" "w5=$PWD:w5" "w15=$PWD:w15"
VITE_PATCH='{"lattice":[1024,1024]}' research/flow/engine/turns.sh 3 "big3=$PWD:w3" "big5=$PWD:w5" "big15=$PWD:w15"
node --import ./research/flow/register.mjs research/mean-window/tables.ts research/flow/out/engine
```

The last command prints the table of the ADR; without a folder it reads the logs of the record.
`research.test.ts` checks the record with every `npm test`: it unpacks the archive, makes the table, and compares it
with the table of the ADR.
