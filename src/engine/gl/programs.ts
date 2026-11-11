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
import shapeFrag from './glsl/shape.frag?raw';
import toolsGlsl from './glsl/tools.glsl?raw';
import viewGlsl from './glsl/view.glsl?raw';
import wallsFrag from './glsl/walls.frag?raw';
import { bindBlock, program, type GL } from './gl';

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

export interface Programs {
  /** The agent pass without the wall check of the sensors, for an environment without walls. */
  agents: Program;
  /**
   * The programs for walls, compiled at their first use: a simulation without walls never needs them (Kernels.walled
   * in sim.ts).
   */
  walled: () => Walled;
  points: Program;
  counts: Program;
  fill: Program;
  init: Program;
  diffuse: Program;
  paint: Program;
  shape: Program;
  /** Without (index 0) and with (1) the food, light and walls (ENV in view.glsl). */
  render: [Program, Program];
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

/** The agent pass from `frag` (agents.frag or a version of it), with the agent tools (tools.glsl). */
export function agentsProgram(gl: GL, frag: string, senseWalls: boolean): Program {
  return simProgram(gl, (senseWalls ? '#define SENSE_WALLS 1\n' : '') + toolsGlsl + frag);
}

/** Compiles every program once; simulation shaders get the shared prelude (common.glsl). */
export function compile(gl: GL): Programs {
  const sim = (frag: string) => simProgram(gl, frag);
  const plain = (frag: string) => wrap(gl, program(gl, V + 'precision highp float;\n' + fullscreen, V + frag));
  const view = (frag: string): [Program, Program] => [
    plain('#define ENV 0\n' + viewGlsl + frag),
    plain('#define ENV 1\n' + viewGlsl + frag),
  ];
  let walled: Walled | undefined;
  return {
    agents: agentsProgram(gl, agentsFrag, false),
    walled: () => (walled ??= { agents: agentsProgram(gl, agentsFrag, true), walls: sim(wallsFrag) }),
    init: sim(initFrag),
    diffuse: sim(diffuseFrag),
    paint: sim(brushGlsl + paintFrag),
    shape: sim(brushGlsl + shapeFrag),
    counts: sim(countsFrag),
    fill: plain(fillFrag),
    points: wrap(gl, program(gl, V + common + toolsGlsl + pointsVert, V + common + pointsFrag)),
    render: view(renderFrag),
    height: view(heightFrag),
    bloom: plain(bloomFrag),
    sample: plain(sampleFrag),
  };
}
