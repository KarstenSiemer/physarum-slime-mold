// The passes of the picture of the tubes of an older checkout against those of this one, in one page and on one state
// (ADR 0034, amendment of 2026-11-15). Not a test of the app: it runs only when asked, with the configuration
// research/vitest.config.ts (README.md, part 10, has the command). Two checkouts timed one after the other share the GPU
// with what else runs at the time, and that changes between their runs. Here the old passes and the new ones run in
// turns, a sample each, on the same state, so a load falls on both alike. The old passes come from the sources in
// VITE_OLD (a folder below the repository with the tubes.wgsl and the tubes.frag of the old checkout); the code around
// them is this checkout's. It writes one line per scene and backend to research/flow/out/engine/<name>.jsonl: the
// medians of the old and of the new passes, and the values of the picture, the factors and the stream that differ.
// Environment variables as picture-passes.gpu.test.ts: VITE_KINDS, VITE_SCENES, VITE_WARM, VITE_BATCH, VITE_BATCHES,
// VITE_NAME, VITE_PATCH, VITE_SIZE; and VITE_OLD, and VITE_FRAME (1: a whole frame in place of the passes alone, one
// step and one drawn picture as in picture.gpu.test.ts, with the picture of the tubes on).
import { it } from 'vitest';
import { commands } from 'vitest/browser';
import { Engine } from '../../../src/engine/engine';
import { FLOW } from '../../../src/engine/flow';
import { WebGl2Backend } from '../../../src/engine/gl/backend';
import { bindBlock, program, type GL } from '../../../src/engine/gl/gl';
import common from '../../../src/engine/gl/glsl/common.glsl?raw';
import fullscreen from '../../../src/engine/gl/glsl/fullscreen.vert?raw';
import { FLOW_BINDING, PARAMS_BINDING, VIEW_BINDING, type Program } from '../../../src/engine/gl/programs';
import wgslCommon from '../../../src/engine/shaders/common.wgsl?raw';
import { STREAM, TUBES } from '../../../src/engine/tubes';
import type { Backend } from '../../../src/engine/types';
import { WebGpuBackend } from '../../../src/engine/webgpu';
import { constrain } from '../../../src/model/params';
import { presetById } from '../../../src/model/presets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const KINDS = (env.VITE_KINDS ?? 'webgpu,webgl2').split(',');
const SCENES = (env.VITE_SCENES ?? 'three-strains,tokyo').split(',');
const WARM = Number(env.VITE_WARM ?? 1500);
const BATCH = Number(env.VITE_BATCH ?? 50);
const BATCHES = Number(env.VITE_BATCHES ?? 11);
const NAME = env.VITE_NAME ?? 'picture-ab';
const PATCH = JSON.parse(env.VITE_PATCH ?? '{}') as Record<string, unknown>;
const [WIDTH = 2560, HEIGHT = 1600] = (env.VITE_SIZE ?? '').split(',').filter(Boolean).map(Number);
const OLD = env.VITE_OLD ?? 'research/flow/out/old';
const FRAME = env.VITE_FRAME === '1';

/** The numbers of tubes.ts as the old GLSL takes them; a number that it does not use does no harm. */
const literal = (v: number) => (Number.isInteger(v) ? `${String(v)}.0` : String(v));
const GL_DEFINES =
  `#define RADIUS ${literal(TUBES.radius)}\n#define EDGE ${literal(TUBES.edge)}\n#define SHEET ${literal(TUBES.sheet)}\n` +
  `#define SPAN ${literal(TUBES.span)}\n#define BODY_LOW ${literal(FLOW.bodyLow)}\n#define FAST ${literal(STREAM.fast)}\n`;

/** A pass of the simulation as programs.ts builds one (simProgram()). */
function glProgram(gl: GL, frag: string): Program {
  const V = '#version 300 es\n';
  const p = program(gl, V + common + fullscreen, V + common + frag);
  bindBlock(gl, p, 'Params', PARAMS_BINDING);
  bindBlock(gl, p, 'View', VIEW_BINDING);
  bindBlock(gl, p, 'Flow', FLOW_BINDING);
  return { program: p, loc: (name) => gl.getUniformLocation(p, name) };
}

/** Of two fields: the values that differ, and the largest difference. */
function difference(got: Float32Array, want: Float32Array) {
  let [values, largest] = [0, 0];
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    const [a, b] = [got[i] ?? NaN, want[i] ?? NaN];
    if (Object.is(a, b)) continue;
    values++;
    largest = Math.max(largest, Math.abs(a - b));
  }
  return { values, largest };
}

