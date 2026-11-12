import agentsFrag from './glsl/agents.frag?raw';
import bloomFrag from './glsl/bloom.frag?raw';
import brushGlsl from './glsl/brush.glsl?raw';
import common from './glsl/common.glsl?raw';
import countsFrag from './glsl/counts.frag?raw';
import diffuseFrag from './glsl/diffuse.frag?raw';
import fillFrag from './glsl/fill.frag?raw';
import fullscreen from './glsl/fullscreen.vert?raw';
import growthFrag from './glsl/growth.frag?raw';
import growthGlsl from './glsl/growth.glsl?raw';
import growthVert from './glsl/growth.vert?raw';
import heightFrag from './glsl/height.frag?raw';
import initFrag from './glsl/init.frag?raw';
import paintFrag from './glsl/paint.frag?raw';
import pointsFrag from './glsl/points.frag?raw';
import pointsVert from './glsl/points.vert?raw';
import renderFrag from './glsl/render.frag?raw';
import sampleFrag from './glsl/sample.frag?raw';
import scentDownFrag from './glsl/scent-down.frag?raw';
import shapeFrag from './glsl/shape.frag?raw';
import toolsGlsl from './glsl/tools.glsl?raw';
import viewGlsl from './glsl/view.glsl?raw';
import wallsFrag from './glsl/walls.frag?raw';
import { bindBlock, program, startProgram, type GL } from './gl';

/** Uniform block binding points. */
export const PARAMS_BINDING = 0;
export const VIEW_BINDING = 1;

const V = '#version 300 es\n';

export interface Program {
  program: WebGLProgram;
  /** Cached uniform locations. */
  loc: (name: string) => WebGLUniformLocation | null;
}

/** The programs for an environment that may hold walls (Programs.walled()). */
export interface Walled {
  /** The agent pass whose sensors check for walls (SENSE_WALLS in agents.frag, ADR 0020). */
  agents: Program;
  /** The clearance passes (walls.frag). */
  walls: Program;
}

/** The programs of the scent view (ADR 0009, amendment 2026-11-11). */
export interface ScentPrograms {
  /** The render pass with the view (SCENT in render.frag), without (index 0) and with (1) the food, light and walls. */
  render: [Program, Program];
  /** The pass that fills its coarse map (scent-down.frag): the scent of its texels and the share that holds scent. */
  down: Program;
  /** The pass that refreshes the scent of its texels after steps and keeps their share (SUM_ONLY). */
  sum: Program;
}

/** The agent passes with the saturating trail perception (SATURATE in agents.frag, ADR 0022). */
export interface Saturated {
  /** Without the wall check of the sensors. */
  agents: Program;
  /** With the wall check of the sensors (SENSE_WALLS). */
  walled: Program;
}

/** The programs of growth and shrinkage (growth.frag, growth.vert, ADR 0025). */
export interface Growth {
  /** PASS 0 and 1: the row sums of the occupancy, then the window counts. */
  rows: Program;
  windows: Program;
  /** PASS 2: shrinkage and the choice of a parent's neighbour. */
  test: Program;
  /** PASS 3: one level of a pyramid of sums. */
  build: Program;
  /** PASS 4: the births. */
  birth: Program;
  /** The claims of the parents and the births of the winners. */
  points: Program;
}

export interface Programs {
  /** The agent pass without the wall check of the sensors, for an environment without walls. */
  agents: Program;
  /**
   * The programs for walls, compiled at their first use: a simulation without walls never needs them (Kernels.walled
   * in sim.ts).
   */
  walled: () => Walled;
  /** The agent passes that saturate the trail, compiled at their first use: most scenes never saturate. */
  saturated: () => Saturated;
  points: Program;
  counts: Program;
  fill: Program;
  init: Program;
  /** The start for a capacity above the start population (CAPACITY in init.frag), compiled at its first use. */
  capacity: () => Program;
  /** The programs of growth and shrinkage, compiled at their first use: every scene has growth off. */
  growth: () => Growth;
  diffuse: Program;
  /** The diffusion pass with covered food (COVERED in diffuse.frag, ADR 0022), compiled at its first use. */
  covered: () => Program;
  /** The view's diffusion of a step that moves first (VIEW in diffuse.frag, ADR 0027), compiled at its first use. */
  view: () => Program;
  paint: Program;
  shape: Program;
  /** Without (index 0) and with (1) the food, light and walls (ENV in view.glsl). */
  render: [Program, Program];
  /**
   * The programs of the scent view once they are built, else undefined. The first call starts their build, and with
   * KHR_parallel_shader_compile the driver builds them beside the frames, which draw without the view until then.
   * Most frames never draw it.
   */
  scent: () => ScentPrograms | undefined;
  height: [Program, Program];
  bloom: Program;
  sample: Program;
}

function wrap(gl: GL, p: WebGLProgram): Program {
  bindBlock(gl, p, 'Params', PARAMS_BINDING);
  bindBlock(gl, p, 'View', VIEW_BINDING);
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program: p,
    loc: (name) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
      return cache.get(name) ?? null;
    },
  };
}

/** A simulation program: a full-screen pass with the shared prelude (common.glsl). */
function simProgram(gl: GL, frag: string): Program {
  return wrap(gl, program(gl, V + common + fullscreen, V + common + frag));
}

