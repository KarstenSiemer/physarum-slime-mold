<script lang="ts">
  import { onMount } from 'svelte';
  import { BACKGROUND } from '../engine/render';
  import { SCENT_LEVELS, SCENT_LINE, SCENT_LOW, SCENT_TOP, scentGlow, scentOver, scentSensors } from '../engine/scent';
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
  // The view draws its line once a strand is measured and a strain follows food (scentSensors()).
  const lined = $derived(scentSensors(app.settings, strand).half.some((h) => h > 0));

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
      // The line as the view draws it over the bare dish.
      line: linearToHex(scentOver(bg, style, 0, SCENT_LINE, 0)),
    };
  });
  const label = (v: number) => (v >= 1000 ? `${String(v / 1000)}k` : String(v));
</script>

<figure class="legend" aria-labelledby="scent-legend-title" aria-describedby="scent-legend-note">
  <figcaption id="scent-legend-title">Scent per cell</figcaption>
  {#if !food && !light}
    <p class="empty" id="scent-legend-note">This scene has no food and no light, so it has no scent to show.</p>
  {:else}
    {#if food}
      <div class="row">
        <span class="name">Food <span class="sr-only">(green glow)</span></span>
        <span class="bar" style:background={colours.food}></span>
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
          <span class:odd={i % 2 === 1} style:left="{(i / SCENT_TOP) * 100}%"
            >{label(v)}{i === SCENT_TOP ? '+' : ''}</span
          >
        {/each}
      </span>
    </div>
    {#if food && lined}
      <!-- The line of the map (ADR 0009, decision of 2026-11-12): what it means, in one plain sentence. -->
      <div class="row">
        <span class="name"><span class="swatch" style:background={colours.line}></span></span>
        <span class="key">Inside the line, food steers an agent more than a strand holds it.</span>
      </div>
    {/if}
    <p class="note" id="scent-legend-note">
      {food ? 'Green glow: food scent.' : ''}
      {light ? 'Pink glow: the repellent of light.' : ''}
      The glow is stronger where the scent is stronger. Each number is ten times the number before it, and the glow stays
      the same from 10,000 up.
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
    max-width: 310px;
  }
  figcaption {
    font-weight: 600;
    margin-bottom: 4px;
  }
  /* The bar is 240 px wide, so the numbers below it keep apart (6 px and more with the fonts of macOS and Linux). */
  .row {
    display: grid;
    grid-template-columns: 40px 240px;
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
  /* The line of the map, as it shows over the bare dish. */
  .swatch {
    display: inline-block;
    width: 22px;
    height: 2px;
    vertical-align: middle;
  }
  .key {
    margin: 3px 0 1px;
    color: var(--fg);
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
  .note,
  .empty {
    margin: 4px 0 0;
    color: var(--muted);
  }
  /*
   * Phones and short screens: no note, so the legend covers little of the picture, and every other number, so the
   * numbers keep apart on the shorter bar (0.01, 1, 100 and 10k+).
   */
  @media (max-width: 720px), (max-height: 500px) {
    .note {
      display: none;
    }
    .row {
      grid-template-columns: 34px 180px;
    }
    .ticks > .odd {
      display: none;
    }
  }
</style>
