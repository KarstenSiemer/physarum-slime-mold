# 0004: Svelte 5 for the user interface

- Status: accepted
- Date: 2026-11-08

## Context

The UI is not a few sliders. It has 1–4 strain cards that appear and disappear, a strain ×
strain matrix, a tool bar, a preset gallery that updates every control at once, dialogs with
explanations, keyboard shortcuts and URL sync ([design §4](../design.md#4-interaction)). It
must be accessible and look polished. The engine must stay independent of the UI.

## Options

1. **Plain TypeScript + DOM** — no dependency, but hand-written state sync for dynamic lists
   and presets; most code, most bugs.
2. **Tweakpane / lil-gui** — fastest to build, but fixed layout and look; weak for
   explanatory content, custom widgets (matrix, sensor diagram) and accessibility.
3. **React / Preact** — mature; virtual DOM runtime, more boilerplate for this size.
4. **Svelte 5 (runes)** — compiles to direct DOM updates with a small runtime; `$state` maps
   directly to the parameter object; compiler warns about accessibility problems; first-class
   Vite plugin and TypeScript support.

## Decision

Option 4 with plain CSS (custom properties for theme). Native elements first: `<input
type="range">`, `<input type="color">`, `<dialog>`, `popover`. The engine (`src/engine`) has no
Svelte imports.

## Consequences

- Extra dev dependencies: `svelte`, `@sveltejs/vite-plugin-svelte`, `svelte-check`,
  `eslint-plugin-svelte`, `prettier-plugin-svelte`.
- `svelte-check` must pass in CI. `{@html}` is banned by lint (no HTML from strings).
