<script lang="ts">
  import { strainSpec, type Strain, type StrainKey } from '../model/params';
  import SensorDiagram from './SensorDiagram.svelte';
  import Slider from './Slider.svelte';

  interface Props {
    strain: Strain;
    index: number;
    removable: boolean;
    /** The Jones model: food counts as the strain's own trail, and there is no light and no other strain (ADR 0022). */
    jones?: boolean;
    onremove: () => void;
  }
  let { strain = $bindable(), index, removable, jones = false, onremove }: Props = $props();

  const name = $derived(`Strain ${'ABCD'[index] ?? index + 1}`);
  const MAIN: StrainKey[] = ['sensorAngle', 'sensorOffset', 'rotationAngle', 'stepSize', 'decay'];
  const MORE = $derived<StrainKey[]>(jones ? ['deposit', 'randomTurn'] : ['deposit', 'randomTurn', 'food', 'light']);
  let more = $state(false);
</script>

<article class="card" aria-label={name} style:--c={strain.color}>
  <header>
    <input type="color" bind:value={strain.color} aria-label="{name} color" />
    <h3>{name}</h3>
    {#if removable}
      <button type="button" class="ghost" onclick={onremove} aria-label="Remove {name}">Remove</button>
    {/if}
  </header>
  <SensorDiagram sa={strain.sensorAngle} so={strain.sensorOffset} ra={strain.rotationAngle} color={strain.color} />
  {#each MAIN as key (key)}
    <Slider spec={strainSpec[key]} bind:value={strain[key]} id="s{index}-{key}" />
  {/each}
  <button type="button" class="ghost more" aria-expanded={more} onclick={() => (more = !more)}>
    {more ? 'Fewer settings' : 'More settings'}
  </button>
  {#if more}
    {#each MORE as key (key)}
      <Slider spec={strainSpec[key]} bind:value={strain[key]} id="s{index}-{key}" />
    {/each}
    {#if !jones}
      <Slider spec={strainSpec.share} bind:value={strain.share} id="s{index}-share" live={false} />
    {/if}
  {/if}
</article>

<style>
  .card {
    border: 1px solid var(--line);
    border-left: 3px solid var(--c);
    border-radius: 10px;
    padding: 8px 10px;
    margin: 8px 0;
    background: rgba(255, 255, 255, 0.02);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h3 {
    flex: 1;
    margin: 0;
    font-size: 13px;
  }
  .more {
    margin-top: 2px;
  }
</style>
