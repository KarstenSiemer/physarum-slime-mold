import { defaultSettings, defaultStrain, MAX_STRAINS, type Settings, type Strain } from './params';

/**
 * Food, light or a wall in the canonical frame of the preset's own arena (engine/environment.ts, toFrame()), the
 * arena it is painted in: like every edit, it goes to other grids through the canonical frame of the arena it was
 * painted in, also after a switch to another arena. Positions from the grid's centre, on a landscape grid; a
 * portrait grid turns the frame by 90°. In a dish the unit is the grid's short side on both axes. In a box or a
 * periodic grid x from −0.8 to 0.8 spans the long side and y from −0.5 to 0.5 the short side, whatever the screen's
 * shape. The radius is in units of the short side.
 */
export interface EnvShape {
  kind: 'food' | 'light' | 'wall';
  at: [number, number];
  to?: [number, number];
  r: number;
}

/** Groups of the preset list, in this order in the Panel and in Learn → Scenes. */
export const GROUPS = [
  { id: 'start', label: 'Start here' },
  { id: 'jones', label: 'Jones 2010' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'fogleman', label: 'Fogleman 2020' },
] as const;

export type Group = (typeof GROUPS)[number]['id'];

export interface Preset {
  id: string;
  name: string;
  group: Group;
  /** Where the settings come from, shown as a chip: "Jones 2010, Fig. 4", "Fogleman 2020", "Made for this app". */
  source: string;
  /** One line under the name. */
  summary: string;
  /** What to look for, shown for experiments. */
  watch?: string;
  /** About this scene, 2 to 4 sentences. */
  about: string;
  /** What each strain does, one entry per strain. The UI adds the numbers from the settings. */
  strainRoles: string[];
  /** Why these settings. */
  why: string;
  settings: () => Settings;
  env?: EnvShape[];
}

/** The scene the app starts with. */
export const START = 'three-strains';

const deg = (rad: number) => (rad * 180) / Math.PI;

function strains(list: Partial<Strain>[]): Strain[] {
  return list.map((p, i) => ({ ...defaultStrain(i), ...p }));
}

function settings(patch: Partial<Settings>): Settings {
  return { ...defaultSettings(), seed: (Math.random() * 2 ** 32) >>> 0, ...patch };
}

/** Matrix row for Fogleman's old `RepulsionFactor r`: self +1, every other strain −r. */
function repulsion(i: number, r: number) {
  return Array.from({ length: MAX_STRAINS }, (_, j) => (j === i ? 1 : -r));
}

/** Fogleman's presets (cmd/viewer/main.go:30–57, MIT): radians, kept fraction, repulsion factor. */
function fogleman(rows: number[][], perStrainDensity: number): Settings {
  return settings({
    resolution: 1024,
    density: perStrainDensity * rows.length,
    diffusion: 2,
    layout: 'mixed',
    strains: rows.map(([sa = 0, sd = 0, ra = 0, step = 0, deposit = 5, keep = 0.1, r = 1], i) => ({
      ...defaultStrain(i),
      sensorAngle: deg(sa),
      sensorOffset: sd,
      rotationAngle: deg(ra),
      stepSize: step,
      deposit,
      decay: 1 - keep,
      attraction: repulsion(i, r),
    })),
  });
}

// Jones' model: Table 1 (p. 134), 15 % of cells with an agent as in Fig. 4 and 5, and his rule of one agent per
// cell (p. 133). Sensor offset and step size are in cells, so the grid sets the scale of the model: 512 here;
// scenes that need another grid set it themselves. The scenes of Jones' papers run on the Jones model, which weighs
// food as the strain's own trail (ADR 0022); the app's scenes with these agents set the extended model.
const jones = (patch: Partial<Strain>, extra: Partial<Settings> = {}) =>
  settings({
    resolution: 512,
    density: 0.15,
    collisions: true,
    model: 'jones',
    strains: strains([{ food: patch.attraction?.[0] ?? 1, ...patch }]),
    ...extra,
  });

// Grid 1024 shows about four times as many holes as 512, and without glow they stay dark (decided 2026-11-09).
const network = { resolution: 1024, bloom: 0 } satisfies Partial<Settings>;

