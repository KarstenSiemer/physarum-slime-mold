// The Y-maze of Reid et al. 2012 in the real engine: which arm does a colony choose when one arm has slime (ADR 0056,
// stage 2b)? Not a test of the app: it runs only when asked, with the configuration research/vitest.config.ts. The
// layout is src/model/y-maze.ts (ADR 0066); measure-y-maze.ts reads the records. WebGPU only.
//
// One run, with the settings of the scene Snail maze on the lattice of the layout and the start layout Empty:
// 1. The engine paints the layout, with slime on the own part of the arms of the case. The slime is new at step 0.
// 2. The run takes VITE_AGE steps without a colony, so the slime is that old when the colony comes.
// 3. One step of the inoculate tool places about 50 agents on the middle of the base, as the start layout Food places
//    a colony on a food (Engine.seedAtFood()). The base holds no food.
// 4. Every 50 steps the run reads the trail. A cell holds plasm when its trail is at or above the low level
//    (plasmLevels()). A food is touched when one of its cells holds plasm. The arm whose food is touched first is the
//    chosen arm; both in one sample is a split. The run stops VITE_AFTER steps after the first touch, or VITE_LIMIT
//    steps after the inoculation.
// 5. The first agents cross an arm in about 65 steps, so samples of 50 steps give many splits. The run therefore
//    also reads the trail after every step until a food is touched (`exact`; after 1,000 steps without a touch every
//    10 steps), and then every 10 steps until the other food is touched (`second`).
//
// The settings come from environment variables:
// - VITE_CASE: one, both or none: slime on one arm (the left arm for an odd seed, the right arm for an even one), on
//   both arms, or on no arm.
// - VITE_SEEDS: the seeds, as a list or as a range (1-40). The runs of one call share one browser session; every run
//   has a simulation of its own.
// - VITE_WIDTH: the width of an arm in cells, 19 or 9.
// - VITE_AGE: the steps before the inoculation (18000: 10 h of model time).
// - VITE_FRESH: 1 paints the slime right before the inoculation, with the Slime tool: slime of the age 0.
// - VITE_AFTER (2000), VITE_LIMIT (10000): when a run stops, as above.
// - VITE_VARIANT: the name of the rule that runs, for the record. variant.ts sets it; without it the rule is `none`,
//   the app as it is.
// - VITE_NAME: the name of the record; without it `<variant>-<case>`, with `-w9` and `-fresh` where they apply. The
//   record is research/flow/out/engine/y-maze/<name>-s<first seed>-<last seed>.jsonl, one line per run.
// - VITE_PATCH: settings as JSON, on top of the scene's.
// - VITE_SNAPS: steps since the inoculation, as a list of multiples of 50: the run also writes the trail and the
//   slime field at each (`-trail-s<seed>-<step>`, `-slime-s<seed>-<step>`), for a picture.
// - VITE_BIRTHS: 1 also writes every birth of a run with the free neighbours of its parent (`-births-s<seed>`), for
//   the measurement of the age of their slime. It needs the variant `births` of variant.ts, which makes the growth
//   pass write the free neighbours beside each birth, and it reads the slime field before every step that tests
//   growth.
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { AgentToolKind, strainAgents } from '../../../src/engine/pack';
import { readBuffer } from '../../../src/engine/readback';
import { plasmLevels, slimeSteps } from '../../../src/engine/slime';
import type { Stroke } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain, FOOD_START } from '../../../src/model/params';
import { presetById } from '../../../src/model/presets';
import { RUN_RADIUS, SIDES, yMaze, type Side } from '../../../src/model/y-maze';

const OUT = 'research/flow/out/engine/y-maze/';
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const CASE = env.VITE_CASE ?? 'one';
const WIDTH = Number(env.VITE_WIDTH ?? 19);
const AGE = Number(env.VITE_AGE ?? 18000);
const FRESH = env.VITE_FRESH === '1';
const AFTER = Number(env.VITE_AFTER ?? 2000);
const LIMIT = Number(env.VITE_LIMIT ?? 10000);
const VARIANT = env.VITE_VARIANT ?? 'none';
const BIRTHS = env.VITE_BIRTHS === '1';
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Record<string, unknown>;
const SNAPS = (env.VITE_SNAPS ?? '').split(',').filter(Boolean).map(Number);
const SEEDS = (env.VITE_SEEDS ?? '1-40').split(',').flatMap((part) => {
  const [from = 0, to = from] = part.split('-').map(Number);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
});
const NAME = env.VITE_NAME ?? `${VARIANT}-${CASE}${WIDTH === 19 ? '' : `-w${String(WIDTH)}`}${FRESH ? '-fresh' : ''}`;
const FILE = `${OUT}${NAME}-s${String(SEEDS[0])}-${String(SEEDS[SEEDS.length - 1])}`;

