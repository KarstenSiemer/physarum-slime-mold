<script lang="ts">
  import { tick } from 'svelte';
  import { presetById } from '../model/presets';
  import { app, sceneChanged } from './state.svelte';

  const scene = $derived(presetById(app.scene));
  const changed = $derived(sceneChanged());

  // Opens the settings at the scene card, with "About this scene" open.
  async function show() {
    app.panel = true;
    app.sceneSection = true;
    app.sceneAbout = true;
    await tick();
    document.getElementById('scene-card')?.scrollIntoView({ block: 'nearest' });
  }
</script>

<button type="button" class="scene-label" title="About this scene" onclick={show}>
  <span class="sr-only">Scene:</span>
  <span class="name">{scene?.name ?? 'Custom settings'}</span>
  {#if changed}<span class="tag">changed</span>{/if}
</button>

<style>
  .scene-label {
    display: flex;
    gap: 8px;
    align-items: baseline;
    max-width: 100%;
    min-height: 28px;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--glass);
    backdrop-filter: blur(14px) saturate(140%);
    text-align: left;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .tag {
    flex: none;
    color: var(--accent);
    font-size: 12px;
  }
</style>
