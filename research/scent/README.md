# The reach of the scent: how the setting came about, and how to check it

This folder belongs to the amendment of 2026-11-14 of
[ADR 0036](../../docs/adr/0036-the-reach-of-the-food-scent-as-a-setting.md#amendment-2026-11-14-scent-reach-as-built).
The first part of this page tells in plain words how the setting came about. The rest is a reference: one command for
each step, for the day when you want to run a step again.

## The story in one page

**The question.** The owner wanted to set the radius of the scent of food in the panel. In the extended model the
setting Scent decay decides how far the scent spreads: the fraction of the scent that disappears in each step. A
radius in cells is easier to read. But a scent has no edge: it only gets weaker with the distance. So the setting
needs a distance that means one thing, and a way to turn it into a decay.

**Step 1: the theory.** In each step the scent spreads through 3 × 3 mean filters, as many as the diffusion passes
say, and a part of it decays. Once the scent no longer changes, it falls off in a fixed way. Beside a long line of
food it falls by the same factor from cell to cell, e^κ. The factor follows from the decay and the passes alone:
cosh κ = (3 (1 − d)^(−1/p) − 1) / 2. Around a small dab the scent falls faster, because it spreads in all directions.

**Step 2: the measurement.** A test of the real engine paints one food on an empty box, with no live agent, runs
until the scent no longer changes, and reads it along the axes. Once with a line of food across the box, once with a
dab of radius 3 cells; scent decays from 0.3 to 0.0003; 1, 2 and 4 passes. Beside the line the measured fall-off
agrees with the formula within 0.5 %, down to a decay of 0.001. Below that the box is too small for many passes. The
dab gives the same table on WebGPU and on WebGL2.

**Step 3: the setting.** Scent reach is the distance over which the scent beside a long food falls to a tenth: ln(10)
/ κ. One pass gives 4 cells at a decay of 0.1 and 24 cells at 0.003. The panel shows it under Scent decay, and the two
move together. It is no setting of its own, so a scene and a link keep their bytes.

**What it does not change.** A longer reach widens the scent. The measurements of ADR 0009 found that food steers
agents only up to about 12 to 14 cells, at every decay: a scent that reaches farther is also flatter. The help of the
setting says so, and it names Trail saturation, which lets food steer agents from farther away (ADR 0022).

**What is not exact.** The measurement ran on one machine (M3 Pro). The dab's table does not test a dab of another
size. The steering reach was not measured again here.

## The reference

### What you need

Node 26 and the packages of the repository (`npm ci`), and the browser of the tests (`npx playwright install
chromium`).

### The logs

The three logs are one archive, `logs.tar.gz`. Unpack it to `research/scent/logs/`, which git ignores:

```bash
node --import ./research/flow/register.mjs research/scent/logs.ts unpack
```

`list` shows what the archive holds, and `pack` packs the folder again after a new measurement.

### Step 2: measure the scent

The dab, on both backends, about 2 minutes each (M3 Pro):

```bash
VITE_KIND=webgpu VITE_NAME=profile-webgpu npx vitest run --config research/vitest.config.ts research/scent/profile.gpu.test.ts
VITE_KIND=webgl2 VITE_NAME=profile-webgl2 npx vitest run --config research/vitest.config.ts research/scent/profile.gpu.test.ts
```

The line of food, about 2 minutes:

```bash
VITE_KIND=webgpu VITE_LINE=1 VITE_NAME=line-webgpu npx vitest run --config research/vitest.config.ts research/scent/profile.gpu.test.ts
```

Each run writes one line per setting to `research/scent/logs/<name>.jsonl`. `VITE_DECAYS`, `VITE_PASSES`,
`VITE_RADIUS` and `VITE_SIDE` change the settings (the head of `profile.gpu.test.ts`).

### Step 3: the tables

```bash
node --import ./research/flow/register.mjs research/scent/reach.ts research/scent/logs/line-webgpu.jsonl
node --import ./research/flow/register.mjs research/scent/reach.ts research/scent/logs/profile-webgpu.jsonl
```

You must see the tables of the amendment of ADR 0036. `research.test.ts` checks it with every `npm test`: it unpacks
the archive, makes the tables, and finds each row of the ADR in them.

### The files

| File                  | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `profile.gpu.test.ts` | measures the scent of one food in the real engine |
| `reach.ts`            | turns the logs into the tables of the ADR         |
| `research.test.ts`    | checks the tables of the ADR against the archive  |
| `logs.ts`             | unpacks and packs the archive                     |
| `logs.tar.gz`         | the three logs of the measurement of 2026-11-14   |
