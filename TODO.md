# TODO

Plan: [docs/design.md](docs/design.md). Decisions: [docs/adr/](docs/adr/). Sources:
[docs/knowledge-base/](docs/knowledge-base/). Mark items `[x]` only after they are verified.

## M0 Research and plan

- [x] Read Jones 2010 (all 28 pages, all figures) → `knowledge-base/jones-2010-model.md`
- [x] Read Fogleman Go repo incl. git history of preset formats → `knowledge-base/variants.md`
- [x] Read Sage Jenson's page and diagram → `knowledge-base/variants.md`
- [x] Verify WebGPU in headless Chromium (macOS Metal, Linux SwiftShader) → `knowledge-base/webgpu-platform.md`
- [x] Browser support matrix and fallback decision → ADR 0003
- [x] Extended models (36 Points, growth, MCPM) and GPU techniques → `knowledge-base/gpu-techniques-and-extensions.md`
- [x] Hosting, Renovate, CI hardening, pre-commit → ADRs 0011–0016
- [x] Audit/security skills research (report in session; install pending, see M5)
- [x] Design plan `docs/design.md`; ADRs 0001–0016

## M1 Scaffold and tooling

- [x] Vite 8 + Svelte 5 + TypeScript 6.0 (not 7: peer ranges of `typescript-eslint` and `svelte-check`)
- [x] ESLint (strict type-checked) + Prettier + `svelte-check`, strict `tsconfig`
- [x] Vitest unit (Node) and browser mode (Chromium + WebGPU)
- [x] Playwright e2e with platform WebGPU flags (verified on Metal and in a GPU-less Linux container)
- [x] `.pre-commit-config.yaml` (all hooks pass; installed for pre-commit and pre-push)
- [x] CI workflow, security workflow (zizmor, Scorecard), dependency review
- [x] Renovate config + self-hosted workflow (GitHub App setup is an owner step)
- [x] GitHub Pages deploy job (repository settings are an owner step: `scripts/github-setup.sh`)
- [x] `.claude/launch.json` for the in-app preview

## M2 Simulation core (WebGPU)

- [x] `model/params.ts` schema + `sanitize()` + fuzz tests
- [x] Device setup with raised limits; device-loss message
- [x] Init pass with 7 layouts; distinct cells in collision mode for the mixed layout
- [ ] Collision mode: every agent on a free cell from the first step, in every layout, also when it moves out of a wall or the dish, and without rounding into the next cell (`init.wgsl`, ADR 0008)
- [x] Agent pass (Jones rule), shrinkage, inoculate and cut tools
- [x] Diffuse pass (tiled 3 × 3 mean, passes, decay, walls, food and light scent)
- [x] Collision mode (claims, ADR 0008)
- [x] Brush pass (food, light, wall, erase)
- [x] GPU tests: compile, diffusion vs CPU, mass balance, every rule branch, walls, determinism, seeds, collisions, Fig. 10 scale law (Metal and SwiftShader)

## M3 Rendering

- [x] Glow, gel, paper and agents styles; dither; sRGB
- [x] Auto levels from a GPU histogram (black 65th, white 99th percentile)
- [x] Bloom (thresholded dual filter in trail space)
- [x] Overlays for food, light, walls; pan and zoom
- [ ] HDR canvas when supported (optional)

## M4 Interface

- [x] Panel, strain cards with live sensor diagram, attraction matrix, toolbar, stats
- [x] Presets (incl. exact Fogleman ports) and 6 experiments from the paper, verified in the gallery
- [x] Learn dialog (biology, six steps, controls, experiments, credits)
- [x] URL state (deflated, validated, bomb-safe) and PNG export
- [x] Keyboard shortcuts, touch pinch/pan, axe scan clean, startup auto-tune of grid size
- [x] Mobile layout check (375 × 812: settings closed, one toolbar row, no sideways scroll, error box fits)
- [x] Scene card (source, summary, what to watch, strains from the live settings, why), scene name over the canvas, presets in groups, Learn → Scenes; preset unit tests check the texts against the settings (2026-11-09)
- [x] One agent per cell: help, notice when switched off in a scene made for it, restart on every switch, kept off without `EXT_float_blend` (2026-11-09)
- [ ] Dish scenes alike on every screen shape: food positions relative to the dish, and agents counted in the dish rather than the grid. Today Shortest path and Steiner tree end differently on a tall screen (a thick lens, a long bridge; measured on WebGPU on a 118 × 256 grid, 2026-11-10), and one food of Shrinking plasmodium lies outside the dish there; their texts say so

## M5 Quality and reach

- [x] WebGL2 fallback backend (ADR 0003) with shared GPU tests (all model tests on both backends, e2e fallback test)
- [x] Security review and audits with four skills (sharp edges, supply chain, web security, GitHub Actions); findings verified and fixed or accepted with reasons in ADRs 0011, 0013–0017
- [x] Performance numbers on Metal (timestamp queries for compute passes, wall time for render passes) → `knowledge-base/webgpu-platform.md`
- [x] README (usage, development, architecture, credits, images from the gallery)

## M6 Release

- [x] `scripts/github-setup.sh settings` before the first push of the workflows: it limits the environments `renovate` and `github-pages` to `main` (a job would create them unprotected) and adds both rulesets (owner)
- [x] Renovate GitHub App, variable `RENOVATE_CLIENT_ID`, secret `RENOVATE_PRIVATE_KEY` in the environment `renovate` (owner, ADR 0015); the first run with a token (2026-11-09) opened PRs #3 and #4 and the Dependency Dashboard #5
- [x] Commit on a branch, PR, CI green (needs owner OK)
- [x] `scripts/github-setup.sh codeql` after the first merge, once CodeQL has analysed `main` (ADR 0014); ruleset `codeql` active since 2026-11-09
- [x] CodeQL default setup also analyses `python` since 2026-11-09 (vendored `.claude/skills/` scripts): `python` stays (owner decision, ADR 0014), both script modes name the languages, high alerts 9–11 dismissed as "won't fix" with reasons
- [ ] Report the findings in the vendored `supply-chain-risk-auditor` to Trail of Bits: private vulnerability report (token handling) and public issue (ReDoS, URL checks) (owner)
- [x] Ruleset `code owners`: `require_last_push_approval` off since 2026-11-09 (owner decision, ADR 0014). It required an approval on every pull request and kept Renovate PR #3 (`.node-version`, no code owner) blocked with all required checks green; after the change, auto-merge merged PR #3
- [x] Code owner review with 0 required approvals (ADR 0014): after the change, Renovate PR #4 (`.pre-commit-config.yaml`) stayed blocked with all required checks green and a review request to the owner; GitHub reports no errors in `.github/CODEOWNERS`
- [x] The owner's own PRs to code-owned paths need no bypass: the PR #7 merge passed ruleset `code owners` without a review (rule suite 5003859265, ADR 0014)
- [x] Site live at <https://karstensiemer.github.io/physarum-slime-mold/>, no custom domain (ADR 0018)

## Later (not in scope now)

- Jenson-style contagion between strains; adaptive sensing ("36 Points" idea, own parameters only, license note in knowledge base)
- Growth and death (Jones 2011), oscillation (Jones 2012), MCPM steering
- Tracer agent with path history (shuttle streaming, Jones Fig. 7); video recording
- Sensor width > 1 and sensitivity threshold `sMin`
- Custom domain `physarum.karstensiemer.de` (steps in `knowledge-base/github-pages.md`)
