import type { Engine } from '../engine/engine';
import { defaultSettings, MAX_STRAINS, strainLike, type Settings } from '../model/params';
import { presetById, RULE_MISSING_NOTICE, usesRule, type Preset } from '../model/presets';
import { modelChanged } from '../model/scene';

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

export const LEARN_TABS = ['Physarum', 'The model', 'Controls', 'Scenes', 'About'] as const;

export type LearnTab = (typeof LEARN_TABS)[number];

export interface Stats {
  fps: number;
  stepsPerSecond: number;
  step: number;
  alive: number[];
}

export interface AppState {
  settings: Settings;
  /** Id of the loaded preset; empty for settings from the page address (a shared link or a reload). */
  scene: string;
  /** The settings the scene loaded with, to tell whether a model parameter changed since. */
  sceneBase: Settings | undefined;
  /**
   * For each strain, its index in the loaded scene, or −1 for a strain added since. Removing a strain moves the
   * later ones up a letter, so the scene card finds each strain's role here.
   */
  strainOrigin: number[];
  /** Settings → Scene is open (kept while the panel is hidden). */
  sceneSection: boolean;
  /** "About this scene" in the scene card is open. */
  sceneAbout: boolean;
  tool: Tool;
  /** Brush radius in CSS pixels. */
  brush: number;
  /** Strain placed by the inoculate tool. */
  strain: number;
  paused: boolean;
  panel: boolean;
  learn: boolean;
  learnTab: LearnTab;
  hideUi: boolean;
  error: string;
  /** Short message shown for a few seconds. */
  notice: string;
  /** Largest grid this device runs smoothly (lowered by the startup check in App.svelte). */
  maxResolution: number;
  /** The backend supports one agent per cell (WebGL2 needs EXT_float_blend). */
  canCollide: boolean;
  stats: Stats;
}

/** Reactive UI state shared by all components. The engine itself is not reactive. */
export const app = $state<AppState>({
  settings: defaultSettings(),
  scene: '',
  sceneBase: undefined,
  strainOrigin: [],
  sceneSection: true,
  sceneAbout: false,
  tool: 'pan',
  brush: 18,
  strain: 0,
  paused: false,
  panel: true,
  learn: false,
  learnTab: 'Physarum',
  hideUi: false,
  error: '',
  notice: '',
  maxResolution: 4096,
  canCollide: true,
  stats: { fps: 0, stepsPerSecond: 0, step: 0, alive: [] },
});

/**
 * Makes `p` the current scene with fresh settings, capped to what this device runs (grid size, the
 * one-agent-per-cell rule). The caller hands the settings and the environment to the engine.
 */
export function setScene(p: Preset) {
  const s = p.settings();
  s.resolution = Math.min(s.resolution, app.maxResolution);
  if (!app.canCollide) s.collisions = false;
  const base = structuredClone(s);
  app.settings = s;
  app.scene = p.id;
  app.sceneBase = base;
  app.strainOrigin = s.strains.map((_, i) => i);
  // The inoculate tool places the selected strain, and a scene with fewer strains has no such strain.
  app.strain = Math.min(app.strain, s.strains.length - 1);
}

let ruleNoticeShown = false;

/** Once per page load: this backend runs the current scene, made for the rule, without it. */
function noteMissingRule() {
  const p = presetById(app.scene);
  if (app.canCollide || ruleNoticeShown || !p || !usesRule(p)) return;
  ruleNoticeShown = true;
  showNotice(RULE_MISSING_NOTICE, 12_000);
}

/** Loads a preset (capped to the device's grid size) with its food, light and walls. */
export function loadPreset(id: string) {
  const p = presetById(id);
  if (!p) return;
  setScene(p);
  noteMissingRule();
  void engine?.load($state.snapshot(app.settings), p.env);
}

/**
 * The backend cannot run one agent per cell: the switch shows it off, and that is no change to the scene. A scene
 * chosen while the engine started gets its notice here.
 */
export function ruleUnavailable() {
  app.canCollide = false;
  app.settings.collisions = false;
  if (app.sceneBase) app.sceneBase.collisions = false;
  noteMissingRule();
}

/** Adds a strain that copies strain A: the defaults are Jones' values without the rule, which collapse. */
export function addStrain() {
  const s = app.settings;
  const first = s.strains[0];
  if (!first || s.strains.length >= MAX_STRAINS) return;
  s.strains.push(strainLike($state.snapshot(first), s.strains.length));
  app.strainOrigin.push(-1);
}

/** Removes strain `i`; the strains after it move up a letter, and so do their trail weights. */
export function removeStrain(i: number) {
  const s = app.settings;
  if (s.strains.length < 2 || i < 0 || i >= s.strains.length) return;
  s.strains.splice(i, 1);
  for (const st of s.strains) st.attraction = [...st.attraction.slice(0, i), ...st.attraction.slice(i + 1), -1];
  app.strainOrigin.splice(i, 1);
  // The inoculate tool keeps its strain when an earlier one goes.
  if (i < app.strain) app.strain--;
  app.strain = Math.min(app.strain, s.strains.length - 1);
}

/**
 * True when a model parameter differs from the loaded scene. A grid the device lowered (memory, startup
 * check) is no change: the scene asks for at most `app.maxResolution`.
 */
export function sceneChanged(): boolean {
  const base = app.sceneBase;
  if (!base) return false;
  return modelChanged(app.settings, { ...base, resolution: Math.min(base.resolution, app.maxResolution) });
}

export function openLearn(tab: LearnTab) {
  app.learnTab = tab;
  app.learn = true;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message for a few seconds. */
export function showNotice(text: string, ms = 7000) {
  app.notice = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (app.notice = ''), ms);
}

let engine: Engine | undefined;

export const getEngine = () => engine;
export const setEngine = (e: Engine | undefined) => {
  engine = e;
};
