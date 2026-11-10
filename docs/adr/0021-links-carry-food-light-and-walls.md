# 0021: Shared links carry the scene with its food, light and walls

- Status: accepted (that a link carries the drawing is owner decision D8 of 2026-11-09; the
  behaviour of a drawing too large for a link and the caps are open owner items, TODO.md)
- Date: 2026-11-10

## Context

`docs/design.md` promises a "URL with full state". The page address held only the settings:
`#s=<base64url>`, deflated JSON (`src/model/url.ts`; `MAX_HASH` 8,192 characters, `MAX_JSON` 64 KiB
against decompression bombs, `sanitize()` in `src/model/params.ts`, ADR 0013). A link lost the food,
light and walls, and the scene's name: a link to the Maze opened without walls, and the scene card
said that the address names no scene. A reload lost them in the same way, as the address is what a
reload opens.

The engine keeps every edit since the last Clear or preset load that the sweep left, each in the
frame of the arena it was painted in, and paints that list on every new simulation (ADR 0019). A
preset's shapes come first, in the canonical frame of the preset's arena; strokes follow, each in
cells of the grid it was painted on, with that grid and its arena. Owner decision D8: a shared link
carries that list, in its own pull request.

## Options

How a link keeps a stroke exact, so that it paints the sender's bytes on the sender's grid:

1. Round the positions and the radius when the link is made. No step is small enough: a cell centre
   can lie exactly on the edge of a brush (ADR 0019, 12 cells of a dab of radius 5), and a rounded
   stroke can move it out. Not exact.
2. Keep the float64 values: 8 bytes for each of 5 numbers before compression, so a few hundred
   strokes would fit.
3. **Put every stroke on whole steps of 1/16 cell before it is painted and recorded**, and keep the
   steps in the link. The link then holds the list exactly, so it paints what the list paints, on
   every grid. A stroke moves by at most 1/32 of a cell. The environment is painted in whole cells,
   so the screen cannot show that.

How a link names a preset's shapes:

1. List them like strokes. They are not on the steps, and a scene has up to 8 of them.
2. **By the scene's id, and one bit per shape for the shapes the list still holds**: exact, as the
   receiver makes them again with `fromShape`, and a few bytes.

What a link holds when the drawing does not fit:

1. The strokes that fit. The receiver then gets a drawing that the sender never had: an erase
   without the strokes before it, food without the wall that a later stroke put on it.
2. **The settings and the scene as it loads, without any part of the drawing**, and the sender's
   app says so.

## Decision

Option 3, the scene's id with one bit per shape, and the settings with the scene for a drawing that
does not fit.

- **Steps.** `Engine.paint` (`src/engine/engine.ts`, line 294) puts both ends and the radius of a
  stroke on whole steps of `STEP` = 1/16 cell (`snap`, `src/engine/environment.ts`, line 21) before
  `paintsCell`, the paint and the record: the stroke that the simulation holds is the one in the
  list. `MIN_RADIUS` (0.75) is 12 steps. `snap` never gives −0, so a decoded list is equal to the
  sender's, sign of zero included. `Engine.load` (line 119) takes a link's strokes after the scene's
  shapes; `Engine.envList` (line 146) gives the list to the link.
- **Address.** `#s=<settings>&e=<drawing>` (`encodeLink` and `decodeLink` in `src/model/url.ts`,
  lines 95 and 110). `s` is the settings as before. `e` is the bytes below, deflated (deflate-raw)
  and in base64url. `MAX_HASH` (8,192 characters) holds for the whole hash and `MAX_JSON` (64 KiB)
  for each inflated part. A link without a scene and without a stroke has no `e`: it is a link of
  the old form. A link of the old form opens as before: the settings, no food, light or walls and no
  scene.
