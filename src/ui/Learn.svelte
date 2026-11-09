<script lang="ts">
  import { globalSpec, strainSpec, type Spec } from '../model/params';
  import { GROUPS, PRESETS } from '../model/presets';
  import { letter, strainNumbers } from '../model/scene';
  import { app, LEARN_TABS, loadPreset } from './state.svelte';

  let dialog: HTMLDialogElement;

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

  // Each scene's strains with the numbers of its own settings (not the live ones).
  const sceneStrains = new Map(
    PRESETS.map((p) => {
      const s = p.settings();
      return [p.id, s.strains.map((st, i) => ({ color: st.color, text: strainNumbers(s, i, p.env) }))] as const;
    }),
  );
  let details = $state<Record<string, boolean>>({});

  function onTabKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = (LEARN_TABS.indexOf(app.learnTab) + step + LEARN_TABS.length) % LEARN_TABS.length;
    app.learnTab = LEARN_TABS[i] ?? app.learnTab;
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
    {#each LEARN_TABS as t, i (t)}
      <button
        type="button"
        role="tab"
        id="learn-tab-{i}"
        aria-selected={app.learnTab === t}
        aria-controls="learn-panel"
        tabindex={app.learnTab === t ? 0 : -1}
        onclick={() => (app.learnTab = t)}>{t}</button
      >
    {/each}
  </div>

  <div
    class="tabpanel"
    role="tabpanel"
    tabindex="0"
    id="learn-panel"
    aria-labelledby="learn-tab-{LEARN_TABS.indexOf(app.learnTab)}"
  >
    {#if app.learnTab === 'Physarum'}
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
    {:else if app.learnTab === 'The model'}
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
    {:else if app.learnTab === 'Controls'}
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
    {:else if app.learnTab === 'Scenes'}
      <p>
        Each scene loads its settings with its food, light and walls. Scenes marked Jones 2010 use the settings of a
        figure in his paper, on a grid shaped like your screen. Fogleman 2020 scenes are his saved settings. The others
        were made for this app.
      </p>
      {#each GROUPS as g (g.id)}
        <h3>{g.label}</h3>
        <ul class="scenes">
          {#each PRESETS.filter((p) => p.group === g.id) as p (p.id)}
            <li class="scene">
              <div class="head">
                <h4>{p.name}</h4>
                <span class="chip">{p.source}</span>
              </div>
              <p>{p.summary}</p>
              <div class="actions">
                <button
                  type="button"
                  onclick={() => {
                    run(p.id);
                  }}>Load<span class="sr-only"> {p.name}</span></button
                >
                <button
                  type="button"
                  class="ghost"
                  aria-expanded={details[p.id] === true}
                  aria-controls="details-{p.id}"
                  onclick={() => (details[p.id] = !details[p.id])}
                  >Details<span class="sr-only"> of {p.name}</span></button
                >
              </div>
              {#if details[p.id]}
                <div class="details" id="details-{p.id}">
                  {#if p.watch}<p><strong>What to watch:</strong> {p.watch}</p>{/if}
                  <p>{p.about}</p>
                  <ul class="strains" aria-label="Strains">
                    {#each sceneStrains.get(p.id) ?? [] as st, i (i)}
                      <li>
                        <span class="dot" style:--c={st.color} aria-hidden="true"></span>
                        <span><strong>{letter(i)}</strong> {p.strainRoles[i]}: {st.text}.</span>
                      </li>
                    {/each}
                  </ul>
                  <p><strong>Why these settings:</strong> {p.why}</p>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/each}
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
    /* The width includes padding and border: content-box sizing made it 385 px wide on a 375 px phone. */
    box-sizing: border-box;
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
  h3 {
    margin: 18px 0 8px;
    font-size: 14px;
  }
  h4 {
    margin: 0;
    font-size: 14px;
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
  /* Two columns where they fit, one on phones (a card needs about 280 px). */
  .scenes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
    gap: 10px;
    align-items: start;
  }
  .scene {
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.03);
  }
  .scene p {
    margin: 6px 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: baseline;
  }
  .chip {
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--accent);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .details {
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }
  .details strong {
    color: var(--fg);
  }
  .strains {
    list-style: none;
    margin: 6px 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .strains li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--c);
  }
  a {
    color: var(--accent);
  }
</style>
