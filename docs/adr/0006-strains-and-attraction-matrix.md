# 0006: Strains with an attraction matrix

- Status: accepted
- Date: 2026-11-08

## Context

The user wants several strains placed next to each other, each with its own color and
behaviour. Jones models one population. Fogleman's Go version runs 2–5 species: each species
deposits into its own grid and senses `Σ_i table[c][i] · trail_i`
([variants](../knowledge-base/variants.md#michael-fogleman-2020-go)). A negative weight is
chemorepulsion, which Jones shows gives Turing-like spots and stripes (Fig. 15–16).

## Options

1. One population only — misses the main request.
2. Unlimited strains — one texture fetch per strain per sensor, and a UI nobody can read.
3. **Up to 4 strains** in the four lanes of one `rgba32float` texel: one fetch per sensor,
   then `dot(trail, A[strain])`.

## Decision

Option 3. Each strain has its own color, population share, SA, SO, RA, step size, deposit,
decay, random-turn probability, food attraction and light avoidance. A 4 × 4 matrix `A` holds
how strongly strain _c_ follows the trail of strain _i_ (−2 … +2). Self = +1 is Jones'
chemoattraction, self = −1 is his chemorepulsion.

Fogleman's named presets are ported with exact values: his `RepulsionFactor r` becomes row
`[1, −r, −r, …]`, his kept fraction `DecayFactor` becomes `decay = 1 − DecayFactor`, and his
2-pass box blur becomes `diffusion passes = 2`.

## Consequences

- One code path for 1–4 strains; unused lanes have weight 0 and zero trail.
- More than 4 strains would need a second texture; not planned.