- **Bytes** (`packDrawing` and `unpackDrawing` in `src/model/link.ts`, lines 170 and 233). A version
  (1); the scene's id (a length and its ASCII characters, 0 for none); for a scene, the number of
  strains and for each its index in the scene plus 1 (0 for a strain added since, so that each
  strain keeps its role on the scene card), the number of the scene's shapes, and one bit per shape
  for those the list holds. Then the number of strokes, and per stroke a head byte: kind (bits 0 and
  1, `EnvKind`), arena (bits 2 and 3, the index in `BOUNDARIES`), and whether its grid (bit 4), its
  start (bit 5), its end (bit 6) and its radius (bit 7) follow. A grid follows when it differs from
  the stroke before (two varints); a start when it is not the end of the stroke before, as the
  difference from that end; an end when the stroke is not a dab, as the difference from the start;
  a radius when it differs from the one before. Differences are zigzag varints of steps, so a
  segment of a drag takes 3 to 5 bytes before compression and a repeated dab 1 byte.
- **Drawing of a list** (`drawingOf`, line 81). A preset load puts the shapes first and every later
  edit is a stroke (ADR 0019), so the shapes that the list holds are its first edits without a grid,
  in the scene's order, in the scene's arena (`sameEdit` in `src/engine/environment.ts`, line 77,
  which `Engine.matches` uses too). An edit without a grid that is not the scene's next shape cannot
  go in a link (only the engine's console API can make one); the link then holds the scene alone.
- **Untrusted input** (`unpackDrawing`; ADR 0013). The decoder never throws: a reader past the end
  or a varint longer than 5 bytes throws inside, and `unpackDrawing` returns undefined. It returns a
  drawing only when every value is in range and every name comes from its fixed set: version 1, a
  scene id of `[a-z0-9-]` that `presetById` finds, the preset's number of shapes and no bit set
  beyond them, origins from −1 to the preset's strains less one, the arena from `BOUNDARIES` (3 is
  refused), a grid and a radius on the first stroke, grid sides whole numbers from 16 to 4096 (what
  `gridSize` gives), positions within 2^20 cells (a drag on screen stays below 2^17), radii from
  `MIN_RADIUS` to 16,384 cells (a brush on screen stays below 2,000), and no byte after the last
  stroke. `decodeLink` gives each strain no scene role (−1) when the origins do not match the
  settings' strains. A broken `e` part leaves out the drawing: the settings load alone, as from a
  link of the old form, and `decodeLink` sets `drawingLost`. `openLink` then shows the notice "This
  app cannot read the scene and drawing in this link, so only its settings load.", and the scene
  card says that the link names no scene this app can read. Unknown parts of the hash are ignored,
  and the parts go into a `Map`, so `__proto__` is a key like any other. Unit tests check the
  limits at their edges: the longest link that keeps its drawing has at most 8,192 characters and
  opens exactly; settings and a drawing that are valid but inflate to more than 64 KiB are refused;
  so are versions 0, 2 and 255 and 0 or 5 strains.
- **Caps** (`src/model/link.ts`, lines 20 and 26; the encoder and the decoder check the same,
  `Budget`). At most `MAX_STROKES` = 4,096 strokes, refused before the first stroke is read. At most
  `MAX_WORK` = 64 passes over 4,096 × 4,096 cells of paint work, by `workOf` (line 56), a bound for
  every grid of at most 4,096 cells a side: on another grid a stroke moves through its arena's frame
  (ADR 0019), so along every axis it covers at most (D + 2r) / s of that axis, with D the longer
  side of its box, r its radius and s the short side of its own grid; the box a paint segment
  dispatches over adds at most 6 cells; a periodic stroke is painted in at most ⌈2D / s⌉ segments of
  at most half a period. A unit test checks the bound against `paintBox` of every segment of
  `paintSegments` for 3,000 random strokes, also over several periods and with brushes up to twice
  the short side, on 8 grids from 16 × 4,096 to 4,096 × 4,096. The work also caps the segments: a
  stroke shorter than half a period has one, and a longer one costs at least a quarter pass per
  segment, so a link asks for at most 4,096 + 4 · 64 = 4,352 of them.
