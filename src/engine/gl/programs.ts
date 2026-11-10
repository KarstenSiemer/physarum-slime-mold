import agentsFrag from './glsl/agents.frag?raw';
import bloomFrag from './glsl/bloom.frag?raw';
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
import viewGlsl from './glsl/view.glsl?raw';
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

export interface Programs {
  agents: Program;
  points: Program;
  counts: Program;
  fill: Program;
  init: Program;
  diffuse: Program;
  paint: Program;
  render: Program;
  height: Program;
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

/** Compiles every program once; simulation shaders get the shared prelude (common.glsl). */
export function compile(gl: GL): Programs {
  const sim = (frag: string) => wrap(gl, program(gl, V + common + fullscreen, V + common + frag));
  const plain = (frag: string) => wrap(gl, program(gl, V + 'precision highp float;\n' + fullscreen, V + frag));
  const view = (frag: string) => plain(viewGlsl + frag);
  return {
    agents: sim(agentsFrag),
    init: sim(initFrag),
    diffuse: sim(diffuseFrag),
    paint: sim(paintFrag),
    counts: sim(countsFrag),
    fill: plain(fillFrag),
    points: wrap(gl, program(gl, V + common + pointsVert, V + common + pointsFrag)),
    render: view(renderFrag),
    height: view(heightFrag),
    bloom: plain(bloomFrag),
    sample: plain(sampleFrag),
  };
}
