# Model variants after Jones (2010)

## Sage Jenson (2019)

Source: <https://cargocollective.com/sagejenson/physarum> (read 2026-11-08).

- Implementation: C++ + GLSL (openFrameworks). Agents and trail map live on the GPU.
  Real-time with **5–10 million particles** on a GTX 1070.
- Six sub-steps per tick (own diagram on the page):
  1. **Sense** — three sensors at _sensor distance_ and _sensor angle_.
  2. **Rotate** — front highest: no change; both sides higher: turn randomly;
     right higher: turn right; left higher: turn left.
  3. **Move** — along heading φ.
  4. **Deposit** — onto trail map.
  5. **Diffuse** — 3 × 3 mean filter.
  6. **Decay** — multiply by a decay factor.
- Differences to Jones: **no collision step** (several agents per cell allowed). Jenson notes
  that collisions approximate conservation of matter and are needed for exact Physarum mimicry,
  but preferred the patterns without them.
- Configurable: sensor distance, sensor size, sensor angle, step size, rotation angle,
  deposition amount, decay factor, deposit size, diffuse size.
- Extra: **contagion** — infected particles lay an infected trail that spreads to others and
  changes simulation properties.
- Look: white filaments on black, thin sharp lines, high particle counts.

## Michael Fogleman (2020), Go

Source: `/Users/karstensiemer/git/KarstenSiemer/physarum` (MIT, © 2020 Michael Fogleman).

Step order (`pkg/physarum/model.go:60-159`):

1. **Combine grids**: for each species `c`, `sensed_c = Σ_i table[c][i] · trail_i`
   (`model.go:120-132`). Self weight ≈ N(+1, 0.25), others ≈ N(−1, 0.25)
   (`config.go:22-25`, `config.go:67-84`). This is the **multi-species attraction/repulsion
   table**.
2. **Move particles** (parallel): sense `sensed_c` at C, L = heading − SA, R = heading + SA
   (`model.go:74-82`), rotate, move by step distance, wrap at edges (`model.go:84-88`).
   Rule (`model.go:170-181`): C > L and C > R → 0; C < L and C < R → random ±1;
   L < R → +1; R < L → −1; else 0. Same as Jones.
3. **Deposit, blur, decay** per species: nearest-cell deposit (`grid.go:41-43`; commit
   `29ce595` "don't do bilinear add (causes biases)"), then box blur radius 1 with 2 passes,
   the last pass multiplied by `DecayFactor` (`grid.go:45-56`, `blur.go:79-82`).

Conventions that differ from Jones:

- `DecayFactor` is the **fraction kept** (`trail' = blur(trail) · DecayFactor`, default 0.1,
  `config.go:19-20`). Jones' `decayT` is the fraction removed: `decayT = 1 − DecayFactor`.
- No collisions; `1 << 22` particles on a 1024² grid (4 per cell) for stills
  (`run.go:10-18`), `1 << 20` on 512² in the viewer (`cmd/viewer/main.go:18-28`).
- Grid initialised with uniform noise in [0, 1) (`grid.go:21-23`); agents uniform random with
  random heading (`model.go:44-58`).
- Random config ranges (`config.go:8-26`): SA 0–120°, SD 0–64, RA 0–120°, step 0.2–2,
  deposit 5, decay 0.1.
- Speed trick: 65 536-entry sin/cos tables (`trig.go`). Not needed on GPU.

Rendering (`image.go:13-85`, `cmd/viewer/main.go:135-175`):

- One color per species from 5-color palettes (`palette.go:31-88`), shuffled.
- Per species: normalise to [min, max], clamp, gamma 1/2.2, multiply by species color,
  **add** all species, clamp to 255.
- Auto level: max = 1.5 × 99.9th percentile (`image.go:20-31`) or percentiles 0.1 %–99.9 %
  (`main.go:135-145`).

Named presets in `cmd/viewer/main.go:30-57` use **older struct layouts** (verified in git
history, commits `70bacad` and `9e98cd5`):

- 8 fields (before `70bacad`): `{PopulationPercentage, SensorAngle, SensorDistance,
RotationAngle, StepDistance, DepositionAmount, DecayFactor, RepulsionFactor}`.
  Agents per species = `w · h · PopulationPercentage` (so 4 means 4 agents per cell).
- 7 fields (`70bacad` to `9e98cd5`): the same without `PopulationPercentage`.
- `RepulsionFactor r` meant `sensed_c = trail_c − r · Σ_{i≠c} trail_i`
  (`git show 9e98cd5^:pkg/physarum/model.go`). As a table row: self 1, others −r.
- Angles are radians. Blur was radius 1, 2 passes, decay as multiplier.

| Preset   | Species | Agents/cell each | SA (rad)   | SD        | RA (rad)   | Step       | Dep | Keep       | r            |
| -------- | ------- | ---------------- | ---------- | --------- | ---------- | ---------- | --- | ---------- | ------------ |
| cyclones | A       | 4                | 0.87946403 | 42.838207 | 0.97047323 | 2.8447638  | 5   | 0.29681    | 1.4512       |
|          | B       | 4                | 1.7357124  | 17.430664 | 0.30490428 | 2.1706762  | 5   | 0.27878627 | 0.46232897   |
| dunes    | A       | 2                | 0.99931663 | 44.21652  | 1.9704952  | 1.4215798  | 5   | 0.1580779  | 0.7574965    |
|          | B       | 2                | 1.9694986  | 1.294038  | 0.5384646  | 1.1613986  | 5   | 0.21102181 | 1.5123861    |
| dot grid | A       | 1.3333334        | 1.3433642  | 49.39263  | 0.91616887 | 0.69644034 | 5   | 0.17888786 | 0.2036435    |
|          | B       | 1.3333334        | 0.0856143  | 1.6695175 | 1.8827246  | 2.3155663  | 5   | 0.14249614 | 0.0026361942 |
|          | C       | 1.3333334        | 0.7959472  | 33.977413 | 0.5246451  | 2.2891424  | 5   | 0.22549233 | 1.4248871    |

The 7-field presets "untitled" and "cool" have 5 species each (`main.go:44-56`); population
was then a global particle count split evenly.

## Comparison

| Aspect         | Jones 2010                 | Jenson 2019               | Fogleman 2020             |
| -------------- | -------------------------- | ------------------------- | ------------------------- |
| Platform       | CPU, 200²–500²             | GPU (GLSL), 5–10 M agents | CPU (Go), 1–4 M agents    |
| Collisions     | yes, 1 agent/cell          | no                        | no                        |
| Deposit        | only after successful move | always                    | always, nearest cell      |
| Diffusion      | 3 × 3 mean                 | 3 × 3 mean                | box blur r = 1, 2 passes  |
| Decay          | × (1 − decayT)             | × factor                  | × factor (kept fraction)  |
| Species        | 1                          | 1 (+ contagion)           | 2–5 with attraction table |
| Food/obstacles | yes                        | —                         | —                         |
