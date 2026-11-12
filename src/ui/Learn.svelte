<script lang="ts">
  import {
    collisionsHelp,
    coveredFoodHelp,
    globalSpec,
    growthHelp,
    modelHelp,
    scentViewHelp,
    strainSpec,
  } from '../model/params';
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

  // The switch Growth and shrinkage comes before its values and Capacity, as in the panel.
  const GROWTH_KEYS = new Set<string>([
    'growthEvery',
    'growthWindow',
    'growthMin',
    'growthMax',
    'shrinkEvery',
    'shrinkWindow',
    'shrinkMin',
    'shrinkMax',
    'capacity',
  ]);
  const specs: { label: string; help: string; ref?: string }[] = [
    ...Object.values(strainSpec),
    ...Object.entries(globalSpec)
      .filter(([k]) => !GROWTH_KEYS.has(k))
      .map(([, v]) => v),
    collisionsHelp,
    modelHelp,
    coveredFoodHelp,
    growthHelp,
    ...Object.entries(globalSpec)
      .filter(([k]) => GROWTH_KEYS.has(k))
      .map(([, v]) => v),
    // The view switch last: it changes only the picture.
    scentViewHelp,
  ];

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
        network like the Tokyo rail system (Tero 2010). The model in this app has no flow, so its tubes do not grow
        thicker with use.
      </p>
      <p>
        It moves toward food by chemotaxis: it follows chemical gradients. It flees light and dryness. When the food
        runs out, it shrinks onto the remaining food sources. In the simulation food never runs out. With Random
        shrinkage turned on, agents die off and a full sheet shrinks onto the food, as in the scene Shrinking
        plasmodium. A network with few agents contracts between the food sources even without it, as in Shortest path
        and Steiner tree.
      </p>
      <p>
        A real plasmodium also grows: from one oat flake it spreads over the agar until it finds more food. Agents do
        not grow by themselves. The switch Growth and shrinkage adds Jones’ rule for this from his later papers: agents
        divide at the thin edge of the colony and die where they crowd. The scene Foraging maze shows it: a small colony
        on one food grows through a maze until it reaches the other food.
      </p>
    {:else if app.learnTab === 'The model'}
      <p>
        The model comes from a research paper: Jeff Jones, “Characteristics of Pattern Formation and Evolution in
        Approximations of Physarum Transport Networks”, <em>Artificial Life</em>, 2010. Jones worked at the Centre for
        Unconventional Computing of the University of the West of England in Bristol. This app calls the paper Jones
        2010.
      </p>
      <p>
        Jones showed that thousands of simple agents build networks like the slime mold’s without any plan: each agent
        only follows a chemical trail and adds to it. He mapped which settings give networks, sheets, spots or stripes,
        and showed how food turns a network into short paths between the food.
      </p>
      <p>
        Sage Jenson’s GPU version (2019) and Michael Fogleman’s version with several species (2020) build on the same
        rules, and this app draws on all three. A scene marked “Jones 2010, Fig. 4” uses the settings of figure 4 of the
        paper, on the grid of that figure: 200&nbsp;×&nbsp;200 cells.
      </p>
      <p>
        Like the paper, the app imitates the plasmodium with many tiny agents on a grid. Each agent stands for a bit of
        the cell. The agents leave a chemical trail and follow it. Every step has six parts:
      </p>
      <ol>
        <li>
          <strong>Sense.</strong> Three sensors in front of the agent read the trail: front, front-left and front-right.
        </li>
        <li>
          <strong>Rotate.</strong> Front strongest: keep going. Front weakest: turn left or right at random. Otherwise: turn
          toward the stronger side.
        </li>
        <li>
          <strong>Move</strong> one step forward. In Jones’ original, only one agent may sit in each cell (the switch One
          agent per cell).
        </li>
        <li><strong>Deposit</strong> some trail after a successful move.</li>
        <li><strong>Diffuse:</strong> the trail spreads to the 8 neighbour cells (a 3 × 3 average).</li>
        <li><strong>Decay:</strong> a fixed fraction of the trail disappears.</li>
      </ol>
      <p>
        No agent knows the network. The network appears because trails attract agents, and agents strengthen trails.
        With Jones’ settings, diffusion and decay alone do not keep it from collapsing into lines; his rule of one agent
        per cell does. A blocked agent turns to a random direction, and these turns start new branches (p. 135). Without
        the rule, agents pile up in the same cells and the network contracts into a few lines.
      </p>
      <p>
        Jones gives every length in cells: how far ahead the sensors are, how far an agent moves in a step, and how far
        one 3 × 3 average spreads the trail. So a pattern keeps its size in cells. A scene of Jones runs on the grid of
        its figure on every screen, with free space beside it. Around a grid with wrapping edges, its copies show
        dimmed. On another grid the same settings make more or fewer meshes, and the result is different from the paper.
        You can choose another grid under Scene → Grid. The panel then names Jones’ grid and has a button to go back to
        it. The other scenes use a grid shaped like your screen.
      </p>
      <p>
        The setting Model chooses the rules. <strong>Jones</strong> has only the rules that Jeff Jones published.
        <strong>Extended</strong> has Jones’ rules and the additions of this app. The scenes from Jones’ papers start with
        Jones, and all other scenes and the default settings start with Extended.
      </p>
      <p>
        In the Jones model, one strain follows its own trail, or flees it as in Jones’ Turing patterns. One agent fits
        in a cell, and one 3 × 3 average spreads the trail in each step. Food goes into the trail map, so its scent
        spreads and fades with the trail. Walls mark where agents cannot go. Agents can die off, as in Shrinking
        plasmodium. In later papers Jones lets food release almost no scent while agents cover it: the switch Covered
        food releases less.
      </p>
      <p>
        From 2011 on, Jones also lets the population grow and shrink (Nat. Comput. 10: 1345). Every few steps, an agent
        that moved counts the agents in a square around it, itself included. If the square holds few agents, the agent
        divides: a new agent appears in an empty cell next to it. If its shrinkage square holds too many agents, the
        agent dies. So a colony grows at its thin edge, and crowded paths stay thin. Each of his later papers uses its
        own squares, limits and intervals. The switch Growth and shrinkage has the values of 2011 as its defaults. A new
        agent needs a dead one: Capacity sets how many agents the simulation can hold. To see growth, choose the scene
        Foraging maze, or switch on one agent per cell and Growth and shrinkage, then raise Capacity or start with the
        layout Empty and use Inoculate.
      </p>
      <p>
        The extended model adds what Jones did not publish. Several strains can share the dish, each with its own trail.
        A table sets how strongly each strain follows or flees the trails of the others, an idea from Michael Fogleman’s
        version. Light releases a repellent that spreads like the food scent. The food scent has a decay of its own, and
        a strain has its own weight for food and light. Agents can share cells, the trail can spread in more passes, and
        walls also block what the sensors read.
      </p>
      <p>
        With Scent decay 0.1 the scent fades within a few cells, so an agent notices food only when a sensor comes
        close. In a dense network, food becomes a hub with paths that lead in, and the rest of the network goes on as
        before. A whole network reorganizes around food only when agents are few and the network contracts, as in
        Shortest path and Steiner tree. It also does when agents die off, as in Shrinking plasmodium.
      </p>
      <p>
        In the extended model, a lower Scent decay spreads the food scent farther. Food then releases less scent, so the
        scent reaches farther, but it does not become stronger. Trail saturation makes a dense trail count less, so a
        weak scent can still turn an agent on it. With Scent decay 0.1 and Trail saturation 0, the extended model runs a
        scene of Jones as Jones does, until you paint a wall or use the Cut tool.
      </p>
      <p>
        To see the scent, select Scent in the toolbar or press S. A green glow shows the scent of food, and a pink glow
        the repellent of light. The glow fades out as the scent gets weaker, down to 0.01 per cell. The scale is the
        same in every scene and in both models. A green line shows where the food scent is as strong as the trail of a
        strand: inside it, food pulls an agent on a strand more than the strand does. Compare a scene in Jones with the
        same scene in Extended at a low Scent decay: the glow reaches farther, but a small food gets weaker, so the line
        can come closer to the food. The view changes only the picture, not the simulation.
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
        Keys: Space play/pause, . step, R reset, 1–7 tools, [ and ] brush size, F fit view, S scent, H hide panels, L
        this dialog.
      </p>
      <p>
        The page address is a link to what you see: the settings, the scene, and the food, light and walls you painted.
        Copy it to share the scene or to come back to it. The agents and their trails start again when the link opens.
        If the drawing is too large for a link, a notice says so. The link then opens the scene as it loads, without the
        drawing. If this app cannot read the drawing in a link, a notice says so, and only the settings load.
      </p>
    {:else if app.learnTab === 'Scenes'}
      <p>
        Each scene loads its settings with its food, light and walls. Scenes marked Jones 2010 use the settings of a
        figure in his paper, on the grid of that figure. Fogleman 2020 scenes are his saved settings, and the others
        were made for this app. These scenes use a grid shaped like your screen.
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
    /* The header (about 43 px) sticks to the top: a control that gets focus scrolls into view below it. */
    scroll-padding-top: 56px;
    padding: 0 20px 20px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: rgba(12, 13, 18, 0.94);
    color: var(--fg);
    line-height: 1.55;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.6);
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