// Food, light and walls in the canonical frame of the arena they are painted in, the preset's own (EnvShape): on a
// 16:10 window x from −0.8 to 0.8 spans its width and y from −0.5 to 0.5 its height in every arena. The values place every shape where the fractions of the grid
// used before 2026-11-10 put it on 16:10.
const food = (x: number, y: number, r = 0.012): EnvShape => ({ kind: 'food', at: [x, y], r });
const wall = (x1: number, y1: number, x2: number, y2: number): EnvShape => ({
  kind: 'wall',
  at: [x1, y1],
  to: [x2, y2],
  r: 0.008,
});

const FOGLEMAN_WHY =
  'Not derived from biology. Fogleman’s program draws random settings and prints them, and he saved this set under its name. The values are copied exactly: radians turned into degrees, his kept fraction into decay = 1 − kept, and his repulsion factor into a negative weight on the other strains’ trails.';

export const PRESETS: Preset[] = [
  {
    id: 'three-strains',
    name: 'Three strains',
    group: 'start',
    source: 'Made for this app',
    summary: 'Three rival strains start in one disc and weave their networks around each other.',
    about:
      'The start scene. Three strains begin as slices of one disc. Each follows its own trail and steers away from the other two, so their networks wind around each other instead of merging. It works like the versions of Sage Jenson and Michael Fogleman: several agents per cell and no one-agent-per-cell rule, which gives thin, sharp filaments.',
    strainRoles: ['One of three equal rivals', 'The same settings as A', 'The same settings as A'],
    why: 'Chosen for this app, not taken from a paper. As in Fogleman’s version, agents share cells (3 agents per cell) and the trail gets two blur passes. Decay 0.6 removes most of the trail every step, so a path lasts only while agents keep walking it. Sensor distance 18 sets the size of the mesh (Jones, Fig. 10). A weight of −0.7 on the other strains’ trails keeps the networks apart.',
    settings: () =>
      settings({
        density: 3,
        diffusion: 2,
        layout: 'sectors',
        strains: strains(
          [0, 1, 2].map((i) => ({
            sensorAngle: 35,
            rotationAngle: 40,
            sensorOffset: 18,
            stepSize: 1.4,
            decay: 0.6,
            attraction: repulsion(i, 0.7),
          })),
        ),
      }),
  },
  {
    id: 'two-strains',
    name: 'Two strains',
    group: 'start',
    source: 'Made for this app',
    summary: 'Two strains side by side; each builds its own network and avoids the other.',
    about:
      'Two strains start in two bands, side by side. Each follows its own trail and is repelled by the other’s, so the two networks compete for space. Watch what happens where they meet. Like the start scene, it runs without the one-agent-per-cell rule.',
    strainRoles: ['Starts in the left band', 'The same settings as A, starts in the right band'],
    why: 'Chosen for this app. Sensor distance 14 (Jones: 9) gives a coarser mesh, and decay 0.3 lies between Jones’ 0.1 and the start scene’s 0.6. A weight of −0.6 on the other strain’s trail keeps the strains apart, and 2 agents per cell fill the grid.',
    settings: () =>
      settings({
        density: 2,
        layout: 'bands',
        strains: strains(
          [0, 1].map((i) => ({
            sensorOffset: 14,
            decay: 0.3,
            attraction: repulsion(i, 0.6).map((v, j) => (j < 2 ? v : 0)),
          })),
        ),
      }),
  },
  {
    id: 'network',
    name: 'Transport network',
    group: 'jones',
    source: 'Jones 2010, Fig. 4',
    summary: 'Jones’ standard model: a network that keeps rebuilding itself.',
    about:
      'Jones’ default setting (p. 134–135). Within a few hundred steps, randomly placed agents form a mesh of trails. Small loops shrink and vanish, bigger holes grow, and now and then a new branch sprouts across a hole, so the network never settles (Fig. 4 shows steps 2 to 4,151). The trails look grainy, as in Jones’ figures: in every step most agents are blocked and turn at random.',
    strainRoles: ['Jones’ standard agent'],
    why: 'Jones’ defaults: Table 1 (p. 134) with one blur pass and wrapping edges, 15 % of cells holding an agent (Fig. 4) and his rule of one agent per cell (p. 133). A rotation angle above the sensor angle keeps the network changing (p. 135). Blocked agents turn at random, and these turns let new branches take hold; without the rule the network contracts into a few lines. Grid 1024 and no glow keep the holes small and dark.',
    settings: () => jones({ sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 9 }, network),
  },
  {
    id: 'hexagons',
    name: 'Minimizing network',
    group: 'jones',
    source: 'Jones 2010, Fig. 5',
    summary: 'Equal angles: loops close one by one until a simple mesh is left.',
    about:
      'Jones’ model with the sensor angle raised to 45°, equal to the rotation angle. New branches do not last: small loops close, the other holes grow, and the network contracts like a soap film. On Jones’ 200 × 200 grid it ends after about 31,000 steps as a simple network whose copies, side by side, approximate a hexagonal tiling (Fig. 5). This grid holds far more holes, so the mesh keeps coarsening for longer.',
    strainRoles: ['Jones’ agent with equal angles'],
    why: 'Only the sensor angle differs from Jones’ defaults. With equal angles an agent turns exactly toward where its side sensor was, so its sensors stay on the trail and new branches do not last (p. 135). The rest is as for Fig. 5: 15 % of cells hold an agent (p. 136), one blur pass (Table 1) and one agent per cell (p. 133). Grid 1024 and no glow keep the holes small and dark.',
    settings: () => jones({ sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 }, network),
  },
  {
    id: 'spots',
    name: 'Turing spots',
    group: 'jones',
    source: 'Jones 2010, Fig. 16 (top)',
    summary: 'Agents flee their own trail and settle into a regular array of spots.',
    about:
      'Here agents are repelled by the trail they lay (chemorepulsion). They first gather in tight circular flows that push each other apart, and over time a regular array of spots spreads across the grid (p. 143). Jones compares such patterns to Turing patterns, the chemistry used to explain spots and stripes on animal coats.',
    strainRoles: ['Jones’ repelled agent'],
    why: 'Jones’ values for Fig. 16, top row (p. 144): 20 % of cells hold an agent, sensor and rotation angle 45°, sensor distance 40, one agent per cell. The long sensor distance sets the wide spacing between the spots.',
    settings: () =>
      jones({ sensorAngle: 45, rotationAngle: 45, sensorOffset: 40, attraction: [-1, 0, 0, 0] }, { density: 0.2 }),
  },
  {
    id: 'stripes',
    name: 'Turing stripes',
    group: 'jones',
    source: 'Jones 2010, Fig. 16 (bottom)',
    summary: 'Repulsion with wide-set sensors: stripes that line up over time.',
    about:
      'Again agents flee their own trail, but the side sensors point far to the sides and agents turn further. Stripes first appear in many directions. Then one direction wins, turns the neighbouring stripes to its orientation and finally covers the grid (p. 143–144).',
    strainRoles: ['Jones’ repelled agent with wide-set sensors'],
    why: 'Jones’ values for Fig. 16, bottom row (p. 144): 20 % of cells hold an agent, one agent per cell, sensor distance 13. The sensor distance sets the spacing between the stripes.',
    settings: () =>
      jones({ sensorAngle: 112.5, rotationAngle: 67.5, sensorOffset: 13, attraction: [-1, 0, 0, 0] }, { density: 0.2 }),
  },
];

