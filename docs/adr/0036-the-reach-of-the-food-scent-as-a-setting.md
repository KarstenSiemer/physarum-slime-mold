# 0036: The reach of the food scent as a setting

- Status: accepted (owner decision, 2026-11-14); the form of the setting is open (`TODO.md`)
- Date: 2026-11-14

## Context

The owner asked on 2026-11-14 to set the radius of the scent of food in the UI.

What sets the reach today:

- In the extended model the food scent is a field of its own. Its reach follows from the setting Scent decay and from
  the number of diffusion passes. `emissionScale()` scales the source with the decay, so a large food reaches the same
  plateau at every decay ([model.md](../model.md), section 6.4; ADR 0022).
- In the Jones model the food scent is part of Jones' one trail map. It decays with the strain, and the model holds
  only Jones' published rules (ADR 0022, the owner's decision "Jones streng" of 2026-11-11).
- A measurement of 2026-11-12: the agents follow food only to about 12 to 14 cells from it in every model, also where
  the scent reaches farther at a low decay (ADR 0009, decision 6 of the amendment on the line where food steers). So a
  wider scent alone did not steer agents from farther away.

## Options

1. A setting of the reach in cells, from which the app computes the scent decay. It needs the relation of reach,
   decay and diffusion passes, measured on the grid.
2. Keep Scent decay as the setting, and show the reach in cells that it gives.
3. A source of the food scent of its own, for example a disc of a set radius. A new rule of the extended model.

## Decision

1. **The panel gets a setting for the reach of the food scent** (owner, 2026-11-14).
2. **Only in the extended model** (my choice under the owner's delegation of 2026-11-12): in the Jones model a reach
   of its own would break Jones' one map, against the owner's decision of 2026-11-11.
3. **The form is open.** Before it is chosen: measure the reach of the scent against the decay and the passes, and
   whether the agents follow food from farther away with it (the item of the steering reach in `TODO.md`). Option 1
   or 2 changes no rule; option 3 does, and then `docs/model.md` changes in the same pull request.

## Consequences

- A scene keeps its bytes as long as its setting keeps its value.
- If the agents still follow food only to 12 to 14 cells, a larger reach shows in the scent view but steers no farther.
  Then the setting needs a rule of steering too, or a text in the UI that says so.
