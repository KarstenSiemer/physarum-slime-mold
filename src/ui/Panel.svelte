<script lang="ts">
  import {
    BOUNDARIES,
    collisionsHelp,
    globalSpec,
    LAYOUTS,
    MAX_STRAINS,
    RESOLUTIONS,
    STYLES,
    type Strain,
  } from '../model/params';
  import { GROUPS, PRESETS, presetById, ruleOffNotice, usesRule } from '../model/presets';
  import Matrix from './Matrix.svelte';
  import SceneCard from './SceneCard.svelte';
  import Section from './Section.svelte';
  import Slider from './Slider.svelte';
  import { addStrain, app, clearEnvironment, loadPreset, removeStrain, showNotice } from './state.svelte';
  import StrainCard from './StrainCard.svelte';

  const s = $derived(app.settings);

  const LAYOUT_LABEL: Record<(typeof LAYOUTS)[number], string> = {
    mixed: 'Mixed everywhere',
    bands: 'Side by side',
    sectors: 'Pie slices',
    colonies: 'One colony each',
    ring: 'Ring',
    center: 'Center spot',
    empty: 'Empty dish (inoculate)',
  };
  const BOUNDARY_LABEL: Record<(typeof BOUNDARIES)[number], string> = {
    wrap: 'Wrap around (no edges)',
    box: 'Closed box',
    dish: 'Petri dish',
  };
  const STYLE_LABEL: Record<(typeof STYLES)[number], string> = {
    glow: 'Glow',
    gel: 'Gel relief',
    paper: 'Paper (like the article)',
    agents: 'Agents only',
  };

  let ruleHelp = $state(false);

  // The engine restarts the population on every switch, so agents stacked without the rule do not stay
  // stacked (ADR 0008).
  function setRule(on: boolean) {
    s.collisions = on;
    const scene = presetById(app.scene);
    if (!on && scene && usesRule(scene)) showNotice(ruleOffNotice(scene), 12_000);
  }
</script>

<aside class="panel" aria-label="Simulation settings">
  <Section title="Scene" bind:open={app.sceneSection}>
    <label class="field">
      <span>Preset</span>
      <select
        value={app.scene}
        onchange={(e) => {
          loadPreset(e.currentTarget.value);
        }}
      >
        {#if !app.scene}<option value="" disabled>Choose a preset…</option>{/if}
        {#each GROUPS as g (g.id)}
          <optgroup label={g.label}>
            {#each PRESETS.filter((p) => p.group === g.id) as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <SceneCard />
    <label class="field">
      <span>Start layout</span>
      <select bind:value={s.layout}>
        {#each LAYOUTS as l (l)}<option value={l}>{LAYOUT_LABEL[l]}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span>Edges</span>
      <select bind:value={s.boundary}>
        {#each BOUNDARIES as b (b)}<option value={b}>{BOUNDARY_LABEL[b]}</option>{/each}
      </select>
    </label>
    <Slider spec={globalSpec.density} bind:value={s.density} id="density" live={false} />
    <label class="field">
      <span>Grid (cells on the long side)</span>
      <select bind:value={s.resolution} onchange={() => (app.gridPicked = true)}>
        {#each RESOLUTIONS as r (r)}<option value={r}>{r}</option>{/each}
      </select>
    </label>
    <div class="check">
      <label>
        <input
          type="checkbox"
          checked={s.collisions && app.canCollide}
          disabled={!app.canCollide}
          aria-describedby={ruleHelp ? 'rule-help' : undefined}
          onchange={(e) => {
            setRule(e.currentTarget.checked);
          }}
        />
        <span>One agent per cell (Jones 2010){app.canCollide ? '' : ': not available here'}</span>
      </label>
      <button
        class="help"
        type="button"
        aria-expanded={ruleHelp}
        aria-controls="rule-help"
        aria-label="About {collisionsHelp.label}"
        onclick={() => (ruleHelp = !ruleHelp)}>?</button
      >
    </div>
    {#if ruleHelp}
      <p class="helptext" id="rule-help">
        {collisionsHelp.help}
        {#if !app.canCollide}Not available in this browser: it lacks the GPU feature EXT_float_blend.{/if}
        <cite>{collisionsHelp.ref}</cite>
      </p>
    {/if}
  </Section>

  <Section title="Strains" open>
    {#each s.strains as strain, i (i)}
      <StrainCard
        bind:strain={() => strain, (v: Strain) => (s.strains[i] = v)}
        index={i}
        removable={s.strains.length > 1}
        onremove={() => {
          removeStrain(i);
        }}
      />
    {/each}
    {#if s.strains.length < MAX_STRAINS}
      <button type="button" onclick={addStrain}>Add strain</button>
    {/if}
  </Section>

  {#if s.strains.length > 1}
    <Section title="Interactions" open>
      <Matrix bind:strains={s.strains} />
    </Section>
  {/if}

  <Section title="Environment">
    <Slider spec={globalSpec.diffusion} bind:value={s.diffusion} id="diffusion" />
    <Slider spec={globalSpec.foodStrength} bind:value={s.foodStrength} id="food" />
    <Slider spec={globalSpec.lightStrength} bind:value={s.lightStrength} id="light" />
    <Slider spec={globalSpec.scentDecay} bind:value={s.scentDecay} id="scent" />
    <Slider spec={globalSpec.shrink} bind:value={s.shrink} id="shrink" />
    <button type="button" onclick={clearEnvironment}>Clear food, light and walls</button>
  </Section>

  <Section title="Look">
    <label class="field">
      <span>Style</span>
      <select bind:value={s.style}>
        {#each STYLES as st (st)}<option value={st}>{STYLE_LABEL[st]}</option>{/each}
      </select>
    </label>
    <Slider spec={globalSpec.exposure} bind:value={s.exposure} id="exposure" />
    {#if s.style === 'glow'}
      <Slider spec={globalSpec.bloom} bind:value={s.bloom} id="bloom" />
    {/if}
    <Slider spec={globalSpec.speed} bind:value={s.speed} id="speed" />
  </Section>
</aside>

<style>
  .panel {
    overflow-y: auto;
    padding: 4px 14px 14px;
  }
  .field {
    display: grid;
    gap: 4px;
    margin: 6px 0 8px;
  }
  .field span,
  .check span {
    color: var(--fg);
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 8px 0;
  }
  .check label {
    flex: 1;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  /* WCAG 2.2 target size (2.5.8): at least 24 × 24 px. */
  .help {
    flex: none;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 50%;
    font-size: 12px;
    line-height: 1;
  }
  .helptext {
    margin: -2px 0 8px;
    color: var(--muted);
    font-size: 12px;
  }
  cite {
    display: block;
    font-style: normal;
    color: var(--accent);
    opacity: 0.8;
  }
</style>
