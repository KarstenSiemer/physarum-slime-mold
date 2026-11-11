<script lang="ts">
  import { BACKGROUND } from '../engine/render';
  import { SCENT_BANDS, SCENT_FILL, SCENT_LEVELS, scentColours, scentOver } from '../engine/scent';
  import { hexToLinear, linearToHex } from '../model/color';
  import { app } from './state.svelte';

  const NONE = [0, 0] as const;
  /** The opacity of each band's fill (engine/scent.ts). */
  const fills = Array.from({ length: SCENT_BANDS }, (_, k) => SCENT_FILL[0] + SCENT_FILL[1] * k);

  // The bands as the view draws them over the bare dish of the current style, with the line at each power of ten.
  const layers = $derived.by(() => {
    const style = app.settings.style;
    const bg = hexToLinear(BACKGROUND[style]);
    const colours = scentColours(style);
    const food = {
      id: 'food',
      label: 'Food scent',
      bands: fills.map((a) => linearToHex(scentOver(bg, style, [a, 0], NONE))),
      edge: linearToHex(colours.food[1]),
    };
    const repellent = {
      id: 'repellent',
      label: 'Light repellent',
      bands: fills.map((a) => linearToHex(scentOver(bg, style, NONE, [a, 0]))),
      edge: linearToHex(colours.repellent[1]),
    };
    // Only the extended model has light (ADR 0022).
    return app.settings.model === 'extended' ? [food, repellent] : [food];
  });
  const label = (v: number) => (v >= 1000 ? `${String(v / 1000)}k` : String(v));
</script>

<figure class="legend" aria-labelledby="scent-legend-title">
  <figcaption id="scent-legend-title">Scent per cell</figcaption>
  {#each layers as l (l.id)}
    <div class="row">
      <span class="name">{l.label}</span>
      <span class="bar" aria-hidden="true" style:--n={SCENT_BANDS}>
        {#each l.bands as c, k (k)}<span class="band" style:--c={c} style:--edge={l.edge}></span>{/each}
      </span>
    </div>
  {/each}
  <div class="row">
    <span class="name"></span>
    <span class="bar ticks" style:--n={SCENT_BANDS}
      >{#each SCENT_LEVELS as v (v)}<span>{label(v)}</span>{/each}</span
    >
  </div>
  <p class="note">
    A band starts at its value. The next band starts at ten times that value. The view shows no scent below 0.01.
  </p>
</figure>

<style>
  .legend {
    margin: 0;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--glass);
    border: 1px solid var(--line);
    backdrop-filter: blur(14px);
    font-size: 11px;
    pointer-events: none;
  }
  figcaption {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 90px auto;
    align-items: center;
    gap: 6px;
  }
  .row + .row {
    margin-top: 3px;
  }
  .name {
    color: var(--muted);
  }
  .bar {
    display: grid;
    grid-template-columns: repeat(var(--n), 32px);
  }
  /* The line at the power of ten where each band starts. */
  .band {
    height: 12px;
    background: var(--c);
    border-left: 1px solid var(--edge);
  }
  .ticks span {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .note {
    margin: 4px 0 0;
    max-width: 320px;
    color: var(--muted);
  }
</style>