- **Too large** (`encodeLink`). When the drawing does not fit in `MAX_HASH` or exceeds a cap, the
  link holds the settings and the scene as it loads (`sceneOnly`, line 98): every shape, no stroke;
  without a scene, the settings alone. The app then says "The drawing is too large for a link." as a
  notice (App.svelte), once each time a drawing grows too large.
- **The address follows the list.** `Engine.onEdits` counts every change of the list in
  `app.envVersion` (`src/ui/state.svelte.ts`), and so do a preset load, a Clear before the engine
  exists and an opened link. App.svelte (line 125) starts its 400 ms timer again on every change of
  the settings or that count, as it does for the settings, and reads the list when the timer fires
  (`currentDrawing`, `src/ui/state.svelte.ts`, line 204): a drag that records many segments gives
  one encoding when it rests. Only the latest encoding writes the address. Before the engine exists,
  the drawing is what the engine will load. The address is written only after it was read at
  startup: before, a decoding slower than 400 ms let the first run write the default settings to the
  address until the next run.
- **Startup.** App.svelte (line 55) decodes the link once; `openLink` (`src/ui/state.svelte.ts`,
  line 168) sets the settings, the scene and its own settings, the origins and the scene flag, and
  keeps the drawing for `startScene` (line 187). The device's limits reach the scene's settings as
  for a preset load: `sceneChanged` caps their grid and `ruleUnavailable` turns their rule off. That
  loads once: the link's settings, the shapes the link kept and its strokes, with no second apply.
  A preset load or a Clear before the engine exists drops the drawing. After the load,
  `Engine.onEdits` sets the flag by `Engine.matches`.
- **Scene card.** It compares the link's settings with the scene's (`sceneChanged`) and the list with
  the scene's shapes: a link to the Maze with a stroke or without a wall says "changed" and offers
  Reload scene; a link to the scene as it loads does not.

Capacity, measured in Node with the CPU engine and `BrushDrag` (`src/ui/drag.ts`), window 1,280 ×
720 at a device pixel ratio of 1: each drag a smooth curve of 200 to 600 px at 300 px/s and 60 Hz,
food, wall and light in turn; dabs at random places; three seeds. The settings take 361 to 416 of
the 8,192 characters.

| Scene (grid)               | Brush              | Drag segments that fit | Dabs that fit  | Characters each |
| -------------------------- | ------------------ | ---------------------- | -------------- | --------------- |
| Maze (512 × 288)           | 18 px (7.2 cells)  | 2,698 to 2,779         | 1,304 to 1,306 | 2.8 and 6.0     |
| Three strains (1536 × 864) | 18 px (21.6 cells) | 1,935 to 1,969         | 1,153 to 1,155 | 3.9 and 6.7     |
| Three strains (1536 × 864) | 60 px (72 cells)   | 1,420 to 1,425         |                | 5.5             |
| Three strains (1536 × 864) | 4 px (4.8 cells)   | 2,483 to 2,527         |                | 3.1             |

The length limits every row; with the 60 px brush the list at the limit used 62 of the 64 passes. A
drag at 300 px/s records 29.8 segments per second (ADR 0019): 2,000 segments are about a minute of
fast painting without a pause.

Encoding, in Chromium on an M3 Pro (the Vitest browser, a list of drag segments on the Maze's grid,
10 runs): `drawingOf` with `packDrawing`, and `encodeLink` with its compression:

| Edits  | Link                      | drawingOf and packDrawing, median / max | encodeLink, median / max |
| ------ | ------------------------- | --------------------------------------- | ------------------------ |
| 500    | 2,007 characters          | 0.2 / 0.6 ms                            | 0.6 / 0.8 ms             |
| 2,000  | 6,274 characters          | 0.4 / 0.5 ms                            | 1.0 / 1.1 ms             |
| 2,700  | 8,176 characters          | 0.6 / 1.3 ms                            | 1.1 / 1.8 ms             |
| 4,096  | too large: the scene only | 0.8 / 1.0 ms                            | 1.7 / 2.2 ms             |
| 20,000 | above `MAX_STROKES`       | 0.0 / 0.1 ms                            | 0.3 / 1.0 ms             |

