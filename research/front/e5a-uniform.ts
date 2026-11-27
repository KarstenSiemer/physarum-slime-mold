// Part E5a of stage 4 (ADR 0086, decision 4): the flow over 8 neighbours as a branch on a uniform, U.g.w, in place of
// the variant EIGHT, for the time of a step of that form with 4 neighbours only. It rewrites flow.wgsl and flow.frag of
// a copy of the code (research/front/e5a-times.sh makes it), never those of the app. Prototype code.
// Usage: node research/front/e5a-uniform.ts <copy>/src/engine/shaders/flow.wgsl <copy>/src/engine/gl/glsl/flow.frag
import { readFileSync, writeFileSync } from 'node:fs';

const [wgslPath, fragPath] = process.argv.slice(2);
if (!wgslPath || !fragPath) throw new Error('usage: e5a-uniform.ts <flow.wgsl> <flow.frag>');

/** `text` with `from` in place of `to`, once. */
function swap(text: string, from: string, to: string): string {
  if (text.split(from).length !== 2) throw new Error(`not once: ${from.slice(0, 90)}`);
  return text.replace(from, to);
}

/** `text` with the lines from the first line that starts with `start` to the end of the block `//#endif` (or `#endif`)
 *  after `last`, in place of `to`. */
function block(text: string, start: string, last: string, end: string, to: string): string {
  const from = text.indexOf(start);
  if (from < 0) throw new Error(`no block: ${start.slice(0, 90)}`);
  const stop = text.indexOf(end, text.indexOf(last, from)) + end.length;
  return text.slice(0, from) + to + text.slice(stop);
}

/** The pressure of the uniform form: the diagonal edges and the weighted sum only while U.g.w is not 0. */
const pressure = (wgsl: boolean) => {
  const [v2, f, ifEight] = wgsl ? ['vec2i', 'var', 'if (eight) {'] : ['ivec2', '', 'if (eight) {'];
  const declare = (type: string, name: string, value: string) =>
    wgsl ? `  var ${name} = ${value};\n` : `  ${type} ${name} = ${value};\n`;
  return (
    (wgsl ? '  let eight = U.g.w != 0.0;\n' : '  bool eight = U.g.w != 0.0;\n') +
    ['qse', 'qnw', 'qsw', 'qne'].map((n) => declare(v2, n, `${v2}(-1)`)).join('') +
    ['ese', 'enw', 'esw', 'ene'].map((n) => declare('float', n, '0.0')).join('') +
    (wgsl ? `  ${f} sum = ee + ew + es + en;\n` : '  float sum = ee + ew + es + en;\n') +
    `  ${ifEight}\n` +
    `    qse = diagonalXY(p, ${v2}(1, 1), qe, qs);\n` +
    `    qnw = diagonalXY(p, ${v2}(-1, -1), qw, qn);\n` +
    `    qsw = diagonalXY(p, ${v2}(-1, 1), qw, qs);\n` +
    `    qne = diagonalXY(p, ${v2}(1, -1), qe, qn);\n` +
    '    ese = ghostEdge(m.z, qse);\n' +
    '    enw = ghostEdge(m.z, qnw);\n' +
    '    esw = ghostEdge(m.z, qsw);\n' +
    '    ene = ghostEdge(m.z, qne);\n' +
    '    sum = AXIS * sum + DIAG * (ese + enw + esw + ene);\n' +
    '  }\n'
  );
};

