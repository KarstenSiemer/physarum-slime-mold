# GPU techniques and model extensions

Research read on 2026-11-08 (sources linked). Items marked _unverified_ were not confirmed in a
primary source.

## Deposit on the GPU

- WGSL has no float atomics ([gpuweb#4894](https://github.com/gpuweb/gpuweb/issues/4894), open)
  and no texture atomics. Public implementations use integer `atomicAdd` into a storage buffer
  (fixed point), then add it to the trail in a per-cell pass:
  [vipinsudhakar/filament](https://github.com/vipinsudhakar/filament/tree/HEAD/src/engine)
  (MIT, TypeScript, up to 4 M agents, attraction matrix as `dot(trail, interaction[s])`),
  [StevenFAU/Bit-Physics](https://github.com/StevenFAU/Bit-Physics/tree/HEAD/packages/physarum/web/src/v2)
  (MIT, fused deposit+diffuse+decay, bit-identical trail over 5 000 steps).
- Our variant counts agents (`atomicAdd(1)`) and multiplies by the strain's deposit later
  (ADR 0005). Same determinism, no fixed-point scale to tune.
- Anti-patterns seen: plain read-modify-write deposit (loses deposits, nondeterministic);
  in-place blur of a `read_write` texture (workgroups read halo cells another group already
  updated).
- Optimisation found in Bit-Physics: counting sort of agents by 8 × 8 tile every 32 steps cut
  step time from 1.29 ms to 0.80 ms (self-reported). Built here: every 32 steps a counting sort by 8 × 8 tiles
  reorders the agents (ADR 0005, [design.md](../design.md)).

## One agent per cell on the GPU

- No public GPU Physarum implements Jones' occupancy rule (GitHub code and web search,
  2026-11-08).
- Established method for parallel agent conflicts: unique priorities written with
  `atomicMax`, priorities permuted every step to avoid bias. Yang, Andelfinger, Cai & Knoll,
  _SIGSIM-PADS '18_, doi [10.1145/3200921.3200940](https://doi.org/10.1145/3200921.3200940)
  ([pdf](https://philipp-andelfinger.net/pdfs/yang2018evaluation.pdf)). Push (claim) methods
  beat pull methods by far. This is what ADR 0008 does.

## Float accuracy

- WGSL guarantees `sin`/`cos` only to an absolute error of 2⁻¹¹ on [−π, π]
  ([WGSL spec](https://www.w3.org/TR/WGSL/)). `dir()` in `common.wgsl` reduces the angle first.
- Bit-exact results across GPU vendors are impossible with float math; tests compare
  invariants and tolerances across devices and bit-exact results only on one device.

## Rendering references

- Normalise by the steady-state level before the tone curve (Bit-Physics divides by
  `d·ρ·(1−α)/α`; our `equilibrium()` uses `deposit · density · share / decay`).
- Tone curves in use: `1 − e^(−x)` (filament), log + AgX (Bit-Physics), percentile + gamma
  (Fogleman).
- Bloom: quarter resolution with a soft knee (filament); dual filter (Bjørge, SIGGRAPH 2015).
- Relief: normals from central differences, Phong specular (SuboptimalEng/slime-sim-webgpu).
- Dither after sRGB encoding with a hash of (x, y, frame).
- HDR canvas: Chrome 129+, `configure({ format: 'rgba16float', toneMapping: { mode: 'extended' } })`
  ([Chrome blog](https://developer.chrome.com/blog/new-in-webgpu-129)).

## Extensions (not implemented, candidates for later)

Built since this list was made: growth and death (Jones 2011; ADR 0025), covered food (ADR 0022) and the flux model of
Tero et al. on the grid cells (ADR 0029). [model.md](../model.md) states the rules as they are now.

| Extension                             | Mechanism                                                                                                                      | Cost on GPU                    | Source                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adaptive sensing ("36 Points")        | `SD = SD0 + SDamp · s^SDexp · 250`, the same form for SA, RA and move distance; `s` = trail at the agent, kept in [0, 1]       | cheap                          | Jenson, sagejenson.com/36points; Bleuje, github.com/Bleuje/interactive-physarum. **Both CC BY-NC-SA 3.0: do not copy code or parameter tables into this MIT project.** |
| Food consumption, background nutrient | Food projection drops when agents cover it (built as covered food, ADR 0022); background 0.01 radial vs 0.001 dendritic growth | cheap                          | arXiv:1511.05869                                                                                                                                                       |
| Light per Jones                       | Sensor values × Ld (0.2) in lit cells; repellents as negative projection                                                       | cheap                          | Bioinspir. Biomim. 7:016009 (2012), arXiv:1212.0023                                                                                                                    |
| Oscillation, amoeboid movement        | Blocked agents keep heading and wait; reset probability pID 0.01–0.05; needs occupancy rule                                    | cheap with ADR 0008            | same 2012 paper                                                                                                                                                        |
| MCPM steering (Polyphorm)             | Compare forward vs one mutated direction, probabilistic choice                                                                 | cheaper than Jones (2 samples) | PolyPhy (MIT); Elek et al. _(citation unverified)_                                                                                                                     |

Our light model (a diffusing repellent field, ADR 0007) is a deliberate simplification of the
2012 mechanism: it gives a gradient outside the lit area, so agents retreat before they enter.
