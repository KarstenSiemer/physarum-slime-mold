# 0028: Performance of drawing and stepping

- Status: accepted
- Date: 2026-11-11

## Context

On 2026-11-11 the owner said that the app felt slower since #28. A measurement compared the production builds of
30b60ef (before #26), 2c355b7 (#26) and 45155a8 (#28) in headed Chromium, WebGPU on Metal, on an Apple M3 Pro with
a 2560 × 1600 canvas, in interleaved rounds:

- On WebGPU neither #26 nor #28 is measurably slower. The ratio of the step time of 45155a8 to 30b60ef was 1.004 to
  1.029, of the draw time 0.98 to 1.02, with a resolution of about ±3 %.
- On WebGL2 #26 made the draw on the periodic grid slower, by 0.7 to 3.5 ms per frame: the integer remainders that
  replaced a float wrap that was wrong on some grid sides (ADR 0023). That is still open.

The owner then said that the app often falls from about 100 to 40 fps and back at 1 M agents. A trace of every frame
over 60 to 90 s found the cause outside the app: another program that uses the GPU at the same time. "1 M agents" was
the default scene after the startup check had lowered its grid to 768 × 480 (1,105,920 agents).

- Alone on the GPU the app held 119 to 121 fps at that grid, with no frame in flight at the start of a frame.
- With a second browser that ran the default scene, switched on and off every 15 s, it fell to 76 to 91 fps, and
  to 41 to 52 fps with the other load on the machine. Three frames were then in flight, and the time from submit to
  GPU done was 32 to 73 ms. The change took 1 to 2 s each way.
- The step budget (`src/engine/budget.ts`) did not cause it: it stayed at its floor of 1 step per frame under the
  load. No periodic work of the app (the sort every 32 steps, the exposure measurement) lined up with it.

Under such load the app gets a share of the GPU, and its frame rate is that share divided by its own GPU time per
frame. At grid 768 the backdrop blur of the panels was about two thirds of that time. The browser's GPU time per
frame, measured with ioreg:

| Variant                       | GPU ms per frame |
| ----------------------------- | ---------------- |
| main (45155a8)                | 2.9–3.1          |
| main, `backdrop-filter: none` | 0.95–1.5         |
| main, all panels hidden       | 1.0              |

Under the same second GPU client, in four interleaved rounds of 12 s: main gave 53, 45, 44 and 95 fps, main without
the blur 76, 93, 116 and 118 fps. Under the load of other sessions, the default scene gave 28.5 fps with the panels
and 46.0 fps without the blur (12 alternating rounds, higher in 11).

A blur behind a panel costs this much because the canvas under it changes in every frame, so the browser blurs it
again in every frame, for each panel.

## Options

1. **Panels without a backdrop blur** (chosen), with a background that is more opaque.
2. Keep the blur. The panels look as before, and the app keeps the cost.
3. A blurred copy of the canvas drawn by the app once per frame for all panels. Less cost than six browser blurs,
   but still a full-screen pass, and the panels would need to sit over that copy.

## Decision

1. **No backdrop blur** (the owner's decision of 2026-11-11: "Unschärfe entfernen", after the measurement above).
   The toolbar groups, the brand bar, the settings panel, the scene name, the stats line and the notices
   (`src/App.svelte`, `src/ui/Toolbar.svelte`, `src/ui/SceneLabel.svelte`) and the backdrop of the Learn dialog
   (`src/ui/Learn.svelte`) draw no `backdrop-filter`. A test reads every style file in `src/` and fails if one uses
   it (`src/ui/glass.test.ts`).
2. **The panels' background goes from 0.88 to 0.94 opacity** (`--glass` in `src/app.css`), the opacity of the Learn
   dialog. My choice: without the blur, the moving trails behind a panel show through sharp, and 0.94 keeps them
   faint. The contrast of the text over a white canvas rises with it (the existing contrast test).
3. **The backdrop of the Learn dialog goes from 0.45 to 0.6 black.** My choice, for the same reason: the dialog
   covers the canvas, and the simulation around it now shows sharp.

## Consequences

- The panels look flatter: dark, nearly opaque, with no frosted picture behind them.
- Under another GPU client the app keeps about 1.5 to 2 times the frame rate it had.
- Open, for a later change: the WebGL2 draw cost from #26; three frames stay queued when the GPU is behind, which
  gives 32 to 90 ms from input to picture; the shader changes measured with the same harness (faster wraps in the
  render and simulation passes, no scent reads while there is no scent, no draw of an unchanged paused frame); the
  draw cost when zoomed far out.
