<script lang="ts">
  import { onMount } from 'svelte';
  import { at } from './engine/at';
  import { Engine } from './engine/engine';
  import { MIN_RADIUS } from './engine/environment';
  import { GpuUnavailableError } from './engine/gpu';
  import { AgentToolKind, inoculateRate } from './engine/pack';
  import { presetById, START } from './model/presets';
  import { decodeLink, encodeLink } from './model/url';
  import Learn from './ui/Learn.svelte';
  import Panel from './ui/Panel.svelte';
  import SceneLabel from './ui/SceneLabel.svelte';
  import { constrain } from './model/params';
  import {
    adopt,
    app,
    autoTune,
    currentDrawing,
    deadLeft,
    deviceAdjusted,
    getEngine,
    openLink,
    ruleUnavailable,
    setEngine,
    setScene,
    showNotice,
    startScene,
    toolsFor,
    type Tool,
  } from './ui/state.svelte';
  import Toolbar from './ui/Toolbar.svelte';
  import { BrushDrag } from './ui/drag';
  import { GridTuner } from './ui/tune';

  let canvas: HTMLCanvasElement;
  let unsupported = $state(false);
  let ready = $state(false);
  /** Height of the header, scene name and notice; the phone panel starts below them. */
  let topHeight = $state(72);
  /** The page address was read: from then on it follows the state. */
  let addressRead = $state(false);

  onMount(() => {
    const life = new AbortController();
    // Phones: show the simulation first; the settings open on demand.
    if (matchMedia('(max-width: 720px)').matches) app.panel = false;
    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      getEngine()?.fitView();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    void (async () => {
      // A shared link: its settings, and the scene with its food, light and walls, which startScene() loads.
      const link = location.hash.length > 1 ? await decodeLink(location.hash.slice(1)) : undefined;
      const start = presetById(START);
      if (link) openLink(link);
      else if (start) setScene(start);
      addressRead = true;
      try {
        // The engine lowers the grid when the device cannot hold it, also for the first allocation.
        const engine = await Engine.create(canvas, $state.snapshot(app.settings), deviceAdjusted);
        if (life.signal.aborted) {
          engine.destroy();
          return;
        }
        if (!engine.backend.supportsCollisions) ruleUnavailable();
        engine.onError = fail;
        setEngine(engine);
        Object.assign(globalThis, { physarum: engine });
        // The panel works before the engine exists, so a preset may have been chosen meanwhile, and the settings
        // effect below does not run again for the new engine: load what the state holds now, with its environment.
        await startScene(engine);
        engine.paused = app.paused;
        engine.start();
        ready = true;
        void engine.backend.lost.then((message) => {
          app.error = `The graphics device was lost (${message}).`;
        });
      } catch (err) {
        unsupported = err instanceof GpuUnavailableError;
        app.error = err instanceof Error ? err.message : String(err);
      }
    })();

    const stats = setInterval(() => void updateStats(), 500);
    return () => {
      life.abort();
      clearInterval(stats);
      observer.disconnect();
      getEngine()?.destroy();
      setEngine(undefined);
    };
  });

  // Settings → engine (live changes, resets or reallocation are decided there).
  $effect(() => {
    const snapshot = $state.snapshot(app.settings);
    const valid = constrain(snapshot);
    // Keep the UI consistent with what a shared link would load (e.g. collisions cap density at 1, and the Jones
    // model binds its scent to the trail).
    if (valid !== snapshot) adopt(valid);
    getEngine()?.apply(valid).catch(fail);
  });

  // Read both reactive values before any condition, or Svelte would not track them.
  $effect(() => {
    const paused = app.paused;
    const engine = ready ? getEngine() : undefined;
    if (engine) engine.paused = paused;
  });

  // Settings, scene and food, light and walls → URL hash, debounced, so the address is always a shareable link. The
  // engine changes its edit list outside Svelte: app.envVersion counts the changes (state.svelte.ts). A scene and its
  // strains' origins change only with the settings or that count. The drawing is read when the timer fires, so a
  // drag records many segments for one encoding. Until the address was read at startup, it is left as it is.
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  let urlRuns = 0;
  /** The last link left the drawing out: the notice comes once each time a drawing grows too large. */
  let dropped = false;
  const shared = $derived({ settings: $state.snapshot(app.settings), edits: app.envVersion });
  $effect(() => {
    const { settings } = shared;
    clearTimeout(urlTimer);
    if (!addressRead) return;
    urlTimer = setTimeout(() => {
      const run = ++urlRuns;
      void encodeLink(settings, currentDrawing()).then(({ hash, dropped: lost }) => {
        if (run !== urlRuns) return; // a later encoding started meanwhile
        history.replaceState(null, '', `#${hash}`);
        if (lost && !dropped) showNotice('The drawing is too large for a link.');
        dropped = lost;
      });
    }, 400);
  });

  // Startup check: in the first 15 s of active time, lower the grid (at most twice, not below 512 cells)
  // while the frame rate stays below 40 fps (or below 90 % of a lower rate the browser gives, such as
  // 30 fps in a power saving mode) or the steps below 3/4 of what the speed asked for (ui/tune.ts). The scene's own
  // lattice keeps its cells (autoTune() in ui/state.svelte.ts, ADR 0026).
  const tuner = new GridTuner();

  function fail(err: unknown) {
    app.error = `The simulation stopped: ${err instanceof Error ? err.message : String(err)}.`;
  }

  // A reload would replay a shared link that may be too heavy for this device.
  function startFresh() {
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }

  let last = { t: performance.now(), frames: 0, step: 0 };
  let counting = false;
  async function updateStats() {
    const e = getEngine();
    if (!e) return;
    // Also while rebuilding: that time must not count.
    if (tuner.running) autoTune(tuner, e, performance.now(), document.visibilityState === 'visible');
    // The alive count waits for the GPU, which can take longer than the 500 ms interval under load. So
    // time, frames and steps are read together before it, and two counts never overlap.
    if (e.busy || counting) return;
    const now = { t: performance.now(), frames: e.frames, step: e.sim.step };
    const dt = (now.t - last.t) / 1000;
    const rates = { fps: (now.frames - last.frames) / dt, stepsPerSecond: Math.max(0, now.step - last.step) / dt };
    last = now;
    counting = true;
    // The count is of the agents of this run: a restart while it waits for the GPU makes it one of an older run.
    const run = e.restarts;
    const counted = await e.sim
      .alive()
      .then(
        (alive) => ({ alive, run }),
        () => ({ alive: app.stats.alive, run: app.stats.run }),
      )
      .finally(() => (counting = false));
    app.stats = { ...rates, step: now.step, ...counted };
  }

  // Pointer input: pan, pinch, paint and agent tools.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- pointer bookkeeping, never rendered
  const pointers = new Map<number, [number, number]>();
  const drag = new BrushDrag();
  let held: [number, number] | undefined;
  /** The notice that no dead agents are left came during this press of the inoculate tool. */
  let toldNoDead = false;
  /** The notice has 36 words: 10 s to read them, not the usual 7 s. */
  const NO_DEAD_NOTICE_MS = 10_000;
  let pinch = 0;

  function twoPointers(): [[number, number], [number, number]] {
    const list = [...pointers.values()];
    return [at(list, 0), at(list, 1)];
  }

  function pos(e: PointerEvent | WheelEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  }

  const brushCells = (e: Engine) => app.brush * (canvas.width / canvas.clientWidth) * e.view.scale;
  const painting = (t: Tool) => t === 'food' || t === 'light' || t === 'wall' || t === 'erase';

  function paintTo(e: Engine, p: [number, number]) {
    if (painting(app.tool)) drag.to(e, p, app.tool, Math.max(MIN_RADIUS, brushCells(e)));
  }

  function onpointerdown(ev: PointerEvent) {
    const e = getEngine();
    if (!e) return;
    canvas.setPointerCapture(ev.pointerId);
    const p = pos(ev);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = twoPointers();
      pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
      held = undefined;
      return;
    }
    if (ev.button !== 0 || app.tool === 'pan') return;
    drag.end();
    paintTo(e, p);
    if (app.tool === 'inoculate' || app.tool === 'cut') held = p;
    toldNoDead = false;
  }

  function onpointermove(ev: PointerEvent) {
    const e = getEngine();
    const prev = pointers.get(ev.pointerId);
    if (!e || !prev) return;
    const p = pos(ev);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = twoPointers();
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      e.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / Math.max(1, pinch));
      e.panBy((p[0] - prev[0]) / 2, (p[1] - prev[1]) / 2);
      pinch = d;
    } else if (app.tool === 'pan' || (ev.buttons & 4) !== 0) {
      e.panBy(p[0] - prev[0], p[1] - prev[1]);
    } else {
      paintTo(e, p);
    }
    // Also while another tool is selected: a key can select the held tool again before the pointer goes up.
    if (held) held = p;
  }

  function onpointerup(ev: PointerEvent) {
    pointers.delete(ev.pointerId);
    drag.end();
    held = undefined;
  }

  function onwheel(ev: WheelEvent) {
    ev.preventDefault();
    getEngine()?.zoomAt(...pos(ev), Math.exp(-ev.deltaY * 0.0015));
  }

  // While a tool is held, the engine applies it in every frame, by the time the frame stands for (Engine.frame). Only
  // while that tool is selected: a key can select another tool during the hold (ADR 0022, decision 31).
  $effect(() => {
    let raf = 0;
    const tick = () => {
      const e = getEngine();
      if (e && held && (app.tool === 'cut' || app.tool === 'inoculate')) {
        const [x, y] = e.toGrid(...held);
        const radius = brushCells(e);
        if (app.tool === 'cut') e.agentTool({ kind: AgentToolKind.cut, x, y, radius, strain: 0, rate: 0 });
        else {
          const rate = inoculateRate(radius, app.settings, e.sim.agents, app.strain);
          const dead = deadLeft(e);
          // Paused, the hold runs steps only while a dead agent is known: else they would only move the scene.
          e.agentTool({ kind: AgentToolKind.inoculate, x, y, radius, strain: app.strain, rate, idle: dead !== true });
          if (!toldNoDead && dead === false) {
            toldNoDead = true;
            const letter = 'ABCD'[app.strain] ?? String(app.strain + 1);
            showNotice(
              `All agents of strain ${letter} are alive. Inoculate uses only dead agents. To get dead agents, set ` +
                'Shrinkage above 0, or select the start layout Empty. In that layout all agents are dead at the start.',
              NO_DEAD_NOTICE_MS,
            );
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  });

  function onkeydown(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || t.closest('input, select, textarea, button, summary, a, dialog'))
      return;
    const tool = toolsFor(app.settings.model).find((x) => x.key === ev.key);
    if (tool) app.tool = tool.id;
    else if (ev.key === ' ') app.paused = !app.paused;
    else if (ev.key === '.') {
      app.paused = true;
      getEngine()?.frame(performance.now(), 1);
    } else if (ev.key === 'r') getEngine()?.reset();
    else if (ev.key === 'f') getEngine()?.fitView();
    else if (ev.key === 'h') app.hideUi = !app.hideUi;
    else if (ev.key === 'l') app.learn = true;
    else if (ev.key === '[') app.brush = Math.max(4, app.brush - 4);
    else if (ev.key === ']') app.brush = Math.min(120, app.brush + 4);
    else return;
    ev.preventDefault();
  }

  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} k` : `${n}`);
</script>

<svelte:window {onkeydown} />

<main class="app" class:hide={app.hideUi} class:with-panel={app.panel} style:--top-height="{topHeight}px">
  <canvas
    bind:this={canvas}
    class="tool-{app.tool}"
    aria-label="Physarum simulation. Use the toolbar to place food, light, walls or agents."
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={onpointerup}
    {onwheel}
  ></canvas>

  <!-- One column, so the scene name never covers a notice: header, scene name, notice. -->
  <div class="top ui" bind:clientHeight={topHeight}>
    <header class="brand">
      <h1>Physarum</h1>
      <button type="button" onclick={() => (app.learn = true)}>Learn</button>
      <button type="button" aria-expanded={app.panel} aria-controls="settings" onclick={() => (app.panel = !app.panel)}>
        {app.panel ? 'Hide settings' : 'Settings'}
      </button>
    </header>
    <SceneLabel />
    {#if app.notice}
      <p class="notice" role="status">{app.notice}</p>
    {/if}
  </div>

  {#if app.panel}
    <div class="panel-wrap ui" id="settings"><Panel /></div>
  {/if}

  <div class="toolbar-wrap ui"><Toolbar /></div>

  <p class="stats ui" aria-live="off">
    {app.stats.fps.toFixed(0)} fps · {app.stats.stepsPerSecond.toFixed(0)} steps/s · step {app.stats.step}
    {#if app.stats.alive.length}· {fmt(app.stats.alive.reduce((a, b) => a + b, 0))} agents{/if}
  </p>

  {#if app.error}
    <div class="error" role="alert">
      <p>{app.error}</p>
      {#if unsupported}
        <p>
          This simulation needs WebGPU, or WebGL2 with float textures. Current Chrome, Edge, Safari and Firefox have
          them. Update your browser, try another one, or turn on hardware acceleration.
        </p>
      {:else}
        <p>Reload the page to try again, or start fresh with the default scene.</p>
        <button type="button" onclick={startFresh}>Start fresh</button>
      {/if}
    </div>
  {/if}

  <Learn />
</main>

<style>
  .app {
    position: fixed;
    inset: 0;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    cursor: crosshair;
  }
  canvas.tool-pan {
    cursor: grab;
  }
  canvas.tool-pan:active {
    cursor: grabbing;
  }
  .hide .ui {
    display: none;
  }
  /* Header, scene name and notice share one column, so none of them covers another. */
  .top {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    pointer-events: none;
  }
  .top > :global(*) {
    pointer-events: auto;
  }
  /* Glass like the toolbar groups: readable over bright trails and the light paper style. */
  .brand {
    display: flex;
    gap: 2px;
    align-items: center;
    padding: 3px 3px 3px 12px;
    border-radius: 10px;
    background: var(--glass);
    border: 1px solid var(--line);
    backdrop-filter: blur(14px) saturate(140%);
  }
  .brand button {
    border: 0;
    background: transparent;
  }
  .brand button:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  h1 {
    margin: 0 8px 0 0;
    font-size: 17px;
    font-weight: 650;
    letter-spacing: 0.04em;
  }
  .panel-wrap {
    position: absolute;
    top: 12px;
    right: 12px;
    bottom: 68px;
    width: 340px;
    display: flex;
    border-radius: 14px;
    background: var(--glass);
    border: 1px solid var(--line);
    backdrop-filter: blur(16px) saturate(140%);
    overflow: hidden;
  }
  .toolbar-wrap {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 4px;
    pointer-events: none;
  }
  .toolbar-wrap :global(.toolbar) {
    pointer-events: auto;
  }
  /* On glass like the scene name: --muted straight on the canvas had about 2.3:1 over the paper style. */
  .stats {
    position: absolute;
    left: 10px;
    bottom: 56px;
    margin: 0;
    padding: 2px 6px;
    border-radius: 6px;
    background: var(--glass);
    backdrop-filter: blur(14px);
    font:
      11px/1.4 ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
    color: var(--muted);
    pointer-events: none;
  }
  .notice {
    align-self: center;
    box-sizing: border-box;
    max-width: min(560px, 100%);
    margin: 0;
    padding: 8px 14px;
    border-radius: 10px;
    background: var(--glass);
    border: 1px solid var(--line);
    backdrop-filter: blur(14px);
  }
  .error {
    position: absolute;
    z-index: 2;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    /* Without it, left: 50% limits the box to the right half of the screen. */
    width: max-content;
    max-width: min(520px, calc(100vw - 32px));
    box-sizing: border-box;
    padding: 16px 20px;
    border-radius: 14px;
    background: #23110f;
    border: 1px solid #5a2a22;
  }
  /* Beside the open panel, the column ends at the panel, so notices center over the free canvas. */
  @media (min-width: 721px) {
    .with-panel .top {
      right: 364px;
    }
  }
  @media (max-width: 720px) {
    /* Below the header, the scene name and a notice, so none of them covers the panel's controls. */
    .panel-wrap {
      top: calc(12px + var(--top-height) + 8px);
      left: 8px;
      right: 8px;
      bottom: 64px;
      width: auto;
    }
    .notice {
      width: 100%;
    }
    .stats {
      display: none;
    }
  }
</style>
