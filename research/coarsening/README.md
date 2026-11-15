# The coarsening network: the app against a paper's model and against the organism

This folder belongs to [ADR 0045](../../docs/adr/0045-the-scene-coarsening-network.md). The first part tells in plain
words what was measured and what came out. The rest is a reference: the definitions, the numbers and one command for
each step.

The paper: W. Baumgarten, J. Jones and M. J. B. Hauser, "Network coarsening dynamics in a plasmodial slime mould:
modelling and experiments", Acta Physica Polonica B 46(6): 1201–1218, 2015,
[doi:10.5506/APhysPolB.46.1201](https://doi.org/10.5506/APhysPolB.46.1201). Page numbers here are the journal's.

## The story in one page

**The question.** `docs/fidelity.md` row 8 (network formation) compared the app only with Jones' figures. This paper
does two things at once. It films the vein network of a real plasmodium while the network coarsens, and it runs
Jones' model with stated values and measures it the same way. So one scene can be compared with both.

**The scene.** Coarsening network is the model of the paper (p. 1204 to 1206): 25,000 agents at random in a dish on
400 × 400 cells, sensor and rotation angle 67.5°, sensor distance 5, growth and shrinkage every 5 steps. The harness
runs it in the real engine on WebGPU, for the sensor distances 3 to 15 of the paper's Fig. 5, with 3 seeds each, until
the network has closed to a spot.

**What the app does.** The same as the paper's Fig. 2: a dense mesh within 100 steps, loops that close one by one, a
network that leaves the rim and shrinks, one last ring, and a spot. Every run of the 21 went this way.

**Against the paper's model.**

- _The coarsening time tc_ (the last branching point is gone, p. 1209). It falls with the sensor distance as in the
  paper, along the same law tc = γ / SO² + tc(0). But the app is slower: γ is 251,934 against 140,352, so the app needs
  1.6 to 1.7 times as long at the sensor distances 3 to 7 (11,400 ± 2,066 steps at 5; the paper names 6,850 for its
  one run). At 15 the two meet (2,250 against 2,046), and the offset tc(0) is the same (1,469 against 1,422).
- _The coverage ρ._ It falls, stays flat and rises again when the last ring closes, as in Fig. 4. Its value depends on
  the level above which a cell counts as a vein, and the paper names no level. At half a deposit ρ goes from 0.73 to a
  lowest value of 0.14 to 0.15 (the paper's text: about 0.7 to about 0.2; its Fig. 4, read by eye: 0.62 to 0.13). At a
  quarter of a deposit it goes from 0.92 to 0.21.
- _The number of veins._ It falls fast at first and then more slowly, as in the paper (p. 1211). At sensor distance 7
  the two rates are 22.2 and 5.4 per tmax (the paper: 31.25 and 6.25).
- _Length against number_ (Eq. 8): the exponent β is −0.38 at sensor distance 7 (−0.36 to −0.40 over all distances;
  the paper's model: −0.41).
- _Width and degree._ The mean width of a vein stays the same over the whole run (8.8 cells at a quarter of a deposit),
  as in the paper. 99 % of the junctions join three veins and about 1 % four. The paper saw up to five.

**Against the organism.** These are the paper's own measurements of _Physarum polycephalum_ (p. 1206 to 1216).

- The coverage of the organism falls to about 0.2 and stays there. The app's lowest value lies at 0.14 to 0.28, by the
  level. Unlike the organism, the app's ρ rises at the end: its network closes to a spot, where the plasmodium walks
  out of the picture. The paper's model does the same as the app.
- The organism's junctions join three veins. The app: 99 %.
- β of the organism is −0.35. The app: −0.38.
- The organism loses veins at one rate, 7.69 per tmax. The app has two rates; its slow one is 5.1 to 6.3. The paper
  says that the fast one is the build-up of the veins from a random start, which the film of the organism does not
  hold.
- The widths of the organism's veins are log-normal: few thick veins and many thin ones. The app's veins all have one
  width, as in the paper's model. This is the main difference, and Jones' rules cannot give it. The flow in the tubes
  of the extended model makes veins of different widths; nobody has measured that against this paper.

**Why the app is slower.** Not known. Two things are ruled out or likely. The order of a step is not it: with move
first, as in the scenes of Jones 2010, tc is 13,100 ± 819 at sensor distance 5, no faster. The likely cause is the
update: Jones picks the agents one by one in random order, and an agent can step into a cell that another one just
left. The app moves all agents at once, and a cell that an agent leaves stays closed until the next step (ADR 0008).
In a crowded vein fewer agents move then. No run tests this: the app has no sequential update.

**What is not exact.**

- The paper gives no radius of its dish and no level for its vein mask. The dish is the app's (0.945 of the side). So
  the values of ρ compare only as a course, not digit by digit.
- The paper's numbers for tc at other sensor distances than 5 come from its fit (Eq. 4), not from a table.
- tc and tmax are read at the samples: every 25 steps up to step 500, every 50 up to 3,000, then every 100.
- The rates of the veins are slopes over few masks at the large sensor distances: at 15 the fast phase is over within
  about 190 steps, and its rate (2.0) says nothing.
- The distributions of the lengths and the widths (log-normal or not) are not measured, only their means.
- WebGPU only, 3 seeds. WebGL2 computes the same rules with other bytes; it was not run.

## Definitions

- **Vein mask.** A cell is a vein if its trail is above a level, in deposits (one deposit is 5). The record holds three
  levels: 0.125, 0.25 and 0.5. All counts of lacunae and veins use 0.25 (`LEVEL` in `measure.ts`): at 0.5 the last
  ring has gaps, so it would count as no ring; at 0.25, 20 of the 21 runs show the ring between tc and tmax. In the last one (SO 13, seed 2) the last two lacunae closed between two samples, so its tc is its tmax.
- **Coverage ρ = Av / Anet** (Eq. 2). Av: the cells of the mask. Anet: the area of the smallest circle around the
  centres of those cells, with half a cell added to its radius.
- **Lacuna.** A part of the rest of at least 20 cells that does not reach the edge of the lattice, as in ADR 0027.
- **tc.** The paper: the instant when all branching points are gone. Here: the first sample from which the mask holds
  at most one lacuna. With one lacuna the network is one ring.
- **tmax.** The paper: the network has collapsed to a point. Here: the first sample from which the mask holds no
  lacuna. A spot of about 30 agents then stays.
- **Veins.** The skeleton code of the Tokyo measures (`research/flow/prototype/tokyo.ts`: thinning, junctions, chains)
  gives a graph. `veins()` in `measure.ts` cuts loose ends off and joins the two links at a vertex with two ends. A
  vein is a link between two junctions; the degree of a junction is the number of vein ends at it. Junction pixels
  that touch are one junction, so two junctions side by side count as one of degree 4.
- **Rates.** N0 is the largest number of veins of a run. The rates are the slopes of ln(N / N0) over t / tmax before
  and after 0.06 (where the paper's model changes its rate) up to 0.6 (where its Fig. 6 ends).

## The numbers

The coarsening time of each sensor distance, 3 seeds each, against the paper's fit (Eq. 4, p. 1210). All counts at level 0.25.

| SO  | tc of the seeds        | tc, mean | paper, Eq. 4 | app / paper | tmax, mean | tc / tmax |
| --- | ---------------------- | -------- | ------------ | ----------- | ---------- | --------- |
| 3   | 30,000, 32,700, 25,600 | 29,433   | 17,017       | 1.73        | 34,567     | 0.85      |
| 5   | 11,100, 9,500, 13,600  | 11,400   | 7,036        | 1.62        | 15,300     | 0.75      |
| 7   | 7,600, 6,500, 7,400    | 7,167    | 4,286        | 1.67        | 8,533      | 0.84      |
| 9   | 4,700, 5,100, 3,600    | 4,467    | 3,155        | 1.42        | 5,900      | 0.76      |
| 11  | 3,500, 3,800, 3,600    | 3,633    | 2,582        | 1.41        | 4,367      | 0.83      |
| 13  | 2,450, 3,400, 3,000    | 2,950    | 2,252        | 1.31        | 3,467      | 0.85      |
| 15  | 1,950, 2,450, 2,350    | 2,250    | 2,046        | 1.10        | 3,100      | 0.73      |

The fit of the paper's law over the 21 runs:

```text
tc = 251,934 / SO² + 1,469 (R² 0.978, 21 runs); the paper: 140,352 / SO² + 1,422
```

Sensor distance 5: the coverage at each level, the lacunae and the agents alive, means of 3 seeds.

| Step            | ρ, level 0.125 | ρ, level 0.25 | ρ, level 0.5 | lacunae | agents |
| --------------- | -------------- | ------------- | ------------ | ------- | ------ |
| 25              | 0.98           | 0.92          | 0.73         | 136.3   | 26,754 |
| 200             | 0.74           | 0.62          | 0.48         | 178.7   | 22,192 |
| 1,000           | 0.48           | 0.39          | 0.29         | 63.3    | 11,012 |
| 2,500           | 0.35           | 0.28          | 0.20         | 24.0    | 5,931  |
| 5,000           | 0.30           | 0.24          | 0.17         | 9.7     | 3,250  |
| tc              | 0.31           | 0.25          | 0.18         | 1.0     | 819    |
| (tc + tmax) / 2 | 0.39           | 0.32          | 0.21         | 1.0     | 641    |

The lowest coverage of each seed up to its tc, and the coverage at tc:

```text
level 0.125: lowest ρ up to tc 0.28, 0.27, 0.27 at steps 6,200, 9,400, 10,900
level 0.25: lowest ρ up to tc 0.22, 0.21, 0.22 at steps 6,100, 9,400, 11,900
level 0.5: lowest ρ up to tc 0.15, 0.14, 0.15 at steps 6,200, 9,400, 11,600
ρ at tc, level 0.125 / 0.25 / 0.5: 0.31 / 0.25 / 0.18
```

The veins of each sensor distance: the largest count N0 and its step, the two rates per tmax, β, and the junctions of all masks by their degree. The paper's model at sensor distance 7: rates 31.25 and 6.25, β −0.41, degrees up to 5. The organism: one rate of 7.69, β −0.35, degree 3.

| SO  | N0    | at step | rate before 0.06 | rate after 0.06 | before / after | β     | degree 3 | degree 4 | higher |
| --- | ----- | ------- | ---------------- | --------------- | -------------- | ----- | -------- | -------- | ------ |
| 3   | 1,079 | 50      | 28.4             | 6.0             | 4.7            | -0.38 | 98.8 %   | 1.1 %    | 0.0 %  |
| 5   | 880   | 50      | 25.0             | 5.9             | 4.2            | -0.38 | 98.8 %   | 1.2 %    | 0.0 %  |
| 7   | 669   | 50      | 22.2             | 5.4             | 4.1            | -0.38 | 99.1 %   | 0.9 %    | 0.0 %  |
| 9   | 484   | 50      | 17.9             | 6.3             | 2.8            | -0.39 | 99.2 %   | 0.8 %    | 0.0 %  |
| 11  | 307   | 75      | 12.6             | 6.3             | 2.0            | -0.40 | 99.2 %   | 0.8 %    | 0.0 %  |
| 13  | 189   | 100     | 9.8              | 5.6             | 1.7            | -0.36 | 99.5 %   | 0.5 %    | 0.0 %  |
| 15  | 116   | 133     | 2.0              | 5.1             | 0.4            | -0.38 | 99.7 %   | 0.3 %    | 0.0 %  |

Sensor distance 7 over normalised time, means of 3 seeds:

| t / tmax           | 0.05 | 0.1  | 0.2  | 0.3  | 0.4  | 0.5  | 0.6  |
| ------------------ | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| veins              | 227  | 132  | 60   | 32   | 22   | 15   | 10   |
| mean length, cells | 23.0 | 28.4 | 38.3 | 50.7 | 57.7 | 69.3 | 72.0 |
| mean width, cells  | 8.85 | 8.77 | 8.83 | 8.79 | 8.83 | 8.84 | 8.94 |

The order of a step at sensor distance 5:

```text
SO 5, sense first (the scene): tc 11,400 ± 2,066; move first: tc 13,100 ± 819 (seeds 13,300, 12,200, 13,800)
```

## The commands

The campaign (a few minutes on an Apple M3 Pro; it writes the masks to `out/masks/`, about 90 MB):

```sh
VITE_CO_SO=3,5,7,9,11,13,15 VITE_CO_STEPS=120000 VITE_CO_MASKS=100 npx vitest run --config research/vitest.config.ts research/coarsening/coarsen.gpu.test.ts
VITE_CO_LABEL=order-webgpu VITE_CO_SO=5 VITE_CO_STEPS=120000 VITE_CO_PATCH='{"stepOrder":"move-first"}' npx vitest run --config research/vitest.config.ts research/coarsening/coarsen.gpu.test.ts
node --import ./research/flow/register.mjs research/coarsening/veins.ts coarsen-webgpu
node --import ./research/flow/register.mjs research/coarsening/tables.ts research/coarsening/out
```

The first command ran twice on 2026-11-15, at commit `b93584e` plus this branch: the two files were equal byte for
byte. The record:

```sh
node --import ./research/flow/register.mjs research/coarsening/logs.ts          # unpacks logs.tar.gz to logs/
node --import ./research/flow/register.mjs research/coarsening/tables.ts        # the tables above, from logs/
node --import ./research/flow/register.mjs research/coarsening/logs.ts pack     # after a new campaign
```

A picture of a dump (`VITE_CO_TRAILS=300,1650` writes trails to `out/trails/`):

```sh
node --import ./research/flow/register.mjs research/coarsening/picture.ts research/coarsening/out/trails/<file> --level=0.25
```

## The files

| File                  | What it is                                                                          |
| --------------------- | ----------------------------------------------------------------------------------- |
| `coarsen.gpu.test.ts` | the harness: runs the scene in the real engine and writes one line per sample       |
| `measure.ts`          | the vein mask, the smallest circle, the coverage, the lacunae, the veins of a graph |
| `veins.ts`            | the graph of each mask: veins, mean length, degrees                                 |
| `tables.ts`           | the tables of this page from the logs                                               |
| `picture.ts`          | a PNG of a dumped trail or mask                                                     |
| `research.test.ts`    | a unit test: the measures on known shapes, the tables of this page, the archive     |
| `logs.ts`             | unpacks and packs the archive                                                       |
| `logs.tar.gz`         | the record: the lines of the campaign, of the veins and of the run with move first  |

The masks themselves are not in the archive (about 90 MB). The harness gives the same bytes again for the same seed on the
same GPU, and `veins.ts` makes the lines of the veins from them.
