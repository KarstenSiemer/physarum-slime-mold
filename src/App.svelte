<script lang="ts">
  import { onMount } from 'svelte';
  import { at } from './engine/at';
  import { Engine } from './engine/engine';
  import { GpuUnavailableError } from './engine/gpu';
  import { AgentToolKind } from './engine/pack';
  import { presetById } from './model/presets';
  import { decodeSettings, encodeSettings } from './model/url';
  import Learn from './ui/Learn.svelte';
  import Panel from './ui/Panel.svelte';
  import { constrain } from './model/params';
  import { app, getEngine, setEngine, showNotice, TOOLS, type Tool } from './ui/state.svelte';
  import Toolbar from './ui/Toolbar.svelte';
  import { GridTuner } from './ui/tune';

  let canvas: HTMLCanvasElement;
  let unsupported = $state(false);
  let ready = $state(false);
  const START = 'three-strains';

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
      const fromUrl = location.hash.startsWith('#s=') ? await decodeSettings(location.hash.slice(3)) : undefined;
      const start = presetById(START);
      if (fromUrl) app.settings = fromUrl;
      else if (start) app.settings = start.settings();
      try {
        // The engine lowers the grid when the device cannot hold it, also for the first allocation.
        const engine = await Engine.create(canvas, $state.snapshot(app.settings), (message, resolution) => {
          app.maxResolution = Math.min(app.maxResolution, resolution);
          app.settings.resolution = resolution;
          showNotice(message);
        });
        if (life.signal.aborted) {
          engine.destroy();
          return;
        }
        app.canCollide = engine.backend.supportsCollisions;
        if (!app.canCollide) app.settings.collisions = false;
        engine.onError = fail;
        setEngine(engine);
        Object.assign(globalThis, { physarum: engine });
        if (!fromUrl && start) await engine.load($state.snapshot(app.settings), start.env);
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
    // Keep the UI consistent with what a shared link would load (e.g. collisions cap density at 1).
    if (valid.density !== snapshot.density) app.settings.density = valid.density;
    getEngine()?.apply(valid).catch(fail);
  });

  // Read both reactive values before any condition, or Svelte would not track them.
  $effect(() => {
    const paused = app.paused;
    const engine = ready ? getEngine() : undefined;
    if (engine) engine.paused = paused;
  });

  // Settings → URL hash, debounced, so the address is always a shareable link.
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const snapshot = $state.snapshot(app.settings);
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      void encodeSettings(snapshot).then((h) => {
        history.replaceState(null, '', `#s=${h}`);
      });
    }, 400);
  });

  // Startup check: in the first 15 s of active time, lower the grid (at most twice, not below 512 cells)
  // while the frame rate stays below 40 fps or the steps per second below 3/4 of the speed (ui/tune.ts).
  const tuner = new GridTuner();
  function autoTune(e: Engine) {
    const lower = tuner.tick({
      now: performance.now(),
      active: document.visibilityState === 'visible' && !app.paused && !e.busy,
      run: e.restarts,
      frames: e.frames,
      steps: e.sim.step,
      speed: app.settings.speed,
      resolution: app.settings.resolution,
      picked: app.gridPicked,
    });
    if (lower === undefined) return;
    app.maxResolution = lower;
    app.settings.resolution = lower;
    showNotice(`Lowered the grid to ${lower} cells for smooth playback. Change it under Scene → Grid.`);
  }

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
    if (tuner.running) autoTune(e); // also while rebuilding: that time must not count
    // The alive count waits for the GPU, which can take longer than the 500 ms interval under load. So
    // time, frames and steps are read together before it, and two counts never overlap.
    if (e.busy || counting) return;
    const now = { t: performance.now(), frames: e.frames, step: e.sim.step };
    const dt = (now.t - last.t) / 1000;
    const rates = { fps: (now.frames - last.frames) / dt, stepsPerSecond: Math.max(0, now.step - last.step) / dt };
    last = now;
    counting = true;
    const alive = await e.sim
      .alive()
      .catch(() => app.stats.alive)
      .finally(() => (counting = false));
    app.stats = { ...rates, step: now.step, alive };
  }

  // Pointer input: pan, pinch, paint and agent tools.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- pointer bookkeeping, never rendered
  const pointers = new Map<number, [number, number]>();
  let lastGrid: [number, number] | undefined;
  let held: [number, number] | undefined;
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
    if (!painting(app.tool)) return;
    const g = e.toGrid(...p);
    e.paint({ kind: app.tool, from: lastGrid ?? g, to: g, radius: brushCells(e) });
    lastGrid = g;
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
    lastGrid = undefined;
    paintTo(e, p);
    if (app.tool === 'inoculate' || app.tool === 'cut') held = p;
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
      if (held) held = p;
    }
  }

  function onpointerup(ev: PointerEvent) {
    pointers.delete(ev.pointerId);
    lastGrid = undefined;
    held = undefined;
  }

  function onwheel(ev: WheelEvent) {
    ev.preventDefault();
    getEngine()?.zoomAt(...pos(ev), Math.exp(-ev.deltaY * 0.0015));
  }

  // While a tool is held, it acts on every frame.
  $effect(() => {
    let raf = 0;
    const tick = () => {
      const e = getEngine();
      if (e && held) {
        const [x, y] = e.toGrid(...held);
        const radius = brushCells(e);
        const total = app.settings.strains.reduce((a, s) => a + s.share, 0);
        const share = (app.settings.strains[app.strain]?.share ?? 1) / total;
        const p = Math.min(
          1,
          (Math.PI * radius * radius * Math.max(0.25, app.settings.density)) / (2 * e.sim.agents * share),
        );
        e.agentTool(
          app.tool === 'cut'
            ? { kind: AgentToolKind.cut, x, y, radius, strain: 0, revive: 0, teleport: 0 }
            : { kind: AgentToolKind.inoculate, x, y, radius, strain: app.strain, revive: p, teleport: p },
        );
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
    const tool = TOOLS.find((x) => x.key === ev.key);
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

<main class="app" class:hide={app.hideUi}>
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

  <header class="brand ui">
    <h1>Physarum</h1>
    <button type="button" onclick={() => (app.learn = true)}>Learn</button>
    <button type="button" aria-expanded={app.panel} aria-controls="settings" onclick={() => (app.panel = !app.panel)}>
      {app.panel ? 'Hide settings' : 'Settings'}
    </button>
  </header>

  {#if app.panel}
    <div class="panel-wrap ui" id="settings"><Panel /></div>
  {/if}

  <div class="toolbar-wrap ui"><Toolbar /></div>

  <p class="stats ui" aria-live="off">
    {app.stats.fps.toFixed(0)} fps · {app.stats.stepsPerSecond.toFixed(0)} steps/s · step {app.stats.step}
    {#if app.stats.alive.length}· {fmt(app.stats.alive.reduce((a, b) => a + b, 0))} agents{/if}
  </p>

  {#if app.notice}
    <p class="notice ui" role="status">{app.notice}</p>
  {/if}

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
  .brand {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  h1 {
    margin: 0 6px 0 0;
    font-size: 17px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.8);
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
  .stats {
    position: absolute;
    left: 14px;
    bottom: 58px;
    margin: 0;
    font:
      11px/1.4 ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
    color: var(--muted);
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
    pointer-events: none;
  }
  .notice {
    position: absolute;
    top: 12px;
    left: 50%;
    translate: -50% 0;
    margin: 0;
    padding: 8px 14px;
    border-radius: 10px;
    background: var(--glass);
    border: 1px solid var(--line);
    backdrop-filter: blur(14px);
  }
  .error {
    position: absolute;
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
  @media (max-width: 720px) {
    .panel-wrap {
      top: 56px;
      left: 8px;
      right: 8px;
      bottom: 64px;
      width: auto;
    }
    .notice {
      top: 52px;
      width: calc(100vw - 32px);
    }
    .stats {
      display: none;
    }
  }
</style>
