<script lang="ts">
  import { attractionSpec, type Strain } from '../model/params';

  let { strains = $bindable() }: { strains: Strain[] } = $props();

  const letter = (i: number) => 'ABCD'[i] ?? String(i + 1);
  // Diverging color: blue repels, warm attracts.
  const tint = (v: number) =>
    v >= 0 ? `rgba(242, 160, 70, ${Math.min(1, v / 2) * 0.55})` : `rgba(80, 150, 255, ${Math.min(1, -v / 2) * 0.55})`;

  function setAll(fn: (row: number, col: number) => number) {
    strains.forEach((s, r) => {
      s.attraction = s.attraction.map((v, c) => (c < strains.length ? fn(r, c) : v));
    });
  }
</script>

<table>
  <caption>
    How strongly each strain (row) follows the trail of another (column). Positive attracts, negative repels.
  </caption>
  <thead>
    <tr>
      <th scope="col"><span class="sr-only">Strain</span></th>
      {#each strains as s, c (c)}
        <th scope="col"><span class="dot" style:--c={s.color}></span>{letter(c)}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each strains as row, r (r)}
      <tr>
        <th scope="row"><span class="dot" style:--c={row.color}></span>{letter(r)}</th>
        {#each strains as _, c (c)}
          <td style:--bg={tint(row.attraction[c] ?? 0)}>
            <input
              type="number"
              min={attractionSpec.min}
              max={attractionSpec.max}
              step={attractionSpec.step * 2}
              aria-label="Strain {letter(r)} follows strain {letter(c)}"
              value={row.attraction[c]}
              onchange={(e) => {
                const v = Math.min(
                  attractionSpec.max,
                  Math.max(attractionSpec.min, e.currentTarget.valueAsNumber || 0),
                );
                row.attraction = row.attraction.map((x, i) => (i === c ? v : x));
              }}
            />
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
<div class="quick">
  <button
    type="button"
    class="ghost"
    onclick={() => {
      setAll((r, c) => (r === c ? 1 : -1));
    }}>Rivals</button
  >
  <button
    type="button"
    class="ghost"
    onclick={() => {
      setAll((r, c) => (r === c ? 1 : 0));
    }}>Ignore</button
  >
  <button
    type="button"
    class="ghost"
    onclick={() => {
      setAll(() => 1);
    }}>Merge</button
  >
  <button
    type="button"
    class="ghost"
    onclick={() => {
      setAll((r, c) => (r === c ? 1 : c === (r + 1) % strains.length ? 1 : -1));
    }}>Chase</button
  >
</div>

<style>
  table {
    border-collapse: separate;
    border-spacing: 3px;
    margin: 4px 0;
  }
  caption {
    caption-side: top;
    text-align: left;
    color: var(--muted);
    font-size: 12px;
    padding-bottom: 6px;
  }
  th {
    font-weight: 500;
    color: var(--muted);
    white-space: nowrap;
  }
  td {
    background: var(--bg);
    border-radius: 6px;
  }
  td input {
    width: 6ch;
    background: transparent;
    border: 0;
    text-align: center;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 50%;
    background: var(--c);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
</style>