During a drag (the built app, the Maze running, Chromium at 60 Hz, a food drag that rests three
times for 800 ms with the pointer down, so that each rest writes the address) frames came at most
16.8 ms apart, also within 100 ms of each write, and no long task came: with 68 edits, with 1,907
edits (a link of 6,510 characters) and with 2,379 edits (too large).

Paint work at the caps, in the Vitest browser on an M3 Pro, from a clear environment until the GPU
finished, 3 runs; lists painted on 512 × 288 and mapped to the grid (`strokeOn`):

| List                                       | Work        | WebGPU 4096 × 2304 | WebGPU 3072 × 3072 | WebGL2 4096 × 2304 | WebGL2 3072 × 3072 |
| ------------------------------------------ | ----------- | ------------------ | ------------------ | ------------------ | ------------------ |
| 64 dabs that cover the grid                | 64 passes   | 63 to 69 ms        | 67 to 71 ms        | 26 to 30 ms        | 25 to 27 ms        |
| 4,096 dabs, each a box of 1/8 of the sides | 65.5 passes | 51 to 54 ms        | 81 to 83 ms        | 29 to 33 ms        | 51 to 56 ms        |
| 4,096 drag segments of the Maze's brush    | 16.5 passes | 17 to 20 ms        | 21 ms              | 5 to 7 ms          | 8 to 10 ms         |

The second list lies just above the cap. `paint` itself took at most 2 ms of JavaScript. But
`Engine.load` also maps every stroke to the grid and builds the sweep's `Placement` on the main
thread (`flushEnv`, `src/engine/engine.ts`, line 363). In Node on the M3 Pro, with the GPU paint
left out (the CPU test backend with `paint` stubbed), 3 runs:

| List, painted on 512 × 288                                | Work        | `Engine.load`, 4096 × 2304 | `Engine.load`, 3072 × 3072 |
| --------------------------------------------------------- | ----------- | -------------------------- | -------------------------- |
| 4,096 walls of radius 17.5 cells, the most CPU work found | 62 passes   | 35 to 51 ms                | 60 to 69 ms                |
| 4,096 drag segments of the Maze's brush                   | 16.5 passes | 9 to 14 ms                 | 10 to 12 ms                |
| 2,700 of them, about what fits in 8,192 characters        | 10.9 passes | 5 to 7 ms                  | 7 to 8 ms                  |
| 64 dabs that cover the grid                               | 64 passes   | 0.5 to 0.7 ms              | 0.5 ms                     |

The Mac ran other work at the same time: a reviewer's runs of the same walls took 41 to 77 ms for
`Engine.load`, and up to 109 ms for the `Placement` alone. The cost comes again later. Every new simulation paints the whole list again on the GPU: a change
of the grid, the density or the dish (ADR 0019). A new grid also maps the list and builds the
`Placement` again: 38 to 67 ms for the walls above.

## Consequences

- A link and a reload keep the scene and its food, light and walls, byte for byte on the sender's
  grid (CPU engine test with strokes of every kind on two grids and three arenas; e2e test on the
  GPU) and as the sender's list paints them on other grids (CPU engine test on two other screen
  shapes).
- Every stroke moves by at most 1/32 of a cell when it is painted. Tests that put a cell within
  `SLACK` (0.01 cells) of a brush's edge use values on the steps (ADR 0019).
- A link names the scene's shapes by their order. If a later version changes a preset's shapes, a
  link made before paints the new shapes; with another number of shapes, the drawing is left out,
  the settings load alone and the notice says so.
- A drawing too large for a link is dropped as a whole, and the sender sees one notice. Owner items
  (TODO.md): whether that notice is enough, or the app should show it where the user copies a link;
  and whether the caps (4,096 strokes, 64 passes) are right for weaker GPUs and phone CPUs.
- Links of this form do not open in an app from before this ADR, which reads only `#s=`.
