<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, open = $bindable(false), children }: { title: string; open?: boolean; children: Snippet } = $props();
</script>

<details class="section" bind:open>
  <summary>{title}</summary>
  <div class="body">{@render children()}</div>
</details>

<style>
  .section {
    border-top: 1px solid var(--line);
  }
  summary {
    cursor: pointer;
    padding: 10px 2px;
    font-weight: 600;
    letter-spacing: 0.02em;
    list-style-position: inside;
  }
  .body {
    padding: 0 2px 12px;
  }
</style>
