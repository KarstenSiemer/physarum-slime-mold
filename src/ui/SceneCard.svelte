<script lang="ts">
  import { tick } from 'svelte';
  import { presetById, sourceKind, sourceText } from '../model/presets';
  import { letter, strainNumbers } from '../model/scene';
  import { app, loadPreset, openLearn, sceneChanged, type LearnTab } from './state.svelte';

  const scene = $derived(presetById(app.scene));
  const changed = $derived(sceneChanged());
  let sourceOpen = $state(false);
  let heading = $state<HTMLHeadingElement>();

  // Each strain keeps the role it had in the scene, also after an earlier strain was removed.
  function role(i: number): string {
    const origin = app.strainOrigin[i] ?? -1;
    return (origin >= 0 ? scene?.strainRoles[origin] : undefined) ?? 'Added strain';
  }

  // Reload scene removes its own button, so the focus moves to the card's heading instead of the page.
  async function reload(id: string) {
    loadPreset(id);
    await tick();
    heading?.focus();
  }

  // Where "More in Learn" leads for each kind of source.
  const LEARN: Record<ReturnType<typeof sourceKind>, LearnTab> = {
    jones: 'The model',
    fogleman: 'About',
    nakagaki: 'Physarum',
    app: 'Scenes',
  };
</script>

<section id="scene-card" class="card" aria-label="Scene">
  {#if scene}
    <header>
      <h3 bind:this={heading} tabindex="-1">{scene.name}</h3>
      {#if changed}<span class="tag">changed</span>{/if}
    </header>
    <div class="chips">
      <button
        type="button"
        class="chip source"
        aria-expanded={sourceOpen}
        aria-controls="scene-source"
        title="Where these settings come from"
        onclick={() => (sourceOpen = !sourceOpen)}>{scene.source}</button
      >
      {#if app.settings.collisions}<span class="chip">One agent per cell</span>{/if}
    </div>
    {#if sourceOpen}
      <div class="source-text" id="scene-source">
        <p>{sourceText(scene)}</p>
        <button
          type="button"
          class="ghost"
          onclick={() => {
            openLearn(LEARN[sourceKind(scene)]);
          }}>More in Learn</button
        >
      </div>
    {/if}
    <p class="summary">{scene.summary}</p>
    {#if scene.watch}
      <p class="watch"><strong>What to watch:</strong> {scene.watch}</p>
    {/if}
    {#if changed}
      <p class="changed">
        <span>You changed the scene.</span>
        <button
          type="button"
          onclick={() => {
            void reload(scene.id);
          }}>Reload scene</button
        >
      </p>
    {/if}
    <details bind:open={app.sceneAbout}>
      <summary>About this scene</summary>
      <p>{scene.about}</p>
      <ul class="strains" aria-label="Strains">
        {#each app.settings.strains as st, i (i)}
          <li>
            <span class="dot" style:--c={st.color} aria-hidden="true"></span>
            <span
              ><strong>{letter(i)}</strong>
              {role(i)}: {strainNumbers(app.settings, i, scene.env)}.</span
            >
          </li>
        {/each}
      </ul>
      <h4>Why these settings</h4>
      <p>{scene.why}</p>
    </details>
  {:else}
    <!-- The address holds the settings since the page started, so a reload lands here as well (App.svelte). -->
    <p class="summary">
      These settings came from the page address, after a reload or from a shared link. The address names no scene, so
      there is no scene text. Choose a preset to load one.
    </p>
  {/if}
</section>

<style>
  .card {
    margin: 4px 0 10px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.03);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
  }
  h3 {
    margin: 0;
    font-size: 15px;
  }
  h4 {
    margin: 10px 0 2px;
    font-size: 13px;
  }
  .tag {
    color: var(--accent);
    font-size: 12px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0 6px;
  }
  .chip {
    min-height: 24px;
    padding: 2px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--muted);
    font-size: 12px;
    line-height: 18px;
    background: transparent;
    overflow-wrap: anywhere;
  }
  .chip.source {
    color: var(--accent);
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .source-text {
    margin: 0 0 8px;
    padding: 8px 10px;
    border-left: 2px solid var(--accent);
    background: rgba(255, 255, 255, 0.03);
    font-size: 12px;
  }
  .source-text p {
    margin: 0 0 4px;
  }
  .summary,
  .watch {
    margin: 6px 0;
  }
  .watch,
  details {
    color: var(--muted);
  }
  .changed {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
    margin: 8px 0;
    color: var(--accent);
  }
  summary {
    cursor: pointer;
    min-height: 24px;
    padding: 4px 0;
    color: var(--fg);
  }
  details p {
    margin: 4px 0;
  }
  .strains {
    list-style: none;
    margin: 6px 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .strains li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .strains strong {
    color: var(--fg);
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--c);
  }
</style>
