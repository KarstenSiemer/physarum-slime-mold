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
- [x] Walls block sensors: a sensor whose way from the agent passes through a wall reads BLOCKED, with the walk of the moves up to 92 cells; agents far from every wall skip the walk (clearance per 8 × 8 tile); without walls the agents and trail stay as before, bit for bit (ADR 0020, 2026-11-10)
- [x] Since walls block sensors, repelling strains keep a band of about half the sensor distance free along a wall, and their spots and stripes line up along it; before, they gathered against walls (ADR 0020). The owner keeps this (decision 2026-11-10)
- [x] Long sensors among many walls cost the most since walls block sensors: Three strains (3,981,312 agents on 1536 × 864) among the Maze's walls with a sensor distance of 64 takes 2.4 to 2.7 times as long per step on WebGPU and 1.9 to 2.4 times on WebGL2, where it then runs at most 14 to 20 frames per second (M3 Pro, ADR 0020). The owner keeps this cost (decision 2026-11-10). A cheaper walk could end once the clearance of a tile it enters is above the rest of its way, or use a finer clearance; neither is measured
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
- [x] Shared links carry the scene with its food, light and walls: the engine's edit list exactly, on whole steps of 1/16 cell, the scene's shapes by the scene and one bit each; about 2,000 to 2,800 drag segments or 1,150 to 1,300 dabs fit in 8,192 characters (owner decision D8, ADR 0021, 2026-11-10)
- [x] A drawing too large for a link: the link holds the settings and the scene as it loads, without any part of the drawing, and the app shows the notice "The drawing is too large for a link." once each time a drawing grows too large. Measured capacity (1,280 × 720, brush 18 px): 2,698 to 2,779 drag segments or about 1,305 dabs on the Maze, 1,935 to 1,969 segments or about 1,154 dabs on Three strains; with a 60 px brush 1,420 segments. The owner keeps this (decision 2026-11-10; ADR 0021)
- [x] Caps of a link's drawing: 4,096 strokes and 64 passes over 4,096 × 4,096 cells of paint work. On an M3 Pro such a link painted in at most 83 ms on the GPU and took up to 77 ms of main-thread time in `Engine.load` (the sweep's `Placement`); a link that fills its 8,192 characters took 5 to 8 ms. Every new simulation paints the list again, and a new grid builds the `Placement` again. The owner keeps the caps (decision 2026-11-10; ADR 0021)
- [x] Keyboard shortcuts, touch pinch/pan, axe scan clean, startup auto-tune of grid size
- [x] Mobile layout check (375 × 812: settings closed, one toolbar row, no sideways scroll, error box fits)
- [x] Scene card (source, summary, what to watch, strains from the live settings, why), scene name over the canvas, presets in groups, Learn → Scenes; preset unit tests check the texts against the settings (2026-11-09)
- [x] One agent per cell: help, notice when switched off in a scene made for it, restart on every switch, kept off without `EXT_float_blend` (2026-11-09)
- [x] Dish scenes alike on every screen shape: food, light and walls in a frame of the short side, turned on a tall screen, and a dish's agents counted over the square of its short side. Shortest path ends as one band and Steiner tree as two junctions joined by a short bridge on wide and tall screens alike, and all eight foods of Shrinking plasmodium lie in the dish (WebGPU, 16:9 and 9:19.5, 5 to 10 seeds, 2026-11-10); the texts say what the GPU shows
- [x] Maze on every screen shape: a box or a periodic grid keeps its food, light and walls where they lie relative to its edges, so the Maze has both foods from 1:1 to 9:19.5 (ADR 0019, 2026-11-10)
- [x] Scene card: food, light and walls that differ from the scene (a Clear, painting) count as a change, so Reload scene is offered (owner decision, ADR 0019, 2026-11-10)
- [x] Maze keeps a path from food to food on every screen shape since walls block sensors: 12 of 12 runs at steps 2,000 to 15,000 on 16:9, 16:10, 9:19.5 and 1:1 (WebGPU, seeds 31 to 42); before, 0 of 12 at step 15,000 on 16:9 and 1 of 12 on 9:19.5. The texts say what the GPU shows (ADR 0020, 2026-11-10)
- [ ] Shrinking plasmodium at Jones' %p 50 (0.5, 64 % of the dish) tears a hole beside the middle food in 3 of 15 runs on 512 × 288; at 0.6 (77 %) and with the old count of 73,728 agents in none (ADR 0019, 2026-11-10). Keep Jones' value with the text that says so, or raise the density (owner decision)