// Experiments from Jones 2010 and the Physarum literature: settings, environment and what to watch.
PRESETS.push(
  {
    id: 'shortest-path',
    name: 'Shortest path',
    group: 'experiments',
    source: 'Jones 2010, Fig. 18',
    summary: 'Two food sources in a dish: the network contracts into one band between them.',
    watch:
      'A loose network forms, snags on both food sources, then contracts into one band between them, like the real slime mold between two oat flakes. In some runs a side branch to the rim stays for a long time.',
    about:
      'Several hundred agents in a round dish with two food sources. Food releases a scent that spreads and fades like the trail, so the network snags on both foods. Then it contracts like a soap film until one band joins them. The band stays many cells wide, because only one agent fits in a cell.',
    strainRoles: ['Jones’ contracting agent, drawn to food'],
    why: 'Jones’ values for Fig. 18 (p. 145): as many agents as 2 % of the square around the dish, sensor and rotation angle 45°, one agent per cell, a closed dish, food weight 0.01. Equal angles let the network contract, and weak food lets its loops close (p. 146), so it can shrink to a single path. On grid 256 the dish is smaller than Jones’ 200 × 200 lattice.',
    settings: () =>
      jones(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
        { resolution: 256, density: 0.02, boundary: 'dish', foodStrength: 0.01 },
      ),
    env: [food(-0.288, 0, 0.02), food(0.288, 0, 0.02)],
  },
  {
    id: 'steiner',
    name: 'Steiner tree',
    group: 'experiments',
    source: 'Jones 2010, Fig. 19',
    summary: 'Four food sources: the network shrinks to a short tree that joins them all.',
    watch:
      'A loose network wraps around the four food sources, then contracts. It ends as two three-way junctions joined by a short bridge, where paths meet at about 120° as in soap films (Plateau’s laws). The bridge runs across or along the screen, and a tail to the rim can stay for a few thousand steps.',
    about:
      'The same setup with four food sources at the corners of a square. The network shrinks until it joins all four with little material, close to a Steiner tree: the shortest network that connects a set of points, with extra junctions where three paths meet (p. 144). Different runs take different routes but end in similar trees.',
    strainRoles: ['Jones’ contracting agent, drawn to food'],
    why: 'Jones’ values for Fig. 19 (p. 146): as many agents as 2 % of the square around the dish, which is about 2.5 % of the dish, sensor and rotation angle 45°, one agent per cell, food weight 0.01. With fewer agents loops and tails to the rim stay for thousands of steps longer.',
    settings: () =>
      jones(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
        { resolution: 256, density: 0.02, boundary: 'dish', foodStrength: 0.01 },
      ),
    // A square with the corners as far from the centre as the 0.32 × 0.26 rectangle of before.
    env: [food(-0.145, -0.145, 0.02), food(0.145, -0.145, 0.02), food(-0.145, 0.145, 0.02), food(0.145, 0.145, 0.02)],
  },
  {
    id: 'shrinking',
    name: 'Shrinking plasmodium',
    group: 'experiments',
    source: 'Jones 2010, Fig. 21',
    summary: 'A full sheet of agents slowly dies off and shrinks onto the food sources.',
    watch:
      'Agents die at random, half of them within about 2,800 steps. The sheet shrinks onto the food sources and leaves a network of veins between them, in most runs the same one. In some runs a hole opens beside the middle food early, and a loop stays around it.',
    about:
      'The dish starts packed with agents, which soon form a solid sheet. In every step each agent dies with a small chance, so the sheet thins out and shrinks onto the food sources, as a starving plasmodium does. In the paper, three runs ended in the same network (Fig. 21).',
    strainRoles: ['Jones’ contracting agent, drawn to food'],
    why: 'Jones’ values for Fig. 21 (p. 147): as many agents as 50 % of the square around the dish, so they start as a solid sheet, a removal chance of 0.00025 per agent and step, sensor and rotation angle 45°, one agent per cell. Slow removal lets the sheet adapt; faster removal tears holes into it (p. 148). Food weight 0.05 and the food positions are this app’s choice.',
    settings: () =>
      jones(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
        { density: 0.5, boundary: 'dish', foodStrength: 0.05, shrink: 0.00025 },
      ),
    env: [
      food(0, 0),
      food(-0.192, -0.18),
      food(0.192, -0.2),
      food(-0.272, 0.12),
      food(0.256, 0.16),
      food(0, 0.28),
      food(-0.368, -0.05),
      food(0.368, -0.03),
    ],
  },
  {
    id: 'wound',
    name: 'Wound healing',
    group: 'experiments',
    source: 'Jones 2010, Fig. 22',
    summary: 'A repelling spot pattern that grows back after you cut it.',
    watch:
      'Wait until the spots are regular, then choose the Cut tool and cut a hole. Agents flow back in and the original pattern grows again. In the paper the hole closed about 275 steps after the cut, and the pattern was back after about 550 (Fig. 22).',
    about:
      'A regular spot pattern made by chemorepulsion, like Turing spots with a shorter sensor distance. Jones cut a square hole into it. The agents flowed back in, and the undamaged pattern around the wound guided the regrowth until it matched the old one (p. 148). A network made by attraction also heals, but into a different pattern (Fig. 23).',
    strainRoles: ['Jones’ repelled agent'],
    why: 'Jones’ values for Fig. 22 (p. 148): 10 % of cells hold an agent, sensor and rotation angle 45°, sensor distance 27, one agent per cell. The Cut tool differs from his method in one point: Jones kept agents out of the wound until all were placed elsewhere, while here they flow back as soon as you release the tool. As in his method, the wound keeps its trail.',
    settings: () =>
      jones({ sensorAngle: 45, rotationAngle: 45, sensorOffset: 27, attraction: [-1, 0, 0, 0] }, { density: 0.1 }),
  },
  {
    id: 'light',
    name: 'Fleeing light',
    group: 'experiments',
    source: 'Made for this app',
    summary: 'A transport network around a bright lamp: it retreats from the light.',
    watch:
      'Physarum avoids light. The network retreats from the lit disc and reroutes around it. Paint more light with the Light tool.',
    about:
      'Real Physarum avoids light. A lamp in the middle releases a repellent that spreads and fades, so agents feel it before they enter the lit disc. The network itself uses Jones’ settings for Fig. 4.',
    strainRoles: ['Jones’ standard agent, flees light'],
    why: 'The network uses Jones’ values for Fig. 4 with one agent per cell. The light is this app’s simplification: a spreading repellent with strength 0.2. Jones 2010 has no light.',
    // Light that releases a repellent is no rule of Jones: the extended model (ADR 0022).
    settings: () =>
      jones({ sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 9 }, { model: 'extended', lightStrength: 0.2 }),
    env: [{ kind: 'light', at: [0, 0], r: 0.16 }],
  },
  {
    id: 'maze',
    name: 'Maze',
    group: 'experiments',
    source: 'Nakagaki et al. 2000',
    summary: 'Food at both ends of a winding corridor: the network fills it, then thins to many paths.',
    watch:
      'The network first fills every corridor. Then loops close and agents slowly die, so it thins to a mesh of paths that runs through the gaps between the walls. A path from food to food forms early and still holds at step 15,000, on wide, tall and square screens alike.',
    about:
      'In 2000, Toshiyuki Nakagaki and colleagues let a real slime mold fill an agar maze and put food at two exits. It pulled out of the dead ends and joined the food along the shortest route. Here, walls form a winding corridor with food at both ends. The model keeps many paths instead of one tube: it has no flow that thickens the shortest one.',
    strainRoles: ['Jones’ contracting agent, drawn to food'],
    why: 'Jones’ contracting setting with values chosen for this app: 12 % of cells hold an agent, sensor distance 7, food weight 0.03, a slow shrinkage of 0.0001 per agent and step, closed box edges, one agent per cell. Walls block movement and sensing, and the trail does not spread through them. No sensor reads the trail behind a wall, so agents on one side of a thin wall do not follow the trail on the other side.',
    settings: () =>
      jones(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 7 },
        // Sensors that walls block are the owner's rule for the Maze, not Jones': the extended model (ADR 0020, 0022).
        { model: 'extended', density: 0.12, boundary: 'box', foodStrength: 0.03, shrink: 0.0001 },
      ),
    env: [
      wall(-0.4, -0.5, -0.4, 0.2),
      wall(0, -0.2, 0, 0.5),
      wall(0.4, -0.5, 0.4, 0.2),
      wall(-0.4, 0.2, -0.16, 0.2),
      wall(0.16, -0.2, 0.4, -0.2),
      food(-0.64, -0.4, 0.018),
      food(0.64, 0.4, 0.018),
    ],
  },
);

