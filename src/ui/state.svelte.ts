import type { Engine } from '../engine/engine';
import { strainAgents } from '../engine/pack';
import { drawingOf, kindsOf, type Drawing } from '../model/link';
import {
  constrain,
  defaultSettings,
  globalSpec,
  MAX_STRAINS,
  RESOLUTIONS,
  sameLattice,
  strainLike,
  strainSpec,
  toJones,
  type Lattice,
  type Model,
  type Settings,
} from '../model/params';
import { presetById, RULE_MISSING_NOTICE, usesRule, type Preset } from '../model/presets';
import { fmt, letter, list, modelChanged, signed } from '../model/scene';
import type { Link } from '../model/url';

export const TOOLS = [
  { id: 'pan', key: '1', label: 'Move', help: 'Drag to move the view. Scroll or pinch to zoom.' },
  {
    id: 'inoculate',
    key: '2',
    label: 'Inoculate',
    help: 'Hold to place agents of the selected strain. The tool uses only dead agents.',
  },
  { id: 'food', key: '3', label: 'Food', help: 'Place oat flakes. Food releases an attracting scent.' },
  {
    id: 'light',
    key: '4',
    label: 'Light',
    help: 'Shine light. Physarum flees from it. Only the extended model has light.',
  },
  { id: 'wall', key: '5', label: 'Wall', help: 'Draw walls that agents cannot cross or sense through.' },
  { id: 'erase', key: '6', label: 'Erase', help: 'Remove food, light and walls.' },
  {
    id: 'cut',
    key: '7',
    label: 'Cut',
    help: 'Wound the network: moves the agents in an area away. In the extended model the area also loses its trail.',
  },
] as const;

export type Tool = (typeof TOOLS)[number]['id'];

/** The tools of a model: Jones' papers have no light that releases a repellent (ADR 0022). */
export const toolsFor = (model: Model) => TOOLS.filter((t) => model === 'extended' || t.id !== 'light');

/**
 * Keeps the selected tool one that the current model offers (toolsFor()): every change of the model calls it, a load
 * of a scene or a link too. Light in the Jones model selects Move (ADR 0022, decision 25).
 */
function fitTool() {
  if (!toolsFor(app.settings.model).some((t) => t.id === app.tool)) app.tool = 'pan';
}

export const LEARN_TABS = ['Physarum', 'The model', 'Controls', 'Scenes', 'About'] as const;

export type LearnTab = (typeof LEARN_TABS)[number];

export interface Stats {
  fps: number;
  stepsPerSecond: number;
  step: number;
  alive: number[];
  /** Engine.restarts when `alive` was counted, −1 before the first count: the run whose agents it counts. */
  run: number;
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
  stats: { fps: 0, stepsPerSecond: 0, step: 0, alive: [], run: -1 },
});

/**
 * Makes `p` the current scene with fresh settings, capped to what this device runs (grid size, the
 * one-agent-per-cell rule). The caller hands the settings and the environment to the engine.
 */
