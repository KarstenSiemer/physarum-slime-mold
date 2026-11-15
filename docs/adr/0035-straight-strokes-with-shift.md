# 0035: Straight strokes with Shift

- Status: accepted (owner decisions, 2026-11-14), built 2026-11-14 (the amendment below)
- Date: 2026-11-14

## Context

The brush tools Food, Light, Wall and Erase paint along a drag of the pointer. `BrushDrag` (`src/ui/drag.ts`)
records a segment each time the pointer has moved half a brush radius, and each segment is a stroke
`{ kind, from, to, radius }` that `Engine.paint()` paints. The edit list holds the strokes, and a link carries them
(ADR 0019, ADR 0021). A straight wall or a straight row of food is hard to draw by hand this way.

The owner asked on 2026-11-14 that Shift lets the Wall tool join two points with a straight line, in place of drawing
at once on a press of the mouse. No tool uses Shift today (`src/App.svelte`).

`Engine.paint()` already paints a straight segment between two points with the radius of the brush. So a straight line
needs no new rule of the simulation: it is one stroke.

## Options

1. **Shift and two clicks** (the owner's request): the first click sets the start point, the second the end point.
2. Shift during a drag: the line runs from the start of the drag to the pointer, and the release paints it. One
   gesture in place of two clicks, as many drawing programs do it.
3. Option 1 or 2 with angles that snap to steps of 45°. Not asked for.

## Decision

1. **Option 1, for every brush tool: Food, Light, Wall and Erase** (owner, 2026-11-14: "Ja, mach es auch für die
   anderen Werkzeuge"). With Shift held, a click sets the start point, and the next click paints the straight line
   from it as one stroke with the radius of the brush.
2. **A preview between the two clicks** (owner, 2026-11-14: "zeige eine Vorschau"): the line from the start point to
   the pointer, as wide as the brush.
3. **The UI explains it** (owner, 2026-11-14: "eine Anleitung dazu muss mit in die UI"): in the help of each brush tool,
   in the list of keys in `README.md`, and in the Learn dialog.
4. **The agent tools Inoculate and Cut keep their way** (my choice under the owner's delegation of 2026-11-12). They act
   on every step while they are held (ADR 0023), and a line of two clicks has no time to stand for.
5. Open until it is built, and decided then with its reason here: what ends a start point that waits for its second
   click (Escape, another tool, Shift let go), how the preview looks in each style, and what a touch screen without
   Shift gets.

## Consequences

- A straight line is one stroke in the edit list, so a link with it stays short.
- The preview is drawn by the UI over the canvas. No byte of a simulation changes, and the simulation never reads it.
- Tests to add when it is built: an e2e test that Shift, a click and a second click paint a straight wall that the
  edit list holds as one stroke, for each brush tool; a test that the agent tools ignore Shift.

## Amendment 2026-11-14: built, and the open points of decision 5

The owner asked to work on without him on 2026-11-14 at night. So I chose the open points of decision 5 under the
delegation of 2026-11-12, each with its reason.

1. **A line ends where the next one starts.** While Shift is held, the end of a line is the start of the next one, so
   clicks in a row draw a line with corners, such as the walls of a maze. A single straight line needs no more clicks
   than before: let go of Shift after the second click. On the same grid the next line starts exactly at the end of the
   last one, with the same radius if the brush did not change. So painted food in a row of clicks is one connected food,
   and one food site of the flow (ADR 0029, decision 17, as built in its amendment 2026-11-14 (2)): a food stroke that
   starts at the end of the last one with the same radius joins it (`sites.test.ts` holds a row of lines as
   `StraightLine` makes them).
2. **What ends a start that waits:** Escape, letting go of Shift, a click without Shift, another tool, and the page
   losing the focus. The line exists only while Shift is held, so letting go of Shift is the plain way to stop. A page
   that loses the focus can miss the key going up, and a start the user cannot see would then wait for a later click.
3. **The start is a point of the scene.** It stays where it was clicked when the view moves or zooms between the
   clicks. It is kept in cells of the grid on screen with that grid (`StraightLine` in `src/ui/drag.ts`). When the
   startup check builds a new grid between the clicks, the canonical frame of the arena takes the start there, as it
   takes an edit (`toFrame()` and `fromFrame()` in `src/engine/environment.ts`).
4. **A press with Shift paints nothing while it drags.** The press set or ended a line. Without this, letting go of
   Shift before the button would paint a freehand drag from where the pointer is.
5. **The preview** is a band as wide as the brush from the start to the pointer: a light band with a dark rim, the same
   in every style. The light band shows on the dark styles (glow, gel, agents), and the dark rim on the white paper
   style. The UI draws it as an SVG over the canvas, so no byte of the simulation changes. While the pointer is off the
   canvas, the preview is a dot at the start. It follows the view in every frame, so a zoom between the clicks moves
   it with the scene.
6. **A touch screen without a keyboard has no straight lines.** The owner asked for Shift. A button for touch would be
   a control nobody asked for. A tablet with a keyboard has Shift.
7. **The engine gets two read-only parts:** `Engine.toCanvas()`, the inverse of `toGrid()`, for the preview, and
   `Engine.gridOnScreen`, the grid whose cells `toGrid()` gives.

Consequences:

- With Shift held, the keys 1 to 7 and `[` `]` give other characters on the common keyboard layouts (`!` for 1 on a US
  and on a German layout), so they switch no tool and change no brush size then. The toolbar and the slider still do.
- Tests: `src/ui/drag.test.ts` (the first click paints nothing, the second one stroke, a row of clicks joins, `end()`,
  no grid on screen, a new grid in each arena); in `tests/e2e/ui.spec.ts` one stroke per brush tool with its preview,
  a straight erase that removes a straight wall, a row of clicks with Escape, Shift let go and another tool, and Cut
  with Shift held.
