// The grids that the outline distances of the electrodes change (ADR 0058): the fit of the grid to the memory of a
// device counts 4 B per cell for them, in every scene. This script fits the default settings and every scene with
// these 4 B and without them, on three backends, six hints of the device's memory and six canvases, and names the
// cases whose grid differs (README.md). It runs the fit of the engine itself (Engine.fit()) on the CPU backend of the
// engine tests, with the limits of each backend.
// Usage: node --import ./research/flow/register.mjs research/electrode/fit.ts
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CpuBackend } from '../../src/engine/cpu-backend.ts';
import { Engine } from '../../src/engine/engine.ts';
import {
  BYTES_PER_AGENT,
  BYTES_PER_AGENT_GL,
  BYTES_PER_CELL,
  BYTES_PER_CELL_HALF_FLOAT,
  COVERED_BYTES_PER_CELL_HALF_FLOAT,
  TUBE_MAP_BYTES_PER_CELL_GL,
} from '../../src/engine/sizing.ts';
import { defaultSettings, type Settings } from '../../src/model/params.ts';
import { PRESETS } from '../../src/model/presets.ts';

/** The bytes per cell of the outline distances of the electrodes. */
const POLE_BYTES = 4;

/** What the fit reads of a backend (Backend in src/engine/types.ts). */
interface Limits {
  name: string;
  bytesPerCell: number;
  bytesPerAgent: number;
  coveredBytesPerCell: number;
  tubeMapBytesPerCell: number;
  supportsCollisions: boolean;
  maxAgents: number;
}

/** The three backends of the app, as their classes state their limits (webgpu.ts, gl/backend.ts). */
export const BACKENDS: Limits[] = [
  {
    name: 'WebGPU',
    bytesPerCell: BYTES_PER_CELL,
    bytesPerAgent: BYTES_PER_AGENT,
    coveredBytesPerCell: 0,
    tubeMapBytesPerCell: 0,
    supportsCollisions: true,
    maxAgents: 2 ** 24,
  },
  {
    name: 'WebGL2',
    bytesPerCell: BYTES_PER_CELL,
    bytesPerAgent: BYTES_PER_AGENT_GL,
    coveredBytesPerCell: 0,
    tubeMapBytesPerCell: TUBE_MAP_BYTES_PER_CELL_GL,
    supportsCollisions: true,
    maxAgents: 2 ** 22,
  },
  {
    name: 'WebGL2 without float blending',
    bytesPerCell: BYTES_PER_CELL_HALF_FLOAT,
    bytesPerAgent: BYTES_PER_AGENT_GL,
    coveredBytesPerCell: COVERED_BYTES_PER_CELL_HALF_FLOAT,
    tubeMapBytesPerCell: TUBE_MAP_BYTES_PER_CELL_GL,
    supportsCollisions: false,
    maxAgents: 2 ** 22,
  },
];
/** navigator.deviceMemory in GB; undefined where the browser does not say (Safari, Firefox). */
export const MEMORY = [undefined, 0.5, 1, 2, 4, 8] as const;
/** Canvases in pixels: three desktops, a small window, a phone upright, and a square. */
export const CANVASES = [
  [1600, 1000],
  [1920, 1080],
  [2560, 1440],
  [1280, 720],
  [390, 844],
  [1000, 1000],
] as const;

/** A case whose grid the 4 B change: where, and the grid without and with them. */
export interface Change {
  scene: string;
  backend: string;
  memory: number | undefined;
  canvas: readonly [number, number];
  before: string;
  now: string;
}

/** The grid that settings run on: a lattice, or the cells on the long side of a grid shaped like the screen. */
const gridOf = (s: Settings) => (s.lattice ? `lattice ${s.lattice.join(' × ')}` : String(s.resolution));

/** Every case, and those whose grid differs with the 4 B of the outline distances of the electrodes. */
export async function fitChanges(): Promise<{ cases: number; changes: Change[] }> {
  const scenes = [
    { id: 'default', settings: () => defaultSettings() },
    ...PRESETS.map((p) => ({ id: p.id, settings: p.settings })),
  ];
  const changes: Change[] = [];
  let cases = 0;
  const device = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    for (const limits of BACKENDS)
      for (const canvas of CANVASES) {
        const backend = new CpuBackend();
        Object.assign(backend, limits);
        const engine = await Engine.create(
          { width: canvas[0], height: canvas[1] } as HTMLCanvasElement,
          defaultSettings(),
          undefined,
          backend,
        );
        for (const memory of MEMORY) {
          Object.defineProperty(globalThis, 'navigator', { value: { deviceMemory: memory }, configurable: true });
          for (const scene of scenes) {
            cases++;
            backend.bytesPerCell = limits.bytesPerCell - POLE_BYTES;
            const before = gridOf(engine.fit(scene.settings()));
            backend.bytesPerCell = limits.bytesPerCell;
            const now = gridOf(engine.fit(scene.settings()));
            if (before !== now) changes.push({ scene: scene.id, backend: limits.name, memory, canvas, before, now });
          }
        }
        // The engine never started its loop, and the CPU backend holds nothing of a GPU: nothing to free.
      }
  } finally {
    if (device) Object.defineProperty(globalThis, 'navigator', device);
  }
  return { cases, changes };
}

/** The lines that the script prints. */
export async function fitReport(): Promise<string[]> {
  const { cases, changes } = await fitChanges();
  return [
    `${String(cases)} cases: ${String(changes.length)} with another grid`,
    ...changes.map(
      (c) =>
        `${c.scene} on ${c.backend}, ${c.memory === undefined ? 'no memory hint' : `a memory hint of ${String(c.memory)} GB`}, ` +
        `a canvas of ${c.canvas.join(' × ')}: ${c.before} before, ${c.now} now`,
    ),
  ];
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) console.log((await fitReport()).join('\n'));
