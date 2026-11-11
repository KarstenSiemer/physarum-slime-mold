import agentsFrag from './glsl/agents.frag?raw';
import bloomFrag from './glsl/bloom.frag?raw';
import brushGlsl from './glsl/brush.glsl?raw';
import common from './glsl/common.glsl?raw';
import countsFrag from './glsl/counts.frag?raw';
import diffuseFrag from './glsl/diffuse.frag?raw';
import fillFrag from './glsl/fill.frag?raw';
import fullscreen from './glsl/fullscreen.vert?raw';
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
  /** The pass that fills its coarse lattice (scent-down.frag). */
  down: Program;
}

/** The agent passes with the saturating trail perception (SATURATE in agents.frag, ADR 0022). */
export interface Saturated {
  /** Without the wall check of the sensors. */
  agents: Program;
  /** With the wall check of the sensors (SENSE_WALLS). */
  walled: Program;
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
  diffuse: Program;
  /** The diffusion pass with covered food (COVERED in diffuse.frag, ADR 0022), compiled at its first use. */
  covered: () => Program;
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

/** The diffusion pass from `frag` (diffuse.frag or a version of it); `covered`: with covered food (COVERED, ADR 0022). */
export function diffuseProgram(gl: GL, frag: string, covered: boolean): Program {
  return simProgram(gl, (covered ? '#define COVERED 1\n' : '') + frag);
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
  let scentStarted: ReturnType<typeof startProgram>[] | undefined;
  let scent: ScentPrograms | undefined;
  return {
    agents: agentsProgram(gl, agentsFrag, false),
    walled: () => (walled ??= { agents: agentsProgram(gl, agentsFrag, true), walls: sim(wallsFrag) }),
    saturated: () =>
      (saturated ??= {
        agents: agentsProgram(gl, agentsFrag, false, true),
        walled: agentsProgram(gl, agentsFrag, true, true),
      }),
    init: sim(initFrag),
    diffuse: diffuseProgram(gl, diffuseFrag, false),
    covered: () => (covered ??= diffuseProgram(gl, diffuseFrag, true)),
    paint: sim(brushGlsl + paintFrag),
    shape: sim(brushGlsl + shapeFrag),
    counts: sim(countsFrag),
    fill: plain(fillFrag),
    points: wrap(gl, program(gl, V + common + toolsGlsl + pointsVert, V + common + pointsFrag)),
    render: view(renderFrag),
    scent: () => {
      if (scent) return scent;
      const vertex = V + 'precision highp float;\n' + fullscreen;
      scentStarted ??= [
        startProgram(gl, vertex, V + '#define SCENT 1\n#define ENV 0\n' + viewGlsl + renderFrag),
        startProgram(gl, vertex, V + '#define SCENT 1\n#define ENV 1\n' + viewGlsl + renderFrag),
        startProgram(gl, vertex, V + '#define ENV 0\n' + viewGlsl + scentDownFrag),
      ];
      if (!scentStarted.every((p) => p.done())) return undefined;
      for (const p of scentStarted) p.check();
      const [off, on, down] = scentStarted.map((p) => wrap(gl, p.program));
      if (!off || !on || !down) return undefined;
      return (scent = { render: [off, on], down });
    },
    height: view(heightFrag),
    bloom: plain(bloomFrag),
    sample: plain(sampleFrag),
  };
}
