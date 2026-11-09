# Physarum: a slime mold simulator for the browser

An interactive simulation of the slime mold _Physarum polycephalum_. Millions of simple agents
leave trails and follow them, and transport networks appear: they connect food, flee light,
shrink, heal and compete. Everything runs on your graphics card, in the browser.

![Three strains weave their networks](docs/images/hero.jpg)

**Live:** <https://karstensiemer.github.io/physarum-slime-mold/>

## What you can do

- Place up to **four strains** side by side, give each a color and its own behaviour, and set
  how strongly each strain follows or flees the others.
- Change every parameter of the Jones (2010) model live: sensor angle, sensor distance,
  rotation angle, step size, deposit, decay, random turns, population, diffusion.
- Paint **food** (attracts), **light** (repels), **walls**, inoculate agents, or **cut** a
  wound and watch it heal.
- Run **experiments**: shortest path, Steiner tree, shrinking plasmodium and wound healing from
  the paper, plus light avoidance and a maze.
- Read what each scene shows: where its settings come from, what to watch, and why it uses them.
- Switch looks (glow, gel relief, paper, agents), pan and zoom, save a PNG, share the exact
  state as a link.
- Learn: the biology, the paper behind the model and its six steps, every control and every
  scene, with references.

| Steiner tree (Jones 2010, Fig. 19)       | Cyclones (Fogleman's two-species preset) |
| ---------------------------------------- | ---------------------------------------- |
| ![Steiner tree](docs/images/steiner.jpg) | ![Cyclones](docs/images/cyclones.jpg)    |

## How it works

Each agent has three forward sensors. Every step it senses the trail, turns toward the
strongest sensor (Jones' rule), moves, and deposits trail. The trail spreads to neighbor cells
and decays. Strong trails attract more agents, which strengthen the trail: a network forms.

- Simulation: WebGPU compute shaders (WGSL) with integer atomics; deterministic for a seed.
  Optional one-agent-per-cell rule as in the paper, with a deterministic GPU claim method.
- Fallback: a WebGL2 backend with the same model for browsers without WebGPU.
- Rendering: auto levels from a GPU histogram, glow (bloom), dithering against banding.

Details: [design](docs/design.md), [decisions (ADRs)](docs/adr/),
[knowledge base](docs/knowledge-base/) (paper notes, variants, GPU and GitHub Pages facts).

## Browser support

WebGPU in current Chrome, Edge, Safari 26+ and Firefox (Windows, Apple Silicon macOS). Other
browsers with WebGL2 (for example Firefox on Linux) use the fallback automatically. Force it
with `?backend=webgl2`.

## Keyboard

Space play/pause · `.` single step · R reset · 1–7 tools · `[` `]` brush size · F fit view ·
H hide panels · L learn

## Development

Requires Node 26 and npm 11.10 or later. Dependencies install without lifecycle scripts and
only after they are 3 days old (`.npmrc`).

```bash
npm ci
npx playwright install chromium
npm run dev          # http://localhost:5173
npm run verify       # lint, svelte-check, unit, GPU, build, e2e
npm run gallery      # renders every preset to test-results/gallery/
pre-commit install   # hooks for commit and push
```

Tests:

| Command            | What                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `npm test`         | unit tests (parameters, presets and their texts, URL parsing with fuzzing, packing, colors, levels) |
| `npm run test:gpu` | shaders compile; every model rule on **both** backends, mass balance, determinism, Fig. 10          |
| `npm run test:e2e` | the built app in Chromium: boot, WebGL2 fallback, tools, presets, keyboard, axe a11y scan           |

GPU tests use the real GPU locally and SwiftShader on GPU-less CI.

## Deployment

GitHub Actions builds, tests and deploys to GitHub Pages from `main`
([ADR 0018](docs/adr/0018-hosting-at-github-io.md)). One-time repository settings are in
`scripts/github-setup.sh`; Renovate needs a GitHub App ([ADR 0015](docs/adr/0015-renovate.md)).

## Credits

- Model: J. Jones, _Characteristics of Pattern Formation and Evolution in Approximations of
  Physarum Transport Networks_, Artificial Life 16(2): 127–153, 2010,
  [doi:10.1162/artl.2010.16.2.16202](https://doi.org/10.1162/artl.2010.16.2.16202).
- GPU approach and inspiration: [Sage Jenson](https://cargocollective.com/sagejenson/physarum).
- Multiple species and the presets Cyclones, Dunes and Dot grid:
  [Michael Fogleman](https://github.com/fogleman/physarum) (MIT).

## License

[MIT](LICENSE)