/** The steps between two samples of the trail. */
const SAMPLE = 50;
/** The steps between two looks at the foods after the first touch, until the other food is touched. */
const LOOK = 10;
/** The steps after the inoculation with a look after every step, while no food is touched. */
const EXACT = 1000;
/** The steps of one frame of a stretch without a sample. */
const CHUNK = 100;
/**
 * The colony of the start: about FOOD_START agents on a disc of twice as many cells, by FOOD_TRIES dead agents that
 * try a random point of it (the constants of Engine.seedAtFood() in src/engine/engine.ts).
 */
const START_CELLS = 2 * FOOD_START;
const START_RADIUS = Math.sqrt(START_CELLS / Math.PI);
const START_TRIES = START_CELLS * Math.LN2;
/**
 * The upper ends of the classes of the age of slime, in steps: class 0 is a cell without slime, class 1 slime of the
 * age 0 to 1 (the cell held plasm in the step before), class 7 slime above the last end.
 */
const AGES = [1, 10, 100, 300, 1000, 3000];

/** The first touch of a food: the steps since the inoculation, the arm, and the state of the two arms then. */
interface Touch {
  t: number;
  chosen: string;
  fill: number[];
  alive: number;
  inArm: number[];
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Neighbour k of 8 around a cell, as growth.wgsl counts them (around()): its offset in cells. */
function around(k: number): [number, number] {
  const j = k + (k >= 4 ? 1 : 0);
  return [(j % 3) - 1, Math.floor(j / 3) - 1];
}

/** The Chebyshev distance of every cell to the nearest cell of `target`, capped at 255 (two chamfer passes). */
function distanceTo(target: Uint8Array, w: number, h: number): Uint8Array {
  const d = new Uint8Array(w * h).fill(255);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 255 : (d[y * w + x] ?? 255));
  const near = (c: number, ...around4: number[]) => {
    d[c] = target[c] ? 0 : Math.min(d[c] ?? 255, Math.min(255, Math.min(...around4) + 1));
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) near(y * w + x, at(x - 1, y), at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1));
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) near(y * w + x, at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1));
  return d;
}

