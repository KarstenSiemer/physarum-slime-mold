import { dishRadius } from '../engine/brush';
import {
  defaultSettings,
  defaultStrain,
  MAX_STRAINS,
  strainLike,
  type Lattice,
  type Settings,
  type StepOrder,
  type Strain,
} from './params';
import { tokyoLight, tokyoShapes } from './tokyo';
import { Y_MAZE, yMaze } from './y-maze';

/**
 * Food, light, a wall, an electrode or painted slime in the canonical frame of the preset's own arena
 * (engine/environment.ts, toFrame()), the arena it is painted in: like every edit, it goes to other grids through the
 * canonical frame of the arena it was painted in, also after a switch to another arena. Positions from the grid's
 * centre, on a landscape grid; a portrait grid turns the frame by 90°. In a dish the unit is the grid's short side on
 * both axes. In a box or a periodic grid x from −0.8 to 0.8 spans the long side and y from −0.5 to 0.5 the short side,
 * whatever the screen's shape. The radius is in units of the short side.
 *
 * A shape of the kind `slime` coats ground with slime (ADR 0055, decision 7), as the experiments of Reid et al. 2012
 * coat the agar. At the start of a run its cells without a wall have slime of the age 0, in the extended model. A wall
 * clears the slime of its cells, so the order of the walls and the slime of a scene does not matter.
 *
 * A shape of the kind `start` is a start spot (ADR 0066): the start layout Food places the colony of strain k at the
 * k-th start spot of the scene, in place of the k-th food, as Reid et al. 2012 set a plasmodium on agar without food.
 * A strain without a start spot starts on its food. A start spot paints nothing, and its radius is not read: the colony
 * takes the disc that it takes on a food (Engine.seedAtFood()).
 */
export interface EnvShape {
  kind: 'food' | 'light' | 'wall' | 'anode' | 'cathode' | 'slime' | 'start';
  at: [number, number];
  to?: [number, number];
  r: number;
}

/**
 * Groups of the preset list, in this order in the Panel and in Learn → Scenes (ADR 0064). A group holds the scenes of
 * one rule set:
 * - `start` and `experiments`: this app's rules for the organism. One agent per cell, growth and shrinkage, the flow
 *   in the tubes and the slime, in the extended model.
 * - `jones`: the patterns of Jones 2010, with the values and the model of the paper.
 * - `papers`: the experiments of papers, each as its paper sets it. The experiments of the papers on Jones' model
 *   have the model and the values of their paper, and the Maze has the protocol of Nakagaki et al. 2000: it starts
 *   full and does not grow.
 * - `shared`: the scenes without the rule of one agent per cell, where several agents share a cell: Fogleman's saved
 *   settings, and this app's two scenes in that style.
 */
export const GROUPS = [
  { id: 'start', label: 'Start here' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'jones', label: 'Jones 2010' },
  { id: 'papers', label: 'Paper experiments' },
  { id: 'shared', label: 'Agents share cells' },
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
  /**
   * The figure of the paper that shows what the scene should reach (ADR 0037). Only a link: no figure has a licence
   * that lets this app show it. Absent where no figure shows the result of the scene.
   */
  figure?: Figure;
  settings: () => Settings;
  /** The scene's food, light and walls: its newest revision (shapeRevision()). */
  env?: EnvShape[];
  /**
   * The scene's shapes before `env`, oldest first: revision 0 is what the scene had when links began to name its shapes
   * (2026-11-10, ADR 0021). A shared link names the revision it was made with, so it paints its sender's shapes after
   * the scene's shapes change (ADR 0027).
   */
  envHistory?: EnvShape[][];
}

/** A link to a figure of a paper: the figure's name, and where and how a reader sees it. */
export interface Figure {
  href: string;
  /** "Fig. 4", "Fig. 16, top row". */
  label: string;
  /** "page 9 of the free PDF". */
  note: string;
}

/**
 * Jones 2010, the publisher's PDF that the repository of his university holds as open access, in the copy of the
 * Wayback Machine: the repository itself shows a bot check and then loses the path (ADR 0043). Page 1 of the PDF is
 * page 127 of the journal (ADR 0037).
 */
export const JONES_PDF =
  'https://web.archive.org/web/20260923011704/https://uwe-repository.worktribe.com/preview/980585/artl.2010.16.2.pdf';

/** A figure of Jones 2010 on page `journalPage` of the journal: the link opens the free PDF at that page. */
function jonesFigure(label: string, journalPage: number): Figure {
  const page = journalPage - 126;
  return { href: `${JONES_PDF}#page=${page}`, label, note: `page ${page} of the free PDF` };
}

/**
 * Baumgarten, Jones and Hauser 2015 at its journal, free to read: the publisher's PDF, whose page 1 is page 1201 of
 * the journal (ADR 0045). The PDF states no licence, so the app links the figure and does not show it (ADR 0037).
 */
export const BAUMGARTEN_PDF = 'https://www.actaphys.uj.edu.pl/R/46/6/1201/pdf';

/** A figure of Baumgarten, Jones and Hauser 2015 on page `journalPage` of the journal. */
function baumgartenFigure(label: string, journalPage: number): Figure {
  const page = journalPage - 1200;
  return { href: `${BAUMGARTEN_PDF}#page=${page}`, label, note: `page ${page} of the free PDF` };
}

/**
 * Jones and Adamatzky 2015, "Slime mould inspired generalised Voronoi diagrams with repulsive fields", as arXiv holds
 * it (arXiv:1503.06973v1, a non-exclusive licence): the app links a figure and does not show it (ADR 0037, ADR 0048).
 */
export const VORONOI_PDF = 'https://arxiv.org/pdf/1503.06973v1';

/** A figure of Jones and Adamatzky 2015 on page `page` of the PDF, which is the page number printed there. */
function voronoiFigure(label: string, page: number): Figure {
  return { href: `${VORONOI_PDF}#page=${page}`, label, note: `page ${page} of the free PDF` };
}

/**
 * Tsuda, Jones, Adamatzky and Mills 2011, "Routing Physarum with electrical flow/current", on arXiv, free to read
 * (ADR 0047). arXiv states no licence that lets this app show a figure, so the app links it (ADR 0037).
 */
export const TSUDA_PDF = 'https://arxiv.org/pdf/1204.1752';

/**
 * The layout of the scene Electrotaxis in cells (ADR 0047). The paper gives no lattice and no positions: Fig. 11 shows
 * five current sinks in a column on the left, five current sources in a column on the right, and the agents in a
 * vertical line just left of the sources (p. 11). This lattice holds its 1,500 agents at a density of 0.025. The line
 * of the start layout stands in the middle column (init.wgsl LINE), the anodes `anode` cells right of it and the
 * cathodes `cathode` cells left of it, each column with `count` electrodes `pitch` cells apart, of `radius` cells.
 */
export const ELECTROTAXIS = {
  lattice: [250, 240],
  anode: 20,
  cathode: 100,
  count: 5,
  pitch: 31,
  radius: 1.5,
} as const;

/** The electrodes of the scene Electrotaxis in the frame of its box (EnvShape): the cathodes, then the anodes. */
function electrotaxisShapes(): EnvShape[] {
  const { lattice, anode, cathode, count, pitch, radius } = ELECTROTAXIS;
  const [w, h] = lattice;
  const column = (kind: 'anode' | 'cathode', dx: number) =>
    Array.from({ length: count }, (_, k): EnvShape => ({
      kind,
      // The frame of a box: 1.6 units along its long side, 1 along its short side (environment.ts).
      at: [(dx / w) * 1.6, ((k - (count - 1) / 2) * pitch) / h],
      r: radius / h,
    }));
  return [...column('cathode', -cathode), ...column('anode', anode)];
}

/** The revision of a scene's shapes that the scene loads now: the number of its earlier shape lists. */
export const shapeRevision = (p: Preset) => p.envHistory?.length ?? 0;

/** The shapes of revision `revision` of a scene, or undefined for a revision it does not have (ADR 0027). */
export function shapesAt(p: Preset, revision: number): EnvShape[] | undefined {
  const newest = shapeRevision(p);
  if (!Number.isInteger(revision) || revision < 0 || revision > newest) return undefined;
  return revision === newest ? (p.env ?? []) : p.envHistory?.[revision];
}

/** The scene the app starts with. */
export const START = 'three-networks';

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
// cell (p. 133). Sensor offset and step size are in cells, so the grid sets the scale of the model. The scenes of
// Jones' papers run on the lattice of their figure (ADR 0026) and on the Jones model, which weighs food and a
// repellent as the strain's own trail (ADR 0022, ADR 0044). The app's scenes with these agents set the extended model and a grid of 512 cells on
// the long side, shaped like the screen; so does a scene of Jones on a device that cannot hold its lattice.
const jones = (patch: Partial<Strain>, extra: Partial<Settings> = {}) =>
  settings({
    resolution: 512,
    density: 0.15,
    collisions: true,
    model: 'jones',
    strains: strains([{ food: patch.attraction?.[0] ?? 1, light: patch.attraction?.[0] ?? 1, ...patch }]),
    ...extra,
  });

// The scenes of Jones 2010 move first, as his scheduler does there (p. 133); every other scene and the default settings
// sense first, as Jones 2011 (p. 1350) and his later papers, Fogleman and the code before do (owner, 2026-11-12;
// ADR 0027).
const jones2010 = (patch: Partial<Strain>, extra: Partial<Settings> = {}) =>
  jones(patch, { stepOrder: 'move-first', ...extra });

/**
 * The lattices of Jones 2010 (ADR 0026): 200 × 200 cells for Fig. 4, 5, 10, 16 and 18 to 20, 300 × 300 for Fig. 11,
 * 12, 15 and 21 to 23 (500 × 500 for Fig. 13 and 14). A new array for each scene's settings.
 */
