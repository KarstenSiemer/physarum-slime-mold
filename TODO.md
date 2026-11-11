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
- [x] Model switch "Jones" and "Extended" (owner decisions 2026-11-11, ADR 0022): "Jones" holds only Jones' published rules (one strain that follows or flees its own trail, one agent per cell, one 3 × 3 mean, food in the trail map); "Extended" is Jones plus this app's additions (several strains, light, a scent decay of its own, agents that share cells, more diffusion passes, sensors that walls block, trail saturation K, scent scaled by g(d) = (d / (1 − d)) / (0.1 / 0.9)). The 8 scenes from Jones 2010 run on Jones, the other 7 presets and the default settings on Extended, all bit for bit as on the base (15 presets and the default settings, 500 steps, WebGPU and WebGL2, M3 Pro)
- [x] The Jones model's panel offers only Jones' settings; a switch to it keeps strain A and says what went; links that set a value Jones does not have open in Extended, and a Jones link holds no K, light or scent decay of its own (ADR 0022)
- [x] Review of the strict model's settings and panel (ADR 0022, decisions 24 to 31): an old link opens as Jones only if Jones runs it as it was made (the Maze and Fleeing light opened as Jones); the tool follows the model after a preset or a link; Scent decay has the range of the strain's Decay; Jones sets the share to 1; the switch notice names every changed value; the panel says that drawn light has no effect in Jones; a held agent tool acts only while it is selected
- [x] Covered food: a food cell releases the covered-food factor while the 3 × 3 window around it holds an agent, in both models, off in every scene; the factor is a setting per scene, 0.001 by default (Adamatzky and Jones 2010; Jones and Adamatzky 2014 use 0.01 for food at a point; ADR 0022, ADR 0024)
- [ ] Default settings and start scene: stay at scent decay 0.1 with K off on the extended model, as now, or set K or a lower scent decay (owner decision, ADR 0022). Measured (ADR 0022, 10 seeds, a UI dab 20 cells from the network): the default settings reach it in 3 of 10 seeds today, in 10 of 10 with the extended model, K 30 and decay 0.003, but then each dab takes 5 to 8 % of all agents; K 100 at decay 0.1 holds 2 % per dab and reaches it in 8 of 10. Pictures in the pull request
- [ ] Covered food costs 0.6 to 2.2 ms per step on WebGPU and 5 to 23 ms on WebGL2 without the rule of one agent per cell (1.5 to 4.4 million agents, M3 Pro), for the occupancy pass; with the rule nothing measurable (ADR 0022). Keep it exact, or count only the agents that moved (cheaper, misses agents blocked at walls)
- [ ] The extended model normalises to a large food, so a dab gets weaker at a low decay: on the 1536 grid at decay 0.001 the scent on a UI dab is 46 against 115 at 0.1, at its edge 28 against 62, while 9 cells out it is 14 against 0.36 (ADR 0022). Keep this, or normalise to another size (owner decision)
- [ ] With K and food, most straight paths out of a food run along the grid axes (axis rank 0.86 at K 30 against 0.57 at K 0, 10 seeds), because Jones' sensors read the cell their point falls in (ADR 0022, decision 17). Keep, or give K a random sensor offset per step (an extended rule, not measured for food reach; owner decision)
- [ ] Old links with a scent decay other than 0.1 open in Extended, whose g(d) makes their scent weaker than when they were made (ADR 0022, decision 24). Keep, or add a way to open them as made (owner decision)
- [x] Agent pass (Jones rule), shrinkage, inoculate and cut tools
- [x] The agent tools keep one agent per cell: a placed or moved agent claims a free cell like a move, and a loser stays dead or where it was, on both backends (ADR 0008, ADR 0023, 2026-11-11). Before, a 1 s inoculation on the Maze put 811 to 852 agents in 234 to 244 cells, up to 18 in one cell, and 60 to 73 % were still stacked at step 2,000; one frame of cut doubled 9 cells. Now no cell holds two agents during or after a 1 s or 10 s hold (seeds 1 to 3)
- [x] Inoculate takes only dead agents: a second 1 s hold took 29 to 37 living agents (4.1 to 5.3 %) from the first colony, now none. With no dead agents of the strain left it places nothing, and a notice says so (ADR 0023, 2026-11-11)
- [x] Inoculate places the same amount per second at any frame rate: it acts on every step, with the chance of the step's share of the frame's time, and while paused it runs 60 steps per second. 60 and 120 frames per second give the same agents bit for bit at the same steps per second (ADR 0023, 2026-11-11)
- [x] A move across the wrap seam lands in the cell it claimed. On a grid 512 cells wide, x = −1.000001 counted in cell 510 and landed in cell 511. `wrapPos()` now takes the whole periods from integers on both backends. Its float division put x = 479.99997 on a side of 480 at −0.00003 (ADR 0008, ADR 0023, 2026-11-11)
- [x] WebGL2 wraps cells with integers. Its float division was not exact on an Apple M3 Pro for 291 of the sides 16 to 4096, such as 33, 47 and 246. Cell W was in the next row and row H outside the grid, for moves, sensors, diffusion, wall clearance and the view. On 512 × 246 cells no agent crossed the top seam under the rule. SwiftShader (CI) divides exactly and cannot show it (ADR 0023, 2026-11-11)
- [x] The alive count of the stats belongs to one run. After a restart the app waits for a new count, and WebGPU counts the agents after each reset. Before, the start layout Empty showed the notice that every agent lives (ADR 0023, 2026-11-11)
- [x] Inoculate gets agents in a full scene: a Capacity above Agents per cell keeps dead agents, and growth brings dead agents to life (ADR 0025, 2026-11-11). Without a higher Capacity the tool does nothing where every agent of the strain lives, as before, and its notice now names Capacity first (ADR 0023)
- [ ] Should a scene or the default settings hold a Capacity above Agents per cell, so that Inoculate works there without a change? It gives the strains other ids and so another run, and costs 32 B per agent more (ADR 0025; owner decision)
- [x] Growth and shrinkage (Jones 2011, Nat. Comput. 10: 1345, Sec. 5.1): a switch in a section Growth with Gf, Gw, Gmin, Gmax, Sf, Sw, Smin, Smax (defaults of 2011) and Capacity; in both models with one agent per cell, off in every scene, which keep their bytes on WebGPU, WebGL2 and WebGL2 without float blending. Exact on both backends: a parent claims an empty neighbour with the key of a move, and the dead agent of rank r of a strain takes the birth of rank r (pyramids of sums). Tested against a CPU copy of the passes (ADR 0025, 2026-11-11)
- [x] Foraging maze (coordinator decision 2026-11-11, ADR 0025): the Maze's walls and foods with Jones' foraging angles (SA 22.5°, RA 45°), growth with the values of 2011 and a start of about 50 agents on the bottom-right food (the new start layout "At the first food"). It reaches the far food within 15,000 steps in 10 of 10 seeds on 16:9, 16:10 and 1:1, on WebGPU and WebGL2, from its own start (median steps 2,751 to 3,901) and when the user inoculates the food at step 100 or 1,000 in the layout Empty (ADR 0025, D1b)
- [ ] The Maze (SA 45°) with growth from 50 agents reaches the far food on 16:9 and 16:10 only along its walls, and not on a square screen (0 of 10). Cause: the diffusion reflects the trail at walls and closed edges, where Jones absorbs it and runs the mean at every lattice site (Jones 2011, p. 1353; 2014, 2015, 2017), and SA 45° is Jones' angle for minimising networks (ADR 0025, D1). Owner decision 2026-11-11: Jones' corrections hold for both models ("Ja, beide Modelle", yes, both models). The fidelity pull request (in progress) brings them to both models: Jones' order of a step (move and deposit, sense, diffuse), closed edges that absorb the trail, inner walls that diffuse in the Jones model and are sinks in the extended model, and a dish of 0.945 of the short side. It measures the Maze (SA 45°) with growth again. The Foraging maze was measured with this branch's diffusion and needs a new measurement after it too (ADR 0025, D1, D1b)
- [ ] A growth count includes the agent itself, as the shrinkage count does (ADR 0024, decision 6), so Growth minimum 0 and 1 act the same; and a child gets a random heading, which Jones does not state (ADR 0025; owner decision)
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
- [x] The scenes of Jones run on the lattice of their figure: 200 × 200 cells for Fig. 4, 5, 16, 18 and 19, 300 × 300 for Fig. 21 and 22, on every screen, with free space beside it and dimmed copies around a periodic lattice; another grid shows a hint with a way back; links hold the lattice, and an old link opens on its grid shaped like the screen; the app's scenes keep their bytes (owner rule 2026-11-11, ADR 0024 decision 3, ADR 0026)
- [ ] Steiner tree on Jones' lattice with this app's foods (a square 0.29 of the dish, foods of 4 cells): an X in about half of the runs, a ring in the others. Fig. 19 shows a square of about 60 cells (0.32 of the dish) with foods of about 2.7 cells, which form a tree in 20 of 20 runs. Fixed by the fidelity PR (the figure's foods, with a revision of a scene's shapes that links hold, so old links still open as made; ADR 0026, decisions 2 and 10)
- [x] Review of the lattices (2026-11-11, ADR 0026): Cut and the clearing of chemicals act on the nearest copy of the brush on a periodic grid, so a tool on a copy or across an edge acts where the copy shows it (also on `main` when zoomed out), on both backends; a paused tool beside a closed arena runs no step; out of memory steps a lattice down by cells, so a 200 × 200 lattice no longer stops the app; the startup check lowers a link's lattice but never the scene's own; a lattice the device cannot hold is no change of the scene and offers no way back that fails; the hint names the grid, Jones' grid and the panel's settings, and keeps the focus; an old link's card says "This link changes the scene."
- [ ] On a 2560 × 1600 screen a lattice of 200 × 200 cells has 8 device pixels per cell and looks soft and blocky (ADR 0026, review of 2026-11-11). A known look, no change now
- [ ] Shrinking plasmodium at Jones' %p 50 (0.5) tears a hole around the middle food in 18 of 31 runs on Jones' lattice of 300 × 300 cells (11 of 31 on 512 × 288, 3 of 15 in ADR 0019). The cause is the dish: Jones' dish is 0.945 of the lattice's side, the app's the side less 2 cells, and with Jones' dish 0 of 31 runs tear. Fixed by the fidelity PR (dish 0.945, and the 19 foods of Fig. 21); the density stays 0.5 (ADR 0026, 2026-11-11)
- [ ] Turing spots on Jones' lattice of 200 × 200 cells keep defects: the spacing varies by 28 to 29 % up to step 60,000, and some rings hold two spots. The cause is the order inside a step: Jones moves and deposits, then senses, then diffuses (p. 132–133), and with his order 30 of 30 runs hold exactly 20 discs. Fixed by the fidelity PR (step order; ADR 0026, 2026-11-11)
- [ ] On a desktop window a scene of Jones lies partly below the settings panel, as the dish did before (ADR 0026). Fit the lattice into the space beside the panel, or keep it centred in the window (owner decision)
- [ ] The copies around a periodic lattice show at 0.15 of their light (ADR 0026). Keep, show them brighter or darker, or show none and let tools act only on the lattice (owner decision)

- [ ] On a square window of 800 × 800 the toolbar wraps onto two rows, and its Brush slider lies on the bottom-right food of the Maze: a press there moves the slider and places no agent. The scene label covers the top-left food, and the stats line overlaps Pause, Step and Reset. At 1000 × 1000 both foods are free (app review of the growth branch, 2026-11-11; the layout is older than growth)

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
- Oscillation (Jones 2012), MCPM steering
- Tracer agent with path history (shuttle streaming, Jones Fig. 7); video recording
- Sensor width > 1 and sensitivity threshold `sMin`
- Custom domain `physarum.karstensiemer.de` (steps in `knowledge-base/github-pages.md`)