it('runs the Y-maze for every seed and writes which arm each colony chose', async () => {
  const preset = presetById('snail-maze');
  if (!preset) throw new Error('no scene snail-maze');
  const maze = yMaze(WIDTH);
  const { w, h } = maze;
  const lines: string[] = [];
  // The storage buffers of a pass that the device has, and that the adapter can give: a rule that reads the slime
  // field in the growth pass `win` needs 9 (variant.ts).
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  const adapterLimit = adapter?.limits.maxStorageBuffersPerShaderStage ?? 0;
  for (const seed of SEEDS) {
    const t0 = performance.now();
    const slimed: Side[] = CASE === 'both' ? [...SIDES] : CASE === 'one' ? [seed % 2 === 1 ? 'left' : 'right'] : [];
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 800;
    const backend = await WebGpuBackend.create(canvas);
    const device = backend.gpu.device;
    // GPU validation errors that no error scope takes: a pass with one would run nothing, and the run would look fine.
    const gpuErrors: string[] = [];
    device.addEventListener('uncapturederror', (e) => {
      if (gpuErrors.length < 5) gpuErrors.push(e.error.message.slice(0, 300));
    });
    const settings = constrain({ ...preset.settings(), lattice: [w, h], layout: 'empty', seed, ...PATCH });
    const engine = await Engine.create(canvas, settings, undefined, backend);
    await engine.load(settings, maze.shapes(FRESH ? [] : slimed));
    const sim = engine.sim;
    if (sim.width !== w || sim.height !== h) throw new Error('the engine did not take the lattice of the layout');
    const stepTo = async (target: number, chunk = CHUNK) => {
      while (sim.step < target) {
        engine.frame(performance.now(), Math.min(chunk, target - sim.step));
        await sim.finish();
      }
    };
    await stepTo(AGE);
    if (FRESH) {
      for (const run of maze.slimeRuns(slimed)) {
        const stroke: Stroke = {
          kind: 'slime',
          from: [run.from + 0.5, run.y + 0.5],
          to: [run.to + 0.5, run.y + 0.5],
          radius: RUN_RADIUS,
        };
        engine.paint(stroke);
      }
      // A frame without a step paints the strokes.
      engine.frame(performance.now(), 0);
    }
    const painted = (await sim.readSlime()).reduce((n, stamp) => n + (stamp > 0 ? 1 : 0), 0);
    const dead = Math.max(1, strainAgents(settings.strains, sim.agents)[0] ?? 0);
    sim.run(1, {
      kind: AgentToolKind.inoculate,
      x: maze.start[0],
      y: maze.start[1],
      radius: START_RADIUS,
      strain: 0,
      revive: Math.min(1, START_TRIES / dead),
    });
    await sim.finish();
    const placed = (await sim.alive())[0] ?? 0;

    const low = plasmLevels(settings)[0] ?? 1;
    const life = slimeSteps(settings);
    const armOf = new Int8Array(w * h).fill(-1);
    SIDES.forEach((side, k) => {
      for (const c of maze.arm[side]) armOf[c] = k;
    });
    const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
    /** The state of the two arms now: the foods that hold plasm, and per arm the share and the reach of its plasm. */
    const look = async () => {
      const trail = await sim.readTrail();
      const plasm = (c: number) => (trail[c * 4] ?? 0) >= low;
      return {
        t: sim.step - AGE,
        trail,
        touched: SIDES.filter((side) => maze.food[side].some(plasm)),
        fill: SIDES.map((side) => round(maze.arm[side].filter(plasm).length / maze.arm[side].length, 3)),
        front: SIDES.map((side) =>
          round(
            maze.arm[side].reduce((far, c) => Math.max(far, plasm(c) ? (maze.along[c] ?? 0) : 0), 0),
            1,
          ),
        ),
      };
    };
    /** The agents that live, and how many of them stand in the own part of each arm. */
    const census = async () => {
      const inArm = [0, 0];
      let alive = 0;
      for (const a of await sim.readAgents()) {
        if ((a.bits & 4) === 0) continue;
        alive++;
        const k = armOf[Math.floor(a.y) * w + Math.floor(a.x)] ?? -1;
        if (k >= 0) inArm[k] = (inArm[k] ?? 0) + 1;
      }
      return { alive, inArm };
    };
    const chosenOf = (touched: readonly Side[]) => (touched.length === 2 ? 'split' : (touched[0] ?? 'none'));
    const series = {
      t: [] as number[],
      alive: [] as number[],
      inArm: [] as number[][],
      fill: [] as number[][],
      front: [] as number[][],
    };
    /** The first touch by the samples of 50 steps, and by a look after every step. */
    let first: Touch | undefined;
    let exact: Touch | undefined;
    /** The step of the first touch of the other food, or of both foods for a split. */
    let second: number | undefined;
    const ever = new Set<Side>();
    /** Looks at the arms after a step; gives whether the run goes on. */
    const sample = async () => {
      const now = await look();
      for (const side of now.touched) ever.add(side);
      if (!exact && now.touched.length > 0)
        exact = { t: now.t, chosen: chosenOf(now.touched), fill: now.fill, ...(await census()) };
      if (second === undefined && ever.size === 2) second = now.t;
      if (now.t % SAMPLE !== 0) return true;
      const { alive, inArm } = await census();
      series.t.push(now.t);
      series.alive.push(alive);
      series.inArm.push(inArm);
      series.fill.push(now.fill);
      series.front.push(now.front);
      if (!first && now.touched.length > 0)
        first = { t: now.t, chosen: chosenOf(now.touched), fill: now.fill, alive, inArm };
      if (SNAPS.includes(now.t)) {
        const lane = Float32Array.from({ length: w * h }, (_, c) => now.trail[c * 4] ?? 0);
        const name = `${FILE.replace(/-s\d+-\d+$/, '')}-TYPE-s${String(seed)}-${String(now.t)}`;
        await commands.writeFile(`${name.replace('TYPE', 'trail')}.f32.b64`, b64(new Uint8Array(lane.buffer)));
        const stamps = await sim.readSlime();
        await commands.writeFile(`${name.replace('TYPE', 'slime')}.u32.b64`, b64(new Uint8Array(stamps.buffer)));
      }
      return alive > 0 && now.t < (first ? first.t + AFTER : LIMIT);
    };

    // The births of the run, 4 numbers each: the steps since the inoculation; the cell of the parent; the neighbour
    // that it picked (bits 0 to 2), the distance of the parent to ground that the colony did not reach yet (bits 8 to
    // 15) and the class of the slime of the picked neighbour (bits 16 to 19); the class of the slime of each of the 8
    // neighbours, 4 bits each, 15 for a neighbour that is not free.
    const births: number[] = [];
    const growthSteps = settings.growthEvery;
    const stepWithBirths = async () => {
      const step = sim.step;
      const stamps = await sim.readSlime();
      engine.frame(performance.now(), 1);
      const buffer = (sim as unknown as { growth?: { births: GPUBuffer } }).growth?.births;
      if (!buffer) throw new Error('the simulation has no buffers of growth');
      const records = new Uint32Array(await readBuffer(device, buffer));
      const classOf = (c: number) => {
        const stamp = stamps[c] ?? 0;
        const age = step + 1 - stamp;
        if (stamp === 0 || age >= life) return 0;
        return 1 + AGES.filter((end) => age > end).length;
      };
      // Ground that the colony did not reach yet: open cells without a stamp of a step since the inoculation.
      const unreached = Uint8Array.from(maze.open, (open, c) => (open && (stamps[c] ?? 0) <= AGE ? 1 : 0));
      const distance = distanceTo(unreached, w, h);
      for (let i = 0; i < records.length; i += 2) {
        const packed = records[i] ?? 0;
        if (packed === 0) continue;
        const [picked, mask] = [(packed >> 3) & 7, (packed >> 6) & 255];
        if (mask === 0) throw new Error('a birth without free neighbours: run this with the variant `births`');
        const child = records[i + 1] ?? 0;
        const [dx, dy] = around(picked);
        const parent = child - dy * w - dx;
        let classes = 0;
        for (let k = 0; k < 8; k++) {
          const [ox, oy] = around(k);
          classes |= ((mask >> k) & 1 ? classOf(parent + oy * w + ox) : 15) << (4 * k);
        }
        births.push(
          step - AGE,
          parent,
          picked | ((distance[parent] ?? 255) << 8) | (classOf(child) << 16),
          classes >>> 0,
        );
      }
    };

    for (let go = true; go;) {
      // Until the first touch a look after every step (after EXACT steps every LOOK steps), then every LOOK steps
      // until the other food is touched, then only the samples.
      const every = !exact && sim.step - AGE < EXACT ? 1 : second === undefined ? LOOK : SAMPLE;
      const next = Math.floor((sim.step - AGE) / every + 1) * every + AGE;
      if (BIRTHS)
        while (sim.step < next) {
          if (sim.step % growthSteps === 0) await stepWithBirths();
          else await stepTo(Math.min(next, Math.ceil(sim.step / growthSteps) * growthSteps));
        }
      else await stepTo(next, SAMPLE);
      go = await sample();
    }
    const last = series.t.length - 1;
    const line = {
      name: NAME,
      variant: VARIANT,
      case: CASE,
      width: WIDTH,
      age: AGE,
      fresh: FRESH,
      seed,
      slime: slimed.length === 2 ? 'both' : (slimed[0] ?? 'none'),
      painted,
      placed,
      chosen: first?.chosen ?? 'none',
      first: first?.t ?? null,
      fillAtTouch: first?.fill ?? null,
      aliveAtTouch: first?.alive ?? null,
      inArmAtTouch: first?.inArm ?? null,
      exact: exact ?? null,
      second: second ?? null,
      steps: series.t[last] ?? 0,
      fillAtEnd: series.fill[last] ?? null,
      aliveAtEnd: series.alive[last] ?? 0,
      inArmAtEnd: series.inArm[last] ?? null,
      births: births.length / 4,
      series,
      storageBuffers: [device.limits.maxStorageBuffersPerShaderStage, adapterLimit],
      gpuErrors,
      ms: Math.round(performance.now() - t0),
    };
    lines.push(JSON.stringify(line));
    await commands.writeFile(`${FILE}.jsonl`, lines.join('\n') + '\n');
    if (BIRTHS) {
      const bytes = new Uint8Array(Uint32Array.from(births).buffer);
      await commands.writeFile(`${FILE.replace(/-s\d+-\d+$/, '')}-births-s${String(seed)}.u32.b64`, b64(bytes));
    }
    console.log(
      `${NAME} seed ${String(seed)} slime ${line.slime} chosen ${line.chosen} first ${String(line.first)}` +
        ` alive ${String(line.aliveAtEnd)} steps ${String(line.steps)} ms ${String(line.ms)}`,
    );
    engine.destroy();
    backend.destroy();
    if (gpuErrors.length > 0) throw new Error(`GPU validation errors: ${gpuErrors.join(' | ')}`);
  }
}, 14_400_000);