const L200 = (): Lattice => [200, 200];
const L300 = (): Lattice => [300, 300];

// Without glow the holes of the networks stay dark (decided 2026-11-09).
const network = () => ({ lattice: L200(), bloom: 0 }) satisfies Partial<Settings>;

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

/**
 * A colony that forages with the flow in the tubes (ADR 0032): Jones' foraging agent of 2011 with growth and
 * shrinkage, a start on food, the Maze's sensor distance and food weight, and the flow. `rivals`: so many strains like
 * it, each with a colony on a food of its own; each strain flees the trail of the others.
 */
const forager = (extra: Partial<Settings>, rivals = 1): Settings => {
  const s = jones(
    { sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 7 },
    {
      model: 'extended',
      density: 0.01,
      capacity: 0.25,
      layout: 'food',
      boundary: 'dish',
      foodStrength: 0.03,
      growth: true,
      flow: true,
      ...extra,
    },
  );
  const [first] = s.strains;
  if (!first) return s;
  return { ...s, strains: Array.from({ length: rivals }, (_, i) => (i === 0 ? first : strainLike(first, i))) };
};

/** The lattice of Baumgarten, Jones and Hauser 2015 (p. 1204; ADR 0045). */
const L400 = (): Lattice => [400, 400];

/**
 * The dish of Jones and Adamatzky 2015, Fig. 6a and 10 (ADR 0048): 225 cells across, as the app's dish is on a
 * lattice of 239 × 239 cells, with its centre on the centre of a cell.
 */
const L239 = (): Lattice => [239, 239];

/**
 * The seven repellent dots of the scene Voronoi diagram, in cells from the centre of the dish: read from Fig. 6a of
 * Jones and Adamatzky 2015, where each is a square of 3 × 3 cells (ADR 0048). A hexagon around one dot, a few cells
 * off the centre of the dish, as in the figure.
 */
export const VORONOI_DOTS: readonly (readonly [number, number])[] = [
  [-3, -41],
  [-43, -21],
  [37, -21],
  [-4, 2],
  [-43, 23],
  [37, 23],
  [-4, 44],
];

/** The ring of attractant of the same figure: 3 cells wide, its middle 111 cells from the centre of the dish. */
export const VORONOI_RING = { radius: 111, width: 3, segments: 72 } as const;

/**
 * The radius of a repellent dot in cells. The light brush has a smooth edge (docs/model.md, 6.7): with this radius the
 * bytes of a dot sum to 2,243, as much as 0.977 of the paper's 3 × 3 cells of 255 (ADR 0048).
 */
export const VORONOI_DOT_RADIUS = 2.5;

/**
 * The model of Jones and Adamatzky 2015 (p. 6 to 8; ADR 0048): SA = RA = 60°, SO 5, a deposit of 1, a mean over
 * 5 × 5 cells times 0.9, growth and shrinkage tested every 3 steps (1 to 10 agents in 9 × 9 cells divide, 0 to 24 in
 * 5 × 5 survive), in a dish. Capacity 1 leaves room for a child in every cell: the paper has no limit.
 */
const repelled = (extra: Partial<Settings>) =>
  jones(
    { sensorAngle: 60, rotationAngle: 60, sensorOffset: 5, deposit: 1 },
    {
      capacity: 1,
      boundary: 'dish',
      bloom: 0,
      meanWindow: 5,
      growth: true,
      growthEvery: 3,
      growthWindow: 9,
      growthMin: 1,
      growthMax: 10,
      shrinkEvery: 3,
      shrinkWindow: 5,
      shrinkMin: 0,
      shrinkMax: 24,
      ...extra,
    },
  );

/** The shapes of the scene Voronoi diagram on its lattice: the ring as a chain of food strokes, then the dots. */
function voronoiShapes(): EnvShape[] {
  const side = L239()[0];
  // Rounded, so that a scene and a link to it hold the same numbers: to 1/400 of a cell.
  const at = (cells: number) => Math.round((cells / side) * 1e5) / 1e5;
  const { radius, width, segments } = VORONOI_RING;
  const corner = (i: number): [number, number] => {
    const angle = (2 * Math.PI * (i % segments)) / segments;
    return [at(radius * Math.cos(angle)), at(radius * Math.sin(angle))];
  };
  const ringShapes = Array.from({ length: segments }, (_, i): EnvShape => ({
    kind: 'food',
    at: corner(i),
    to: corner(i + 1),
    r: at(width / 2),
  }));
  const dots = VORONOI_DOTS.map(([x, y]): EnvShape => ({
    kind: 'light',
    at: [at(x), at(y)],
    r: at(VORONOI_DOT_RADIUS),
  }));
  return [...ringShapes, ...dots];
}

/** The lattice of the dish scenes with the flow (ADR 0032): the same picture on every screen. */
const L384 = (): Lattice => [384, 384];

/**
 * `count` foods on a ring of radius `radius` around the middle. The first one lies on the right, or `turn` degrees
 * from there toward the bottom of the screen.
 */
const ring = (count: number, radius: number, r: number, turn = 0): EnvShape[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count + (turn * Math.PI) / 180;
    // Rounded, so that a scene and a link to it hold the same numbers.
    const at = (v: number) => Math.round(radius * v * 1e4) / 1e4;
    return food(at(Math.cos(angle)), at(Math.sin(angle)), r);
  });

/**
 * Points and lengths in cells of a lattice as the canonical frame of a box holds them (EnvShape), for a lattice that
 * is not higher than wide. Rounded, so that a scene and a link to it hold the same numbers.
 */
const boxCells = ([w, h]: Lattice) => {
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    at: (x: number, y: number): [number, number] => [round((x - w / 2) / (w / 1.6)), round((y - h / 2) / h)],
    r: (cells: number) => round(cells / h),
  };
};

/**
 * Half the width of a wall of the two mazes of ADR 0051, in cells: a wall along a line of the lattice covers 6
 * cells, and the centre of no cell lies near its edge.
 */
const MAZE_WALL = 2.75;

/**
 * The scene Snail maze (ADR 0051), in cells of its lattice of 384 × 384. Ring walls around the middle. The outermost
 * ring is closed. Every other ring has one gap of `gap` cells, on the right and on the left in turns. A bar closes
 * each ring corridor a quarter turn past its inner gap, so the maze has one route and no loop. A ring is a chain of
 * straight walls, each at most `chord` cells long.
 */
export const SNAIL_MAZE = { side: 384, rings: [28, 68, 108, 148, 188], gap: 30, chord: 16 } as const;

/** The angle of the gap in ring wall `k` of the Snail maze (0 is the innermost): right, left, right, left. */
const snailGap = (k: number) => (k % 2 === 0 ? 0 : Math.PI);

/** The shapes of the Snail maze: the food at the entrance, the food in the middle, then the walls. */
function snailShapes(): EnvShape[] {
  const { side, rings, gap, chord } = SNAIL_MAZE;
  const cells = boxCells([side, side]);
  const point = (radius: number, angle: number) =>
    cells.at(side / 2 + radius * Math.cos(angle), side / 2 + radius * Math.sin(angle));
  const line = (a: [number, number], b: [number, number]): EnvShape => ({
    kind: 'wall',
    at: a,
    to: b,
    r: cells.r(MAZE_WALL),
  });
  const walls: EnvShape[] = [];
  rings.forEach((radius, k) => {
    const outer = rings[k + 1];
    // Half the angle of the gap: its two ends are `gap` cells apart. The outermost ring has none.
    const half = outer === undefined ? 0 : Math.asin(gap / 2 / radius);
    const [from, sweep] = [snailGap(k) + half, 2 * Math.PI - 2 * half];
    const parts = Math.ceil((radius * sweep) / chord);
    for (let i = 0; i < parts; i++)
      walls.push(line(point(radius, from + (sweep * i) / parts), point(radius, from + (sweep * (i + 1)) / parts)));
    // The bar across the corridor outside this ring: a quarter turn past the gap.
    if (outer !== undefined) {
      const angle = snailGap(k) + Math.PI / 2;
      walls.push(line(point(radius, angle), point(outer, angle)));
    }
  });
  // The entrance lies in the outermost corridor, half a turn from the gap of its inner wall.
  const [inner = 0, outer = 0] = rings.slice(-2);
  const entrance = point((inner + outer) / 2, snailGap(rings.length - 2) + Math.PI);
  return [
    { kind: 'food', at: entrance, r: cells.r(6) },
    { kind: 'food', at: cells.at(side / 2, side / 2), r: cells.r(6) },
    ...walls,
  ];
}

/**
 * The scene Corn maze (ADR 0051): 12 × 8 rooms of 40 cells on a lattice of 480 × 320. `walls` are the walls between
 * the rooms, from corner to corner of the rooms: the output of research/flow/engine/corn-maze.ts for its seed 8, a
 * maze without loops with 7 walls taken away. The entrance is the top-left room and the exit the bottom-right one.
 */
export const CORN_MAZE = {
  cols: 12,
  rows: 8,
  room: 40,
  // prettier-ignore
  walls: [
    [1,2,1,3],[2,0,2,2],[2,3,2,6],[3,1,3,4],[3,6,3,7],[4,0,4,1],[5,1,5,2],[5,4,5,5],[6,5,6,6],[7,1,7,2],[7,3,7,7],
    [8,2,8,3],[8,5,8,7],[9,0,9,1],[9,6,9,8],[10,4,10,7],[11,5,11,6],[0,1,1,1],[3,1,4,1],[6,1,7,1],[8,1,9,1],
    [10,1,11,1],[1,2,2,2],[4,2,6,2],[7,2,11,2],[1,3,2,3],[3,3,5,3],[7,3,8,3],[9,3,12,3],[0,4,1,4],[4,4,7,4],
    [8,4,9,4],[10,4,11,4],[1,5,5,5],[8,5,10,5],[0,6,1,6],[3,6,4,6],[5,6,6,6],[11,6,12,6],[1,7,2,7],[4,7,8,7],
    [10,7,11,7],
  ],
} as const;

