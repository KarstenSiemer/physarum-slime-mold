# 0095: The grains show without the picture of the tubes

- Status: accepted. The owner reported the bug on 2026-11-22. The coordinator decided on that day, under the owner's
  delegation of 2026-11-12. An agent built it on 2026-11-22 under the same delegation and chose the parts that
  decision 1 does not fix.
- Date: 2026-11-22
- Extends [ADR 0034](0034-the-picture-of-the-tubes.md), amendment of 2026-11-14 (the stream of the plasm), decision 7.
- In short: the switch "Draw the tubes by their flow" changes only the tubes. The grains of the plasm show while the
  flow runs and the style draws the trail, with the switch on or off. Without the picture of the tubes they lie on the
  trail of the view.

## Context

The owner, on 2026-11-22: with "Draw the tubes by their flow" on he sees the plasm move. When he switches it off, the
moving pattern is gone. Otherwise the view changes as it should.

The code did what ADR 0034 says. Decision 7 of its amendment of 2026-11-14 gives the grains no switch of their own:
they are a part of the picture of the tubes, until a picture of the tubes without grains is needed.
`Simulation.streamTexture` was undefined while `tubesShown()` was false, so the render pass drew no grains
(`streamFx` 0 in `render.ts` packView()). WebGL2 did the same. The owner reads the grains as the movement of the plasm,
not as a part of the drawn tubes, so a switch of the drawn tubes should not take them away.

## Options

1. The grains with the flow, with the switch on or off. The switch keeps one meaning: the drawn tubes.
2. A switch of their own for the grains. Nobody asked for one, and it adds a control that does little.
3. Keep the rule of ADR 0034 and say it better in the help. The owner reported it as a bug.

## Decision

Option 1, decided by the coordinator on 2026-11-22. The agent chose parts 2 to 6.

1. The grains show while the flow holds a state and the style draws the plasm, not in the style Agents only, with or
   without the picture of the tubes. No new switch. `grainsShown()` in `src/engine/tubes.ts` says it beside
   `tubesShown()`, which stays as it was.
2. The stream is a pass of its own on both backends: its own texture (WebGPU) or target (WebGL2) and its own mark of a
   stale state, made once for each drawn state while the grains show. The pass reads the memory and the pressure of the
   flow, and not the factors of the picture, so it needs no other pass. Without the picture a start builds and runs the
   stream alone (ADR 0049) and holds only its texture. With the picture both run, each once for each state.
3. Without the picture the grains lie on the trail of the view as they lie on the picture: more trail in the glow and on
   paper, a darker gel (`streaming()` in `render.wgsl`, `render.frag`). So they show only where trail is.
4. The fit of the grid still counts the three textures while the flow is on (`tubesBytesPerCell()` in
   `src/engine/sizing.ts`): the switch never changes the grid.
5. WebGPU kept the bind groups of a frame by the trail that the frame draws. The stream was a part of the picture, so one
   trail had one stream. Now the trail of the view goes with a stream or with none, and a simulation frees its stream
   while it lives, so a bind group is made again when its stream changes (`Groups.stream` in `render.ts`). WebGL2 binds
   its textures in each frame.
6. The help: the sentences about the grains move from the help of "Draw the tubes by their flow" to the help of "Flow in
   the tubes", which also says that they show with the switch on or off. The help of the switch says that it changes
   only the tubes and leaves the grains. The grains now go with the flow, not with the switch. Learn → Controls reads
   both texts.

## Consequences

- A picture of the tubes without grains still needs a switch of its own (decision 7 of ADR 0034).
- The research runners `research/flow/engine/picture-passes.gpu.test.ts` and `picture-ab.gpu.test.ts` mark the picture
  and the stream as stale and read both, so they time the same three passes as before. Since this record the stream
  runs in a submit of its own.
- Tests: `tubes.test.ts` (`grainsShown()` and the help texts); `tubes.gpu.test.ts` on both backends (the stream with the
  switch on and off and none without the grains, grains that move as far without the picture, and frames while the flow
  frees the stream and makes it again, in an error scope of WebGPU); `sim.gpu.test.ts` on both backends (a frame without
  the picture against the CPU copy of the styles). The wrong rules V94 and V95 (the grains go off with the switch, on
  each backend) and V96 (a frame keeps the stream of an earlier frame, WebGPU) are in
  `research/flow/engine/mutate.ts`.
