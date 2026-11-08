import type { Engine } from '../src/engine/engine';

declare global {
  /** Debug handle set by App.svelte. */
  var physarum: Engine | undefined;
}

export {};