/** The shapes of the Corn maze: the food at the entrance, the food at the exit, then the walls. */
function cornShapes(): EnvShape[] {
  const { cols, rows, room, walls } = CORN_MAZE;
  const cells = boxCells([cols * room, rows * room]);
  return [
    { kind: 'food', at: cells.at(room / 2, room / 2), r: cells.r(6) },
    { kind: 'food', at: cells.at((cols - 0.5) * room, (rows - 0.5) * room), r: cells.r(6) },
    ...walls.map(([x1, y1, x2, y2]): EnvShape => ({
      kind: 'wall',
      at: cells.at(x1 * room, y1 * room),
      to: cells.at(x2 * room, y2 * room),
      r: cells.r(MAZE_WALL),
    })),
  ];
}

/**
 * The scene Crown of veins (ADR 0087), in cells of its lattice of 520 × 340: the neck of the prototype of stage 4
 * (research/front/layouts.ts neck(), crowns.ts; ADR 0084). Its first `long` rows are wall but for a channel `wide`
 * cells wide in the middle, and the food of radius `foodR` lies `foodY` cells from the top, in the middle of the
 * channel. The colony starts on the food.
 */
export const CROWN = { lattice: [520, 340], wide: 14, long: 40, foodY: 8, foodR: 5 } as const;

/**
 * The shapes of the Crown of veins: the food, then the walls of each side of the channel. A wall is the cells within
 * the radius of a stroke, and the picture lights the wall by the distance to the outline of its strokes (paint.wgsl),
 * so a block of thin strokes would show a rib per stroke. Each block is therefore thick strokes of radius R = 8 cells:
 * rows of them 8 cells apart, the lowest one with its outline on the lower edge of the block, and one stroke down the
 * edge at the channel. They end R before the channel and before the lower edge, so they cover no cell outside the
 * block, and every cell inside it lies at least 4 cells (the depth that the picture lights) inside one of them, or as
 * deep as it lies in the block. Their round end leaves the corner at the mouth of the neck open: two strokes of 1.5
 * cells along the last 3 rows and the last 3 columns fill it (√2 < 1.5 < 2, so they cover no cell beside the block).
 * The cells are those of neck() in research/front/layouts.ts, cell for cell (presets.test.ts).
 */
function crownShapes(): EnvShape[] {
  const { lattice, wide, long, foodY, foodR } = CROWN;
  const [w] = lattice;
  const cells = boxCells([...lattice]);
  const R = 8;
  // The channel: the columns from a to b − 1, as neck() in research/front/layouts.ts has them.
  const [a, b] = [Math.round((w - wide) / 2), Math.round((w + wide) / 2)];
  const wall = (x1: number, y1: number, x2: number, y2: number, r: number): EnvShape => ({
    kind: 'wall',
    at: cells.at(x1, y1),
    to: cells.at(x2, y2),
    r: cells.r(r),
  });
  // One side: `edge` is the x of the edge at the channel, `out` the x beyond the grid, `s` the side (−1 left).
  const side = (edge: number, out: number, s: number): EnvShape[] => {
    const rows = Array.from({ length: Math.floor((long - R) / R) + 1 }, (_, i) => long - R - i * R);
    return [
      ...rows.map((y) => wall(out, y, edge + s * R, y, R)),
      wall(edge + s * R, -2 * R, edge + s * R, long - R, R),
      wall(edge + s * 11.5, long - 1.5, edge + s * 1.5, long - 1.5, 1.5),
      wall(edge + s * 1.5, long - 11.5, edge + s * 1.5, long - 1.5, 1.5),
    ];
  };
  return [
    { kind: 'food', at: cells.at(w / 2, foodY), r: cells.r(foodR) },
    ...side(a, -2 * R, -1),
    ...side(b, w + 2 * R, 1),
  ];
}

/**
 * The Y-maze of Reid et al. 2012 with slime on its left arm (ADR 0066): the layout of ADR 0056, and the start spot of
 * the colony on the middle of its base.
 */
const Y = yMaze();

/**
 * The dish of the scene Slime everywhere (ADR 0066): Reid et al. 2012 without the trap. Their dish is 8.6 cm wide,
 * 160 cells at the 0.537 mm per cell of the Y-maze, and the dish of the app is that wide on a lattice of 169 × 169
 * cells (159.7 cells, dishRadius()). The well of glucose is 5 mm wide. The positions of the start and of the well are
 * this app's choice: both lie on the vertical axis, `inset` mm inside the rim, the start at the top.
 */
export const SLIME_DISH = { side: 169, mmPerCell: Y_MAZE.mmPerCell, well: 5, inset: 10 } as const;

/** The shapes of the scene Slime everywhere: the start spot, the well of glucose as food, then slime on the dish. */
function slimeDishShapes(): EnvShape[] {
  const { side, mmPerCell, well, inset } = SLIME_DISH;
  // Cells to the canonical frame of a dish, whose unit is the side of the lattice. Rounded, so that a scene and a
  // link to it hold the same numbers: to about 1/600 of a cell.
  const unit = (cells: number) => Math.round((cells / side) * 1e5) / 1e5;
  const y = unit(dishRadius(side, side) - inset / mmPerCell);
  return [
    { kind: 'start', at: [0, -y], r: 0 },
    { kind: 'food', at: [0, y], r: unit(well / mmPerCell / 2) },
    // Half the side of the lattice reaches past the rim: every cell of the dish.
    { kind: 'slime', at: [0, 0], r: 0.5 },
  ];
}

/**
 * The settings of the scene Tokyo rail network (ADR 0024, 0029), with `extra` on top: the scene with light adds the
 * strength of its light (ADR 0042).
 */
const tokyo = (extra: Partial<Settings> = {}) =>
  jones(
    { sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 7 },
    {
      model: 'extended',
      lattice: [512, 512],
      density: 0.01,
      capacity: 0.25,
      layout: 'food',
      boundary: 'dish',
      foodStrength: 0.03,
      growth: true,
      flow: true,
      // Measured with 1.4, 2 and 2.8 with the mark of starved ground of ADR 0054: with 2.8 the total length of the
      // network at step 48,000 is 1.72 times the minimum spanning tree, and that of the organism at 26 h is 1.75.
      // Before that mark the strength was 1.4 (ADR 0029, decision 12). The I0 = 2 of the model of Tero et al. 2010
      // (Fig. 4) has another unit.
      flowStrength: 2.8,
      ...extra,
    },
  );

const FOGLEMAN_WHY =
  'Not derived from biology. Fogleman’s program draws random settings and prints them, and he saved this set under its name. The values are copied exactly: radians turned into degrees, his kept fraction into decay = 1 − kept, and his repulsion factor into a negative weight on the other strains’ trails.';