const median = (list: number[]) => +([...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0).toFixed(3);

it('measures the passes of the picture of an old checkout against these, in turns', async () => {
  const oldWgsl = await commands.readFile(`${OLD}/tubes.wgsl`);
  const oldFrag = await commands.readFile(`${OLD}/tubes.frag`);
  const rows: string[] = [];
  for (const kind of KINDS)
    for (const scene of SCENES) {
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const backend: Backend = kind === 'webgpu' ? await WebGpuBackend.create(canvas) : WebGl2Backend.create(canvas);
      const preset = presetById(scene);
      if (!preset) throw new Error(`no scene ${scene}`);
      const settings = constrain({ ...preset.settings(), seed: 1, flow: true, showTubes: true, ...PATCH });
      const engine = await Engine.create(canvas, settings, undefined, backend);
      await engine.load(settings, preset.env ?? []);
      const sim = engine.sim;
      for (let i = 0; i < WARM; i += 50) {
        sim.run(50);
        await sim.finish();
      }
      // The passes of each checkout, and how to put them in place. The code around them stays this checkout's. Since
      // ADR 0095 the stream is a pass apart from those of the picture: `stream` below puts it in its own place.
      type Passes = Record<string, unknown>;
      let use: (passes: Passes) => void;
      let ours: Passes;
      let old: Passes;
      if (kind === 'webgpu') {
        const inner = sim as unknown as {
          device: GPUDevice;
          kernels: { tubes(): Passes; tubeStream(): unknown; tubePipelines?: Passes; tubeStreamPipeline?: unknown };
          forgetTubes(): void;
        };
        ours = { ...inner.kernels.tubes(), stream: inner.kernels.tubeStream() };
        const module = inner.device.createShaderModule({ code: wgslCommon + oldWgsl });
        const pipeline = (entryPoint: string, constants: Record<string, number>) =>
          inner.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint, constants } });
        old = {
          roots: pipeline('roots', { SPAN: TUBES.span, BODY_LOW: FLOW.bodyLow }),
          picture: pipeline('picture', { RADIUS: TUBES.radius, EDGE: TUBES.edge, SHEET: TUBES.sheet }),
          stream: pipeline('stream', { BODY_LOW: FLOW.bodyLow, FAST: STREAM.fast }),
        };
        use = ({ stream, ...picture }) => {
          inner.kernels.tubePipelines = picture;
          inner.kernels.tubeStreamPipeline = stream;
          // The bind groups of the passes belong to their pipelines. It marks the picture and the stream as stale too.
          inner.forgetTubes();
        };
      } else {
        const inner = sim as unknown as { gl: GL; prog: { tubes(): Passes; tubeStream(): unknown } };
        ours = { ...inner.prog.tubes(), stream: inner.prog.tubeStream() };
        const gl = inner.gl;
        // The old checkout has no map of the tiles: a pass that writes nothing in the place of each of its passes.
        const nothing = glProgram(gl, 'out vec4 result;\nvoid main() { result = vec4(0.0); }\n');
        old = {
          ...Object.fromEntries(Object.keys(ours).map((pass) => [pass, nothing])),
          roots: glProgram(gl, `#define PASS 0\n${GL_DEFINES}${oldFrag}`),
          picture: glProgram(gl, `#define PASS 1\n${GL_DEFINES}${oldFrag}`),
          stream: glProgram(gl, `#define PASS 2\n${GL_DEFINES}${oldFrag}`),
        };
        use = ({ stream, ...picture }) => {
          inner.prog.tubes = () => picture;
          inner.prog.tubeStream = () => stream;
          Object.assign(sim, { tubesStale: true, streamStale: true });
        };
      }
      const pictures = sim as unknown as {
        tubesStale: boolean;
        streamStale: boolean;
        pictureTexture?: unknown;
        streamTexture?: unknown;
        pictureTarget?: () => unknown;
        streamTarget?: () => unknown;
      };
      const draw = (): unknown => {
        pictures.tubesStale = true;
        pictures.streamStale = true;
        return kind === 'webgpu'
          ? [pictures.pictureTexture, pictures.streamTexture]
          : [pictures.pictureTarget?.(), pictures.streamTarget?.()];
      };
      /** `count` pictures, or frames with VITE_FRAME, and the wait for the GPU. */
      const run = async (count: number) => {
        for (let i = 0; i < count; i++) {
          if (!FRAME) draw();
          else {
            engine.frame(performance.now(), 1);
            await sim.finish();
          }
        }
        await sim.finish();
      };
      const fields = async () => ({
        picture: await sim.readPicture(),
        roots: await sim.readTubeRoots(),
        stream: await sim.readStream(),
      });
      const times: Record<'old' | 'new', number[]> = { old: [], new: [] };
      // In turns, and each checkout first in every second sample.
      const both = [
        ['old', old],
        ['new', ours],
      ] as const;
      for (let b = 0; b < BATCHES; b++)
        for (const [name, passes] of b % 2 === 0 ? both : [...both].reverse()) {
          use(passes);
          // The first pictures after a change build what the passes need: not in the sample.
          await run(3);
          const t0 = performance.now();
          await run(BATCH);
          times[name].push((performance.now() - t0) / BATCH);
        }
      use(old);
      const before = await fields();
      use(ours);
      const after = await fields();
      rows.push(
        JSON.stringify({
          kind,
          scene,
          strains: settings.strains.length,
          w: sim.width,
          h: sim.height,
          step: sim.step,
          frame: FRAME,
          old: median(times.old),
          new: median(times.new),
          oldAll: times.old.map((t) => +t.toFixed(3)),
          newAll: times.new.map((t) => +t.toFixed(3)),
          differ: Object.fromEntries(
            (['picture', 'roots', 'stream'] as const).map((f) => [f, difference(after[f], before[f])]),
          ),
        }),
      );
      engine.destroy();
      backend.destroy();
    }
  await commands.writeFile(`research/flow/out/engine/${NAME}.jsonl`, rows.join('\n') + '\n');
}, 3_600_000);
