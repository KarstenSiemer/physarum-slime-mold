// Which test catches which wrong rule of the flow (ADR 0029, "The tests against wrong rules") and of the picture of
// the tubes (ADR 0034). The script puts one wrong rule at a time into a source file of the app, runs the GPU tests of
// the flow or of the picture on the backend of that file, and puts the file back. Every wrong rule must fail at least
// one test.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/mutate.ts [W1 F3 ...]
// It changes files below src/ while it runs, and it writes each one back as it was. It stops if a file has changed
// since the mutations were written: then the text of a mutation no longer fits.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WGSL = 'src/engine/shaders/flow.wgsl';
const FRAG = 'src/engine/gl/glsl/flow.frag';
/** The passes of the picture of the tubes, and the file of their tests. */
const TUBES_WGSL = 'src/engine/shaders/tubes.wgsl';
const TUBES_FRAG = 'src/engine/gl/glsl/tubes.frag';
const TUBES_SPEC = 'src/engine/tubes.gpu.test.ts';
const FLOW_SPEC = 'src/engine/flow.gpu.test.ts';
/** The tests of one backend: a part of the test names. */
const [GPU, GL] = ['webgpu', 'webgl2|WebGL2'];

/**
 * A wrong rule: its name, the file, the text of the right rule in it, the wrong text, the tests to run, and their
 * file (without one: the tests of the flow).
 */