## M5 Quality and reach

- [x] WebGL2 fallback backend (ADR 0003) with shared GPU tests (all model tests on both backends, e2e fallback test)
- [x] Security review and audits with four skills (sharp edges, supply chain, web security, GitHub Actions); findings verified and fixed or accepted with reasons in ADRs 0011, 0013–0017
- [x] Performance numbers on Metal (timestamp queries for compute passes, wall time for render passes) → `knowledge-base/webgpu-platform.md`
- [x] README (usage, development, architecture, credits, images from the gallery)
- [ ] 120 Hz displays, not measured: a frame has 8.3 ms there. The spatial sort every 32 steps makes its frame 1.4 to 2.4 ms longer at 1280 × 720 and 1.7 to 4.2 ms at 3024 × 1890 (4 million agents, M3 Pro, `knowledge-base/webgpu-platform.md`), so that frame can miss on a slower GPU. The gel style is no risk since the frame-rate work: 1.7 to 2.3 ms per frame (ADR 0009). The owner saw no stutter (2026-11-11). Measure in the app on a 120 Hz display if a stutter shows up
- [x] Waits in CI above a quarter of their limit, also on `main` (ADR 0010, 2026-11-10). The e2e waits for a started app (60 s: `tests/e2e/helpers.ts:31` and the waits in `app.spec.ts` and `scenes.spec.ts`) reach their limit in the CI image when the host is busy. With PR 3 on PR 2, in a review run beside other test containers and GPU measurements, "the Maze keeps its walls and food when the grid changes" failed at 60.1 and 63.7 s; side by side with PR 2 alone the longest waits were 58.8 s against 55.4 s, the medians 23.1 against 21.3 s. On PR 2 with and without ADR 0020 the longest of these waits took 23 to 37 s in three runs, and in a run of ADR 0020 under more load 60 s, a failure; the WebGL2 counting test without float blending took up to 19 s of 60 s, and 68 s under more load. On GitHub Fig. 10 took 271 s of 600 s on `main`. The owner chose longer limits (decision 2026-11-10): each wait that used more than a quarter of its limit has twice that limit now, and the verify job keeps its 30 min (ADR 0010)

## M6 Release

- [x] `scripts/github-setup.sh settings` before the first push of the workflows: it limits the environments `renovate` and `github-pages` to `main` (a job would create them unprotected) and adds both rulesets (owner)
- [x] Renovate GitHub App, variable `RENOVATE_CLIENT_ID`, secret `RENOVATE_PRIVATE_KEY` in the environment `renovate` (owner, ADR 0015); the first run with a token (2026-11-09) opened PRs #3 and #4 and the Dependency Dashboard #5
- [x] Commit on a branch, PR, CI green (needs owner OK)
- [x] `scripts/github-setup.sh codeql` after the first merge, once CodeQL has analysed `main` (ADR 0014); ruleset `codeql` active since 2026-11-09
- [x] CodeQL default setup also analyses `python` since 2026-11-09 (vendored `.claude/skills/` scripts): `python` stays (owner decision, ADR 0014), both script modes name the languages, high alerts 9–11 dismissed as "won't fix" with reasons
- [x] Report the findings in the vendored `supply-chain-risk-auditor` to Trail of Bits: private vulnerability report (token handling) and public issue (ReDoS, URL checks). Not reported (owner decision 2026-11-11); the findings have no impact here, and the copy stays unchanged (ADR 0017)
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