// Michael Fogleman's saved settings (MIT).
PRESETS.push(
  {
    id: 'cyclones',
    name: 'Cyclones',
    group: 'fogleman',
    source: 'Fogleman 2020',
    summary: 'Two species: one builds a coarse honeycomb, the other spins vortices inside it.',
    about:
      'One of Michael Fogleman’s saved settings for his version with several species (2020). Strain A builds large polygonal cells, and strain B gathers into spinning spirals inside them. Each strain flees the other’s trail. It runs like his original: 4 agents per cell per strain, two blur passes and no one-agent-per-cell rule.',
    strainRoles: ['Builds large polygonal cells', 'Spins into spirals inside the cells'],
    why: FOGLEMAN_WHY,
    settings: () =>
      fogleman(
        [
          [0.87946403, 42.838207, 0.97047323, 2.8447638, 5, 0.29681, 1.4512],
          [1.7357124, 17.430664, 0.30490428, 2.1706762, 5, 0.27878627, 0.46232897],
        ],
        4,
      ),
  },
  {
    id: 'dunes',
    name: 'Dunes',
    group: 'fogleman',
    source: 'Fogleman 2020',
    summary: 'Two species: rough ridges like dune crests, with small dots between them.',
    about:
      'A saved setting from Fogleman’s program, which he named “dunes”. Strain A senses far ahead, turns sharply and builds rough, curved ridges. Strain B senses only about a cell ahead, flees the trail of A strongly and gathers into small dots between the ridges. It runs like his original: 2 agents per cell per strain, two blur passes and no one-agent-per-cell rule.',
    strainRoles: ['Builds rough, curved ridges', 'Gathers into small dots, flees A'],
    why: FOGLEMAN_WHY,
    settings: () =>
      fogleman(
        [
          [0.99931663, 44.21652, 1.9704952, 1.4215798, 5, 0.1580779, 0.7574965],
          [1.9694986, 1.294038, 0.5384646, 1.1613986, 5, 0.21102181, 1.5123861],
        ],
        2,
      ),
  },
  {
    id: 'dot-grid',
    name: 'Dot grid',
    group: 'fogleman',
    source: 'Fogleman 2020',
    summary: 'Three species: a regular lattice of dots inside a network of cells.',
    about:
      'A saved setting with three strains, named “dot grid” by Fogleman. Strain B looks almost straight ahead at a very short range and forms a regular lattice of dots. Strain C flees both others strongly and builds a network of cells around them, and strain A, which senses far and moves slowly, gathers into thick streaks. It runs with 1.33 agents per cell per strain, two blur passes and no one-agent-per-cell rule.',
    strainRoles: ['Gathers into thick streaks', 'Forms the lattice of dots', 'Builds a network of cells'],
    why: FOGLEMAN_WHY,
    settings: () =>
      fogleman(
        [
          [1.3433642, 49.39263, 0.91616887, 0.69644034, 5, 0.17888786, 0.2036435],
          [0.0856143, 1.6695175, 1.8827246, 2.3155663, 5, 0.14249614, 0.0026361942],
          [0.7959472, 33.977413, 0.5246451, 2.2891424, 5, 0.22549233, 1.4248871],
        ],
        1.3333334,
      ),
  },
);

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** True for scenes made for Jones' one-agent-per-cell rule. */
export const usesRule = (p: Preset) => p.settings().collisions;

