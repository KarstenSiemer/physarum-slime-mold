// Other rules for the births of a colony with the flow, for the measurements of ADR 0053. The script puts one of them
// into the WGSL passes of the app, runs a command, and puts the files back as they were. WebGPU only: the GLSL passes
// stay as they are, so a run on WebGL2 has the rule of the app. No variant is a rule of the app.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/variant.ts <name> <command ...>
// With the name `check` it only checks that every text that a variant replaces is once in its file.
//
// - parent: the rule before ADR 0053. No agent divides on a starved cell; a child is born onto any free neighbour.
// - child: the cell of the child alone decides. An agent on a starved cell divides onto a neighbour that is not starved.
// - left: also no birth onto ground that a starved tube left and that is not fresh again: a cell without a tube body
//   and with a flow memory below that of fresh ground.
// - weight: the plan of stage 2 of `TODO.md` with the mark of starved ground in the place of the slime. Such ground
//   has the weight 0.025 in the pick of the neighbour, and the pick is as before when every free neighbour has it.
// - floor: a starved tube that vanishes leaves its ground at the floor of the flow memory. This changes the rule of
//   the flow memory (flow.wgsl), and the rule of the births stays that of the app.
// - left+floor: both.
// - parent+floor: `floor` with the rule of the births of before ADR 0053. It says whether the rule of ADR 0053 is a
//   part of what `floor` does.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GROWTH = 'src/engine/shaders/growth.wgsl';
const FLOW = 'src/engine/shaders/flow.wgsl';

/** A change of a file: the text of the app, and the text of the variant. */
type Edit = [file: string, app: string, variant: string];

const PARENT = '  if (starved(s, q)) { return -1; }\n';
const CHILD = '      if (starved(s, cellCoord(u32(m)))) { continue; }\n';
const STREAMS = '// Random streams of their own';
/** left(): ground that a starved tube left and that is not fresh again. */
const LEFT: Edit = [
  GROWTH,
  STREAMS,
  `//#if FLOW
fn left(s: u32, q: vec2i) -> bool {
  let m = textureLoad(flowMemory, q, s, 0);
  return m.y < F.c.z && m.x < F.c.w;
}
//#endif
${STREAMS}`,
];
const NO_BIRTH_ON_LEFT: Edit = [
  GROWTH,
  CHILD,
  '      if (starved(s, cellCoord(u32(m))) || left(s, cellCoord(u32(m)))) { continue; }\n',
];
const TO_THE_FLOOR: Edit = [
  FLOW,
  '  let body = m.y + U.c.y * (presence - m.y);\n',
  '  let body = m.y + U.c.y * (presence - m.y);\n  if (m.y >= U.c.z && body < U.c.z && d * d < U.e.y) { d = U.d.x; }\n',
];
const PICK = `  var rng = rngSeed(agentId(a), GROW);
  var pick = min(u32(rand(&rng) * f32(free)), free - 1u);
  for (var k = 0u; k < 8u; k++) {
    if ((open & (1u << k)) != 0u) {
      if (pick == 0u) {
        let m = cellAt(q + around(k));
        return select(m, -1, lightStops(a, m));
      }
      pick--;
    }
  }
  return -1;`;
const WEIGHTED_PICK = `  var total = 0.0;
  for (var k = 0u; k < 8u; k++) {
    if ((open & (1u << k)) != 0u) { total += select(1.0, 0.025, left(s, cellCoord(u32(cellAt(q + around(k)))))); }
  }
  var rng = rngSeed(agentId(a), GROW);
  var rest = rand(&rng) * total;
  var last = -1;
  for (var k = 0u; k < 8u; k++) {
    if ((open & (1u << k)) != 0u) {
      let m = cellAt(q + around(k));
      last = m;
      rest -= select(1.0, 0.025, left(s, cellCoord(u32(m))));
      if (rest < 0.0) { return select(m, -1, lightStops(a, m)); }
    }
  }
  if (last < 0) { return -1; }
  return select(last, -1, lightStops(a, last));`;

const VARIANTS: Record<string, Edit[]> = {
  parent: [[GROWTH, CHILD, '']],
  child: [[GROWTH, PARENT, '']],
  left: [NO_BIRTH_ON_LEFT, LEFT],
  weight: [LEFT, [GROWTH, PICK, WEIGHTED_PICK]],
  floor: [TO_THE_FLOOR],
  'left+floor': [NO_BIRTH_ON_LEFT, LEFT, TO_THE_FLOOR],
  'parent+floor': [[GROWTH, CHILD, ''], TO_THE_FLOOR],
};

const [name = '', ...command] = process.argv.slice(2);
const read = (file: string) => readFileSync(ROOT + file, 'utf8');
if (name === 'check') {
  const stale = Object.entries(VARIANTS).flatMap(([variant, edits]) =>
    edits.filter(([file, app]) => read(file).split(app).length !== 2).map(([file]) => `${variant}: ${file}`),
  );
  for (const line of stale) console.error(`${line}: the text of the app is not once in the file`);
  console.log(`${String(Object.keys(VARIANTS).length)} variants, ${String(stale.length)} texts that do not fit`);
  process.exit(stale.length > 0 ? 1 : 0);
}
const edits = VARIANTS[name];
if (!edits || command.length === 0) {
  console.error(`usage: variant.ts <${Object.keys(VARIANTS).join('|')}|check> <command ...>`);
  process.exit(1);
}
/** The files as the app has them: written back on every way out of the script. */
const saved = new Map<string, string>();
const restore = () => {
  for (const [file, text] of saved) writeFileSync(ROOT + file, text);
  saved.clear();
};
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});
/** Runs the command with the variant in the files, and gives its exit status. */
function run(list: Edit[]): number {
  try {
    for (const [file] of list) if (!saved.has(file)) saved.set(file, read(file));
    for (const [file, app, variant] of list) {
      const text = read(file);
      if (text.split(app).length !== 2) throw new Error(`${name}: the text of the app is not once in ${file}`);
      writeFileSync(ROOT + file, text.replace(app, variant));
    }
    const [program = '', ...args] = command;
    return spawnSync(program, args, { cwd: ROOT, stdio: 'inherit', env: process.env }).status ?? 1;
  } finally {
    restore();
  }
}
process.exit(run(edits));
