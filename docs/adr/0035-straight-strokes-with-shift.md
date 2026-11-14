# 0035: Straight strokes with Shift

- Status: accepted (owner decisions, 2026-11-14), not built yet (`TODO.md`)
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
