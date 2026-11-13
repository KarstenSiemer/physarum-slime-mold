# A child at the corner of a wall: how the decision came about, and how to check it

This folder belongs to the amendment of 2026-11-13 of
[ADR 0025](../../docs/adr/0025-growth-and-shrinkage.md#amendment-2026-11-13-no-child-between-two-walls-that-touch-at-a-corner). The
first part of this page tells in plain words how the decision came about. The rest is a reference: one command for
each step, for the day when you want to run a step again.

## The story in one page

**The question.** A wall stops an agent also where two wall cells touch only at their corners: a move checks both
cells beside a corner that it passes. The growth rule had no such check. A parent took any free cell of the 3 × 3
cells around it, also the diagonal cell between two such wall cells. So the children could cross a wall that the
agents cannot cross. A reading of the code for `docs/model.md` found this on 2026-11-13. Jones' papers do not say how
a child treats the corner of a wall.

**Step 1: show it.** A GPU test builds walls of single cells that touch only at their corners: one diagonal line in a
box, two on the periodic grid. A colony starts on one side and grows for 30 steps. On `main`, 459 to 496 agents then
lie on the other side, on both backends. No move can get there, so they are children placed across a corner, and
their descendants. This test fails on `main` and passes with the fix.

**Step 2: a first rule, and what it cost.** The brief proposed: a diagonal cell is free only if neither cell beside
the corner is a wall, because a move from the centre of one cell to the centre of the other passes exactly through
the corner and would touch both. I built that first and measured it on the two scenes with growth, with the seeds of
their records. The Foraging maze still found its far food in 10 of 10 seeds. But the Tokyo colony started more
slowly: at step 1,000 it had 11 % fewer agents and had joined all 33 food sources in 1 seed of 10, against 5.

**Step 3: why.** A count of the walls of every scene showed it. No scene has a single corner where two wall cells
touch with open cells on both sides: the gap that the test shows occurs only where a person paints it. But the coast
of the Tokyo map has 815 corners of one wall cell, and the maze 18 to 23. At such a corner the first rule blocked the
child, although a move from another point of the parent's cell passes the corner through the free cell, as the real
plasmodium flows around an obstacle. The move rule counts both cells at a corner for a numerical reason: float32
rounding decides which cell a walk enters, so each one must block. That is a rule for one segment, not for a cell.

**Step 4: the rule now.** A diagonal cell is free unless both cells beside the corner are walls. The child goes only
where a move from the parent's cell can go. This closes the gap and changes nothing else: every scene keeps its
bytes, checked with digests after 500 and 15,000 steps, and it follows from the count of the walls. The WebGPU
shader, the WebGL2 shader and the CPU copy for the tests have the same rule. A unit test pins both sides of it, and
the GPU test against the CPU copy has walls with both kinds of corner.

**What is not exact.** The first rule ran on WebGL2 for 16 runs of the maze only: those runs stopped once the second
rule kept every byte. The time of a step is in the ADR.

**A second look.** The harness of the Foraging maze was a scratch file of an earlier session. Put into this folder, it
gives the lines of that session's record byte for byte on `main`: the table of ADR 0027 comes from the same code.

## What is in this folder, and what you need to read

| File                | What it is                                                                                     | Read it?                   |
| ------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| `README.md`         | this page                                                                                      | yes                        |
| `walls.gpu.test.ts` | counts the two kinds of corner in the walls of every scene (step 3)                            | only to run a step again   |
| `maze.gpu.test.ts`  | the harness of the Foraging maze: 15,000 steps per seed, the flood fill every 100 steps        | only to run a step again   |
| `tables.ts`         | makes the table of the ADR from the lines of the harness, and compares a rerun with the record | only to run a step again   |
| `research.test.ts`  | a unit test: the table of the ADR is the one that `tables.ts` makes from the logs              | no                         |
| `logs.ts`           | unpacks and packs the archive of the logs                                                      | no                         |
| `logs.tar.gz`       | the logs of the record, one archive (below)                                                    | no; `tables.ts` reads them |

The Tokyo scene, its measures and the digests of the scenes use the scripts of
[`research/flow`](../flow/README.md): `engine/dump.gpu.test.ts`, `engine/measure-tokyo.ts`, `summary.ts` and
`engine/digest.gpu.test.ts`.

## The commands

Every command runs from the root of the repository, after `npm ci`. A run of the real engine is a test file in a
headless browser. It runs only with the configuration `research/vitest.config.ts`, so `npm test` never starts one.

Three versions of the code take part: `main` (`7d3a5ee`), the rejected rule "either wall blocks" (`91907bc`, the first
version of this branch) and the chosen rule (this branch). To measure them side by side, check out each one in a
folder of its own (`git worktree add`) and run the commands in each. A version without this folder needs
`maze.gpu.test.ts` copied into it. Two runs at the same time need two ports: add `--api.port=5942 --api.strictPort`
with a port of their own. `91907bc` is a commit of the branch of this pull request; GitHub keeps it after the squash
merge (`git fetch origin pull/54/head`).

### 1. The test that shows the gap

```bash
npx vitest run --project gpu src/engine/sim.gpu.test.ts -t "places no child across the corner"
```

With the fix: 4 tests pass (box and periodic grid, WebGPU and WebGL2). On `main` with the test file of this branch all
4 fail, with 459 to 496 agents on the other side of the wall; the test against the CPU copy fails there too. The record
is `logs/test-main-7d3a5ee.txt`.

### 2. The digests of every scene

```bash
VITE_NAME=digest-both npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

```bash
VITE_ONLY=foraging-maze,tokyo VITE_STEPS=15000 VITE_NAME=digest-both-15000 npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

Each writes `research/flow/out/engine/<name>.jsonl`: per backend and scene the SHA-256 of the agents, the trail, the
scent and the environment after 500 (or 15,000) steps from seed 12345. The record: `logs/digest-main-7d3a5ee*.jsonl`,
`logs/digest-both-ac234db*.jsonl` (the chosen rule; equal to `main` in every run) and `logs/digest-either-*.jsonl`
(the rejected rule, at `91907bc` and after the merge of `main`, `633d898`).

### 3. The corners in the walls

```bash
npx vitest run --config research/vitest.config.ts research/corner/walls.gpu.test.ts
```

It writes `research/corner/out/walls.jsonl` (12 s): per scene and screen the wall cells, the gaps (two wall cells at a
corner) and the corners of one wall cell. The record is `logs/walls.jsonl`: 0 gaps everywhere.

### 4. The Foraging maze

One flow on one backend, 30 runs (three screens, seeds 1 to 10), 4 to 15 minutes:

```bash
VITE_MZ_KIND=webgpu VITE_MZ_FLOW=start VITE_MZ_LABEL=either-start npx vitest run --config research/vitest.config.ts research/corner/maze.gpu.test.ts
```

`VITE_MZ_FLOW` is `start`, `inoc100` or `inoc1000`, `VITE_MZ_KIND` is `webgpu` or `webgl2`, and the label is
`main-<flow>` or `either-<flow>`. Each run writes `research/corner/out/<label>-<kind>.txt`, one line per screen and
seed. The table of the ADR, from the files of `main` and of the rejected rule in one folder:

```bash
node --import ./research/flow/register.mjs research/corner/tables.ts maze research/corner/logs/maze
```

To compare a rerun with the record (exit code 1 if a line differs):

```bash
node --import ./research/flow/register.mjs research/corner/tables.ts same research/corner/logs/maze research/corner/out
```

### 5. The Tokyo scene

As in [`research/flow`](../flow/README.md), part 6, for seeds 1 to 10 (4 minutes each without other load):

```bash
VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=1 VITE_STEPS=500,1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_NAME=either-tk-i1.4-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts either-tk-i1.4-s1 1.5 99999
```

The lines of all seeds in one file, without the lines of step 500, give the tables:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo research/corner/logs/tokyo/either-tokyo-flux1.4.txt
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo-end research/corner/logs/tokyo/either-tokyo-flux1.4.txt
```

The record of `main` is `logs/engine/tokyo-flux1.4.txt` of `research/flow`.

### 6. The time of a step

```bash
VITE_SCENES=foraging-maze,tokyo VITE_NAME=bench-both-1 npx vitest run --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts
```

Run it in turn in `main` and in this branch, twice each. The record is `logs/bench-*.jsonl`.

## The logs

The logs are one archive, `logs.tar.gz`. To unpack it into `research/corner/logs/` (git ignores that folder), and to
pack that folder again after a new campaign:

```bash
node --import ./research/flow/register.mjs research/corner/logs.ts unpack
```

```bash
node --import ./research/flow/register.mjs research/corner/logs.ts pack
```

`tar -xzf research/corner/logs.tar.gz -C research/corner` unpacks it too. The unit test holds a digest of the archive,
so a new archive asks for the new digest. Made on 2026-11-13 on an M3 Pro (Chromium, Metal), while other work ran on
the machine. The lines of `main` in `logs/maze/` equal the record behind the table of ADR 0027 byte for byte (all 90
WebGPU runs and the 16 WebGL2 runs of `main-start-webgl2-partial.txt`). The two files `*-start-webgl2-partial.txt`
hold the runs on WebGL2 that ran before they were stopped.