const SCENES: Preset[] = [
  {
    id: 'three-networks',
    name: 'Three strains',
    group: 'start',
    source: 'Made for this app',
    summary: 'Three rival strains grow from three foods, and each weaves a network of its own.',
    watch:
      'Three small colonies grow from the foods in the middle. After about 800 steps their meshes fill the dish and push into each other. Then the flow thins each mesh. From about step 8,000 three networks remain on the same foods, one of each strain, wound around each other.',
    about:
      'The start scene. Twelve food sources in a dish, and three strains that flee each other’s trail. Each strain is a slime mold of its own and has its own flow: its flux runs only through its own tubes, between the foods that it covers. So each strain keeps the tubes that it needs, and the three networks wind around each other.',
    strainRoles: [
      'Starts on the lower food of the three in the middle',
      'The same settings as A, starts at the upper left',
      'The same settings as A, starts at the upper right',
    ],
    why: 'Jones’ foraging agent with growth and shrinkage, three times. A weight of −1 on the other strains’ trails keeps the tubes apart. The start layout puts each strain on a food of its own. Flow in the tubes is on with a strength of 8, the Maze’s, for each strain. The dish has 384 × 384 cells on every screen. Sensor distance 7 and food weight 0.03 are the Maze’s.',
    settings: () => forager({ lattice: L384() }, 3),
    // The start layout 'food' places strain A on the first food, B on the second and C on the third: the three in the
    // middle. The nine on the ring are for all.
    env: [...ring(3, 0.13, 0.014, 90), ...ring(9, 0.33, 0.014, 30)],
  },
  {
    id: 'two-networks',
    name: 'Two strains',
    group: 'start',
    source: 'Made for this app',
    summary: 'Two rival strains grow from the left and the right, and each builds its own network.',
    watch:
      'A colony starts on the food at the left, and one on the food at the right. Their meshes meet in the middle after about 1,200 steps and fill the box by step 2,500. Then the flow thins them. From about step 8,000 two networks remain on the same foods, one of each strain.',
    about:
      'Nine food sources in a box, and two strains that flee each other’s trail. One starts at the left and one at the right. Each has a flow of its own, which runs only through its own tubes. So each keeps the tubes that carry its own flow between the foods, and the two networks end side by side.',
    strainRoles: ['Starts on the food at the left', 'The same settings as A, starts at the right'],
    why: 'Jones’ foraging agent with growth and shrinkage, twice, as in the scene Three strains. A weight of −1 on the other strain’s trail keeps the tubes apart. Flow in the tubes is on with a strength of 8 for each strain. The box has 480 × 320 cells on every screen. Sensor distance 7 and food weight 0.03 are the Maze’s.',
    settings: () => forager({ lattice: [480, 320], boundary: 'box' }, 2),
    // The start layout 'food' places strain A on the first food and strain B on the second: left and right.
    env: [
      food(-0.6, 0, 0.014),
      food(0.6, 0, 0.014),
      food(-0.3, -0.27, 0.014),
      food(-0.3, 0.27, 0.014),
      food(0, -0.3, 0.014),
      food(0, 0, 0.014),
      food(0, 0.3, 0.014),
      food(0.3, -0.27, 0.014),
      food(0.3, 0.27, 0.014),
    ],
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
    why: 'Jones’ defaults: Table 1 (p. 134) with one blur pass and wrapping edges, 15 % of cells holding an agent (Fig. 4) and his rule of one agent per cell (p. 133). A rotation angle above the sensor angle keeps the network changing (p. 135). Blocked agents turn at random and start new branches; without the rule the network contracts into a few lines. Jones used 200 × 200 cells. Without glow the holes stay dark.',
    figure: jonesFigure('Fig. 4', 135),
    settings: () => jones2010({ sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 9 }, network()),
  },
  {
    id: 'hexagons',
    name: 'Minimizing network',
    group: 'jones',
    source: 'Jones 2010, Fig. 5',
    summary: 'Equal angles: loops close one by one until a simple mesh is left.',
    about:
      'Jones’ model with the sensor angle raised to 45°, equal to the rotation angle. New branches do not last: small loops close, the other holes grow, and the network contracts like a soap film. On Jones’ lattice of 200 × 200 cells it ends after about 31,000 steps as a simple network with one or two holes. Its copies, side by side, approximate a hexagonal tiling (Fig. 5).',
    strainRoles: ['Jones’ agent with equal angles'],
    why: 'Only the sensor angle differs from Jones’ defaults. With equal angles an agent turns exactly toward where its side sensor was, so its sensors stay on the trail and new branches do not last (p. 135). The rest is as for Fig. 5: 15 % of cells hold an agent (p. 136), one blur pass (Table 1), one agent per cell (p. 133) and 200 × 200 cells. Without glow the holes stay dark.',
    figure: jonesFigure('Fig. 5', 136),
    settings: () => jones2010({ sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 }, network()),
  },
  {
    id: 'spots',
    name: 'Turing spots',
    group: 'jones',
    source: 'Jones 2010, Fig. 16 (top)',
    summary: 'Agents flee their own trail and gather in rings that keep their distance.',
    about:
      'Here agents are repelled by the trail they lay (chemorepulsion). They gather in tight circular flows that push each other apart. Slowly they form a regular array, like a Turing pattern on an animal coat (p. 143). On Jones’ lattice it settles as about 20 spots.',
    strainRoles: ['Jones’ repelled agent'],
    why: 'Jones’ values for Fig. 16, top row (p. 144): 20 % of cells hold an agent, sensor and rotation angle 45°, sensor distance 40, one agent per cell, 200 × 200 cells. The long sensor distance sets the wide spacing between the spots.',
    figure: jonesFigure('Fig. 16, top row', 144),
    settings: () =>
      jones2010(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 40, attraction: [-1, 0, 0, 0] },
        { lattice: L200(), density: 0.2 },
      ),
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
    why: 'Jones’ values for Fig. 16, bottom row (p. 144): 20 % of cells hold an agent, one agent per cell, sensor distance 13, 200 × 200 cells. The sensor distance sets the spacing between the stripes.',
    figure: jonesFigure('Fig. 16, bottom row', 144),
    settings: () =>
      jones2010(
        { sensorAngle: 112.5, rotationAngle: 67.5, sensorOffset: 13, attraction: [-1, 0, 0, 0] },
        { lattice: L200(), density: 0.2 },
      ),
  },
];

