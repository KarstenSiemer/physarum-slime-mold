<script lang="ts">
  import {
    BOUNDARIES,
    globalSpec,
    LAYOUTS,
    MAX_STRAINS,
    RESOLUTIONS,
    strainLike,
    STYLES,
    type Strain,
  } from '../model/params';
  import { PRESETS } from '../model/presets';
  import Matrix from './Matrix.svelte';
  import Section from './Section.svelte';
  import Slider from './Slider.svelte';
  import { app, getEngine, loadPreset } from './state.svelte';
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

  let preset = $state('');
  const chosen = $derived(PRESETS.find((p) => p.id === preset));

  // A new strain copies strain A of the scene: the defaults are Jones' values without the rule, which collapse.
  function addStrain() {
    const first = s.strains[0];
    if (first) s.strains.push(strainLike($state.snapshot(first), s.strains.length));
  }

  function removeStrain(i: number) {
    s.strains.splice(i, 1);
    for (const st of s.strains) st.attraction = [...st.attraction.slice(0, i), ...st.attraction.slice(i + 1), -1];
    app.strain = Math.min(app.strain, s.strains.length - 1);
  }
</script>

<aside class="panel" aria-label="Simulation settings">
  <Section title="Scene" open>
    <label class="field">
      <span>Preset</span>
      <select
        bind:value={preset}
        onchange={() => {
          loadPreset(preset);
        }}
      >
        <option value="" disabled>Choose a preset…</option>
        {#each PRESETS.filter((p) => !p.experiment) as p (p.id)}
          <option value={p.id}>{p.name}{p.ref ? ` (${p.ref})` : ''}</option>
        {/each}
        <optgroup label="Experiments">
          {#each PRESETS.filter((p) => p.experiment) as p (p.id)}
            <option value={p.id}>{p.name}{p.ref ? ` (${p.ref})` : ''}</option>
          {/each}
        </optgroup>
      </select>
    </label>
    {#if chosen}
      <p class="blurb">{chosen.watch ?? chosen.blurb}</p>
    {/if}
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
      <select bind:value={s.resolution}>
        {#each RESOLUTIONS as r (r)}<option value={r}>{r}</option>{/each}
      </select>
    </label>
    <label class="check" title={app.canCollide ? undefined : 'This browser lacks the GPU feature (EXT_float_blend).'}>
      <input type="checkbox" bind:checked={s.collisions} disabled={!app.canCollide} />
      <span>One agent per cell (Jones 2010){app.canCollide ? '' : ': not available here'}</span>
    </label>
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
    <button type="button" onclick={() => getEngine()?.clearEnvironment()}>Clear food, light and walls</button>
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
    gap: 8px;
    align-items: center;
    margin: 8px 0;
  }
  .blurb {
    margin: -2px 0 8px;
    color: var(--muted);
    font-size: 12px;
  }
</style>
