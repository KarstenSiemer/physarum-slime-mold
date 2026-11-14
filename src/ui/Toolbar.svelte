<script lang="ts">
  import { letter } from '../model/scene';
  import { app, getEngine, showNotice, toolsFor } from './state.svelte';

  function step() {
    app.paused = true;
    getEngine()?.frame(performance.now(), 1);
  }

  async function savePng() {
    try {
      const blob = await getEngine()?.snapshot();
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `physarum-${Date.now()}.png`;
      a.click();
      // Revoking at once can cancel the download in some browsers.
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
      }, 10_000);
    } catch (err) {
      showNotice(`Could not save the image: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
</script>

<div class="toolbar" role="toolbar" aria-label="Simulation controls">
  <div class="group">
    <button type="button" aria-pressed={!app.paused} onclick={() => (app.paused = !app.paused)} title="Space">
      {app.paused ? 'Play' : 'Pause'}
    </button>
    <button type="button" onclick={step} title="Period key">Step</button>
    <button type="button" onclick={() => getEngine()?.reset()} title="R">Reset</button>
  </div>

  <div class="group" role="radiogroup" aria-label="Tool">
    {#each toolsFor(app.settings.model) as t (t.id)}
      <button
        type="button"
        role="radio"
        aria-checked={app.tool === t.id}
        title="{t.help} ({t.key})"
        onclick={() => (app.tool = t.id)}>{t.label}</button
      >
    {/each}
  </div>

  {#if app.tool !== 'pan'}
    <label class="group brush">
      <span>Brush</span>
      <input type="range" min="4" max="120" bind:value={app.brush} aria-label="Brush size" />
    </label>
  {/if}

  {#if app.tool === 'inoculate' && app.settings.strains.length > 1}
    <div class="group" role="radiogroup" aria-label="Strain to place">
      {#each app.settings.strains as s, i (i)}
        <button
          type="button"
          role="radio"
          class="swatch"
          aria-checked={app.strain === i}
          aria-label="Strain {letter(i)}"
          style:--c={s.color}
          onclick={() => (app.strain = i)}>{letter(i)}</button
        >
      {/each}
    </div>
  {/if}

  <div class="group">
    <button type="button" onclick={() => getEngine()?.fitView()} title="F">Fit</button>
    <button
      type="button"
      aria-pressed={app.settings.showScent}
      title="Show the scent of food and light (S)"
      onclick={() => (app.settings.showScent = !app.settings.showScent)}>Scent</button
    >
    <button type="button" onclick={savePng}>Save PNG</button>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    padding: 8px;
  }
  .group {
    display: flex;
    gap: 2px;
    align-items: center;
    padding: 3px;
    border-radius: 10px;
    background: var(--glass);
    border: 1px solid var(--line);
  }
  .group button {
    border: 0;
    background: transparent;
  }
  .group button[aria-checked='true'],
  .group button[aria-pressed='true'] {
    background: rgba(255, 255, 255, 0.12);
    color: var(--fg);
  }
  .brush {
    padding: 3px 10px;
    gap: 8px;
    color: var(--muted);
  }
  .brush input {
    width: 110px;
  }
  /* Phones: one row that scrolls sideways instead of three wrapped rows. */
  @media (max-width: 720px) {
    .toolbar {
      flex-wrap: nowrap;
      justify-content: flex-start;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .group {
      flex: none;
    }
  }
  .swatch {
    min-width: 30px;
    border-bottom: 3px solid var(--c) !important;
  }
</style>
