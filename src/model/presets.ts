import { defaultSettings, defaultStrain, MAX_STRAINS, type Settings, type Strain } from './params';

/** Food, light or a wall, in fractions of the grid (position) and of its short side (radius). */
export interface EnvShape {
  kind: 'food' | 'light' | 'wall';
  at: [number, number];
  to?: [number, number];
  r: number;
}

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  ref?: string;
  /** What to look for, shown for experiments. */
  watch?: string;
  experiment?: boolean;
  settings: () => Settings;
  env?: EnvShape[];
}

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

// Jones' Table 1 (p. 134) with one agent per cell. The experiments place their food, light and walls in
// fractions of this grid, so its size stays 512 here; scenes that need another grid set it themselves.
const jones = (patch: Partial<Strain>, extra: Partial<Settings> = {}) =>
  settings({ resolution: 512, density: 0.15, collisions: true, strains: strains([patch]), ...extra });

// Grid 1024 shows about four times as many holes as 512, and without glow they stay dark (decided 2026-11-09).
const network = { resolution: 1024, bloom: 0 } satisfies Partial<Settings>;

export const PRESETS: Preset[] = [
  {
    id: 'three-strains',
    name: 'Three strains',
    blurb: 'Three rival strains grow out of one disc and weave their networks around each other.',
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
    blurb: 'Two strains side by side. Each follows its own trail and avoids the other.',
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
    blurb: 'Jones’ default: a network that never stops changing (RA > SA).',
    ref: 'Jones 2010, Fig. 4',
    settings: () => jones({ sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 9 }, network),
  },
  {
    id: 'hexagons',
    name: 'Minimizing network',
    blurb: 'RA = SA: cycles close until a near-hexagonal mesh remains.',
    ref: 'Jones 2010, Fig. 5',
    settings: () => jones({ sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 }, network),
  },
  {
    id: 'spots',
    name: 'Turing spots',
    blurb: 'Agents flee their own trail (chemorepulsion) and form a regular spot pattern.',
    ref: 'Jones 2010, Fig. 16 (top)',
    settings: () =>
      jones({ sensorAngle: 45, rotationAngle: 45, sensorOffset: 40, attraction: [-1, 0, 0, 0] }, { density: 0.2 }),
  },
  {
    id: 'stripes',
    name: 'Turing stripes',
    blurb: 'Chemorepulsion with wide sensors: stripes that align over time.',
    ref: 'Jones 2010, Fig. 16 (bottom)',
    settings: () =>
      jones({ sensorAngle: 112.5, rotationAngle: 67.5, sensorOffset: 13, attraction: [-1, 0, 0, 0] }, { density: 0.2 }),
  },
  {
    id: 'cyclones',
    name: 'Cyclones',
    blurb: 'Fogleman’s two-species preset: swirling vortices.',
    ref: 'Fogleman 2020',
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
    blurb: 'Fogleman’s two-species preset: wind-blown ridges.',
    ref: 'Fogleman 2020',
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
    blurb: 'Fogleman’s three-species preset: a lattice of dots.',
    ref: 'Fogleman 2020',
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
];

const food = (x: number, y: number, r = 0.012): EnvShape => ({ kind: 'food', at: [x, y], r });
const wall = (x1: number, y1: number, x2: number, y2: number): EnvShape => ({
  kind: 'wall',
  at: [x1, y1],
  to: [x2, y2],
  r: 0.008,
});

// Experiments from Jones 2010 and the Physarum literature: settings, environment and what to watch.
PRESETS.push(
  {
    id: 'shortest-path',
    experiment: true,
    name: 'Shortest path',
    blurb: 'Two food sources in a dish.',
    watch:
      'A loose network forms, snags on both food sources, then contracts until one short path joins them, like the real slime mold between two oat flakes.',
    ref: 'Jones 2010, Fig. 18',
    settings: () =>
      jones(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
        { resolution: 256, density: 0.02, boundary: 'dish', foodStrength: 0.01 },
      ),
    env: [food(0.32, 0.5, 0.02), food(0.68, 0.5, 0.02)],
  },
  {
    id: 'steiner',
    experiment: true,
    name: 'Steiner tree',
    blurb: 'Four food sources in a dish.',
    watch:
      'A loose network wraps around the four food sources, then contracts. It usually ends as two three-way junctions joined by a short bridge, where the paths meet at about 120°, as soap films do (Plateau’s laws).',
    ref: 'Jones 2010, Fig. 19',
    settings: () =>
      jones(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
        { resolution: 256, density: 0.012, boundary: 'dish', foodStrength: 0.01 },
      ),
    env: [food(0.4, 0.37, 0.02), food(0.6, 0.37, 0.02), food(0.4, 0.63, 0.02), food(0.6, 0.63, 0.02)],
  },
  {
    id: 'shrinking',
    experiment: true,
    name: 'Shrinking plasmodium',
    blurb: 'A full sheet of agents slowly starves.',
    watch:
      'Agents die at random. The sheet shrinks, tears and finally leaves a network of veins between the food sources, as a starving plasmodium does.',
    ref: 'Jones 2010, Fig. 21',
    settings: () =>
      jones(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
        { density: 0.5, boundary: 'dish', foodStrength: 0.05, shrink: 0.00025 },
      ),
    env: [
      food(0.5, 0.5),
      food(0.38, 0.32),
      food(0.62, 0.3),
      food(0.33, 0.62),
      food(0.66, 0.66),
      food(0.5, 0.78),
      food(0.27, 0.45),
      food(0.73, 0.47),
    ],
  },
  {
    id: 'wound',
    experiment: true,
    name: 'Wound healing',
    blurb: 'A regular spot pattern that you can damage.',
    watch:
      'Wait until the spots are regular, then choose the Cut tool and cut a hole. Agents flow back in and the original pattern grows again.',
    ref: 'Jones 2010, Fig. 22',
    settings: () =>
      jones({ sensorAngle: 45, rotationAngle: 45, sensorOffset: 27, attraction: [-1, 0, 0, 0] }, { density: 0.1 }),
  },
  {
    id: 'light',
    experiment: true,
    name: 'Fleeing light',
    blurb: 'A network with a bright lamp in the middle.',
    watch:
      'Physarum avoids light. The network retreats from the lit disc and reroutes around it. Paint more light with the Light tool.',
    settings: () => jones({ sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 9 }, { lightStrength: 0.2 }),
    env: [{ kind: 'light', at: [0.5, 0.5], r: 0.16 }],
  },
  {
    id: 'maze',
    experiment: true,
    name: 'Maze',
    blurb: 'Food at the entrance and the exit of a maze.',
    watch:
      'The network first fills every corridor. Dead ends hold no food, so they empty, and the network contracts toward a path from food to food (Nakagaki 2000).',
    ref: 'Nakagaki et al. 2000',
    settings: () =>
      jones(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 7 },
        { density: 0.12, boundary: 'box', foodStrength: 0.03, shrink: 0.0001 },
      ),
    env: [
      wall(0.25, 0.0, 0.25, 0.7),
      wall(0.5, 0.3, 0.5, 1.0),
      wall(0.75, 0.0, 0.75, 0.7),
      wall(0.25, 0.7, 0.4, 0.7),
      wall(0.6, 0.3, 0.75, 0.3),
      food(0.1, 0.1, 0.018),
      food(0.9, 0.9, 0.018),
    ],
  },
);

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);