const MUTATIONS: [name: string, file: string, right: string, wrong: string, tests: string, spec?: string][] = [
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
  // Every strain has a flow of its own (ADR 0031): the wrong rules that give a strain the flow of the first strain.
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
  // The levels of the trail follow the decay of the strain (ADR 0032): the block of the passes, for each backend.
  [
    'T1 block: the trail levels of a tube without the decay of the strain (the WebGPU tests)',
    'src/engine/flow.ts',
    'return [FLOW.trailLow * deposit * scale, FLOW.trailFull * deposit * scale];',
    'return [FLOW.trailLow * deposit, FLOW.trailFull * deposit];',
    GPU,
  ],
  [
    'T2 block: the trail levels of a tube without the decay of the strain (the WebGL2 tests)',
    'src/engine/flow.ts',
    'return [FLOW.trailLow * deposit * scale, FLOW.trailFull * deposit * scale];',
    'return [FLOW.trailLow * deposit, FLOW.trailFull * deposit];',
    GL,
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
  // The picture of the tubes (ADR 0034).
  [
    'V1 wgsl: the square root of the strength, not the fourth root',
    TUBES_WGSL,
    'textureStore(rootsOut, p, sqrt(sqrt(vec4f(across[0], across[1], across[2], across[3]))));',
    'textureStore(rootsOut, p, sqrt(vec4f(across[0], across[1], across[2], across[3])));',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V2 wgsl: the strength of a cell without a body in the sum',
    TUBES_WGSL,
    'if (m.y >= BODY_LOW) { sum += m.x * m.y; }',
    'if (m.y >= 0.0) { sum += m.x * m.y; }',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V3 wgsl: the flow memory without the body',
    TUBES_WGSL,
    'if (m.y >= BODY_LOW) { sum += m.x * m.y; }',
    'if (m.y >= BODY_LOW) { sum += m.x; }',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V4 wgsl: the sum of the 3 × 3 cells over one cell of length',
    TUBES_WGSL,
    'across[s] = min(sum / SPAN, 1.0);',
    'across[s] = min(sum, 1.0);',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V5 wgsl: a strength above 1',
    TUBES_WGSL,
    'across[s] = min(sum / SPAN, 1.0);',
    'across[s] = sum / SPAN;',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V6 wgsl: the tubes of every strain from the memory of the first strain',
    TUBES_WGSL,
    'let m = textureLoad(memory, q, s, 0);',
    'let m = textureLoad(memory, q, 0u, 0);',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V7 wgsl: a disc on a cell without a tube',
    TUBES_WGSL,
    'if (textureLoad(memory, p, s, 0).y < BODY_LOW) { continue; }',
    'if (textureLoad(memory, p, s, 0).y < -1.0) { continue; }',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V8 wgsl: a disc passes a wall',
    TUBES_WGSL,
    'if (there >= WALL_BYTE || clearOf(here) + clearOf(there) <= d) { continue; }',
    'if (there >= WALL_BYTE) { continue; }',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V9 wgsl: the wall distance of a byte without the half step',
    TUBES_WGSL,
    'fn clearOf(b: u32) -> f32 { return max(0.0, (1.0 - (2.0 * f32(b) + 1.0) / 255.0) * SHAPE_RANGE); }',
    'fn clearOf(b: u32) -> f32 { return max(0.0, (1.0 - 2.0 * f32(b) / 255.0) * SHAPE_RANGE); }',
    GPU,
    TUBES_SPEC,
  ],
  ['V10 wgsl: a disc on a cell of a wall', TUBES_WGSL, 'if (here < WALL_BYTE) {', 'if (true) {', GPU, TUBES_SPEC],
  [
    'V11 wgsl: no plasmodium without a tube',
    TUBES_WGSL,
    'textureStore(pictureOut, p, max(SHEET * textureLoad(trail, p, 0), tube));',
    'textureStore(pictureOut, p, tube);',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V12 wgsl: the mean trail without the largest weight',
    TUBES_WGSL,
    'let tube = top * lit / max(sum, vec4f(1e-20));',
    'let tube = lit / max(sum, vec4f(1e-20));',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V13 wgsl: the largest value of the discs, not the mean of their trails',
    TUBES_WGSL,
    'lit += textureLoad(trail, q, 0) * weight;',
    'lit = max(lit, textureLoad(trail, q, 0) * weight); sum = top;',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V14 wgsl: a weight without the factor of the radius',
    TUBES_WGSL,
    'let weight = root * clamp(',
    'let weight = clamp(',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V15 wgsl: the edge of a disc twice as wide',
    TUBES_WGSL,
    '- d) / EDGE, vec4f(0.0), vec4f(1.0));',
    '- d) / (2.0 * EDGE), vec4f(0.0), vec4f(1.0));',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V16 wgsl: a picture outside the arena',
    TUBES_WGSL,
    'if (cellXY(p).x < 0) {\n    textureStore(pictureOut, p, vec4f(0.0));',
    'if (false) {\n    textureStore(pictureOut, p, vec4f(0.0));',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V17 glsl: the square root of the strength, not the fourth root',
    TUBES_FRAG,
    'result = sqrt(sqrt(a));',
    'result = sqrt(a);',
    GL,
    TUBES_SPEC,
  ],
  [
    'V18 glsl: the strength of a cell without a body in the sum',
    TUBES_FRAG,
    'if (m.y >= BODY_LOW) sum += m.x * m.y;',
    'if (m.y >= 0.0) sum += m.x * m.y;',
    GL,
    TUBES_SPEC,
  ],
  [
    'V19 glsl: the flow memory without the body',
    TUBES_FRAG,
    'if (m.y >= BODY_LOW) sum += m.x * m.y;',
    'if (m.y >= BODY_LOW) sum += m.x;',
    GL,
    TUBES_SPEC,
  ],
  [
    'V20 glsl: the sum of the 3 × 3 cells over one cell of length',
    TUBES_FRAG,
    'return min(sum / SPAN, 1.0);',
    'return min(sum, 1.0);',
    GL,
    TUBES_SPEC,
  ],
  ['V21 glsl: a strength above 1', TUBES_FRAG, 'return min(sum / SPAN, 1.0);', 'return sum / SPAN;', GL, TUBES_SPEC],
  [
    'V22 glsl: the tubes of the second strain from the memory of the first strain',
    TUBES_FRAG,
    'if (strains > 1) a.y = across(flowMemory1, p);',
    'if (strains > 1) a.y = across(flowMemory, p);',
    GL,
    TUBES_SPEC,
  ],
  [
    'V23 glsl: a tube of a strain that the scene does not hold',
    TUBES_FRAG,
    'if (strains > 2) a.z = across(flowMemory2, p);',
    'a.z = across(flowMemory2, p);',
    GL,
    TUBES_SPEC,
  ],
  [
    'V24 glsl: a disc on a cell without a tube',
    TUBES_FRAG,
    'if (texelFetch(memory, p, 0).y < BODY_LOW) return 0.0;',
    'if (texelFetch(memory, p, 0).y < -1.0) return 0.0;',
    GL,
    TUBES_SPEC,
  ],
  [
    'V25 glsl: a disc passes a wall',
    TUBES_FRAG,
    'if (isWall(there) || clearOf(here) + clearOf(there) <= d) continue;',
    'if (isWall(there)) continue;',
    GL,
    TUBES_SPEC,
  ],
  [
    'V26 glsl: the wall distance of a byte without the half step',
    TUBES_FRAG,
    'float clearOf(vec4 s) { return max(0.0, (1.0 - 2.0 * s.r - 1.0 / 255.0) * SHAPE_RANGE); }',
    'float clearOf(vec4 s) { return max(0.0, (1.0 - 2.0 * s.r) * SHAPE_RANGE); }',
    GL,
    TUBES_SPEC,
  ],
  ['V27 glsl: a disc on a cell of a wall', TUBES_FRAG, 'if (!isWall(here)) {', 'if (true) {', GL, TUBES_SPEC],
  [
    'V28 glsl: no plasmodium without a tube',
    TUBES_FRAG,
    'result = max(SHEET * texelFetch(trail, p, 0), tube);',
    'result = tube;',
    GL,
    TUBES_SPEC,
  ],
  [
    'V29 glsl: the mean trail without the largest weight',
    TUBES_FRAG,
    'vec4 tube = top * lit / max(sum, vec4(1e-20));',
    'vec4 tube = lit / max(sum, vec4(1e-20));',
    GL,
    TUBES_SPEC,
  ],
  [
    'V30 glsl: the largest value of the discs, not the mean of their trails',
    TUBES_FRAG,
    'lit += texelFetch(trail, q, 0) * weight;',
    'lit = max(lit, texelFetch(trail, q, 0) * weight); sum = top;',
    GL,
    TUBES_SPEC,
  ],
  [
    'V31 glsl: a weight without the factor of the radius',
    TUBES_FRAG,
    'vec4 weight = root * clamp(',
    'vec4 weight = clamp(',
    GL,
    TUBES_SPEC,
  ],
  [
    'V32 glsl: the edge of a disc twice as wide',
    TUBES_FRAG,
    '- d) / EDGE, 0.0, 1.0);',
    '- d) / (2.0 * EDGE), 0.0, 1.0);',
    GL,
    TUBES_SPEC,
  ],
  [
    'V33 glsl: a picture outside the arena',
    TUBES_FRAG,
    'if (cellXY(p).x < 0) {\n    result = vec4(0.0);\n    return;\n  }\n  float reach',
    'if (false) {\n    result = vec4(0.0);\n    return;\n  }\n  float reach',
    GL,
    TUBES_SPEC,
  ],
  [
    'V34 webgpu: the picture does not follow a new memory of the flow',
    'src/engine/sim.ts',
    '    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.\n    this.changed();\n    this.revision++;',
    '    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.\n    this.revision++;',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V35 webgpu: a new memory of the flow is no change for the maps of a frame',
    'src/engine/sim.ts',
    '    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.\n    this.changed();\n    this.revision++;',
    '    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.\n    this.changed();',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V36 webgpu: the picture from the trail before the diffusion of a step that moves first',
    'src/engine/sim.ts',
    '    const trail = this.viewTexture;\n    this.writeParams();\n    const tubes = this.ensureTubes();',
    '    const trail = this.trail[this.parity];\n    this.writeParams();\n    const tubes = this.ensureTubes();',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V37 webgpu: the picture with its switch off',
    'src/engine/sim.ts',
    'if (!tubesShown(this.settings) || !this.flow) return this.viewTexture;\n    if (this.tubesStale || !this.tubes) return this.encodeTubes(this.flow).picture;',
    'if (!this.flow) return this.viewTexture;\n    if (this.tubesStale || !this.tubes) return this.encodeTubes(this.flow).picture;',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V38 webgpu: the picture with the wall distances of another boundary',
    'src/engine/sim.ts',
    '  private encodeTubes(flow: FlowState): TubeState {\n    this.syncShape();',
    '  private encodeTubes(flow: FlowState): TubeState {',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V39 webgpu: the bind groups of the picture outlive the third pair of the view',
    'src/engine/sim.ts',
    "      for (const key of [...this.bindCache.keys()]) if (key.startsWith('view')) this.bindCache.delete(key);\n      this.forgetTubes();",
    "      for (const key of [...this.bindCache.keys()]) if (key.startsWith('view')) this.bindCache.delete(key);",
    GPU,
    TUBES_SPEC,
  ],
  [
    'V40 webgpu: the bind groups of the picture outlive the state of the flow',
    'src/engine/sim.ts',
    "    for (const key of [...this.bindCache.keys()]) if (key.includes('flow')) this.bindCache.delete(key);\n    this.forgetTubes();",
    "    for (const key of [...this.bindCache.keys()]) if (key.includes('flow')) this.bindCache.delete(key);",
    GPU,
    TUBES_SPEC,
  ],
  [
    'V41 webgpu: the strand of the scent view from the picture',
    'src/engine/webgpu.ts',
    'await this.auto.measure(() => [sim.pictureTexture, sim.viewTexture]);',
    'await this.auto.measure(() => [sim.pictureTexture, sim.pictureTexture]);',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V42 webgpu: the levels from the trail without the tubes',
    'src/engine/webgpu.ts',
    'await this.auto.measure(() => [sim.pictureTexture, sim.viewTexture]);',
    'await this.auto.measure(() => [sim.viewTexture, sim.viewTexture]);',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V43 webgpu: a measurement that waits keeps the textures of before its wait',
    'src/engine/webgpu.ts',
    'await this.auto.measure(() => [sim.pictureTexture, sim.viewTexture]);',
    'const early: [GPUTexture, GPUTexture] = [sim.pictureTexture, sim.viewTexture];\n    await this.auto.measure(() => early);',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V44 webgpu: a frame draws the trail of the view',
    'src/engine/render.ts',
    '    const trail = sim.pictureTexture;',
    '    const trail = sim.viewTexture;',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V45 webgpu: the glow of a frame from the trail of the view',
    'src/engine/webgpu.ts',
    '    const trail = sim.pictureTexture;\n    const agents',
    '    const trail = sim.viewTexture;\n    const agents',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V46 webgpu: a frame keeps the scent of the frame that built its bind group',
    'src/engine/render.ts',
    '    let byOcc = byScent.get(scent);\n    if (!byOcc) {\n      byOcc = new Map();\n      byScent.set(scent, byOcc);',
    '    let byOcc = byScent.get(trail);\n    if (!byOcc) {\n      byOcc = new Map();\n      byScent.set(trail, byOcc);',
    GPU,
    TUBES_SPEC,
  ],
  [
    'V47 webgl2: the picture does not follow a new memory of the flow',
    'src/engine/gl/sim.ts',
    '    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.\n    this.changed();\n    this.revision++;',
    '    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.\n    this.revision++;',
    GL,
    TUBES_SPEC,
  ],
  [
    'V48 webgl2: a new memory of the flow is no change for the maps of a frame',
    'src/engine/gl/sim.ts',
    '    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.\n    this.changed();\n    this.revision++;',
    '    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.\n    this.changed();',
    GL,
    TUBES_SPEC,
  ],
  [
    'V49 webgl2: the picture from the trail before the diffusion of a step that moves first',
    'src/engine/gl/sim.ts',
    '    const trail = this.viewTrail().texture;\n    this.writeParams();\n    const tubes = this.ensureTubes();',
    '    const trail = this.currentTrail.texture;\n    this.writeParams();\n    const tubes = this.ensureTubes();',
    GL,
    TUBES_SPEC,
  ],
  [
    'V50 webgl2: the picture with its switch off',
    'src/engine/gl/sim.ts',
    'if (!tubesShown(this.settings) || !this.flow) return this.viewTrail();\n    if (this.tubesStale || !this.tubes) return this.encodeTubes(this.flow).picture;',
    'if (!this.flow) return this.viewTrail();\n    if (this.tubesStale || !this.tubes) return this.encodeTubes(this.flow).picture;',
    GL,
    TUBES_SPEC,
  ],
  [
    'V51 webgl2: the picture with the wall distances of another boundary',
    'src/engine/gl/sim.ts',
    "  private encodeTubes(flow: NonNullable<GlSim['flow']>) {\n    this.syncShape();",
    "  private encodeTubes(flow: NonNullable<GlSim['flow']>) {",
    GL,
    TUBES_SPEC,
  ],
  [
    'V52 webgl2: the strand of the scent view from the picture',
    'src/engine/gl/backend.ts',
    'const [drawn, model] = [sim.pictureTarget().texture, sim.viewTargets().trail.texture];',
    'const [drawn, model] = [sim.pictureTarget().texture, sim.pictureTarget().texture];',
    GL,
    TUBES_SPEC,
  ],
  [
    'V53 webgl2: the levels from the trail without the tubes',
    'src/engine/gl/backend.ts',
    'const [drawn, model] = [sim.pictureTarget().texture, sim.viewTargets().trail.texture];',
    'const [drawn, model] = [sim.viewTargets().trail.texture, sim.viewTargets().trail.texture];',
    GL,
    TUBES_SPEC,
  ],
  [
    'V54 webgl2: a frame and its glow from the trail of the view',
    'src/engine/gl/backend.ts',
    '    const trail = sim.pictureTarget().texture;',
    '    const trail = sim.viewTargets().trail.texture;',
    GL,
    TUBES_SPEC,
  ],
  [
    'V55 both: the picture in the style that draws the agents',
    'src/engine/tubes.ts',
    "s.showTubes && flowOn(s) && s.style !== 'agents';",
    's.showTubes && flowOn(s);',
    `${GPU}|${GL}`,
    TUBES_SPEC,
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
for (const [name, file, right, wrong, tests, spec = FLOW_SPEC] of MUTATIONS) {
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
      const run = spawnSync('npx', ['vitest', 'run', '--project', 'gpu', spec, '-t', tests], {
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
