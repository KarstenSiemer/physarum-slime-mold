# 0059: The film of the slime keeps its cost

- Status: accepted (decision of the owner of 2026-11-17).
- Date: 2026-11-17
- Extends [ADR 0057](0057-the-film-of-the-slime.md): its first open point, the time that the film adds to a draw.

## Context

ADR 0057 draws the slime as a film. The film adds time to a draw where it covers the picture. ADR 0057 measured it
(Results, "The time of a draw"): a canvas of 2,560 × 1,600 pixels, the scene Three strains with film on every pixel,
the glow style, the view that fits the grid, milliseconds:

| Backend | A draw without the film | A draw with the film | The layer of ADR 0055 added |
| ------- | ----------------------- | -------------------- | --------------------------- |
| WebGPU  | 1.92                    | 4.10                 | 0.23                        |
| WebGL2  | 4.10                    | 8.24                 | 0.19                        |

- A screen of 60 Hz shows a new frame every 16.7 ms.
- One machine made all these times, an M3 Pro. No slower GPU is measured.
- With the switch Show slime off, a draw runs the shader without the film, as before.
- ADR 0057 names two ways to make the film cheaper without another picture. Neither is built or measured.
- On the same day the owner asked to bring the work on the look to an end. In the owner's words of that day, the
  look of the slime and of the electrodes had used more than half of the usage of the week.

## Options

1. Leave the film as it is.
2. Build one of the two ways now, with a measurement and with tests on both backends.

## Decision

Option 1. The agent asked: "Soll ich den Film des Schleims billiger machen?" (shall I make the film of the slime
cheaper?). The owner answered on 2026-11-17: "So lassen" (leave it so).

The agent recommended option 1 for two reasons:

- On the machine of the measurement the film adds about 4 ms to a draw at most, of the 16.7 ms of a frame.
- Option 2 is more work on the look, and the owner wanted to end that work.

## Consequences

- In a view that fits the grid or is zoomed in, a draw with film on every pixel takes about twice the time of a
  draw without the film (ADR 0057).
- The two ways stay in ADR 0057, Open points. A draw that is too slow on a weaker GPU is the reason to build one.
- A user with a slow picture can switch Show slime off.
