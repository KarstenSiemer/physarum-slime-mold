import type { Engine } from '../engine/engine';
import { drawingOf, type Drawing } from '../model/link';
import { defaultSettings, MAX_STRAINS, strainLike, type Settings } from '../model/params';
import { presetById, RULE_MISSING_NOTICE, usesRule, type Preset } from '../model/presets';
import { modelChanged } from '../model/scene';
import type { Link } from '../model/url';

export const TOOLS = [
  { id: 'pan', key: '1', label: 'Move', help: 'Drag to move the view. Scroll or pinch to zoom.' },
  { id: 'inoculate', key: '2', label: 'Inoculate', help: 'Hold to place agents of the selected strain.' },
  { id: 'food', key: '3', label: 'Food', help: 'Place oat flakes. Food releases an attracting scent.' },
  { id: 'light', key: '4', label: 'Light', help: 'Shine light. Physarum flees from it.' },
  { id: 'wall', key: '5', label: 'Wall', help: 'Draw walls that agents cannot cross or sense through.' },
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
  /** Id of the loaded preset; empty for settings from a link that names no scene this app can read (docs/adr/0021). */
  scene: string;
  /** The settings the scene loaded with, to tell whether a model parameter changed since. */
  sceneBase: Settings | undefined;
  /**
   * Food, light or walls differ from the loaded scene's shapes: after a Clear, a recorded stroke or a sweep that
   * deleted a shape (Engine.matches). Kept in step with the engine's edit list (setEngine()).
   */
  envChanged: boolean;
  /**
   * Counts changes of the food, light and walls: the engine changes its edit list outside Svelte (Engine.onEdits),
   * and the page address follows this count (App.svelte).
   */
  envVersion: number;
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
  /** The user picked a grid in the panel; the startup check never lowers it then. */
  gridPicked: boolean;
  /** The backend supports one agent per cell (WebGL2 needs EXT_float_blend). */
  canCollide: boolean;
  stats: Stats;
}

/** Reactive UI state shared by all components. The engine itself is not reactive. */
export const app = $state<AppState>({
  settings: defaultSettings(),
  scene: '',
  sceneBase: undefined,
  envChanged: false,
  envVersion: 0,
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
  gridPicked: false,
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
  clearedBeforeStart = false;
  linkDrawing = undefined;
  app.envChanged = false;
  app.envVersion++;
  void engine?.load($state.snapshot(app.settings), p.env);
}

/** Clear was pressed before the engine existed: the engine starts without the scene's shapes (startScene()). */
let clearedBeforeStart = false;

/** The drawing of the shared link the page opened, until the engine loads it (startScene()). */
let linkDrawing: Drawing | undefined;

/** Removes food, light and walls. The panel works before the engine exists, so a Clear then waits for the start. */
export function clearEnvironment() {
  if (engine) {
    engine.clearEnvironment();
    return;
  }
  clearedBeforeStart = true;
  app.envVersion++;
  if (presetById(app.scene)?.env?.length) app.envChanged = true;
}

/**
 * Opens a shared link (url.ts decodeLink()) before the engine exists: its settings, and the scene and the food, light
 * and walls it names, which startScene() then loads. The scene card compares the settings with the scene's, within
 * what this device runs (sceneChanged(), ruleUnavailable()), and the drawing with the scene's shapes. A link that
 * names no scene loads as before: its settings, its strokes if it has any, and no scene text. So does a link whose
 * drawing this app cannot read, and a notice says so.
 */
export function openLink({ settings, drawing, drawingLost }: Link) {
  app.settings = settings;
  linkDrawing = drawing;
  app.envVersion++;
  if (drawingLost) showNotice('This app cannot read the scene and drawing in this link, so only its settings load.');
  const p = drawing && presetById(drawing.scene);
  if (!p) return;
  app.scene = p.id;
  app.sceneBase = p.settings();
  app.strainOrigin = [...drawing.origins];
  app.envChanged = drawing.strokes.length > 0 || drawing.shapes.some((kept) => !kept);
}

/**
 * The first load of a new engine (App.svelte): what the state holds now, because the panel works before the engine
 * exists. The simulation runs under the panel's settings, and a scene's shapes keep the scene's own arena, also when
 * a boundary was chosen meanwhile: in its canonical frame they lie where the scene puts them. One load, so a setting
 * changed while it builds the simulation reaches the engine through App.svelte's settings effect and stays.
 */
export function startScene(e: Pick<Engine, 'load'>) {
  const { shapes, strokes } = waiting();
  linkDrawing = undefined;
  return e.load($state.snapshot(app.settings), shapes, app.sceneBase?.boundary, strokes);
}

/** What startScene() loads: the scene's shapes that a shared link kept, or all of them, then the link's strokes. */
function waiting() {
  const env = clearedBeforeStart ? [] : (presetById(app.scene)?.env ?? []);
  const d = clearedBeforeStart ? undefined : linkDrawing;
  return { shapes: env.filter((_, i) => d?.shapes[i] ?? true), strokes: d?.strokes ?? [] };
}

/**
 * The scene with its food, light and walls, for the page address (App.svelte): the engine's edit list as it is now,
 * or what startScene() will load before the engine exists. The shapes are in the scene's own arena (startScene()).
 */
export function currentDrawing(): Drawing {
  const p = presetById(app.scene);
  const [scene, env] = [p?.id ?? '', p?.env ?? []];
  const origins = $state.snapshot(app.strainOrigin);
  if (engine) return drawingOf(engine.envList(), scene, env, sceneArena(), origins);
  const { shapes, strokes } = waiting();
  return { scene, origins, shapes: env.map((shape) => shapes.includes(shape)), strokes: [...strokes] };
}

/** The arena of the scene's shapes in the engine's list: the scene's own (startScene(), loadPreset()). */
const sceneArena = () => app.sceneBase?.boundary ?? app.settings.boundary;

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
 * True when a model parameter or the food, light and walls differ from the loaded scene. A grid the device lowered
 * (memory, startup check) is no change: the scene asks for at most `app.maxResolution`.
 */
export function sceneChanged(): boolean {
  const base = app.sceneBase;
  if (!base) return false;
  return (
    app.envChanged || modelChanged(app.settings, { ...base, resolution: Math.min(base.resolution, app.maxResolution) })
  );
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
/** Also keeps app.envChanged in step with the engine's food, light and walls: whether they are the scene's shapes. */
export const setEngine = (e: Engine | undefined) => {
  engine = e;
  if (!e) return;
  e.onEdits = () => {
    const env = presetById(app.scene)?.env ?? [];
    app.envChanged = !e.matches(env, sceneArena());
    app.envVersion++;
  };
};
