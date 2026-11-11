<script lang="ts">
  import {
    BOUNDARIES,
    collisionsHelp,
    coveredFoodHelp,
    globalSpec,
    LAYOUTS,
    MAX_STRAINS,
    modelHelp,
    MODELS,
    RESOLUTIONS,
    sameLattice,
    STYLES,
    type Lattice,
    type Strain,
  } from '../model/params';
  import { GROUPS, latticeNotice, latticeText, PRESETS, presetById, ruleOffNotice, usesRule } from '../model/presets';
  import Matrix from './Matrix.svelte';
  import SceneCard from './SceneCard.svelte';
  import Section from './Section.svelte';
  import Slider from './Slider.svelte';
  import {
    addStrain,
    app,
    clearEnvironment,
    JONES_LIGHT,
    latticeLeft,
    latticeValue,
    lightDrawn,
    loadPreset,
    pickGrid,
    removeStrain,
    setModel,
    showNotice,
    useSceneLattice,
  } from './state.svelte';
  import StrainCard from './StrainCard.svelte';

  const s = $derived(app.settings);
  /** The Jones model offers only Jones' settings (ADR 0022). */
  const extended = $derived(s.model === 'extended');
  /** Light that the Jones model draws without effect: the panel says so below the model choice. */
  const lit = $derived(!extended && lightDrawn());
  /** The scene's lattice while the grid is another one: the panel says why the result differs (ADR 0026). */
  const left = $derived(latticeLeft());
  /** The lattices the grid choice offers: the one that runs and the scene's own. */
  const lattices = $derived(
    [s.lattice, app.sceneBase?.lattice ?? null].filter(
      (l, i, all): l is Lattice => l !== null && all.findIndex((m) => sameLattice(m, l)) === i,
    ),
  );

  const LAYOUT_LABEL: Record<(typeof LAYOUTS)[number], string> = {
    mixed: 'Mixed everywhere',
    bands: 'Side by side',
    sectors: 'Pie slices',
    colonies: 'One colony each',
    ring: 'Ring',
    center: 'Center spot',
    empty: 'Empty (inoculate)',
  };
  const BOUNDARY_LABEL: Record<(typeof BOUNDARIES)[number], string> = {
    wrap: 'Wrap around (no edges)',
    box: 'Closed box',
    dish: 'Petri dish',
  };
  const MODEL_LABEL: Record<(typeof MODELS)[number], string> = {
    jones: 'Jones (only Jones’ published rules)',
    extended: 'Extended (Jones plus this app’s rules)',
  };
  const STYLE_LABEL: Record<(typeof STYLES)[number], string> = {
    glow: 'Glow',
    gel: 'Gel relief',
    paper: 'Paper (like the article)',
    agents: 'Agents only',
  };

  let ruleHelp = $state(false);
  let modelHelpOpen = $state(false);
  let coveredHelp = $state(false);

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
      <span>Grid</span>
      <select
        value={s.lattice ? latticeValue(s.lattice) : String(s.resolution)}
        aria-describedby={left ? 'lattice-help' : undefined}
        onchange={(e) => {
          pickGrid(e.currentTarget.value);
        }}
      >
        {#each lattices as l (latticeValue(l))}
          <option value={latticeValue(l)}
            >{latticeText(l)}{sameLattice(l, app.sceneBase?.lattice ?? null) ? ', as in the paper' : ''}</option
          >
        {/each}
        {#each RESOLUTIONS as r (r)}<option value={String(r)}>{r} cells on the long side</option>{/each}
      </select>
    </label>
    {#if left}
      <div class="helptext" id="lattice-help">
        <p>{latticeNotice(left)}</p>
        <button type="button" onclick={useSceneLattice}>Use {latticeText(left)}</button>
      </div>
    {/if}
    <div class="check">
      <label>
        <input
          type="checkbox"
          checked={s.collisions && app.canCollide}
          disabled={!app.canCollide || !extended}
          aria-describedby={ruleHelp ? 'rule-help' : undefined}
          onchange={(e) => {
            setRule(e.currentTarget.checked);
          }}
        />
        <span
          >One agent per cell (Jones 2010){app.canCollide
            ? extended
              ? ''
              : ': always on in the Jones model'
            : ': not available here'}</span
        >
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
    <div class="check">
      <label class="field model">
        <span>{modelHelp.label}</span>
        <select
          value={s.model}
          aria-describedby={[modelHelpOpen && 'model-help', lit && 'jones-light'].filter(Boolean).join(' ') ||
            undefined}
          onchange={(e) => {
            setModel(e.currentTarget.value as (typeof MODELS)[number]);
          }}
        >
          {#each MODELS as m (m)}
            <option value={m} disabled={m === 'jones' && !app.canCollide}>{MODEL_LABEL[m]}</option>
          {/each}
        </select>
      </label>
      <button
        class="help"
        type="button"
        aria-expanded={modelHelpOpen}
        aria-controls="model-help"
        aria-label="About {modelHelp.label}"
        onclick={() => (modelHelpOpen = !modelHelpOpen)}>?</button
      >
    </div>
    {#if modelHelpOpen}
      <p class="helptext" id="model-help">{modelHelp.help} <cite>{modelHelp.ref}</cite></p>
    {/if}
    {#if extended}
      <!-- The extended model's own settings, where the choice of the model is. -->
      <Slider spec={globalSpec.scentDecay} bind:value={s.scentDecay} id="scent" />
      <Slider spec={globalSpec.trailSaturation} bind:value={s.trailSaturation} id="saturation" />
    {:else if lit}
      <p class="helptext" id="jones-light">{JONES_LIGHT}</p>
    {/if}
  </Section>

  <Section title="Strains" open>
    {#each s.strains as strain, i (i)}
      <StrainCard
        bind:strain={() => strain, (v: Strain) => (s.strains[i] = v)}
        index={i}
        removable={s.strains.length > 1}
        jones={!extended}
        onremove={() => {
          removeStrain(i);
        }}
      />
    {/each}
    {#if extended && s.strains.length < MAX_STRAINS}
      <button type="button" onclick={addStrain}>Add strain</button>
    {/if}
  </Section>

  {#if s.strains.length > 1}
    <Section title="Interactions" open>
      <Matrix bind:strains={s.strains} />
    </Section>
  {/if}

  <Section title="Environment">
    {#if extended}
      <Slider spec={globalSpec.diffusion} bind:value={s.diffusion} id="diffusion" />
    {/if}
    <Slider spec={globalSpec.foodStrength} bind:value={s.foodStrength} id="food" />
    {#if extended}
      <Slider spec={globalSpec.lightStrength} bind:value={s.lightStrength} id="light" />
    {/if}
    <div class="check">
      <label>
        <input
          type="checkbox"
          bind:checked={s.coveredFood}
          aria-describedby={coveredHelp ? 'covered-help' : undefined}
        />
        <span>{coveredFoodHelp.label}</span>
      </label>
      <button
        class="help"
        type="button"
        aria-expanded={coveredHelp}
        aria-controls="covered-help"
        aria-label="About {coveredFoodHelp.label}"
        onclick={() => (coveredHelp = !coveredHelp)}>?</button
      >
    </div>
    {#if coveredHelp}
      <p class="helptext" id="covered-help">{coveredFoodHelp.help} <cite>{coveredFoodHelp.ref}</cite></p>
    {/if}
    {#if s.coveredFood}
      <Slider spec={globalSpec.coveredFoodFactor} bind:value={s.coveredFoodFactor} id="covered-factor" />
    {/if}
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
  .check label.model {
    display: grid;
    gap: 4px;
    margin: 0;
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
  .helptext p {
    margin: 0 0 6px;
  }
  cite {
    display: block;
    font-style: normal;
    color: var(--accent);
    opacity: 0.8;
  }
</style>
