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
- [x] Collision mode: every agent on a free cell from the first step, in every layout, also when it moves out of a wall or the dish, and without rounding into the next cell: claim rounds after init, every scene with the rule starts with no shared cell on both backends (ADR 0008, ADR 0019, 2026-11-10)
- [x] Food, light and walls survive a new grid, density, arena and the out-of-memory step-down: an edit list painted on every new simulation, on another grid through the canonical frame of the arena it was painted in: a dish's short side, or the stretched grid of a box or a periodic grid; strokes that later strokes cleared completely on the grid on screen leave the list (ADR 0019, owner decision 2026-11-10)
- [x] Moves check every cell they cross for walls; one wall threshold (byte 128) in WGSL and GLSL (ADR 0019, 2026-11-10)
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
- [x] Food and walls with smooth outlines at any zoom: food below the trail and seen through the gel, walls as lit ridges with a drop shadow and the trail up to them, agents on food and blocked agents shown in collision mode, nothing left after erasing at any zoom, every cell centre drawn as `env` holds it, outlines that follow `env` after a change of boundary (ADR 0009, 2026-11-10)
- [x] Outlines in every replay of the edit list: one call of `Sim.paint` writes `env` and the outlines with the bytes of one call per stroke, on both backends; 100,000 strokes in 0.44 to 0.85 s on WebGPU and 0.15 to 0.52 s on WebGL2 (M3 Pro), an eraser holds its whole outline box (ADR 0009 item 11, ADR 0019, 2026-11-10)
- [x] Outlines beside the edge of a box and the rim of the dish: a stroke's distance counts only as far as the cells it paints allow, so a drag that runs on outside a box draws no line along the edge, an eraser there carves no food it does not erase, and a stroke that paints no cell changes no outline byte, on both backends; both backends outline the same cells, also for a stroke longer than a closed arena (ADR 0009 items 1 and 2, 2026-11-10)
- [x] How much food shows through the gel style's trail: `GEL_CLEAR` stays 0.6 in render.wgsl and render.frag (owner decision 2026-11-10: keep 0.6; ADR 0009 item 4)
- [ ] A replay of 100,000 strokes whose kind changes with every stroke at one place takes 4.8 to 4.9 s on WebGL2 (0.10 s without outlines; on a busy host after the rebase 7.2 s against 0.11 to 0.12 s for PR 2 alone; ADR 0019): every stroke is a run of outlines of its own. Look again only if real edit lists do this
- [x] On WebGL2 a drag of a wide eraser or wall whose outline box reaches far past the brush costs more than PR 3 alone: radius 1,000 cells on 3072 × 1920, 3.80 against 2.91 ms per stroke for erasers and 3.90 against 2.99 ms for walls (M3 Pro; in every other case at most 0.22 ms above PR 3 alone, mostly below it, ADR 0009). Against PR 2 alone (01059ae, no outlines), paired after the rebase on a busy host: 5.87 to 6.01 against 0.36 to 0.37 ms for erasers, 5.49 to 6.02 against 0.36 to 0.41 ms for walls. A subtraction holds every byte of its outline box, and WebGL2 searches 5 rings of `env` at each cell there that holds no layer. The bytes it can change lie within 7.07 cells of the brush; holding only those needs the same rule for the hold over the union of a run of outlines, which one draw cannot test per cell. The owner keeps the exact hold (decision 2026-11-10)
- [x] WebGPU outlines with six pipelines (paint.wgsl override constants `TILED`, `CORE`, `OWN_SEARCH`; ADR 0009 item 11): replays of walls and erasers as fast as before the review fixes of the join, but a new device on SwiftShader (the CI image) takes 16.2 to 16.8 s to build instead of 9.4 to 10.4 s (Metal: no change). One pipeline builds as fast as before, and makes those replays 10 to 14 % slower. The owner keeps six (decision 2026-11-10; ADR 0010)
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
- [x] Dish scenes alike on every screen shape: food, light and walls in a frame of the short side, turned on a tall screen, and a dish's agents counted over the square of its short side. Shortest path ends as one band and Steiner tree as two junctions joined by a short bridge on wide and tall screens alike, and all eight foods of Shrinking plasmodium lie in the dish (WebGPU, 16:9 and 9:19.5, 5 to 10 seeds, 2026-11-10); the texts say what the GPU shows
- [x] Maze on every screen shape: a box or a periodic grid keeps its food, light and walls where they lie relative to its edges, so the Maze has both foods from 1:1 to 9:19.5 (ADR 0019, 2026-11-10)
- [x] Scene card: food, light and walls that differ from the scene (a Clear, painting) count as a change, so Reload scene is offered (owner decision, ADR 0019, 2026-11-10)
- [ ] Shrinking plasmodium at Jones' %p 50 (0.5, 64 % of the dish) tears a hole beside the middle food in 3 of 15 runs on 512 × 288; at 0.6 (77 %) and with the old count of 73,728 agents in none (ADR 0019, 2026-11-10). Keep Jones' value with the text that says so, or raise the density (owner decision)

## M5 Quality and reach

- [x] WebGL2 fallback backend (ADR 0003) with shared GPU tests (all model tests on both backends, e2e fallback test)
- [x] Security review and audits with four skills (sharp edges, supply chain, web security, GitHub Actions); findings verified and fixed or accepted with reasons in ADRs 0011, 0013–0017
- [x] Performance numbers on Metal (timestamp queries for compute passes, wall time for render passes) → `knowledge-base/webgpu-platform.md`
- [x] README (usage, development, architecture, credits, images from the gallery)
- [ ] The e2e waits for a started app (60 s: `tests/e2e/helpers.ts:31` and the waits in `app.spec.ts` and `scenes.spec.ts`) reach their limit in the CI image when the host is busy: in a review run of the joined branch beside other test containers and GPU measurements, "the Maze keeps its walls and food when the grid changes" failed at 60.1 and 63.7 s, and in a run side by side with PR 2 alone the longest waits were 58.8 s against 55.4 s. The join does not change them (median 23.1 against 21.3 s there). The owner chose to raise the limits, in a pull request of its own after PR 6 (decision 2026-11-10; ADR 0010)

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
