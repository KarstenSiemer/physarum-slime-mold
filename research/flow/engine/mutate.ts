// Which test catches which wrong rule of the flow (ADR 0029, "The tests against wrong rules"). The script puts one
// wrong rule at a time into a source file of the app, runs the GPU tests of the flow on the backend of that file, and
// puts the file back. Every wrong rule must fail at least one test.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/mutate.ts [W1 F3 ...]
// It changes files below src/ while it runs, and it writes each one back as it was. It stops if a file has changed
// since the mutations were written: then the text of a mutation no longer fits.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WGSL = 'src/engine/shaders/flow.wgsl';
const FRAG = 'src/engine/gl/glsl/flow.frag';
/** The tests of one backend: a part of the test names. */
const [GPU, GL] = ['webgpu', 'webgl2|WebGL2'];

/** A wrong rule: its name, the file, the text of the right rule in it, the wrong text, and the tests to run. */
const MUTATIONS: [name: string, file: string, right: string, wrong: string, tests: string][] = [
  [
    'W1 wgsl: the momentum on every cell',
    WGSL,
    'let omega = select(1.0, U.b.w, m.z > 0.0);',
    'let omega = select(1.0, U.b.w, m.z >= 0.0);',
    GPU,
  ],
  [
    'W2 wgsl: no pressure limit',
    WGSL,
    'given = signs * U.a.x * headroom(pc, signs);',
    'given = signs * U.a.x + 0.0 * headroom(pc, signs);',
    GPU,
  ],
  [
    'W3 wgsl: food without a tube conducts',
    WGSL,
    'if (body >= U.c.z) { g = body * select(U.b.x + d, U.b.y, food); }',
    'if (body >= U.c.z) { g = body * select(U.b.x + d, U.b.y, food); } else if (food) { g = U.b.y; }',
    GPU,
  ],
  [
    'W4 wgsl: a tube adapts without a flux',
    WGSL,
    'if (fed()) { d = max(U.d.x, d + U.a.z * (mean - d)); }',
    'if (fed() || true) { d = max(U.d.x, d + U.a.z * (mean - d)); }',
    GPU,
  ],
  [
    'W5 wgsl: every food counts as covered',
    WGSL,
    '.y > 0.0 && textureLoad(memory, s, 0).y >= U.c.z;',
    '.y > 0.0 && textureLoad(memory, s, 0).y >= -1.0;',
    GPU,
  ],
  [
    'W6 wgsl: give and take swapped',
    WGSL,
    'return vec4f(d == vec4u(1u)) - vec4f(d == vec4u(2u));',
    'return vec4f(d == vec4u(2u)) - vec4f(d == vec4u(1u));',
    GPU,
  ],
  [
    'W7 wgsl: no ghost conductivity',
    WGSL,
    'return edge(a + U.b.z, textureLoad(memory, q, 0).z + U.b.z);',
    'return edge(a, textureLoad(memory, q, 0).z);',
    GPU,
  ],
  [
    'W8 wgsl: the pressure is not recentred',
    WGSL,
    'if (RECENTRE == 1u) { next -= textureLoad(pressureIn, referenceCell(), 0); }',
    'if (RECENTRE == 9u) { next -= textureLoad(pressureIn, referenceCell(), 0); }',
    GPU,
  ],
  [
    'W9 wgsl: the first site of the list as the reference cell',
    WGSL,
    'if (textureLoad(memory, s, 0).w != 0.0) { return s; }',
    'if (textureLoad(memory, s, 0).w != 0.0 && false) { return s; }',
    GPU,
  ],
  [
    'S1 webgpu: the bind group of settle without the variant',
    'src/engine/sim.ts',
    "const settleKey = flow ? `flow${fm}${senseWalls ? 1 : 0}${saturate ? 1 : 0}` : '';",
    "const settleKey = flow ? `flow${fm}` : '';",
    GPU,
  ],
  [
    'A1 wgsl: no starvation',
    'src/engine/shaders/agents.wgsl',
    'return rand(&r) < F.e.x * F.e.y / (d * d + F.e.y);',
    'return rand(&r) < 0.0 * F.e.x * F.e.y / (d * d + F.e.y);',
    GPU,
  ],
  [
    'A2 wgsl: a birth at any flow memory',
    'src/engine/shaders/agents.wgsl',
    'rand(&rng) >= F.e.z * (m.x - F.e.w) / (1.0 - F.e.w)) { return none; }',
    'rand(&rng) >= F.e.z + 0.0 * (m.x - F.e.w)) { return none; }',
    GPU,
  ],
  [
    'A5 wgsl: no birth by the flow in a step in which a tool is held',
    'src/engine/shaders/agents.wgsl',
    '  }\n//#if FLOW\n  return respawn(a, id);',
    '  }\n//#if FLOW\n  return Spot(a.pos, a.heading, -1);',
    GPU,
  ],
  [
    'G1 wgsl: an agent divides on a starved cell',
    'src/engine/shaders/growth.wgsl',
    'if (memory * memory < F.e.y) { return -1; }',
    'if (memory * memory < 0.0 * F.e.y) { return -1; }',
    GPU,
  ],
  // Every strain has a flow of its own (ADR 0030): the wrong rules that give a strain the flow of the first strain.
  [
    'W10 wgsl: the tube body of every strain from the trail of the first strain',
    WGSL,
    'let t = textureLoad(trail, p, 0)[u32(U.f.z)];',
    'let t = textureLoad(trail, p, 0)[0u];',
    GPU,
  ],
  [
    'S2 webgpu: the passes of every strain with the uniform block of the first strain',
    'src/engine/sim.ts',
    'at(flow.uniforms, strain),',
    'at(flow.uniforms, 0),',
    GPU,
  ],
  [
    'S3 webgpu: the passes of the third and the fourth strain on the layer of the second strain',
    'src/engine/sim.ts',
    "t.createView({ dimension: '2d', baseArrayLayer: strain, arrayLayerCount: 1 });",
    "t.createView({ dimension: '2d', baseArrayLayer: Math.min(strain, 1), arrayLayerCount: 1 });",
    GPU,
  ],
  [
    'A3 wgsl: an agent starves by the flow memory of the first strain',
    'src/engine/shaders/agents.wgsl',
    'let d = textureLoad(flowMemory, q, a.bits & 3u, 0).x;',
    'let d = textureLoad(flowMemory, q, 0u, 0).x;',
    GPU,
  ],
  [
    'A4 wgsl: an agent comes to life by the flow memory of the first strain',
    'src/engine/shaders/agents.wgsl',
    'let m = textureLoad(flowMemory, q, a.bits & 3u, 0);',
    'let m = textureLoad(flowMemory, q, 0u, 0);',
    GPU,
  ],
  [
    'G2 wgsl: an agent divides by the flow memory of the first strain',
    'src/engine/shaders/growth.wgsl',
    'let memory = textureLoad(flowMemory, q, s, 0).x;',
    'let memory = textureLoad(flowMemory, q, 0u, 0).x;',
    GPU,
  ],
  [
    'F1 glsl: the momentum on every cell',
    FRAG,
    'float omega = m.z > 0.0 ? U.b.w : 1.0;',
    'float omega = m.z >= 0.0 ? U.b.w : 1.0;',
    GL,
  ],
  [
    'F2 glsl: no pressure limit',
    FRAG,
    'given = signs * U.a.x * headroom(pc, signs);',
    'given = signs * U.a.x + 0.0 * headroom(pc, signs);',
    GL,
  ],
  [
    'F3 glsl: food without a tube conducts',
    FRAG,
    'if (body >= U.c.z) g = body * (food ? U.b.y : U.b.x + d);',
    'if (body >= U.c.z) g = body * (food ? U.b.y : U.b.x + d); else if (food) g = U.b.y;',
    GL,
  ],
  [
    'F4 glsl: a tube adapts without a flux',
    FRAG,
    'if (fed()) d = max(U.d.x, d + U.a.z * (mean - d));',
    'if (fed() || true) d = max(U.d.x, d + U.a.z * (mean - d));',
    GL,
  ],
  [
    'F5 glsl: every food counts as covered',
    FRAG,
    '.g > 0.0 && texelFetch(memory, s, 0).y >= U.c.z;',
    '.g > 0.0 && texelFetch(memory, s, 0).y >= -1.0;',
    GL,
  ],
  [
    'F6 glsl: no starvation',
    'src/engine/gl/glsl/agents.frag',
    'return rand(r) < F.e.x * F.e.y / (d * d + F.e.y);',
    'return rand(r) < 0.0 * F.e.x * F.e.y / (d * d + F.e.y);',
    GL,
  ],
  [
    'F7 glsl: a birth at any flow memory',
    'src/engine/gl/glsl/tools.glsl',
    'rand(rng) >= F.e.z * (m.x - F.e.w) / (1.0 - F.e.w)) return none;',
    'rand(rng) >= F.e.z + 0.0 * (m.x - F.e.w)) return none;',
    GL,
  ],
  [
    'F14 glsl: no birth by the flow in a step in which a tool is held',
    'src/engine/gl/glsl/tools.glsl',
    '  }\n#if FLOW\n  return respawn(a, i);',
    '  }\n#if FLOW\n  return Spot(a.xy, a.z, -1);',
    GL,
  ],
  [
    'F8 glsl: an agent divides on a starved cell',
    'src/engine/gl/glsl/growth.frag',
    'if (memory * memory < F.e.y) return -1;',
    'if (memory * memory < 0.0 * F.e.y) return -1;',
    GL,
  ],
  [
    'F9 glsl: the first site of the list as the reference cell',
    FRAG,
    'if (texelFetch(memory, s, 0).w != 0.0) return s;',
    'if (texelFetch(memory, s, 0).w != 0.0 && false) return s;',
    GL,
  ],
  [
    'F10 glsl: the tube body of every strain from the trail of the first strain',
    FRAG,
    'float t = texelFetch(trail, p, 0)[int(U.f.z)];',
    'float t = texelFetch(trail, p, 0)[0];',
    GL,
  ],
  [
    'L1 webgl2: the passes of every strain with the uniform block of the first strain',
    'src/engine/gl/sim.ts',
    'this.flowBlock(flow, strain);',
    'this.flowBlock(flow, 0);',
    GL,
  ],
  [
    'L2 webgl2: the agents of the fourth strain with the flow memory of the first strain',
    'src/engine/gl/sim.ts',
    'flowMemory3: of(3) };',
    'flowMemory3: of(0) };',
    GL,
  ],
  [
    'L3 webgl2: the claims of the agents with the flow memory of the first strain alone',
    'src/engine/gl/sim.ts',
    '{ occ: occ.texture, ...flowMemory }, claimPoints);',
    '{ occ: occ.texture, flowMemory: flowMemory.flowMemory ?? occ.texture }, claimPoints);',
    GL,
  ],
  [
    'F15 glsl: the agents of the third strain with the flow memory of the second strain',
    'src/engine/gl/glsl/tools.glsl',
    'if (s == 2u) return texelFetch(flowMemory2, q, 0);',
    'if (s == 2u) return texelFetch(flowMemory1, q, 0);',
    GL,
  ],
  [
    'F16 glsl: growth of the third strain by the flow memory of the second strain',
    'src/engine/gl/glsl/growth.frag',
    'if (s == 2u) return texelFetch(flowMemory2, q, 0);',
    'if (s == 2u) return texelFetch(flowMemory1, q, 0);',
    GL,
  ],
  [
    'F11 glsl: an agent starves by the flow memory of the first strain',
    'src/engine/gl/glsl/agents.frag',
    'float d = flowMemoryOf(bitsOf(a) & 3u, q).x;',
    'float d = flowMemoryOf(0u, q).x;',
    GL,
  ],
  [
    'F12 glsl: an agent comes to life by the flow memory of the first strain',
    'src/engine/gl/glsl/tools.glsl',
    'vec4 m = flowMemoryOf(bitsOf(a) & 3u, q);',
    'vec4 m = flowMemoryOf(0u, q);',
    GL,
  ],
  [
    'F13 glsl: an agent divides by the flow memory of the first strain',
    'src/engine/gl/glsl/growth.frag',
    'float memory = flowMemoryOf(bits & 3u, q).x;',
    'float memory = flowMemoryOf(0u, q).x;',
    GL,
  ],
];

