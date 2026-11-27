<script lang="ts">
  import { tick } from 'svelte';
  import { slimeSteps } from '../engine/slime';
  import {
    BOUNDARIES,
    capacityOf,
    collisionsHelp,
    coveredFoodHelp,
    decayForReach,
    flowEdgesHelp,
    flowHelp,
    globalSpec,
    repellentSpec,
    growthHelp,
    LAYOUTS,
    MAX_STRAINS,
    modelHelp,
    MODELS,
    RESOLUTIONS,
    sameLattice,
    scentReach,
    scentReachSpec,
    frontViewHelp,
    slimeViewHelp,
    snap,
    STEP_ORDERS,
    stepOrderHelp,
    GEL_COLORS,
    STYLES,
    territoryHelp,
    tubeViewHelp,
    type Lattice,
    type Strain,
  } from '../model/params';
  import {
    figureLattice,
    GROUPS,
    latticeLostNotice,
    latticeNotice,
    latticeOrigin,
    latticeText,
    PRESETS,
    presetById,
  } from '../model/presets';
  import Matrix from './Matrix.svelte';
  import SceneCard from './SceneCard.svelte';
  import Section from './Section.svelte';
  import Slider from './Slider.svelte';
  import {
    addStrain,
    app,
    clearEnvironment,
    clearLabel,
    getEngine,
    latticeLeft,
    latticeValue,
    loadPreset,
    pickGrid,
    removeStrain,
    setModel,
    setRule,
    setRules,
    useSceneLattice,
  } from './state.svelte';
  import StrainCard from './StrainCard.svelte';

  const s = $derived(app.settings);
  /** The Jones model offers only Jones' settings (ADR 0022). */
  const extended = $derived(s.model === 'extended');
  /** The scene's lattice while the grid is another one: the panel says why the result differs (ADR 0026). */
  const left = $derived(latticeLeft());
  /** The scene's lattice that this device could not hold, while it runs on another grid (ADR 0026). */
  const lost = $derived(
    app.lostLattice && !s.lattice && sameLattice(app.lostLattice, presetById(app.scene)?.settings().lattice ?? null)
      ? app.lostLattice
      : undefined,
  );
  /** The lattice of the scene is that of a figure of Jones 2010: only then the texts about the grid name the paper. */
  const figure = $derived(figureLattice(presetById(app.scene)));
  let gridSelect = $state<HTMLSelectElement>();

  // The button removes itself with the hint: the focus goes to the grid choice it changed, not to the page.
  async function useLattice() {
    useSceneLattice();
    await tick();
    gridSelect?.focus();
  }
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
    food: 'On food or start, one colony each',
    line: 'Vertical line',
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
  const GEL_COLOR_LABEL: Record<(typeof GEL_COLORS)[number], string> = {
    mild: 'Mild: thin gel a little pale',
    strong: 'Strong: thin gel nearly white',
  };
  const STYLE_LABEL: Record<(typeof STYLES)[number], string> = {
    glow: 'Glow',
    gel: 'Gel relief',
    paper: 'Paper (like the article)',
    agents: 'Agents only',
  };

  let ruleHelp = $state(false);
  let modelHelpOpen = $state(false);
  let orderHelpOpen = $state(false);
  const ORDER_LABEL: Record<(typeof STEP_ORDERS)[number], string> = {
    'move-first': 'Move first (Jones 2010)',
    'sense-first': 'Sense first (Jones 2011, Fogleman)',
  };
  let coveredHelp = $state(false);
  let growthHelpOpen = $state(false);
  let flowHelpOpen = $state(false);
  let edgesHelpOpen = $state(false);
  let territoryHelpOpen = $state(false);
  let tubeHelpOpen = $state(false);
  let slimeHelpOpen = $state(false);
  let frontHelpOpen = $state(false);
  /** The model has slime (ADR 0055): the extended model with a Slime life time above 0. */
  const slimy = $derived(slimeSteps(s) > 0);
  /** Growth and shrinkage need one agent per cell: their window counts assume it (ADR 0025). */
  const canGrow = $derived(app.canCollide && s.collisions);
  /**
   * The rules of the growth front run (engine/territory.ts territoryOn(), ADR 0068): their switch, with the flow and
   * growth, which needs the rule of one agent per cell.
   */
  const rules = $derived(s.flow && s.growth && canGrow && s.territory);
  /** The most Capacity can be: one agent per cell with the rule (capacityOf()). */
  const capacityMax = $derived(s.collisions ? 1 : globalSpec.capacity.max);
  /**
   * Growth is on, but every agent the simulation holds lives, so no agent can divide (ADR 0025): from the alive count
   * of the current run (app.stats), as deadLeft() reads it.
   */
  const noRoom = $derived.by(() => {
    const e = getEngine();
    if (!s.growth || !canGrow || app.stats.run !== e?.restarts) return false;
    return app.stats.alive.reduce((a, b) => a + b, 0) >= e.sim.agents;
  });
  /** The Capacity that the hint offers: room for an agent in every cell (growth runs only with the rule). */
  const roomy = $derived(capacityMax);
  // The button removes itself at once: the focus goes to the Capacity it changed, not to the page.
  async function raiseCapacity() {
    s.capacity = roomy;
    await tick();
    document.getElementById('capacity')?.focus();
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
        bind:this={gridSelect}
        value={s.lattice ? latticeValue(s.lattice) : String(s.resolution)}
        aria-describedby={left || lost ? 'lattice-help' : undefined}
        onchange={(e) => {
          pickGrid(e.currentTarget.value);
        }}
      >
        {#each lattices as l (latticeValue(l))}
          <option value={latticeValue(l)}>
            {latticeText(l)}{sameLattice(l, app.sceneBase?.lattice ?? null) ? latticeOrigin(figure) : ''}
          </option>
        {/each}
        {#each RESOLUTIONS as r (r)}<option value={String(r)}>{r} cells on the long side</option>{/each}
      </select>
    </label>
    {#if left}
      <div class="lattice" id="lattice-help">
        <p class="helptext">{latticeNotice(left, s, figure)}</p>
        <button type="button" class="action" onclick={useLattice}>Use {latticeText(left)}</button>
      </div>
    {:else if lost}
      <p class="helptext" id="lattice-help">{latticeLostNotice(lost, s, figure)}</p>
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
        <span>
          One agent per cell (Jones 2010){app.canCollide
            ? extended
              ? ''
              : ': always on in the Jones model'
            : ': not available here'}
        </span>
      </label>
      <button
        class="help"
        type="button"
        aria-expanded={ruleHelp}
        aria-controls="rule-help"
        aria-label="About {collisionsHelp.label}"
        onclick={() => (ruleHelp = !ruleHelp)}
      >
        ?
      </button>
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
          aria-describedby={modelHelpOpen ? 'model-help' : undefined}
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
        onclick={() => (modelHelpOpen = !modelHelpOpen)}
      >
        ?
      </button>
    </div>
    {#if modelHelpOpen}
      <p class="helptext" id="model-help">{modelHelp.help} <cite>{modelHelp.ref}</cite></p>
    {/if}
    <!-- The order of a step, in both models: each scene sets the order of its paper (ADR 0027). -->
    <div class="check">
      <label class="field model">
        <span>{stepOrderHelp.label}</span>
        <select bind:value={s.stepOrder} aria-describedby={orderHelpOpen ? 'order-help' : undefined}>
          {#each STEP_ORDERS as o (o)}
            <option value={o}>{ORDER_LABEL[o]}</option>
          {/each}
        </select>
      </label>
      <button
        class="help"
        type="button"
        aria-expanded={orderHelpOpen}
        aria-controls="order-help"
        aria-label="About {stepOrderHelp.label}"
        onclick={() => (orderHelpOpen = !orderHelpOpen)}
      >
        ?
      </button>
    </div>
    {#if orderHelpOpen}
      <p class="helptext" id="order-help">{stepOrderHelp.help} <cite>{stepOrderHelp.ref}</cite></p>
    {/if}
    {#if extended}
      <!-- The extended model's own settings, where the choice of the model is. -->
      <Slider spec={globalSpec.scentDecay} bind:value={s.scentDecay} id="scent" />
      <!-- Scent decay in cells (ADR 0036): no setting of its own. Without diffusion the scent does not spread. -->
      {#if s.diffusion > 0}
        <Slider
          spec={scentReachSpec(s.diffusion)}
          bind:value={
            () => scentReach(s.scentDecay, s.diffusion),
            (reach: number) => (s.scentDecay = snap(decayForReach(reach, s.diffusion), globalSpec.scentDecay))
          }
          id="scent-reach"
        />
      {/if}
      <Slider spec={globalSpec.trailSaturation} bind:value={s.trailSaturation} id="saturation" />
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
    {:else}
      <!-- The window of the one mean of the Jones model (ADR 0046); the extended model has passes of 3 × 3. -->
      <Slider spec={globalSpec.meanWindow} bind:value={s.meanWindow} id="mean-window" />
    {/if}
    <Slider spec={globalSpec.foodStrength} bind:value={s.foodStrength} id="food" />
    <!-- The Jones model reads drawn light as a repellent source of its trail map, and names it so (ADR 0044). -->
    <Slider spec={extended ? globalSpec.lightStrength : repellentSpec} bind:value={s.lightStrength} id="light" />
    <!-- The strength of the poles of the Electrode tool, in both models (ADR 0047). -->
    <Slider spec={globalSpec.electrodeStrength} bind:value={s.electrodeStrength} id="electrode" />
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
        onclick={() => (coveredHelp = !coveredHelp)}
      >
        ?
      </button>
    </div>
    {#if coveredHelp}
      <p class="helptext" id="covered-help">{coveredFoodHelp.help} <cite>{coveredFoodHelp.ref}</cite></p>
    {/if}
    {#if s.coveredFood}
      <Slider spec={globalSpec.coveredFoodFactor} bind:value={s.coveredFoodFactor} id="covered-factor" />
    {/if}
    <Slider spec={globalSpec.shrink} bind:value={s.shrink} id="shrink" />
    <button type="button" onclick={clearEnvironment}>{clearLabel(s)}</button>
  </Section>

  <Section title="Growth">
    <div class="check">
      <label>
        <input
          type="checkbox"
          checked={s.growth && canGrow}
          disabled={!canGrow}
          aria-describedby={growthHelpOpen ? 'growth-help' : undefined}
          onchange={(e) => {
            s.growth = e.currentTarget.checked;
          }}
        />
        <span>
          {growthHelp.label} (Jones 2011){app.canCollide
            ? s.collisions
              ? ''
              : ': needs one agent per cell'
            : ': not available here'}
        </span>
      </label>
      <button
        class="help"
        type="button"
        aria-expanded={growthHelpOpen}
        aria-controls="growth-help"
        aria-label="About {growthHelp.label}"
        onclick={() => (growthHelpOpen = !growthHelpOpen)}
      >
        ?
      </button>
    </div>
    {#if growthHelpOpen}
      <p class="helptext" id="growth-help">{growthHelp.help} <cite>{growthHelp.ref}</cite></p>
    {/if}
    {#if s.growth && canGrow}
      {#if s.growthEvery === 0 && s.shrinkEvery === 0}
        <p class="hint">Both tests are off, so growth and shrinkage do nothing.</p>
      {/if}
      {#if noRoom}
        <p class="hint">
          Growth has no room: every agent that the simulation holds is alive, and a child needs a dead agent.
          {#if roomy > capacityOf(s)}
            Raise Capacity to make room. This restarts the scene.
            <button type="button" class="action" onclick={raiseCapacity}>Set Capacity to {roomy}</button>
          {/if}
        </p>
      {/if}
      <Slider spec={globalSpec.growthEvery} bind:value={s.growthEvery} id="growth-every" />
      <Slider spec={globalSpec.growthWindow} bind:value={s.growthWindow} id="growth-window" />
      <!-- Each minimum stays at most its maximum, and each maximum within its window (constrain()). -->
      <Slider spec={{ ...globalSpec.growthMin, max: s.growthMax }} bind:value={s.growthMin} id="growth-min" />
      <Slider
        spec={{ ...globalSpec.growthMax, min: Math.max(1, s.growthMin), max: s.growthWindow ** 2 }}
        bind:value={s.growthMax}
        id="growth-max"
      />
      <Slider spec={globalSpec.shrinkEvery} bind:value={s.shrinkEvery} id="shrink-every" />
      <Slider spec={globalSpec.shrinkWindow} bind:value={s.shrinkWindow} id="shrink-window" />
      <Slider spec={{ ...globalSpec.shrinkMin, max: s.shrinkMax }} bind:value={s.shrinkMin} id="shrink-min" />
      <Slider
        spec={{ ...globalSpec.shrinkMax, min: Math.max(1, s.shrinkMin), max: s.shrinkWindow ** 2 }}
        bind:value={s.shrinkMax}
        id="shrink-max"
      />
      {#if extended}
        <Slider spec={globalSpec.lightGrowth} bind:value={s.lightGrowth} id="light-growth" />
      {/if}
    {/if}
    <!-- Capacity is at least Agents per cell and at most 1 with the rule: the slider shows what the simulation holds
    (capacityOf()). A value at or below Agents per cell stores 0, as many as Agents per cell. -->
    <Slider
      spec={{ ...globalSpec.capacity, max: capacityMax }}
      bind:value={() => capacityOf(s), (v: number) => (s.capacity = v <= s.density ? 0 : v)}
      id="capacity"
      live={false}
    />
  </Section>

  {#if extended}
    <!-- The flow in the tubes is a rule of the extended model only (ADR 0029). -->
    <Section title="Flow">
      <div class="check">
        <label>
          <input type="checkbox" bind:checked={s.flow} aria-describedby={flowHelpOpen ? 'flow-help' : undefined} />
          <span>{flowHelp.label}</span>
        </label>
        <button
          class="help"
          type="button"
          aria-expanded={flowHelpOpen}
          aria-controls="flow-help"
          aria-label="About {flowHelp.label}"
          onclick={() => (flowHelpOpen = !flowHelpOpen)}
        >
          ?
        </button>
      </div>
      {#if flowHelpOpen}
        <p class="helptext" id="flow-help">{flowHelp.help} <cite>{flowHelp.ref}</cite></p>
      {/if}
      {#if s.flow}
        <Slider spec={globalSpec.flowStrength} bind:value={s.flowStrength} id="flow-strength" />
        <!-- The neighbours and the base conductance of the flow act in every scene with the flow (ADR 0086); a change
        acts at the next step. -->
        <div class="check">
          <label>
            <input
              type="checkbox"
              checked={s.flowEdges === 8}
              aria-describedby={edgesHelpOpen ? 'edges-help' : undefined}
              onchange={(e) => {
                s.flowEdges = e.currentTarget.checked ? 8 : 4;
              }}
            />
            <span>{flowEdgesHelp.label}</span>
          </label>
          <button
            class="help"
            type="button"
            aria-expanded={edgesHelpOpen}
            aria-controls="edges-help"
            aria-label="About {flowEdgesHelp.label}"
            onclick={() => (edgesHelpOpen = !edgesHelpOpen)}
          >
            ?
          </button>
        </div>
        {#if edgesHelpOpen}
          <p class="helptext" id="edges-help">{flowEdgesHelp.help}</p>
        {/if}
        <Slider spec={globalSpec.flowBase} bind:value={s.flowBase} id="flow-base" />
        <!-- The rules of the growth front run only with growth, and so with one agent per cell, and the flow
        (territoryOn(), ADR 0068); a switch restarts the scene. Their drift and their flux to the front act only with
        them (ADR 0070, ADR 0086). Their switch on also sets the levers of the Crown of veins (setRules(),
        ADR 0098). -->
        {#if s.growth && canGrow}
          <div class="check">
            <label>
              <input
                type="checkbox"
                checked={s.territory}
                aria-describedby={territoryHelpOpen ? 'territory-help' : undefined}
                onchange={(e) => {
                  setRules(e.currentTarget.checked);
                }}
              />
              <span>{territoryHelp.label}</span>
            </label>
            <button
              class="help"
              type="button"
              aria-expanded={territoryHelpOpen}
              aria-controls="territory-help"
              aria-label="About {territoryHelp.label}"
              onclick={() => (territoryHelpOpen = !territoryHelpOpen)}
            >
              ?
            </button>
          </div>
          {#if territoryHelpOpen}
            <p class="helptext" id="territory-help">{territoryHelp.help} <cite>{territoryHelp.ref}</cite></p>
          {/if}
          {#if s.territory}
            <Slider spec={globalSpec.drift} bind:value={s.drift} id="drift" />
            <Slider spec={globalSpec.frontFlux} bind:value={s.frontFlux} id="front-flux" />
          {/if}
        {/if}
        <!-- The picture of the tubes changes the view only (ADR 0034). -->
        <div class="check">
          <label>
            <input
              type="checkbox"
              bind:checked={s.showTubes}
              aria-describedby={tubeHelpOpen ? 'tube-help' : undefined}
            />
            <span>{tubeViewHelp.label}</span>
          </label>
          <button
            class="help"
            type="button"
            aria-expanded={tubeHelpOpen}
            aria-controls="tube-help"
            aria-label="About {tubeViewHelp.label}"
            onclick={() => (tubeHelpOpen = !tubeHelpOpen)}
          >
            ?
          </button>
        </div>
        {#if tubeHelpOpen}
          <p class="helptext" id="tube-help">{tubeViewHelp.help}</p>
        {/if}
      {/if}
    </Section>

    <!-- The slime is a part of the extended model only (ADR 0055). It needs no flow, so it has a section of its own. -->
    <Section title="Slime">
      <!-- How long the slime stays where the colony was. At 0 the model has no slime, and the switch below goes. -->
      <Slider spec={globalSpec.slimeLife} bind:value={s.slimeLife} id="slime-life" />
      <!-- The avoidance of slime is a part of the rules of the growth front (ADR 0088): its two settings show while the
      rules run and the model has slime, and a line names the switch of the rules while they do not run. A change acts
      at the next step. -->
      {#if slimy && rules}
        <Slider spec={globalSpec.slimeWeight} bind:value={s.slimeWeight} id="slime-weight" />
        <Slider spec={globalSpec.freshReach} bind:value={s.freshReach} id="fresh-reach" />
      {:else if slimy}
        <p class="hint">
          The avoidance of slime needs the switch Rules of the growth front in the Flow section, which shows with Flow
          in the tubes and Growth and shrinkage.
        </p>
      {/if}
      {#if slimy}
        <!-- The film of the slime changes the view only (decision 8). -->
        <div class="check">
          <label>
            <input
              type="checkbox"
              bind:checked={s.showSlime}
              aria-describedby={slimeHelpOpen ? 'slime-help' : undefined}
            />
            <span>{slimeViewHelp.label}</span>
          </label>
          <button
            class="help"
            type="button"
            aria-expanded={slimeHelpOpen}
            aria-controls="slime-help"
            aria-label="About {slimeViewHelp.label}"
            onclick={() => (slimeHelpOpen = !slimeHelpOpen)}
          >
            ?
          </button>
        </div>
        {#if slimeHelpOpen}
          <p class="helptext" id="slime-help">{slimeViewHelp.help}</p>
        {/if}
        <!-- The skirt of the growth front changes the view only (ADR 0060). The front field is a part of the slime. -->
        {#if s.growth && s.collisions}
          <div class="check">
            <label>
              <input
                type="checkbox"
                bind:checked={s.showFront}
                aria-describedby={frontHelpOpen ? 'front-help' : undefined}
              />
              <span>{frontViewHelp.label}</span>
            </label>
            <button
              class="help"
              type="button"
              aria-expanded={frontHelpOpen}
              aria-controls="front-help"
              aria-label="About {frontViewHelp.label}"
              onclick={() => (frontHelpOpen = !frontHelpOpen)}
            >
              ?
            </button>
          </div>
          {#if frontHelpOpen}
            <p class="helptext" id="front-help">{frontViewHelp.help}</p>
          {/if}
        {/if}
      {/if}
    </Section>
  {/if}

  <Section title="Look">
    <label class="field">
      <span>Style</span>
      <select bind:value={s.style}>
        {#each STYLES as st (st)}<option value={st}>{STYLE_LABEL[st]}</option>{/each}
      </select>
    </label>
    {#if s.style === 'gel'}
      <!-- How pale and how clear thin gel is against thick gel (ADR 0009). -->
      <label class="field">
        <span>Gel color</span>
        <select bind:value={s.gelColor}>
          {#each GEL_COLORS as c (c)}<option value={c}>{GEL_COLOR_LABEL[c]}</option>{/each}
        </select>
      </label>
    {/if}
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
  .hint {
    margin: 4px 0 8px;
    font-size: 12px;
    color: var(--fg);
  }
  .hint button {
    display: block;
    margin-top: 4px;
  }
  .lattice {
    margin: -2px 0 10px;
  }
  .lattice .helptext {
    margin: 0 0 6px;
  }
  /* An action, like Reload scene in the scene card. */
  .action {
    color: var(--accent);
    font-size: 13px;
  }
  cite {
    display: block;
    font-style: normal;
    color: var(--accent);
    opacity: 0.8;
  }
</style>