/**
 * The agent pass from `frag` (agents.frag or a version of it), with the agent tools (tools.glsl). `senseWalls`: the
 * sensors check for walls (SENSE_WALLS); `saturate`: the sensors saturate the trail (SATURATE, ADR 0022).
 */
export function agentsProgram(gl: GL, frag: string, senseWalls: boolean, saturate = false): Program {
  const defines = (senseWalls ? '#define SENSE_WALLS 1\n' : '') + (saturate ? '#define SATURATE 1\n' : '');
  return simProgram(gl, defines + toolsGlsl + frag);
}

/** The start from `frag` (init.frag or a version of it); `capacity`: for a capacity above the start (ADR 0025). */
export function initProgram(gl: GL, frag: string, capacity: boolean): Program {
  return simProgram(gl, (capacity ? '#define CAPACITY 1\n' : '') + frag);
}

/**
 * The diffusion pass from `frag` (diffuse.frag or a version of it); `covered`: with covered food (COVERED, ADR 0022);
 * `view`: the view's diffusion of a step that moves first (VIEW, ADR 0027).
 */
export function diffuseProgram(gl: GL, frag: string, covered: boolean, view = false): Program {
  return simProgram(gl, (covered ? '#define COVERED 1\n' : '') + (view ? '#define VIEW 1\n' : '') + frag);
}

const plainProgram = (gl: GL, frag: string) =>
  wrap(gl, program(gl, V + 'precision highp float;\n' + fullscreen, V + frag));

/**
 * A view pass from `frag` (render.frag, height.frag or a version of them, after view.glsl) without (index 0) and with
 * (1) the food, light and walls; `defines` go first, such as SCENT for the scent view.
 */
export function viewPrograms(gl: GL, frag: string, defines = ''): [Program, Program] {
  return [
    plainProgram(gl, defines + '#define ENV 0\n' + viewGlsl + frag),
    plainProgram(gl, defines + '#define ENV 1\n' + viewGlsl + frag),
  ];
}

/** Compiles every program once; simulation shaders get the shared prelude (common.glsl). */
export function compile(gl: GL): Programs {
  const sim = (frag: string) => simProgram(gl, frag);
  const plain = (frag: string) => plainProgram(gl, frag);
  const view = (frag: string) => viewPrograms(gl, frag);
  let walled: Walled | undefined;
  let saturated: Saturated | undefined;
  let covered: Program | undefined;
  let viewDiffuse: Program | undefined;
  let scentStarted: ReturnType<typeof startProgram>[] | undefined;
  let scent: ScentPrograms | undefined;
  let capacity: Program | undefined;
  let growth: Growth | undefined;
  const growthPass = (pass: number) => sim(`#define PASS ${String(pass)}\n${growthGlsl}${growthFrag}`);
  return {
    agents: agentsProgram(gl, agentsFrag, false),
    walled: () => (walled ??= { agents: agentsProgram(gl, agentsFrag, true), walls: sim(wallsFrag) }),
    saturated: () =>
      (saturated ??= {
        agents: agentsProgram(gl, agentsFrag, false, true),
        walled: agentsProgram(gl, agentsFrag, true, true),
      }),
    init: initProgram(gl, initFrag, false),
    capacity: () => (capacity ??= initProgram(gl, initFrag, true)),
    growth: () =>
      (growth ??= {
        rows: growthPass(0),
        windows: growthPass(1),
        test: growthPass(2),
        build: growthPass(3),
        birth: growthPass(4),
        points: wrap(gl, program(gl, V + common + growthGlsl + growthVert, V + common + pointsFrag)),
      }),
    diffuse: diffuseProgram(gl, diffuseFrag, false),
    covered: () => (covered ??= diffuseProgram(gl, diffuseFrag, true)),
    view: () => (viewDiffuse ??= diffuseProgram(gl, diffuseFrag, false, true)),
    paint: sim(brushGlsl + paintFrag),
    shape: sim(brushGlsl + shapeFrag),
    counts: sim(countsFrag),
    fill: plain(fillFrag),
    points: wrap(gl, program(gl, V + common + toolsGlsl + pointsVert, V + common + pointsFrag)),
    render: view(renderFrag),
    scent: () => {
      // A lost context builds nothing: the frames draw without the view, and the app reports the loss.
      if (scent || gl.isContextLost()) return scent;
      const vertex = V + 'precision highp float;\n' + fullscreen;
      scentStarted ??= [
        startProgram(gl, vertex, V + '#define SCENT 1\n#define ENV 0\n' + viewGlsl + renderFrag),
        startProgram(gl, vertex, V + '#define SCENT 1\n#define ENV 1\n' + viewGlsl + renderFrag),
        startProgram(gl, vertex, V + '#define ENV 0\n' + viewGlsl + scentDownFrag),
        startProgram(gl, vertex, V + '#define ENV 0\n#define SUM_ONLY 1\n' + viewGlsl + scentDownFrag),
      ];
      if (!scentStarted.every((p) => p.done())) return undefined;
      for (const p of scentStarted) p.check();
      const [off, on, down, sum] = scentStarted.map((p) => wrap(gl, p.program));
      if (!off || !on || !down || !sum) return undefined;
      return (scent = { render: [off, on], down, sum });
    },
    height: view(heightFrag),
    bloom: plain(bloomFrag),
    sample: plain(sampleFrag),
  };
}