const only = process.argv.slice(2);
/** The file that holds a wrong rule now, with its right text: written back on every way out of the script. */
let open: { path: string; text: string } | undefined;
const restore = () => {
  if (open) writeFileSync(open.path, open.text);
  open = undefined;
};
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

let survived = 0;
for (const [name, file, right, wrong, tests] of MUTATIONS) {
  if (only.length > 0 && !only.includes(name.split(' ')[0] ?? '')) continue;
  const path = ROOT + file;
  const text = readFileSync(path, 'utf8');
  if (text.split(right).length !== 2) {
    console.error(`${name}: the text of the right rule is not once in ${file}; the mutation must be written again`);
    process.exit(1);
  }
  /** What the tests print with the wrong rule in the file. The file gets its right text back in every case. */
  const withWrongRule = (): string => {
    try {
      open = { path, text };
      writeFileSync(path, text.replace(right, wrong));
      const run = spawnSync('npx', ['vitest', 'run', '--project', 'gpu', 'src/engine/flow.gpu.test.ts', '-t', tests], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 900_000,
        // Plain text without colour codes.
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      });
      return `${run.stdout}${run.stderr}`;
    } finally {
      restore();
    }
  };
  const out = withWrongRule();
  const lines = out.split('\n').map((line) => line.trim());
  const failed = lines.filter((line) => line.startsWith('×')).map((line) => line.replace(/\s+\d+ms$/, ''));
  const summary = lines.find((line) => line.startsWith('Tests ')) ?? 'NO SUMMARY';
  console.log(`== ${name}: ${summary.replace(/\s+/g, ' ')}`);
  for (const test of failed) console.log(`     ${test}`);
  if (failed.length === 0) {
    survived++;
    console.log(summary === 'NO SUMMARY' ? out.slice(-1500) : '     NO TEST FAILS: the wrong rule is not caught');
  }
}
if (survived > 0) process.exitCode = 1;
