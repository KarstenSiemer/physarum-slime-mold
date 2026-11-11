<script lang="ts">
  import { fieldText, snap, type Spec } from '../model/params';

  interface Props {
    spec: Spec;
    value: number;
    id: string;
    /** false: apply only when the drag ends (for changes that reset the simulation). */
    live?: boolean;
  }
  let { spec, value = $bindable(), id, live = true }: Props = $props();

  const STEPS = 1000;
  let draft = $state<number | null>(null);
  let open = $state(false);

  const toPos = (v: number) => (spec.log ? (Math.log(v / spec.min) / Math.log(spec.max / spec.min)) * STEPS : v);
  const fromPos = (p: number) => (spec.log ? spec.min * (spec.max / spec.min) ** (p / STEPS) : p);

  function input(p: number) {
    const v = snap(fromPos(p), spec);
    if (live) value = v;
    else draft = v;
  }
  function commit(v: number) {
    if (Number.isFinite(v)) value = snap(v, spec);
    draft = null;
  }
  const shown = $derived(draft ?? value);
</script>

<div class="slider">
  <div class="head">
    <label for={id}>{spec.label}</label>
    <input
      class="num"
      type="number"
      aria-label="{spec.label} value"
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={fieldText(shown, spec)}
      onchange={(e) => {
        commit(e.currentTarget.valueAsNumber);
        // A typed value that snaps back to the current one changes nothing, so nothing redraws the field: show the
        // value that the simulation uses (a window of 8 is 9).
        e.currentTarget.value = fieldText(value, spec);
      }}
    />
    {#if spec.unit}<span class="unit">{spec.unit}</span>{/if}
    <button
      class="help"
      type="button"
      aria-expanded={open}
      aria-controls="{id}-help"
      aria-label="About {spec.label}"
      onclick={() => (open = !open)}>?</button
    >
  </div>
  <input
    {id}
    type="range"
    min={spec.log ? 0 : spec.min}
    max={spec.log ? STEPS : spec.max}
    step={spec.log ? 1 : spec.step}
    value={toPos(shown)}
    aria-describedby={open ? `${id}-help` : undefined}
    oninput={(e) => {
      input(e.currentTarget.valueAsNumber);
    }}
    onchange={(e) => {
      commit(fromPos(e.currentTarget.valueAsNumber));
    }}
  />
  {#if open}
    <p class="helptext" id="{id}-help">
      {spec.help}
      {#if spec.ref}<cite>{spec.ref}</cite>{/if}
    </p>
  {/if}
</div>

<style>
  .slider {
    display: grid;
    gap: 2px;
    margin: 6px 0 8px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  label {
    flex: 1;
    color: var(--fg);
  }
  .num {
    width: 7ch;
    text-align: right;
  }
  .unit {
    color: var(--muted);
    min-width: 3ch;
  }
  .help {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    font-size: 11px;
    line-height: 1;
  }
  .helptext {
    margin: 2px 0 4px;
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