let w = readFileSync(wgslPath, 'utf8');
// The helpers of EIGHT stay in the source.
w = swap(w, '}\n//#if EIGHT\n\n// The flow over 8 neighbours', '}\n\n// The flow over 8 neighbours');
w = swap(
  w,
  '  return abs(e * (pc - textureLoad(pressureIn, q, 0)));\n}\n//#endif\n',
  '  return abs(e * (pc - textureLoad(pressureIn, q, 0)));\n}\n',
);
w = block(
  w,
  '//#if EIGHT\n  // Over 8 edges (ADR 0086): the 4 axis edges with the weight AXIS, the 4 diagonal edges with DIAG.\n',
  'flux = AXIS * flux + DIAG * across;\n',
  '//#endif\n',
  '  if (U.g.w != 0.0) {\n' +
    '    let across = diagonalFlux(m.z, pc, diagonalXY(p, vec2i(1, 1), qe, qs))\n' +
    '      + diagonalFlux(m.z, pc, diagonalXY(p, vec2i(-1, -1), qw, qn))\n' +
    '      + diagonalFlux(m.z, pc, diagonalXY(p, vec2i(-1, 1), qw, qs))\n' +
    '      + diagonalFlux(m.z, pc, diagonalXY(p, vec2i(1, -1), qe, qn));\n' +
    '    flux = AXIS * flux + DIAG * across;\n' +
    '  }\n',
);
w = block(
  w,
  '//#if EIGHT\n  // Over 8 edges (ADR 0086): the 4 axis edges with the weight AXIS, the 4 diagonal edges with DIAG, each',
  '  let sum = ee + ew + es + en;\n',
  '//#endif\n',
  pressure(true),
);
w = block(
  w,
  '//#if EIGHT\n    var across = vec4f(0.0);\n',
  '    acc = AXIS * acc + DIAG * across;\n',
  '//#endif\n',
  '    if (eight) {\n' +
    '      var across = vec4f(0.0);\n' +
    '      if (ese > 0.0) { across += ese * textureLoad(pressureIn, qse, 0); }\n' +
    '      if (enw > 0.0) { across += enw * textureLoad(pressureIn, qnw, 0); }\n' +
    '      if (esw > 0.0) { across += esw * textureLoad(pressureIn, qsw, 0); }\n' +
    '      if (ene > 0.0) { across += ene * textureLoad(pressureIn, qne, 0); }\n' +
    '      acc = AXIS * acc + DIAG * across;\n' +
    '    }\n',
);
if (/^\s*\/\/#(if|else) EIGHT/m.test(w)) throw new Error('a block of EIGHT is left in flow.wgsl');
writeFileSync(wgslPath, w);

let g = readFileSync(fragPath, 'utf8');
g = swap(g, '#if EIGHT && PASS < 2\n', '#if PASS < 2\n');
g = swap(
  g,
  '#if EIGHT\n\n// The size of the flux per lane over the diagonal edge',
  '\n// The size of the flux per lane over the diagonal edge',
);
g = swap(
  g,
  '  return abs(e * (pc - texelFetch(pressureIn, q, 0)));\n}\n#endif\n',
  '  return abs(e * (pc - texelFetch(pressureIn, q, 0)));\n}\n',
);
g = block(
  g,
  '#if EIGHT\n  // Over 8 edges (ADR 0086): the 4 axis edges with the weight AXIS, the 4 diagonal edges with DIAG (update',
  'flux = AXIS * flux + DIAG * across;\n',
  '#endif\n',
  '  if (U.g.w != 0.0) {\n' +
    '    vec4 across = diagonalFlux(m.z, pc, diagonalXY(p, ivec2(1, 1), qe, qs))\n' +
    '      + diagonalFlux(m.z, pc, diagonalXY(p, ivec2(-1, -1), qw, qn))\n' +
    '      + diagonalFlux(m.z, pc, diagonalXY(p, ivec2(-1, 1), qw, qs))\n' +
    '      + diagonalFlux(m.z, pc, diagonalXY(p, ivec2(1, -1), qe, qn));\n' +
    '    flux = AXIS * flux + DIAG * across;\n' +
    '  }\n',
);
g = block(
  g,
  '#if EIGHT\n  // Over 8 edges (ADR 0086): the axis edges with the weight AXIS, the diagonal edges with DIAG, each',
  '  float sum = ee + ew + es + en;\n',
  '#endif\n',
  pressure(false),
);
g = block(
  g,
  '#if EIGHT\n    vec4 across = vec4(0.0);\n',
  '    acc = AXIS * acc + DIAG * across;\n',
  '#endif\n',
  '    if (eight) {\n' +
    '      vec4 across = vec4(0.0);\n' +
    '      if (ese > 0.0) across += ese * texelFetch(pressureIn, qse, 0);\n' +
    '      if (enw > 0.0) across += enw * texelFetch(pressureIn, qnw, 0);\n' +
    '      if (esw > 0.0) across += esw * texelFetch(pressureIn, qsw, 0);\n' +
    '      if (ene > 0.0) across += ene * texelFetch(pressureIn, qne, 0);\n' +
    '      acc = AXIS * acc + DIAG * across;\n' +
    '    }\n',
);
if (/^#(if|elif) EIGHT/m.test(g)) throw new Error('a block of EIGHT is left in flow.frag');
writeFileSync(fragPath, g);
console.log('the uniform branch is in', wgslPath, 'and', fragPath);