// Experiments from Jones 2010 and the Physarum literature: settings, environment and what to watch.
SCENES.push(
  {
    id: 'shortest-path',
    name: 'Shortest path',
    group: 'papers',
    source: 'Jones 2010, Fig. 18',
    summary: 'Two food sources in a dish: the network contracts into one band between them.',
    watch:
      'A loose network forms, snags on both food sources, then contracts into one band between them, like the real slime mold between two oat flakes. Trail that reaches the rim of the dish is lost, so no branch to the rim stays.',
    about:
      'Several hundred agents in a round dish with two food sources. Food releases a scent that spreads and fades like the trail, so the network snags on both foods. Then it contracts like a soap film until one band joins them. The band stays many cells wide, because only one agent fits in a cell.',
    strainRoles: ['Jones’ contracting agent, drawn to food'],
    why: 'Jones’ values for Fig. 18 (p. 145): as many agents as 2 % of the square around the dish, sensor and rotation angle 45°, one agent per cell, a closed dish, food weight 0.01. Equal angles let the network contract, and weak food lets its loops close (p. 146), so it can shrink to a single path. Dish and foods are as in Fig. 18, on 200 × 200 cells.',
    figure: jonesFigure('Fig. 18', 145),
    settings: () =>
      jones2010(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
        { lattice: L200(), density: 0.02, boundary: 'dish', foodStrength: 0.01 },
      ),
    // Fig. 18, first image (p. 145): the foods lie 51 cells left and right of the middle of the 200 × 200 lattice
    // (ADR 0027), with a radius of 4 cells.
    env: [food(-0.255, 0, 0.02), food(0.255, 0, 0.02)],
    // Revision 0, this app's choice before ADR 0027: 57.6 cells left and right of the middle.
    envHistory: [[food(-0.288, 0, 0.02), food(0.288, 0, 0.02)]],
  },
  {
    id: 'steiner',
    name: 'Steiner tree',
    group: 'papers',
    source: 'Jones 2010, Fig. 19',
    summary: 'Four food sources: the network shrinks to a short tree that joins them all.',
    watch:
      'A loose network wraps around the four food sources, then contracts. It ends as a tree through the middle of the square: two three-way junctions joined by a short bridge, where paths meet at about 120° as in soap films (Plateau’s laws), as in Fig. 19.',
    about:
      'The same setup with four food sources at the corners of a square. The network shrinks until it joins all four with little material, close to a Steiner tree: the shortest network that connects a set of points, with extra junctions where three paths meet (p. 144). Different runs take different routes but end in similar trees.',
    strainRoles: ['Jones’ contracting agent, drawn to food'],
    why: 'Jones’ values for Fig. 19 (p. 146): as many agents as 2 % of the square around the dish, which is about 2.5 % of the dish, sensor and rotation angle 45°, one agent per cell, food weight 0.01, 200 × 200 cells. The foods lie as in Fig. 19: a square of 60 cells, each food 2.7 cells in radius.',
    figure: jonesFigure('Fig. 19', 146),
    settings: () =>
      jones2010(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
        { lattice: L200(), density: 0.02, boundary: 'dish', foodStrength: 0.01 },
      ),
    // Fig. 19, second row, first image (p. 146): a square of 60 cells on the 200 × 200 lattice, 0.317 of the dish's
    // diameter of 189 cells, each food with a radius of 2.7 cells (ADR 0027).
    env: [food(-0.15, -0.15, 0.0135), food(0.15, -0.15, 0.0135), food(-0.15, 0.15, 0.0135), food(0.15, 0.15, 0.0135)],
    // Revision 0, this app's choice before ADR 0027: a square of 58 cells with foods of 4 cells, the corners as far
    // from the centre as the 0.32 × 0.26 rectangle of before.
    envHistory: [
      [food(-0.145, -0.145, 0.02), food(0.145, -0.145, 0.02), food(-0.145, 0.145, 0.02), food(0.145, 0.145, 0.02)],
    ],
  },
  {
    id: 'shrinking',
    name: 'Shrinking plasmodium',
    group: 'papers',
    source: 'Jones 2010, Fig. 21',
    summary: 'A full sheet of agents slowly dies off and shrinks onto the food sources.',
    watch:
      'Agents die at random, half of them within about 2,800 steps. The sheet shrinks onto the food sources and leaves a network of veins between them, nearly the same one in each run.',
    about:
      'The dish starts packed with agents, which soon form a solid sheet. In every step each agent dies with a small chance, so the sheet thins out and shrinks onto the food sources, as a real plasmodium does after it has covered the dish (p. 147). In the paper, three runs ended in the same network (Fig. 21).',
    strainRoles: ['Jones’ contracting agent, drawn to food'],
    why: 'Jones’ values for Fig. 21 (p. 147): as many agents as 50 % of the square around the dish, so they start as a solid sheet, a removal chance of 0.00025 per agent and step, sensor and rotation angle 45°, one agent per cell. Slow removal lets the sheet adapt; faster removal tears holes into it (p. 148). Jones used 300 × 300 cells and the 19 foods of Fig. 21. Food weight 0.05 and the food radius are this app’s choice.',
    figure: jonesFigure('Fig. 21', 147),
    settings: () =>
      jones2010(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 9 },
        { lattice: L300(), density: 0.5, boundary: 'dish', foodStrength: 0.05, shrink: 0.00025 },
      ),
    // Fig. 21, first image (p. 147): 19 foods, measured in cells of the 300 × 300 lattice (ADR 0027). Their radius of
    // 2.5 cells is this app's choice: the figure shows the trail, not the food cells.
    env: (
      [
        [103, 53],
        [143, 66],
        [193, 84],
        [102, 90],
        [228, 103],
        [159, 123],
        [200, 128],
        [241, 133],
        [71, 134],
        [122, 146],
        [46, 147],
        [164, 153],
        [73, 173],
        [187, 176],
        [139, 180],
        [231, 181],
        [105, 212],
        [147, 224],
        [175, 239],
      ] as const
    ).map(([x, y]) => food((x - 150) / 300, (y - 150) / 300, 2.5 / 300)),
    // Revision 0, this app's choice before ADR 0027: 8 foods.
    envHistory: [
      [
        food(0, 0),
        food(-0.192, -0.18),
        food(0.192, -0.2),
        food(-0.272, 0.12),
        food(0.256, 0.16),
        food(0, 0.28),
        food(-0.368, -0.05),
        food(0.368, -0.03),
      ],
    ],
  },
  {
    id: 'wound',
    name: 'Wound healing',
    group: 'papers',
    source: 'Jones 2010, Fig. 22',
    summary: 'A repelling spot pattern that grows back after you cut it.',
    watch:
      'Wait until the spots are regular, then choose the Cut tool and cut a hole. Agents flow back in and the original pattern grows again. In the paper the hole closed about 275 steps after the cut, and the pattern was back after about 550 (Fig. 22).',
    about:
      'A regular spot pattern made by chemorepulsion, like Turing spots with a shorter sensor distance. Jones cut a square hole into it. The agents flowed back in, and the undamaged pattern around the wound guided the regrowth until it matched the old one (p. 148). A network made by attraction also heals, but into a different pattern (Fig. 23).',
    strainRoles: ['Jones’ repelled agent'],
    why: 'Jones’ values for Fig. 22 (p. 148): 10 % of cells hold an agent, sensor and rotation angle 45°, sensor distance 27, one agent per cell, 300 × 300 cells. The Cut tool differs from his method in one point: Jones kept agents out of the wound until all were placed elsewhere, while here they flow back as soon as you release the tool. As in his method, the wound keeps its trail.',
    figure: jonesFigure('Fig. 22', 148),
    settings: () =>
      jones2010(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 27, attraction: [-1, 0, 0, 0] },
        { lattice: L300(), density: 0.1 },
      ),
  },
  {
    id: 'light',
    name: 'Fleeing light',
    group: 'experiments',
    source: 'Made for this app',
    summary: 'A colony grows around a bright lamp and joins six foods with tubes that avoid the light.',
    watch:
      'The colony starts on the food at the left and grows around the lit disc: no agent is born on a lit cell. After about 2,000 steps it covers all six foods. Then the flow thins the mesh, and a ring of tubes around the lamp remains. Paint more light with the Light tool.',
    about:
      'Real Physarum avoids light. A lamp in the middle releases a repellent that spreads and fades, so agents feel it before they enter the lit disc, and no agent is born on lit ground. Six foods lie around the lamp. The colony joins them with tubes, and no tube crosses the light.',
    strainRoles: ['Jones’ foraging agent, drawn to food, flees light'],
    why: 'Jones’ foraging agent with growth and shrinkage, and Flow in the tubes with a strength of 2, as in Food ring. The lamp releases a spreading repellent with strength 0.2, and Light stops growth is 1, the default. Both light rules are this app’s: Jones’ own light rule of 2012 makes the sensors of a lit agent weaker. The dish has 384 × 384 cells. Sensor distance 7 and food weight 0.03 are the Maze’s.',
    // A repellent source is a rule of Jones (ADR 0044). To call the source light, and to let light stop growth
    // (ADR 0050), is this app's reading, so the scene runs on the extended model (ADR 0022).
    settings: () => forager({ lattice: L384(), flowStrength: 2, lightStrength: 0.2 }),
    // The start layout 'food' places the colony on the first food: the one at the left. The light comes after the food.
    env: [...ring(6, 0.33, 0.014, 180), { kind: 'light', at: [0, 0], r: 0.16 }],
    // Revision 0, until ADR 0064: the lamp alone, in a network of Jones' agents without growth and without the flow.
    envHistory: [[{ kind: 'light', at: [0, 0], r: 0.16 }]],
  },
  {
    id: 'maze',
    name: 'Maze',
    group: 'papers',
    source: 'Nakagaki et al. 2000',
    summary: 'Food at both ends of a winding corridor: the network fills it, then one tube remains.',
    watch:
      'The network first fills every corridor. The flow runs from food to food and passes the dead ends by. They starve and are empty after about 4,000 steps. One thick tube remains and pulls tight along a short route. Turn Flow in the tubes off to see Jones’ rules alone: many paths remain.',
    about:
      'In 2000, Toshiyuki Nakagaki and colleagues let a real slime mold fill an agar maze and put food at two exits. It pulled out of the dead ends and kept tubes on short routes, in 5 of 19 runs on the shortest alone. Here, walls form a winding corridor with one route between two foods. The flow in the tubes does what the flow in the real one does: the tube that carries it stays and gets wider, and the dead ends starve.',
    strainRoles: ['Jones’ contracting agent, drawn to food'],
    why: 'Jones’ contracting setting with values chosen for this app: 12 % of cells hold an agent, sensor distance 7, food weight 0.03, a shrinkage of 0.0001 per agent and step, closed box edges, one agent per cell. Flow in the tubes is on: each food gives or takes a flux of 8, after the model of Tero et al. Walls block movement and sensing, so no agent follows a trail behind a wall.',
    figure: {
      href: 'https://www.nature.com/articles/35035159/figures/1',
      label: 'Fig. 1',
      note: 'free to view at Nature',
    },
    settings: () =>
      jones(
        { sensorAngle: 45, rotationAngle: 45, sensorOffset: 7 },
        // Sensors that walls block are the owner's rule for the Maze, not Jones': the extended model (ADR 0020, 0022).
        // The flow in the tubes lets the dead ends starve, as in the real maze (ADR 0029). The Maze starts full and
        // has no growth: the slime mold of 2000 filled its maze and did not grow after the food came (ADR 0052). With
        // growth its dead ends empty about eight times later (ADR 0064), so it keeps these settings.
        { model: 'extended', density: 0.12, boundary: 'box', foodStrength: 0.03, shrink: 0.0001, flow: true },
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
  {
    id: 'foraging-maze',
    name: 'Foraging maze',
    group: 'experiments',
    source: 'After Jones 2011 and 2017',
    summary: 'A small colony on one food grows through the maze to the other food; then one tube stays.',
    watch:
      'Fifty agents start on the bottom-right food. They divide at the thin edge and fill the corridors with a mesh. By step 5,000 it reaches the top-left food. Then the flow runs between the foods and the rest starves: one tube is left from about step 15,000. Hold Inoculate to start a colony.',
    about:
      'Jones lets his agents divide where the colony is thin and die where it is crowded (2011). A colony then grows from one food and forages, as a real slime mold does. Here, a small colony starts on one food of the maze and finds the other food by growth alone, as no scent reaches that far. Then the flow in the tubes keeps the tube between the two foods.',
    strainRoles: ['Jones’ foraging agent, drawn to food'],
    why: 'Growth and shrinkage with Jones’ values of 2011: a 9 × 9 window with 1 to 10 agents for growth, a 5 × 5 window with up to 20 for shrinkage, both every 3 steps. Sensor angle 22.5° and rotation angle 45° are Jones’ angles for foraging (2011, 2017). The maze, its foods, sensor distance 7, food weight 0.03 and the flow strength of 8 are the Maze’s. Capacity 0.25 leaves room for the colony.',
    settings: () =>
      jones(
        { sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 7 },
        {
          model: 'extended',
          density: 0.01,
          capacity: 0.25,
          layout: 'food',
          boundary: 'box',
          foodStrength: 0.03,
          growth: true,
          // The flow keeps the tubes between the two foods once the colony covers both (ADR 0064).
          flow: true,
        },
      ),
    // The start layout 'food' places the colony on the first food: the bottom-right one.
    env: [
      wall(-0.4, -0.5, -0.4, 0.2),
      wall(0, -0.2, 0, 0.5),
      wall(0.4, -0.5, 0.4, 0.2),
      wall(-0.4, 0.2, -0.16, 0.2),
      wall(0.16, -0.2, 0.4, -0.2),
      food(0.64, 0.4, 0.018),
      food(-0.64, -0.4, 0.018),
    ],
  },
  {
    id: 'snail-maze',
    name: 'Snail maze',
    group: 'experiments',
    source: 'Made for this app',
    summary: 'A spiral with one route: a colony grows in to the food in the middle, and one tube stays.',
    watch:
      'The colony starts on the right food and fills every corridor. After about 9,000 steps it reaches the food in the middle. The flow then follows the one route, and the blind branches starve. From step 20,000 on they stay empty: no child is born where a tube starved. Short twigs still leave the tube.',
    about:
      'A maze like a snail shell: four ring corridors around a room in the middle. Each ring wall has one gap, on the right and on the left in turns, and a bar closes each corridor a quarter turn past the gap. So one route winds inward, every corridor has two blind branches, and the maze has no loop. The walls are this app’s design.',
    strainRoles: ['Jones’ foraging agent, drawn to food'],
    why: 'Growth and shrinkage with Jones’ values of 2011 and his foraging angles, as in the Foraging maze. Flow in the tubes is on with a strength of 8, the Maze’s. The grid has 384 × 384 cells on every screen, so the rings stay round. A corridor is 34 cells wide. Sensor distance 7 and food weight 0.03 are the Maze’s. Starved ground stays closed for about 160,000 steps; then the colony looks into a blind branch once more.',
    settings: () => forager({ lattice: [SNAIL_MAZE.side, SNAIL_MAZE.side], boundary: 'box' }),
    // The start layout 'food' places the colony on the first food: the one at the entrance.
    env: snailShapes(),
  },
  {
    id: 'corn-maze',
    name: 'Corn maze',
    group: 'experiments',
    source: 'Made for this app',
    summary: 'A maze with six routes between two foods: the flow keeps a tube on the shortest one.',
    watch:
      'The colony starts at the top left and reaches the food at the bottom right after about 3,500 steps, along several routes. From about step 5,000 only the shortest route carries flow. The other corridors starve and stay empty: no child is born where a tube starved. Short twigs still leave the tube.',
    about:
      'A maze like one cut into a corn field: 12 × 8 rooms with dead ends and loops. Six routes join the entrance at the top left and the exit at the bottom right, and the longest is 1.47 times as long as the shortest. In the maze of Nakagaki et al. (2000) a real slime mold kept the shortest route alone in 5 of 19 runs, and a route 1 mm longer in 6. Here the flow keeps the shortest of the six routes.',
    strainRoles: ['Jones’ foraging agent, drawn to food'],
    why: 'Growth and shrinkage with Jones’ values of 2011 and his foraging angles. Flow in the tubes is on with a strength of 8, the Maze’s. The grid has 480 × 320 cells on every screen: rooms of 40 cells, corridors 34 cells wide. A seeded generator made the walls: a maze without loops, then 7 walls taken away. Sensor distance 7 and food weight 0.03 are the Maze’s.',
    settings: () =>
      forager({ lattice: [CORN_MAZE.cols * CORN_MAZE.room, CORN_MAZE.rows * CORN_MAZE.room], boundary: 'box' }),
    // The start layout 'food' places the colony on the first food: the one at the entrance.
    env: cornShapes(),
  },
  {
    id: 'coarsening',
    name: 'Coarsening network',
    group: 'papers',
    source: 'Baumgarten, Jones and Hauser 2015, Fig. 2',
    summary: 'A dense network loses vein after vein until one ring is left, and the ring closes.',
    watch:
      'Within 100 steps the agents form a dense mesh of veins. Loops close one by one, and the mesh leaves the rim of the dish and shrinks. After about 11,000 steps one ring is left. It closes to a spot within some 4,000 more steps.',
    about:
      'Baumgarten, Jones and Hauser watched the vein network of a real slime mold coarsen on agar and ran Jones’ model beside it. The agents start at random in a dish, and the population grows and shrinks by Jones’ rule. The share of the network’s circle that veins cover falls and stays near a fifth, in the organism too (Fig. 4). In the paper the last ring is left after 6,850 steps; here it takes about 11,400.',
    strainRoles: ['Jones’ agent with equal angles of 67.5°'],
    why: 'The paper’s values (p. 1204 to 1206): 25,000 agents in a dish on 400 × 400 cells, sensor and rotation angle 67.5°, sensor distance 5, growth and shrinkage tested every 5 steps: an agent with 0 to 10 agents in its 9 × 9 window divides, one with 0 to 22 in its 5 × 5 window survives. Capacity 1 leaves room for a child in every cell. The dish’s size is this app’s; agents update at once, not in random order.',
    figure: baumgartenFigure('Fig. 2', 1207),
    settings: () =>
      jones(
        { sensorAngle: 67.5, rotationAngle: 67.5, sensorOffset: 5 },
        {
          lattice: L400(),
          // 25,000 agents (p. 1204): the dish counts the square around it (sizing.ts).
          density: 25_000 / 400 ** 2,
          capacity: 1,
          boundary: 'dish',
          bloom: 0,
          growth: true,
          growthEvery: 5,
          growthWindow: 9,
          growthMin: 0,
          growthMax: 10,
          shrinkEvery: 5,
          shrinkWindow: 5,
          shrinkMin: 0,
          shrinkMax: 22,
        },
      ),
  },
  {
    id: 'electrotaxis',
    name: 'Electrotaxis',
    group: 'papers',
    source: 'Tsuda et al. 2011, Fig. 11',
    summary: 'A line of agents between two rows of electrodes moves to the cathodes.',
    watch:
      'The line of agents starts between the two columns of electrodes, near the red anodes. It moves left as one band, away from the anodes and toward the blue cathodes. After about 450 steps it is half way, and after 800 steps a third of the agents stand at the cathodes. It never turns back.',
    about:
      'A real slime mold on a gel with an electric current grows toward the cathode: 13 of 16 pieces did so within six hours, and none turned (p. 4 of the paper). The paper’s model puts the current into Jones’ trail map: a cathode adds 255 to its cells in every step, and an anode takes 255 away. The map spreads over a wide window, so the agents feel the electrodes from far away. Paint your own with the Electrode tool.',
    strainRoles: ['Jones’ agent, pushed by the anodes and drawn to the cathodes'],
    why: 'The paper’s values (p. 10 and 11): 1,500 agents in a vertical line, sensor angle 22.5°, rotation angle 45°, sensor distance 5, deposit 5, Mean window 15, ±255 at the electrodes. The lattice, the places of the electrodes and the decay of 0.01 are this app’s choice: the paper gives none. In the paper the field settles for 400 steps before the agents start, and a blocked agent keeps its heading. Not here.',
    figure: {
      href: `${TSUDA_PDF}#page=11`,
      label: 'Fig. 11',
      note: 'page 11 of the free PDF',
    },
    settings: () =>
      jones(
        // The damping d of the paper's mean has no value there (p. 10). It is the decay of Jones' one map; ADR 0047
        // has the reason for 0.01.
        { sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 5, deposit: 5, decay: 0.01 },
        {
          lattice: [...ELECTROTAXIS.lattice],
          // 1,500 agents (p. 11) on the 60,000 cells of this app's lattice.
          density: 1500 / (ELECTROTAXIS.lattice[0] * ELECTROTAXIS.lattice[1]),
          boundary: 'box',
          layout: 'line',
          meanWindow: 15,
          // The Jones model binds the scent decay to the decay of the strain (asJones()).
          scentDecay: 0.01,
          electrodeStrength: 1,
          // The style Agents: Fig. 11 draws the agents. The trail of this scene is a wide smooth hill, because the map
          // spreads over 15 × 15 cells and decays slowly.
          style: 'agents',
          bloom: 0,
        },
      ),
    env: electrotaxisShapes(),
  },
  {
    id: 'voronoi',
    name: 'Voronoi diagram',
    group: 'papers',
    source: 'Jones and Adamatzky 2015, Fig. 10',
    summary: 'Seven repellent dots in a dish: the network settles on the lines halfway between them.',
    watch:
      'The sheet breaks into a mesh. The mesh leaves the dots and gathers on the lines that lie as far from one dot as from the next. After about 3,000 steps a hexagon and six spokes to the rim are left: the Voronoi diagram of the dots. In about one run of five a loop around one dot replaces two spokes.',
    about:
      'A Voronoi diagram splits a plane into cells: each cell holds the points that lie nearest to one site. A real slime mold draws one when repellents lie on it and food lies along the rim of its dish. Jones and Adamatzky did the same with Jones’ model. A repellent is a source below zero in the trail map, so the agents keep as far from every dot as they can.',
    strainRoles: ['Jones’ agent, angles of 60°: seeks the ring, flees dots'],
    why: 'The paper’s values (p. 7): sensor and rotation angle 60°, sensor distance 5, a deposit of 1, a 5 × 5 mean, growth and shrinkage tested every 3 steps. It gives no lattice, no strengths and no number of agents. Dish, ring and dots are read from Fig. 6a and 10. Both strengths are 0.5, the most this app allows: they fit the diagram best. A dot has a smooth edge here and releases as much as the paper’s hard one.',
    figure: voronoiFigure('Fig. 10', 10),
    settings: () =>
      // About 10,000 agents, read from Fig. 10a; the dish counts the square around it (sizing.ts).
      repelled({ lattice: L239(), density: 10_000 / 239 ** 2, foodStrength: 0.5, lightStrength: 0.5 }),
    env: voronoiShapes(),
  },
  {
    id: 'tokyo',
    name: 'Tokyo rail network',
    group: 'experiments',
    source: 'Tero et al. 2010, Fig. 1',
    summary: 'Food at 36 cities around Tokyo: a colony grows from Tokyo and joins them with tubes.',
    watch:
      'The colony grows from Tokyo and reaches all 36 cities within about 2,000 steps, ten times as fast as the real one. Then the tubes without flow between cities starve. A network with loops around Tokyo Bay remains, as long as the organism’s. 48,000 steps stand for the 26 hours of the experiment.',
    about:
      'In 2010, Atsushi Tero and colleagues put oat flakes on a plate where the cities around Tokyo lie, with the coast as its edge. A slime mold grew out from Tokyo and joined all flakes within 26 hours. Its network was about as short, as fast and as robust as the real railway. Here, Jones’ agents grow from Tokyo, and the flow in the tubes decides which tubes stay.',
    strainRoles: ['Jones’ foraging agent, drawn to food'],
    why: 'Growth and shrinkage with Jones’ values of 2011 let the colony grow from Tokyo. Flow in the tubes is on with a strength of 2.8: the network is then as long as the organism’s. Tokyo is seven foods, as in the model of the paper. The map has 512 × 512 cells on every screen, so north stays up. Sensor distance 7 and food weight 0.03 are the Maze’s. Stations: Wikidata. Coast: © OpenStreetMap contributors.',
    figure: {
      href: 'https://doi.org/10.1126/science.1177894',
      label: 'Fig. 1',
      note: 'at Science, free to read after a free registration',
    },
    settings: () => tokyo(),
    // The start layout 'food' places the colony on the first food: the station of Tokyo.
    env: tokyoShapes(),
  },
  {
    id: 'tokyo-light',
    name: 'Tokyo with light',
    group: 'experiments',
    source: 'Tero et al. 2010, Fig. 2B',
    summary: 'The Tokyo map with light on the mountains and the lakes: the colony keeps to low ground.',
    watch:
      'The colony grows from Tokyo around the lit mountains: no agent is born on a lit cell. From step 4,000 on a hundredth of the network lies on lit ground, a quarter of the land. Set Light stops growth to 0 to compare: then the colony grows over the mountains first.',
    about:
      'The slime mold avoids bright light. So Tero and colleagues lit the mountains and the lakes of their map, and its network kept to the low ground, more like the railway. Here the light lies on 51 squares of 9 × 10 km that are 200 m or more above the sea, and on Lake Kasumigaura. Every lit cell is equally bright; the mask of the paper has shades.',
    strainRoles: ['Jones’ foraging agent, drawn to food, flees light'],
    why: 'The settings of the scene Tokyo rail network, with the app’s Light strength of 0.05 and Light stops growth at 1, the defaults. Without the growth rule a sixth of the young network lay on lit ground, with it a thirtieth; a value of 0.5 changed little. Both light rules are this app’s, not rules of the paper. Elevations: SRTM (NASA and USGS). Lake Kasumigaura and coast: © OpenStreetMap contributors. Stations: Wikidata.',
    figure: {
      href: 'https://doi.org/10.1126/science.1177894',
      label: 'Fig. 2B',
      note: 'at Science, free to read after a free registration',
    },
    settings: () => tokyo({ lightStrength: 0.05 }),
    // The light comes after the food and the walls: the start layout 'food' places the colony on the first food.
    env: [...tokyoShapes(), ...tokyoLight()],
  },
  {
    id: 'food-ring',
    name: 'Food ring',
    group: 'experiments',
    source: 'Made for this app',
    summary: 'Food in the middle and on a ring: a colony grows out and joins all nine with tubes.',
    watch:
      'The colony grows out from the middle food as a mesh and covers all nine foods within about 2,000 steps. Then the flow thins the mesh, and the tubes that carry no flow between foods starve. A network with loops remains between the foods. It thins slowly, over 10,000 steps and more.',
    about:
      'Nine food sources: one in the middle and eight on a ring around it. A small colony starts on the middle food and grows with Jones’ rule. The flow in the tubes then keeps the tubes that carry flow between foods, and the others starve. A network with loops remains.',
    strainRoles: ['Jones’ foraging agent, drawn to food'],
    why: 'Growth and shrinkage with Jones’ values of 2011 and his foraging angles. Flow in the tubes is on with a strength of 2. The dish has 384 × 384 cells on every screen. Sensor distance 7 and food weight 0.03 are the Maze’s. The middle food and the ring are this app’s choice: they show which links the flow keeps.',
    settings: () => forager({ lattice: L384(), flowStrength: 2 }),
    // The start layout 'food' places the colony on the first food: the one in the middle.
    env: [food(0, 0, 0.014), ...ring(8, 0.3, 0.014)],
  },
  {
    id: 'rival-networks',
    name: 'Rival networks',
    group: 'experiments',
    source: 'Made for this app',
    summary: 'Two rival strains grow from two foods, and each builds its own network on all ten foods.',
    watch:
      'Each strain grows from its own food as a mesh, and the two meshes push into each other. From about step 2,000 the flow thins them. Two networks remain on the same foods, one of each strain. Add a third strain: it starts on the third food and builds a third network.',
    about:
      'Ten food sources in a dish, and two strains that flee each other’s trail. Each strain is a slime mold of its own and has its own flow: its flux runs only through its own tubes, between the foods that it covers. So each strain keeps the tubes that it needs, and the two networks lie side by side.',
    strainRoles: ['Starts on the food at the bottom left', 'The same settings as A, starts at the right'],
    why: 'Jones’ foraging agent with growth and shrinkage, twice. A weight of −1 on the other strain’s trail keeps the tubes apart. The start layout puts each strain on a food of its own. Flow in the tubes is on with a strength of 2 for each strain. The dish has 384 × 384 cells on every screen. Sensor distance 7 and food weight 0.03 are the Maze’s.',
    settings: () => forager({ lattice: L384(), flowStrength: 2 }, 2),
    // The start layout 'food' places strain A on the first food and strain B on the second, at opposite sides.
    env: [
      food(-0.35, 0.27, 0.014),
      food(0.36, -0.2, 0.014),
      food(0.02, 0.33, 0.014),
      food(-0.28, 0.22, 0.014),
      food(0.3, 0.18, 0.014),
      food(-0.33, -0.05, 0.014),
      food(-0.05, 0.02, 0.014),
      food(0.22, -0.08, 0.014),
      food(-0.2, -0.27, 0.014),
      food(0.1, -0.3, 0.014),
    ],
  },
  {
    id: 'tokyo-rivals',
    name: 'Tokyo, two networks',
    group: 'experiments',
    source: 'After Tero et al. 2010',
    summary: 'Two rival strains on the map around Tokyo: each joins the 36 cities with tubes of its own.',
    watch:
      'Strain A grows out from Tokyo and strain B from Utsunomiya in the north. Both spread over the whole map, and their meshes push into each other. Then the flow thins each mesh. Two networks remain on the same cities, one of each strain.',
    about:
      'The map of the scene Tokyo rail network, with two strains that flee each other’s trail. Each strain is a slime mold of its own and has its own flow, so each keeps the tubes that carry its own flow between cities. The experiment of Tero and colleagues had one slime mold. This scene is this app’s question of what two rivals build.',
    strainRoles: ['Starts at Tokyo station', 'The same settings as A, starts at Utsunomiya'],
    why: 'The settings of the scene Tokyo rail network, twice: Jones’ foraging agent with growth and shrinkage, and Flow in the tubes with a strength of 2.8 for each strain. A weight of −1 on the other strain’s trail keeps the tubes apart. The start layout puts strain A on Tokyo and strain B on Utsunomiya. The map has 512 × 512 cells. Stations: Wikidata. Coast: © OpenStreetMap contributors.',
    settings: () => forager({ lattice: [512, 512], flowStrength: 2.8 }, 2),
    // The start layout 'food' places strain A on the first food and strain B on the second.
    env: tokyoShapes(['Tokyo', 'Utsunomiya']),
  },
  {
    id: 'y-maze',
    name: 'Y-maze with slime',
    group: 'experiments',
    source: 'Reid et al. 2012',
    summary: 'Slime on one arm of a Y-maze: the slime mold takes the other arm, and the app fills both.',
    watch:
      'The colony starts on the base, without food, and grows into both arms at once. It reaches the first food after about 100 steps and the other one soon after: the slime on the left arm changes nothing yet. Then the flow keeps one tube between the two foods, and the rest of the base starves.',
    about:
      'Reid and colleagues set a slime mold on the base of a Y-maze with food at the end of each arm. With slime on one arm, 39 of 40 chose the arm without slime; with slime on both arms they showed no preference. This app has no rule yet that reads the slime, so its colony takes both arms alike. The avoidance will come with a rule for the growth front.',
    strainRoles: ['Jones’ foraging agent, starts on the base without food'],
    why: 'Jones’ foraging agent with growth and shrinkage, and Flow in the tubes with a strength of 8, as in the Snail maze. The maze has the paper’s sizes at 0.54 mm per cell, on 129 × 90 cells: a base of 1 cm² and arms of 4 cm. The paper gives no width and no angle of the arms: 1 cm and 45° are this app’s. The slime is new at the start; the paper’s was 8 to 12 hours old.',
    settings: () => forager({ lattice: [...Y_MAZE.lattice], boundary: 'box' }),
    // The start layout 'food' places the colony on the start spot: the middle of the base. The foods follow, the left
    // one first, then the walls, the slime of the left arm and its film.
    env: [Y.startShape, ...Y.shapes(['left']), ...Y.film(['left'])],
  },
  {
    id: 'slime-everywhere',
    name: 'Slime everywhere',
    group: 'experiments',
    source: 'Reid et al. 2012',
    summary: 'A dish coated with slime: the colony grows to the glucose as fast as on blank agar.',
    watch:
      'The colony starts at the top of the dish, on slime like all of its ground. Arms grow out on all sides, and one reaches the glucose at the bottom after about 400 steps, as it does without the slime. With one food no flux runs in the tubes, and a network of loops remains.',
    about:
      'Reid and colleagues coated the agar of a dish with slime and let a slime mold find a well of glucose. Without a trap the slime changed neither the time to the glucose, nor the way, nor the speed. This app has no rule yet that reads the slime, so here too the colony grows as on blank agar. A rule for the avoidance of slime must keep this.',
    strainRoles: ['Jones’ foraging agent, starts at the top, drawn to food'],
    why: 'Jones’ foraging agent with growth and shrinkage, and Flow in the tubes with a strength of 8. The dish is 8.6 cm wide at 0.54 mm per cell, on 169 × 169 cells, and its food is a well of glucose 5 mm wide. The places of the start and of the well are this app’s: 1 cm inside the rim, at the top and at the bottom. The slime covers the dish and is new at the start.',
    settings: () => forager({ lattice: [SLIME_DISH.side, SLIME_DISH.side] }),
    // The start layout 'food' places the colony on the start spot at the top, not on the glucose.
    env: slimeDishShapes(),
  },
  {
    id: 'crown',
    name: 'Crown of veins',
    group: 'experiments',
    source: 'Made for this app',
    summary: 'A colony grows out of a neck as one sheet, with veins that fork toward its rim.',
    watch:
      'The colony fills the neck and leaves it after about 1,300 steps. Then it spreads as a half disc. By step 8,000 a few main veins run from the neck toward the rim and fork there. Later these forks go, and new ones grow at the new rim. The rim stays one smooth arc.',
    about:
      'The rules of the growth front: the colony pushes its ground open, its rim takes the flux of the tubes, and that flux pays its births. With the flow over 8 neighbours, a low base conductance and twice the flux to the front, the veins of a crown grow in one sheet. The crown of a real slime mold has more: a lobed rim, and a sheet that moves on ahead of its tube and leaves the veins behind. This scene has neither.',
    strainRoles: ['Jones’ foraging agent with the rules of the growth front'],
    why: 'The best crown of this app’s research so far, in its box of 520 × 340 cells on every screen: a neck 14 cells wide and 40 cells long, and a food at its closed end. Jones’ foraging agent with growth and shrinkage, Sensor distance 7, Food weight 0.03 and a Flow strength of 8. The rules of the growth front with a drift of 1.5, the flow over 8 neighbours, a base conductance of 0.002 and twice the flux to the front.',
    settings: () =>
      forager({
        lattice: [...CROWN.lattice],
        boundary: 'box',
        territory: true,
        drift: 1.5,
        flowEdges: 8,
        flowBase: 0.002,
        frontFlux: 2,
      }),
    // The start layout 'food' places the colony on the food at the closed end of the neck.
    env: crownShapes(),
  },
);

// The scenes without the rule of one agent per cell: this app's two scenes in the style of Jenson and Fogleman, which
// were its start scenes until ADR 0064, and Michael Fogleman's saved settings (MIT).
SCENES.push(
  {
    id: 'three-strains',
    name: 'Three-strain weave',
    group: 'shared',
    source: 'Made for this app',
    summary: 'Three rival strains start in one disc and weave their networks around each other.',
    about:
      'Three strains begin as slices of one disc. Each follows its own trail and steers away from the other two, so their networks wind around each other instead of merging. It works like the versions of Sage Jenson and Michael Fogleman: several agents per cell and no one-agent-per-cell rule, which gives thin, sharp filaments.',
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
    name: 'Two-strain weave',
    group: 'shared',
    source: 'Made for this app',
    summary: 'Two strains side by side; each builds its own network and avoids the other.',
    about:
      'Two strains start in two bands, side by side. Each follows its own trail and is repelled by the other’s, so the two networks compete for space. Watch what happens where they meet. Like the Three-strain weave, it runs without the one-agent-per-cell rule.',
    strainRoles: ['Starts in the left band', 'The same settings as A, starts in the right band'],
    why: 'Chosen for this app. Sensor distance 14 (Jones: 9) gives a coarser mesh, and decay 0.3 lies between Jones’ 0.1 and the 0.6 of the Three-strain weave. A weight of −0.6 on the other strain’s trail keeps the strains apart, and 2 agents per cell fill the grid.',
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
    id: 'cyclones',
    name: 'Cyclones',
    group: 'shared',
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
    group: 'shared',
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
    group: 'shared',
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

/** Every scene, in the order of the groups, and within a group in the order of the list above. */
export const PRESETS: Preset[] = GROUPS.flatMap((g) => SCENES.filter((p) => p.group === g.id));

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/**
 * The step order of a link that names none (ADR 0027): its scene's, or sense first, the order of the code before, for a
 * link without a scene or with a scene this app does not know.
 */
export const stepOrderOf = (scene: string | undefined): StepOrder =>
  (scene ? presetById(scene)?.settings().stepOrder : undefined) ?? 'sense-first';

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

/** A lattice as people write it: "200 × 200 cells", with no-break spaces so that a line never breaks inside it. */
export const latticeText = ([w, h]: Lattice) => `${w}\u00a0×\u00a0${h} cells`;

/** A grid as the panel's Grid choice names it: a lattice, or the cells on the long side of a grid shaped like the screen. */
export const gridText = (s: Pick<Settings, 'lattice' | 'resolution'>) =>
  s.lattice ? latticeText(s.lattice) : `${s.resolution} cells on the long side`;

/**
 * Whether the lattice of a scene is the lattice of a figure of Jones 2010 (ADR 0026). Every other scene with a lattice
 * has a grid of its own: this app's choice, or the lattice of another paper. The texts about the grid name Jones and
 * his figure only for a scene of the first kind (ADR 0064).
 */
export const figureLattice = (p: Preset | undefined): boolean => p !== undefined && sourceKind(p) === 'jones';

/** What the grid choice writes behind the lattice of the scene: `figure` as figureLattice() gives it. */
export const latticeOrigin = (figure: boolean) => (figure ? ', as in the paper' : ', the scene’s grid');

/**
 * Shown below the grid while a scene with a lattice runs on another grid `now` (ADR 0026): the grid, the lattice of
 * the scene, and why the result then differs, with the names of the panel. Also for a shared link made on another
 * grid, so it says what runs, not who changed it. `figure`: the lattice is that of a figure of Jones 2010
 * (figureLattice()), and the text names Jones and the paper.
 */
export function latticeNotice(lattice: Lattice, now: Pick<Settings, 'lattice' | 'resolution'>, figure = true): string {
  if (!figure)
    return `This grid has ${gridText(now)}. The scene was made for ${latticeText(lattice)}. Lengths such as Sensor distance and Step size are in cells. So the pattern keeps its size in cells, and another grid holds more or less of it. The scene can then run differently.`;
  return `This grid has ${gridText(now)}. For this figure, Jones used ${latticeText(lattice)}. Jones gives lengths in cells, as for Sensor distance and Step size. So the pattern keeps its size in cells, and another grid holds more or less of it. The result is then different from the paper.`;
}

/** Shown below the grid while the device cannot hold the lattice of the scene (ADR 0026): no way back. */
export function latticeLostNotice(
  lattice: Lattice,
  now: Pick<Settings, 'lattice' | 'resolution'>,
  figure = true,
): string {
  if (!figure)
    return `This device cannot hold the scene’s grid of ${latticeText(lattice)}. The scene runs on a grid of ${gridText(now)}, so it can run differently.`;
  return `This device cannot hold Jones’ grid of ${latticeText(lattice)} for this figure. The scene runs on a grid of ${gridText(now)}, so the result can be different from the paper.`;
}

export type SourceKind =
  'jones' | 'fogleman' | 'nakagaki' | 'tero' | 'later' | 'coarsening' | 'tsuda' | 'voronoi' | 'reid' | 'app';

export function sourceKind(p: Preset): SourceKind {
  if (p.source.startsWith('Jones 2010')) return 'jones';
  if (p.source.startsWith('Jones and Adamatzky 2015')) return 'voronoi';
  if (p.source.startsWith('Fogleman 2020')) return 'fogleman';
  if (p.source.startsWith('Nakagaki')) return 'nakagaki';
  if (p.source.startsWith('Tero')) return 'tero';
  if (p.source.startsWith('After Jones')) return 'later';
  if (p.source.startsWith('Baumgarten')) return 'coarsening';
  if (p.source.startsWith('Tsuda')) return 'tsuda';
  if (p.source.startsWith('Reid')) return 'reid';
  return 'app';
}

/** The short text behind a scene's source chip. */
export function sourceText(p: Preset): string {
  switch (sourceKind(p)) {
    case 'jones': {
      const figure = p.source.slice('Jones 2010, '.length);
      const lattice = p.settings().lattice;
      const on = lattice ? `, on its lattice of ${latticeText(lattice)} on every screen` : '';
      return `Jones 2010 is the research paper this simulator is built on: Jeff Jones, University of the West of England, in the journal Artificial Life. It shows that thousands of simple agents, each following and laying a chemical trail, build networks like the slime mold Physarum. This scene uses the settings of ${figure} of the paper${on}.`;
    }
    case 'fogleman':
      return 'Fogleman 2020 is Michael Fogleman’s version of the model, written in Go, with several species that follow or flee each other’s trails. This scene uses one of the settings he saved in his code (MIT license).';
    case 'nakagaki':
      return 'Nakagaki, Yamada and Tóth, Nature 407: 470 (2000): a real slime mold left the dead ends of a maze and kept tubes on short ways between two foods. This scene stages that idea; its settings were chosen for this app. The flow in the tubes is built from the model of Tero, Kobayashi and Nakagaki (2007), on the cells of the grid.';
    case 'tero': {
      // "Fig. 1": the runs without light; "Fig. 2B": the runs with light on the mountains and the lakes.
      const figure = p.source.slice('Tero et al. 2010, '.length);
      const runs = figure === 'Fig. 1' ? `the experiment of ${figure}` : `the runs with light of ${figure}`;
      return `Tero and colleagues, Science 327: 439 (2010): a real slime mold, fed where 36 cities around Tokyo lie, built a network much like the rail system. This scene rebuilds ${runs}. The flow in the tubes is built from the model of the paper, on the grid’s cells; the agents and their growth are Jones’. The paper gives no positions: the cities are fitted to its figures.`;
    }
    case 'later':
      return 'Jones’ later papers (Natural Computing 2011; Jones, Mayne and Adamatzky 2017) let the population grow and shrink, and they forage with a sensor angle of 22.5°. This scene uses their rule and values in this app’s maze. The maze, its foods and the other values were chosen for this app.';
    case 'coarsening':
      return 'Baumgarten, Jones and Hauser, Acta Physica Polonica B 46: 1201 (2015), watched the vein network of a real slime mold coarsen and ran Jones’ model, with growth and shrinkage, for a comparison. This scene uses the settings of the model of the paper, on its lattice of 400\u00a0×\u00a0400 cells on every screen.';
    case 'tsuda':
      return 'Tsuda, Jones, Adamatzky and Mills (2011, arXiv:1204.1752) steered a real slime mold with electric current: it grew toward the cathode. In Jones’ model they made each current sink a source above 0 of the trail map, and each current source one below 0. This scene uses the values of that model. The grid and the places of the electrodes were chosen for this app: the paper gives none.';
    case 'voronoi':
      return 'Jones and Adamatzky, “Slime mould inspired generalised Voronoi diagrams with repulsive fields” (2015, arXiv:1503.06973), add repellents to Jones’ model: sources below zero in the trail map. With them the agents draw the Voronoi diagram of a set of points. This scene uses the model of the paper. Its lattice and its strengths are read from the figures or chosen for this app.';
    case 'reid': {
      const what = p.id === 'y-maze' ? 'their Y-maze' : 'their dish without the trap';
      return `Reid, Latty, Dussutour and Beekman, PNAS 109: 17490 (2012): a real slime mold avoids ground with its own slime, and it uses the slime as a memory to find its way out of a trap. This scene rebuilds ${what}, at 0.54 mm per cell. The agents, their growth and the flow in the tubes are this app’s. No rule of the app reads the slime yet.`;
    }
    case 'app':
      return 'This scene was made for this app. Its settings are not taken from a paper.';
  }
}
