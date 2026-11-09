<script lang="ts">
  import { globalSpec, strainSpec, type Spec } from '../model/params';
  import { PRESETS } from '../model/presets';
  import { app, loadPreset } from './state.svelte';

  let dialog: HTMLDialogElement;
  const TABS = ['Physarum', 'The model', 'Controls', 'Experiments', 'About'] as const;
  let tab = $state<(typeof TABS)[number]>('Physarum');

  $effect(() => {
    if (app.learn && !dialog.open) dialog.showModal();
    if (!app.learn && dialog.open) dialog.close();
  });

  function run(id: string) {
    loadPreset(id);
    app.paused = false;
    app.learn = false;
  }

  const specs: Spec[] = [...Object.values(strainSpec), ...Object.values(globalSpec)];

  function onTabKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = (TABS.indexOf(tab) + step + TABS.length) % TABS.length;
    tab = TABS[i] ?? tab;
    document.getElementById(`learn-tab-${i}`)?.focus();
  }
</script>

<dialog bind:this={dialog} onclose={() => (app.learn = false)} aria-labelledby="learn-title">
  <header>
    <h2 id="learn-title">Learn</h2>
    <button type="button" class="ghost" onclick={() => (app.learn = false)} aria-label="Close">Close</button>
  </header>
  <!-- Tabs pattern (WAI-ARIA APG): roving tabindex, arrow keys move between tabs. -->
  <div class="tabs" role="tablist" aria-label="Topics" tabindex="-1" onkeydown={onTabKey}>
    {#each TABS as t, i (t)}
      <button
        type="button"
        role="tab"
        id="learn-tab-{i}"
        aria-selected={tab === t}
        aria-controls="learn-panel"
        tabindex={tab === t ? 0 : -1}
        onclick={() => (tab = t)}>{t}</button
      >
    {/each}
  </div>

  <div class="tabpanel" role="tabpanel" tabindex="0" id="learn-panel" aria-labelledby="learn-tab-{TABS.indexOf(tab)}">
    {#if tab === 'Physarum'}
      <p>
        <em>Physarum polycephalum</em>, the “many-headed slime”, is a slime mold. Its feeding stage is one giant cell
        with many nuclei: a yellow sheet that can grow larger than a hand. It has no brain and no nerves.
      </p>
      <p>
        Still, it finds food and connects food sources with an efficient network of tubes. Inside, the cell squeezes its
        liquid back and forth about every two minutes (shuttle streaming). Tubes that carry much flow grow thicker;
        tubes with little flow fade. In experiments it found the shortest way through a maze (Nakagaki 2000) and built a
        network like the Tokyo rail system (Tero 2010).
      </p>
      <p>
        It moves toward food by chemotaxis: it follows chemical gradients. It flees light and dryness. When the food
        runs out, it shrinks onto the remaining food sources.
      </p>
    {:else if tab === 'The model'}
      <p>
        Jeff Jones (2010) imitates the plasmodium with many tiny agents on a grid. Each agent stands for a bit of the
        cell. The agents leave a chemical trail and follow it. Every step has six parts:
      </p>
      <ol>
        <li>
          <strong>Sense.</strong> Three sensors in front of the agent read the trail: front, front-left and front-right.
        </li>
        <li>
          <strong>Rotate.</strong> Front strongest: keep going. Front weakest: turn left or right at random. Otherwise: turn
          toward the stronger side.
        </li>
        <li><strong>Move</strong> one step forward. In Jones’ original, only one agent may sit in each cell.</li>
        <li><strong>Deposit</strong> some trail after a successful move.</li>
        <li><strong>Diffuse:</strong> the trail spreads to the 8 neighbor cells (a 3 × 3 average).</li>
        <li><strong>Decay:</strong> a fixed fraction of the trail disappears.</li>
      </ol>
      <p>
        No agent knows the network. The network appears because trails attract agents, and agents strengthen trails.
        Diffusion and decay keep it from collapsing into dots.
      </p>
      <p>
        Here, several strains can share the dish. Each strain has its own trail. A table sets how strongly each strain
        follows or flees the trails of the others (an idea from Michael Fogleman’s version). Food and light add their
        own scents.
      </p>
    {:else if tab === 'Controls'}
      <dl>
        {#each specs as spec (spec.label)}
          <dt>{spec.label}</dt>
          <dd>
            {spec.help}{#if spec.ref}<cite> {spec.ref}</cite>{/if}
          </dd>
        {/each}
      </dl>
      <p>
        Keys: Space play/pause, . step, R reset, 1–7 tools, [ and ] brush size, F fit view, H hide panels, L this
        dialog.
      </p>
    {:else if tab === 'Experiments'}
      <p>Each experiment loads settings from the paper. Watch what the text describes.</p>
      <ul class="experiments">
        {#each PRESETS as p (p.id)}
          <li>
            <button
              type="button"
              onclick={() => {
                run(p.id);
              }}>{p.name}</button
            >
            <span
              >{p.watch ?? p.blurb}{#if p.ref}<cite> {p.ref}</cite>{/if}</span
            >
          </li>
        {/each}
      </ul>
    {:else}
      <p>
        Model: J. Jones, “Characteristics of Pattern Formation and Evolution in Approximations of Physarum Transport
        Networks”, <em>Artificial Life</em> 16(2): 127–153, 2010,
        <a href="https://doi.org/10.1162/artl.2010.16.2.16202" rel="noreferrer">doi:10.1162/artl.2010.16.2.16202</a>.
      </p>
      <p>
        GPU approach and visual inspiration: Sage Jenson,
        <a href="https://cargocollective.com/sagejenson/physarum" rel="noreferrer">physarum</a> (2019). Multiple species
        and presets “Cyclones”, “Dunes”, “Dot grid”: Michael Fogleman,
        <a href="https://github.com/fogleman/physarum" rel="noreferrer">physarum</a> (MIT license).
      </p>
      <p>
        This page runs fully in your browser on your graphics card with WebGPU. It sends no data anywhere and uses no
        cookies or tracking.
        <a href="https://github.com/KarstenSiemer/physarum-slime-mold" rel="noreferrer">Source code</a> (MIT license).
      </p>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(720px, calc(100vw - 32px));
    max-height: min(80vh, 760px);
    padding: 0 20px 20px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: rgba(12, 13, 18, 0.94);
    color: var(--fg);
    line-height: 1.55;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(3px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    background: inherit;
    padding-top: 12px;
  }
  h2 {
    margin: 0;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 10px 0 6px;
  }
  [role='tab'][aria-selected='true'] {
    background: rgba(255, 255, 255, 0.14);
  }
  dt {
    font-weight: 600;
    margin-top: 8px;
  }
  dd {
    margin: 2px 0 0;
    color: var(--muted);
  }
  cite {
    font-style: normal;
    color: var(--accent);
  }
  .experiments {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .experiments li {
    display: grid;
    grid-template-columns: 170px 1fr;
    gap: 10px;
    align-items: start;
  }
  a {
    color: var(--accent);
  }
</style>
