<script lang="ts">
  // One agent with its three sensors (Jones 2010, Fig. 3), drawn from the live parameters.
  let { sa, so, ra, color }: { sa: number; so: number; ra: number; color: string } = $props();

  const origin = { x: 26, y: 56 };
  const rad = (d: number) => (d * Math.PI) / 180;
  const len = $derived(18 + 82 * Math.min(1, so / 40));
  const at = (deg: number, r: number) => ({
    x: origin.x + r * Math.cos(rad(deg)),
    y: origin.y + r * Math.sin(rad(deg)),
  });
  const sensors = $derived([-sa, 0, sa].map((d) => at(d, len)));
  const arc = (from: number, to: number, r: number) => {
    const a = at(from, r);
    const b = at(to, r);
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
  };
  const turn = $derived(at(ra, 34));
</script>

<svg viewBox="0 0 140 112" role="img" aria-label="Agent with sensors: angle {sa}°, distance {so}, rotation {ra}°">
  <path d={arc(0, sa, 22)} class="guide" />
  <text x={origin.x + 26} y={origin.y + 14} class="label">SA</text>
  <path d={arc(0, ra, 40)} class="turn" />
  <line x1={origin.x} y1={origin.y} x2={turn.x} y2={turn.y} class="turn" />
  <text x={turn.x + 2} y={turn.y + 10} class="label">RA</text>
  {#each sensors as s, i (i)}
    <line x1={origin.x} y1={origin.y} x2={s.x} y2={s.y} class="arm" />
    <circle cx={s.x} cy={s.y} r="4.5" fill={color} />
  {/each}
  <text x={origin.x + len / 2} y={origin.y - 5} class="label" text-anchor="middle">SO</text>
  <circle cx={origin.x} cy={origin.y} r="5.5" fill="var(--fg)" />
</svg>

<style>
  svg {
    width: 100%;
    max-height: 112px;
    overflow: visible;
  }
  .arm {
    stroke: var(--muted);
    stroke-width: 1.2;
  }
  .guide {
    fill: none;
    stroke: var(--muted);
    stroke-dasharray: 2 2;
  }
  .turn {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.2;
    stroke-dasharray: 4 3;
  }
  .label {
    fill: var(--muted);
    font-size: 9px;
  }
</style>
