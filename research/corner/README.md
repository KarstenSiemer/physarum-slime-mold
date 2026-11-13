# A child at the corner of a wall: how the decision came about, and how to check it

This folder belongs to the amendment of 2026-11-13 of
[ADR 0025](../../docs/adr/0025-growth-and-shrinkage.md#amendment-2026-11-13-no-child-past-the-corner-of-a-wall). The
first part of this page tells in plain words how the decision came about. The rest is a reference: one command for
each step, for the day when you want to run a step again.

## The story in one page

**The question.** A wall stops an agent also where two wall cells touch only at their corners: a move checks both
cells beside a corner that it passes. The growth rule had no such check. A parent took any free cell of the 3 × 3
cells around it, also a diagonal cell on the other side of such a corner. So the children could cross a wall that the
agents cannot cross. A reading of the code for `docs/model.md` found this on 2026-11-13. Jones' papers do not say how
a child treats the corner of a wall.

**Step 1: show it.** A GPU test builds walls of single cells that touch only at their corners: one diagonal line in a
box, two on the periodic grid. A colony starts on one side and grows for 30 steps. On `main`, 459 to 496 agents then
lie on the other side, on both backends. No move can get there, so they are children placed across a corner, and
their descendants. This test fails on `main` and passes with the fix.

**Step 2: choose the rule.** The rule picks a cell, not a position: the child gets its position later, from the dead
agent that takes the birth. The only way that two cells define is the way between their centres. Into a diagonal
cell, that way passes exactly through the corner, and a move on it is blocked if either cell beside the corner is a
wall. So the rule now is: a diagonal cell is free only if neither cell beside the corner is a wall. A looser rule
(only two walls together block) and a rule with the child's own position were rejected; the ADR gives the reasons.

**Step 3: the same rule in three copies.** The WebGPU shader, the WebGL2 shader and the CPU copy for the tests got the
same change. The test that compares the GPU with the CPU copy now also has lines of single wall cells where the colony
grows. Both backends equal the CPU copy. Without the rule in the CPU copy, that test fails.

**Step 4: what changes in the scenes.** Only the two scenes with growth have walls near the colony: the Foraging maze
and the Tokyo rail network (its coast). After 500 steps, 33 of 36 digests (the default settings and 17 scenes, two backends) are equal; the
other three are these two scenes. Then both scenes ran again with the seeds of their records:

RESULTS

**What is not exact.** The time of a step was not measured (the ADR says why). The Tokyo scene on WebGL2 has two seeds
only, as in its record.

**A second look.** The harness of the Foraging maze was a scratch file of an earlier session. Put into this folder, it
gives the lines of that session's record byte for byte on `main`: the table of ADR 0027 comes from the same code.

## What is in this folder, and what you need to read

| File               | What it is                                                                                     | Read it?                   |
| ------------------ | ---------------------------------------------------------------------------------------------- | -------------------------- |
| `README.md`        | this page                                                                                      | yes                        |
| `maze.gpu.test.ts` | the harness of the Foraging maze: 15,000 steps per seed, the flood fill every 100 steps        | only to run a step again   |
| `tables.ts`        | makes the table of the ADR from the lines of the harness, and compares a rerun with the record | only to run a step again   |
| `research.test.ts` | a unit test: the table of the ADR is the one that `tables.ts` makes from the logs              | no                         |
| `logs.ts`          | unpacks and packs the archive of the logs                                                      | no                         |
| `logs.tar.gz`      | the logs of the record, one archive (below)                                                    | no; `tables.ts` reads them |

The Tokyo scene, its measures and the digests of the scenes use the scripts of
[`research/flow`](../flow/README.md): `engine/dump.gpu.test.ts`, `engine/measure-tokyo.ts`, `engine/measure-maze.ts`,
`summary.ts` and `engine/digest.gpu.test.ts`.

## The commands

Every command runs from the root of the repository, after `npm ci`. A run of the real engine is a test file in a
headless browser. It runs only with the configuration `research/vitest.config.ts`, so `npm test` never starts one.

To measure `main` and the fix side by side, check out each one in a folder of its own (`git worktree add`), and run
the commands in both. A run of `main` needs `maze.gpu.test.ts` copied into its folder. Two runs at the same time need
two ports: add `--api.port=5942 --api.strictPort` with a port of their own.

### 1. The test that shows the gap

```bash
npx vitest run --project gpu src/engine/sim.gpu.test.ts -t "places no child across the corner"
```

With the fix: 4 tests pass (box and periodic grid, WebGPU and WebGL2). On `main` (`7d3a5ee`, with the test file of this
branch) all 4 fail, with 459 to 496 agents on the other side of the wall.

### 2. The digests of every scene

```bash
VITE_NAME=digest-fix npx vitest run --config research/vitest.config.ts research/flow/engine/digest.gpu.test.ts
```

It writes `research/flow/out/engine/digest-fix.jsonl`: per backend and scene the SHA-256 of the agents, the trail, the
scent and the environment after 500 steps from seed 12345. The record is `logs/digest-main.jsonl` and
`logs/digest-fix.jsonl`.

### 3. The Foraging maze

One flow on one backend, 30 runs (three screens, seeds 1 to 10), 4 to 15 minutes:

```bash
VITE_MZ_KIND=webgpu VITE_MZ_FLOW=start VITE_MZ_LABEL=fix-start npx vitest run --config research/vitest.config.ts research/corner/maze.gpu.test.ts
```

`VITE_MZ_FLOW` is `start`, `inoc100` or `inoc1000`, `VITE_MZ_KIND` is `webgpu` or `webgl2`, and the label is
`main-<flow>` or `fix-<flow>`. Each run writes `research/corner/out/<label>-<kind>.txt`, one line per screen and seed.
The table of the ADR, from the 12 files of both checkouts in one folder:

```bash
node --import ./research/flow/register.mjs research/corner/tables.ts maze research/corner/logs/maze
```

To compare a rerun with the record (exit code 1 if a line differs):

```bash
node --import ./research/flow/register.mjs research/corner/tables.ts same research/corner/logs/maze research/corner/out
```

### 4. The Tokyo scene

As in [`research/flow`](../flow/README.md), part 6, for seeds 1 to 10 (4 minutes each without other load):

```bash
VITE_SCENE=tokyo VITE_I0=1.4 VITE_SEED=1 VITE_STEPS=500,1000,2000,4000,8000,12000,16000,24000,32000,40000,48000 VITE_NAME=fix-tk-i1.4-s1 npx vitest run --config research/vitest.config.ts research/flow/engine/dump.gpu.test.ts
```

```bash
node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts fix-tk-i1.4-s1 1.5 99999
```

The lines of all seeds in one file give the tables:

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo research/corner/logs/tokyo/fix-tokyo-flux1.4.txt
```

```bash
node --import ./research/flow/register.mjs research/flow/summary.ts engine-tokyo-end research/corner/logs/tokyo/fix-tokyo-flux1.4.txt
```

The two seeds on WebGL2 are the same command with `VITE_KIND=webgl2`, `VITE_STEPS=2000,4000,8000,12000,16000,24000`
and the name `fix-tkgl-i1.4-s1`. The Foraging maze with the flow on (ADR 0029, flux 8) is
`VITE_SCENE=foraging-maze VITE_FLOW=1 VITE_I0=8 VITE_STEPS=1000,2000,3000,4000,6000,8000,12000` with the name
`fix-fm-s1`, measured with `research/flow/engine/measure-maze.ts fix-fm-s1`.

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
so a new archive asks for the new digest.

LOGS