export function setScene(p: Preset) {
  let s = p.settings();
  s.resolution = Math.min(s.resolution, app.maxResolution);
  // Without the rule a scene of Jones runs on the extended model: the Jones model always has it (constrain()).
  if (!app.canCollide) s = constrain({ ...s, collisions: false });
  const base = structuredClone(s);
  app.settings = s;
  app.scene = p.id;
  app.sceneBase = base;
  app.strainOrigin = s.strains.map((_, i) => i);
  // The inoculate tool places the selected strain, and a scene with fewer strains has no such strain.
  app.strain = Math.min(app.strain, s.strains.length - 1);
  fitTool();
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
  fitTool();
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

/**
 * Whether the food, light and walls hold light, which the Jones model draws without effect: the panel says so below
 * the model choice (ADR 0022, decision 29). The engine changes its list outside Svelte, and app.envVersion counts the
 * changes: the read of it lets a derived value follow them.
 */
export function lightDrawn(): boolean {
  return app.envVersion >= 0 && kindsOf(currentDrawing()).has('light');
}

/** Shown below the model choice while the Jones model draws light (lightDrawn()). */
export const JONES_LIGHT =
  'The light on the canvas has no effect in the Jones model. To remove it, use the Erase tool. To use it, select Extended.';

/** The arena of the scene's shapes in the engine's list: the scene's own (startScene(), loadPreset()). */
const sceneArena = () => app.sceneBase?.boundary ?? app.settings.boundary;

/**
 * The backend cannot run one agent per cell: the switch shows it off, and that is no change to the scene. A scene
 * chosen while the engine started gets its notice here.
 */
export function ruleUnavailable() {
  app.canCollide = false;
  app.settings = constrain({ ...$state.snapshot(app.settings), collisions: false });
  fitTool();
  if (app.sceneBase) app.sceneBase = constrain({ ...app.sceneBase, collisions: false });
  noteMissingRule();
}

/**
 * The panel's model choice. A switch to Jones keeps only what Jones' model has (toJones()): strain A, one agent per
 * cell, one diffusion pass, and the scent bound to the trail. A notice says what went (jonesChanges()). The extended
 * model takes the settings as they are. With a scent decay of 0.1 it then runs as Jones does, until a setting of its
 * own changes, a wall is drawn or the Cut tool acts: its sensors check walls on their way, and its cut clears the
 * chemicals.
 */
export function setModel(model: Model) {
  const s = $state.snapshot(app.settings);
  if (model === s.model) return;
  if (model === 'extended') {
    app.settings.model = 'extended';
    return;
  }
  if (!app.canCollide) {
    showNotice('The Jones model needs one agent per cell, and this browser cannot run it.');
    return;
  }
  const next = toJones(s);
  app.settings = next;
  app.strainOrigin = app.strainOrigin.slice(0, 1);
  app.strain = 0;
  fitTool();
  // Only the extended model's sensors check walls on their way (ADR 0020): drawn walls act differently now.
  const walls = kindsOf(currentDrawing()).has('wall') ? ' The walls stop agents, but they do not block sensors.' : '';
  const text = `The Jones model has only Jones’ rules, and light has no effect in it.${walls}${jonesChanges(s, next)}`;
  // About 3.3 words per second, as for the other long notices.
  showNotice(text, Math.max(10_000, text.split(' ').length * 300));
}

/**
 * What toJones() changed, for the notice of the switch (ADR 0022, decision 28): the strains and the agents that share
 * a cell it removed, and every number it changed, from the difference of the settings, so that the notice cannot miss
 * one. The population share of strain A is not in it: one strain has no share.
 */
function jonesChanges(s: Settings, next: Settings): string {
  const n = s.strains.length;
  const removed = [
    n > 1 && (n === 2 ? 'strain B' : `strains B to ${letter(n - 1)}`),
    !s.collisions && 'agents that share a cell',
  ].filter((v): v is string => typeof v === 'string');
  const changed: string[] = [];
  for (const k of Object.keys(globalSpec) as (keyof typeof globalSpec)[]) {
    const why = k === 'scentDecay' ? ' (the Decay of strain A)' : '';
    if (s[k] !== next[k]) changed.push(`${globalSpec[k].label} from ${fmt(s[k])} to ${fmt(next[k])}${why}`);
  }
  const [a, b] = [s.strains[0], next.strains[0]];
  if (a && b) {
    const [from, to] = [a.attraction[0] ?? 0, b.attraction[0] ?? 0];
    if (from !== to) changed.push(`the weight of strain A on its own trail from ${signed(from)} to ${signed(to)}`);
    for (const k of ['food', 'light'] as const)
      if (a[k] !== b[k]) changed.push(`${strainSpec[k].label} from ${signed(a[k])} to ${signed(b[k])}`);
  }
  return [
    removed.length ? ` It removed ${list(removed)}.` : '',
    changed.length ? ` It changed ${list(changed)}.` : '',
  ].join('');
}

/**
 * Keeps the panel on what the engine runs: constrain() binds the Jones model's values and turns a Jones model with a
 * value Jones does not have into the extended one (App.svelte's settings effect). Writes only what changed.
 */
export function adopt(valid: Settings) {
  const s = app.settings as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(valid)) {
    if (JSON.stringify(s[k]) !== JSON.stringify(v)) s[k] = structuredClone(v);
  }
  fitTool();
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
 * The lattice of the loaded scene while the grid is another one (ADR 0026): the panel then says why the result
 * differs from the paper and offers the lattice again. Undefined for a scene without a lattice.
 */
export function latticeLeft(): Lattice | undefined {
  const lattice = app.sceneBase?.lattice;
  return lattice && !sameLattice(app.settings.lattice, lattice) ? lattice : undefined;
}

/** Puts the loaded scene back on its lattice; the other settings stay (the button below the grid). */
export function useSceneLattice() {
  const lattice = app.sceneBase?.lattice;
  if (!lattice) return;
  app.settings.lattice = [lattice[0], lattice[1]];
  app.gridPicked = true;
}

/**
 * The grid choice of the panel: a lattice, "200x200", or a grid shaped like the screen, its cells on the long side.
 * Unknown values change nothing.
 */
export function pickGrid(value: string) {
  const lattice = /^(\d+)x(\d+)$/.exec(value);
  const resolution = Number(value);
  if (lattice) app.settings.lattice = [Number(lattice[1]), Number(lattice[2])];
  else if (RESOLUTIONS.includes(resolution as never)) {
    app.settings.lattice = null;
    app.settings.resolution = resolution;
  } else return;
  app.gridPicked = true;
}

/** The value of a lattice in the panel's grid choice (pickGrid()). */
export const latticeValue = ([w, h]: Lattice) => `${w}x${h}`;

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

/**
 * Whether a dead agent of the selected strain is left for the inoculate tool, which uses only dead agents (ADR 0023).
 * From the alive count of the stats, at most 500 ms old. Undefined while the stats hold no count of the current run
 * of the engine: a count from before a restart or rebuild is of other agents.
 */
export function deadLeft(e: Engine): boolean | undefined {
  if (app.stats.run !== e.restarts) return undefined;
  const alive = app.stats.alive[app.strain];
  const agents = strainAgents(e.settings.strains, e.sim.agents)[app.strain];
  return alive === undefined || agents === undefined ? undefined : alive < agents;
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
