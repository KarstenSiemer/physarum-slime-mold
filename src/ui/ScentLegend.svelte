<script lang="ts">
  import { onMount } from 'svelte';
  import { BACKGROUND } from '../engine/render';
  import { SCENT_LEVELS, SCENT_LINE, SCENT_LOW, SCENT_TOP, scentGlow, scentMark, scentOver } from '../engine/scent';
  import { hexToLinear, linearToHex } from '../model/color';
  import { app, drawn, getEngine } from './state.svelte';

  // The trail of a strand, from the engine's auto levels (Levels.strand), read as often as the stats.
  let strand = $state(0);
  onMount(() => {
    const read = () => {
      strand = getEngine()?.levels().strand ?? 0;
    };
    read();
    const timer = setInterval(read, 500);
    return () => {
      clearInterval(timer);
    };
  });

  const food = $derived(drawn('food'));
  // Only the extended model reads the repellent, and the view draws it only there (ADR 0009).
  const light = $derived(app.settings.model === 'extended' && drawn('light'));
  const mark = $derived(scentMark(app.settings, strand));
  /** Where the mark lies on the bar, 0 to 1. */
  const markAt = $derived(mark > 0 ? Math.min(Math.max((Math.log10(mark) - SCENT_LOW) / SCENT_TOP, 0), 1) : undefined);

  // The glow as the view draws it over the bare dish of the current style, one stop per half power of ten.
  const colours = $derived.by(() => {
    const style = app.settings.style;
    const bg = hexToLinear(BACKGROUND[style]);
    const stops = (layer: 'food' | 'repellent') =>
      Array.from({ length: 2 * SCENT_TOP + 1 }, (_, i) => {
        const a = scentGlow(10 ** (SCENT_LOW + i / 2));
        const c = layer === 'food' ? scentOver(bg, style, a, 0, 0) : scentOver(bg, style, 0, 0, a);
        return `${linearToHex(c)} ${String((i / (2 * SCENT_TOP)) * 100)}%`;
      }).join(', ');
    return {
      food: `linear-gradient(to right, ${stops('food')})`,
      repellent: `linear-gradient(to right, ${stops('repellent')})`,
      // The line at the mark as the view draws it over the glow there.
      line: linearToHex(scentOver(bg, style, scentGlow(mark), SCENT_LINE, 0)),
    };
  });
  const label = (v: number) => (v >= 1000 ? `${String(v / 1000)}k` : String(v));
</script>

<figure class="legend" aria-labelledby="scent-legend-title" aria-describedby="scent-legend-note">
  <figcaption id="scent-legend-title">Scent per cell</figcaption>
  {#if !food && !light}
    <p class="empty" id="scent-legend-note">This scene has no food and no light, so it has no scent to show.</p>
  {:else}
    {#if food && markAt !== undefined}
      <div class="row">
        <span class="name"></span>
        <span class="scale"><span class="mark-label" style:left="{markAt * 100}%">a strand</span></span>
      </div>
    {/if}
    {#if food}
      <div class="row">
        <span class="name">Food <span class="sr-only">(green glow)</span></span>
        <span class="bar" style:background={colours.food}>
          {#if markAt !== undefined}<span class="mark" style:left="{markAt * 100}%" style:--line={colours.line}
            ></span>{/if}
        </span>
      </div>
    {/if}
    {#if light}
      <div class="row">
        <span class="name">Light <span class="sr-only">(pink glow)</span></span>
        <span class="bar" style:background={colours.repellent}></span>
      </div>
    {/if}
    <div class="row" aria-hidden="true">
      <span class="name"></span>
      <span class="scale ticks">
        {#each SCENT_LEVELS as v, i (v)}
          <span style:left="{(i / SCENT_TOP) * 100}%">{label(v)}{i === SCENT_TOP ? '+' : ''}</span>
        {/each}
      </span>
    </div>
    <p class="note" id="scent-legend-note">
      {food ? 'Green glow: food scent.' : ''}
      {light ? 'Pink glow: the repellent of light.' : ''}
      The glow is stronger where the scent is stronger. Each number is ten times the number before it, and the glow stays
      the same from 10,000 up.
      {food && markAt !== undefined
        ? 'The mark shows the trail of a strand. Inside the green line on the map, the food scent is stronger than that trail.'
        : ''}
    </p>
  {/if}
</figure>

<style>
  .legend {
    margin: 0;
    padding: 6px 8px;
    border-radius: 8px;
    /* The glass of the other panels, without a backdrop blur (ADR 0028). */
    background: var(--glass);
    border: 1px solid var(--line);
    font-size: 11px;
    pointer-events: none;
    max-width: 300px;
  }
  figcaption {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 40px 216px;
    align-items: center;
    gap: 6px;
  }
  .name {
    color: var(--muted);
  }
  .bar,
  .scale {
    position: relative;
    height: 12px;
  }
  .bar {
    border-radius: 3px;
    margin: 2px 0;
  }
  /* The mark: the line the view draws where the food scent equals the trail of a strand. */
  .mark {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-left: -1px;
    background: var(--line);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  }
  .scale > span {
    position: absolute;
    top: 0;
    white-space: nowrap;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    transform: translateX(-50%);
  }
  .ticks > span:first-child {
    transform: none;
  }
  .ticks > span:last-child {
    transform: translateX(-100%);
  }
  .mark-label {
    color: var(--fg) !important;
  }
  .note,
  .empty {
    margin: 4px 0 0;
    color: var(--muted);
  }
  /* Phones and short screens: no note, so the legend covers little of the picture. */
  @media (max-width: 720px), (max-height: 500px) {
    .note {
      display: none;
    }
    .row {
      grid-template-columns: 34px 180px;
    }
  }
</style>