/** Shown once per page load when a scene made for the rule loads on a backend without it. */
export const RULE_MISSING_NOTICE =
  'This browser cannot run one agent per cell (it lacks the GPU feature EXT_float_blend). Jones’ scenes run here without the rule, on the extended model: his networks contract into a few lines, and other patterns can look different.';

/**
 * Shown when the user switches the rule off in a scene made for it. The collapse is measured for the
 * Transport network (ADR 0008); a repelling pattern still forms without the rule, so it gets the milder text.
 */
export function ruleOffNotice(p: Preset): string {
  const attracted = (p.settings().strains[0]?.attraction[0] ?? 0) > 0;
  return attracted
    ? 'Without one agent per cell, agents pile up in the same cells and Jones’ networks contract: the Transport network ends as a few straight lines within a few thousand steps. Tick the box to restart with the rule.'
    : 'Without one agent per cell, several agents can share a cell. Jones made this pattern with the rule, so it can turn out different. Tick the box to restart with the rule.';
}

export type SourceKind = 'jones' | 'fogleman' | 'nakagaki' | 'app';

export function sourceKind(p: Preset): SourceKind {
  if (p.source.startsWith('Jones 2010')) return 'jones';
  if (p.source.startsWith('Fogleman 2020')) return 'fogleman';
  if (p.source.startsWith('Nakagaki')) return 'nakagaki';
  return 'app';
}

/** The short text behind a scene's source chip. */
export function sourceText(p: Preset): string {
  switch (sourceKind(p)) {
    case 'jones': {
      const figure = p.source.slice('Jones 2010, '.length);
      return `Jones 2010 is the research paper this simulator is built on: Jeff Jones, University of the West of England, in the journal Artificial Life. It shows that thousands of simple agents, each following and laying a chemical trail, build networks like the slime mold Physarum. This scene uses the settings of ${figure} of the paper, on a grid shaped like your screen.`;
    }
    case 'fogleman':
      return 'Fogleman 2020 is Michael Fogleman’s version of the model, written in Go, with several species that follow or flee each other’s trails. This scene uses one of the settings he saved in his code (MIT license).';
    case 'nakagaki':
      return 'Nakagaki, Yamada and Tóth, Nature 407: 470 (2000): a real slime mold found the shortest way through a maze. This scene stages that idea; its settings were chosen for this app.';
    case 'app':
      return 'This scene was made for this app. Its settings are not taken from a paper.';
  }
}
