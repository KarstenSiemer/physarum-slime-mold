import type { Engine } from '../engine/engine';
import { defaultSettings, type Settings } from '../model/params';
import { PRESETS } from '../model/presets';

export const TOOLS = [
  { id: 'pan', key: '1', label: 'Move', help: 'Drag to move the view. Scroll or pinch to zoom.' },
  { id: 'inoculate', key: '2', label: 'Inoculate', help: 'Hold to place agents of the selected strain.' },
  { id: 'food', key: '3', label: 'Food', help: 'Place oat flakes. Food releases an attracting scent.' },
  { id: 'light', key: '4', label: 'Light', help: 'Shine light. Physarum flees from it.' },
  { id: 'wall', key: '5', label: 'Wall', help: 'Draw walls that agents cannot cross.' },
  { id: 'erase', key: '6', label: 'Erase', help: 'Remove food, light and walls.' },
  { id: 'cut', key: '7', label: 'Cut', help: 'Wound the network: clears an area and moves its agents away.' },
] as const;

export type Tool = (typeof TOOLS)[number]['id'];

export interface Stats {
  fps: number;
  stepsPerSecond: number;
  step: number;
  alive: number[];
}

export interface AppState {
  settings: Settings;
  tool: Tool;
  /** Brush radius in CSS pixels. */
  brush: number;
  /** Strain placed by the inoculate tool. */
  strain: number;
  paused: boolean;
  panel: boolean;
  learn: boolean;
  hideUi: boolean;
  error: string;
  /** Short message shown for a few seconds. */
  notice: string;
  /** Largest grid this device runs smoothly (lowered by the startup check in App.svelte). */
  maxResolution: number;
  /** The user picked a grid in the panel; the startup check never lowers it then. */
  gridPicked: boolean;
  /** The backend supports one agent per cell (WebGL2 needs EXT_float_blend). */
  canCollide: boolean;
  stats: Stats;
}

/** Reactive UI state shared by all components. The engine itself is not reactive. */
export const app = $state<AppState>({
  settings: defaultSettings(),
  tool: 'pan',
  brush: 18,
  strain: 0,
  paused: false,
  panel: true,
  learn: false,
  hideUi: false,
  error: '',
  notice: '',
  maxResolution: 4096,
  gridPicked: false,
  canCollide: true,
  stats: { fps: 0, stepsPerSecond: 0, step: 0, alive: [] },
});

/** Loads a preset (capped to the device's grid size) with its food, light and walls. */
export function loadPreset(id: string) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  const s = p.settings();
  s.resolution = Math.min(s.resolution, app.maxResolution);
  app.settings = s;
  void engine?.load($state.snapshot(app.settings), p.env);
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message for a few seconds. */
export function showNotice(text: string) {
  app.notice = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (app.notice = ''), 7000);
}

let engine: Engine | undefined;

export const getEngine = () => engine;
export const setEngine = (e: Engine | undefined) => {
  engine = e;
};
