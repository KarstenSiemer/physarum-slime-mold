// Other rules for a colony with the flow, for the measurements of ADR 0053 and ADR 0054. The script puts one of them
// into the WGSL passes of the app, runs a command, and puts the files back as they were. WebGPU only: the GLSL passes
// stay as they are, so a run on WebGL2 has the rule of the app. No variant is a rule of the app.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/variant.ts <name> <command ...>
// With the name `check` it only checks that every text that a variant replaces is once in its file.
//
// The births (growth.wgsl):
// - parent: the rule before ADR 0053. No agent divides on a starved cell; a child is born onto any free neighbour.
// - child: the cell of the child alone decides. An agent on a starved cell divides onto a neighbour that is not starved.
// - left: also no birth onto ground that a starved tube left and that is not fresh again: a cell without a tube body
//   and with a flow memory below that of fresh ground.
// - weight: the plan of stage 2 of `TODO.md` with the mark of starved ground in the place of the slime. Such ground
//   has the weight 0.025 in the pick of the neighbour, and the pick is as before when every free neighbour has it.
//
// The mark of starved ground (flow.wgsl):
// - leaky: the mark before ADR 0054. A starved tube that vanishes keeps its flow memory, so each cell of its ground
//   holds a mark of its own depth. With `VITE_RECOVER=0.00023` of dump.gpu.test.ts, the time of the mark before ADR
//   0054, a run is the app of ADR 0053.
// - mark: also a tube that is not starved yet leaves its ground at the floor, when its flow memory is below that of
//   fresh ground.
//
// The records of ADR 0053 name more variants: `floor`, `left+floor` and `parent+floor`. `floor` is the rule of the app
// since ADR 0054, so they are the app, `left` and `parent` now; `variant.ts` of the commit `02c3772` has them as they ran.
//
// The avoidance of slime in the births, for the Y-maze of stage 2b (ADR 0056; y-maze.gpu.test.ts). These variants read
// the slime field in `divideInto()` of growth.wgsl. The growth passes do not hold the field, so each of them also binds
// it in src/engine/sim.ts, and asks for 9 storage buffers in a pass in src/engine/gpu.ts: the pass `win` holds 8, the
// most that every device has. A cell has slime for a variant as for the picture: a stamp that is younger than the
// Slime life time (slime.ts).
// - slime-bind: the growth passes read the field and change nothing. A run must give the bytes of the app.
// - slime-weight: a free neighbour with slime has the weight 0.025 in the pick. The pick is as before when every free
//   neighbour has slime. The slime of the colony itself counts: a cell that held plasm in the step before has slime.
// - slime-old-A: the same, only for slime older than A steps (slime-old-300, slime-old-3000).
// - slime-wall-A: a free neighbour with slime older than A steps is not open while another free neighbour is.
// - slime-ban-A: no child is born onto slime older than A steps at all. It shows what the moves alone do.
//
// The avoidance of slime in the moves, a variant of the measurement of ADR 0056 itself, for the question which rule is
// missing when no rule of the births reaches the targets:
// - slime-sense-A-P: a sensor of an agent reads P less on a cell with slime older than A steps (`sense()` of
//   agents.wgsl): slime-sense-300-10. Three sensors on such slime read the same, so the agent turns as before. The
//   pass `claim` binds the field.
// - slime-stay-A: an agent moves onto a cell with slime older than A steps with the chance 0.025 only. Else it stays
//   and turns to a random heading, as an agent whose move is blocked does. slime-stay-A-C: with the chance C.
//
// - births: for a measurement, no rule. The growth pass `win` writes, beside each birth, the free neighbours of the
//   parent and the neighbour that it picked (y-maze.gpu.test.ts with VITE_BIRTHS=1 reads them). On a box or a dish.
//
// Two variants run together with a `+` between their names, the edits of the first one first: births+slime-wall-300.
// The command gets the name of the variant as VITE_VARIANT.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GROWTH = 'src/engine/shaders/growth.wgsl';
const FLOW = 'src/engine/shaders/flow.wgsl';
const AGENTS = 'src/engine/shaders/agents.wgsl';
const SIM = 'src/engine/sim.ts';
const GPU = 'src/engine/gpu.ts';

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
/** The mark of the app (ADR 0054): a starved tube that vanishes leaves its ground at the floor. */
const FLOOR = '  if (m.y >= U.c.z && body < U.c.z && d * d < U.e.y) { d = U.d.x; }\n';
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
/** The pick with the weight 0.025 for a free neighbour `m` for which `marked(m)` holds, a WGSL expression. */
const weightedPick = (marked: (m: string) => string) => `  var total = 0.0;
  for (var k = 0u; k < 8u; k++) {
    if ((open & (1u << k)) != 0u) { total += select(1.0, 0.025, ${marked('cellAt(q + around(k))')}); }
  }
  var rng = rngSeed(agentId(a), GROW);
  var rest = rand(&rng) * total;
  var last = -1;
  for (var k = 0u; k < 8u; k++) {
    if ((open & (1u << k)) != 0u) {
      let m = cellAt(q + around(k));
      last = m;
      rest -= select(1.0, 0.025, ${marked('m')});
      if (rest < 0.0) { return select(m, -1, lightStops(a, m)); }
    }
  }
  if (last < 0) { return -1; }
  return select(last, -1, lightStops(a, last));`;
const WEIGHTED_PICK = weightedPick((m) => `left(s, cellCoord(u32(${m})))`);

const FLOW_RULE = '@group(0) @binding(16) var<uniform> F: FlowRule;\n';
const FREE = '  let free = countOneBits(open);\n';
/**
 * The slime field in a pass at `binding`, with slimed(m): whether cell m has slime older than `age` steps; with −1 any
 * slime counts.
 */
const slimeWgsl = (binding: number, age: number) => `
// The slime field (slime.wgsl): the stamp of every cell, the step in which it last held plasm, plus 1.
@group(0) @binding(${String(binding)}) var<storage, read> stamps: array<u32>;

// The age of the slime of cell m in steps, or −1 for a cell without slime: no stamp, or one as old as the life time.
fn slimeAge(m: i32) -> i32 {
  let held = stamps[m];
  if (held == 0u) { return -1; }
  let age = P.grid.w + 1u - held;
  return select(i32(age), -1, age >= P.slime.x);
}

// Whether cell m has the slime that the variant avoids.
fn slimed(m: i32) -> bool { return slimeAge(m) > ${String(age)}; }
`;
/**
 * The slime field in the growth passes `test` and `win`, which decide who divides: the binding in growth.wgsl, the
 * buffer in their bind groups, and 9 storage buffers in a pass.
 */
const slimeField = (age: number): Edit[] => [
  [GROWTH, FLOW_RULE, `${FLOW_RULE}${slimeWgsl(17, age)}`],
  [SIM, '  test: [15, 16],\n  win: [15, 16],\n', '  test: [15, 16, 17],\n  win: [15, 16, 17],\n'],
  [
    SIM,
    'return [...resources, extra, flowMemory, flowUniform].map(',
    'return [...resources, extra, flowMemory, flowUniform, this.ensureSlime()].map(',
  ],
  [
    GPU,
    '      maxBufferSize: cap(adapter.limits.maxBufferSize),\n',
    '      maxBufferSize: cap(adapter.limits.maxBufferSize),\n      maxStorageBuffersPerShaderStage: 9,\n',
  ],
];
const SLIME_BIND: Edit = [GROWTH, FREE, `  _ = slimed(c);\n${FREE}`];
const SLIME_PICK: Edit = [GROWTH, PICK, weightedPick((m) => `slimed(${m})`)];
const SLIME_WALL: Edit = [
  GROWTH,
  FREE,
  `  var blank = 0u;
  for (var k = 0u; k < 8u; k++) {
    if ((open & (1u << k)) != 0u && !slimed(cellAt(q + around(k)))) { blank |= 1u << k; }
  }
  if (blank != 0u) { open = blank; }
${FREE}`,
];
const STEERING = '// Separate random streams, so a tool or shrinkage never shifts the steering draws.\n';
const SENSED = '  return dot(t, P.attraction[s]) + P.food[s] * sc.x - P.light[s] * sc.y;\n';
const CLAIM_GROUP =
  '          col.claims,\n          null,\n          null,\n          this.clearance,\n          flowMemory,\n          flowUniform,\n';
/**
 * The slime field in the pass `claim`, whose sensors read `penalty` less on slime older than `age` steps. The field
 * stands outside the lines of the flow: the start builds the agent passes without the flow too.
 */
const slimeSense = (age: number, penalty: number): Edit[] => [
  [AGENTS, STEERING, `${slimeWgsl(14, age)}\n${STEERING}`],
  [AGENTS, SENSED, `${SENSED.slice(0, -2)} - select(0.0, ${penalty.toFixed(3)}, slimed(c));\n`],
  [SIM, CLAIM_GROUP, `${CLAIM_GROUP}          this.ensureSlime(),\n`],
];
const CLAIMED = '    if (canClaim(a, c, clear)) { atomicMax(&claims[c], key(id)); }\n';
/** The slime field in the pass `claim`, where an agent claims a cell with slime older than `age` steps seldom. */
const slimeStay = (age: number, chance: number): Edit[] => [
  [AGENTS, STEERING, `${slimeWgsl(14, age)}\n${STEERING}`],
  [
    AGENTS,
    CLAIMED,
    `    if (canClaim(a, c, clear) && (!slimed(c) || rand(&rng) < ${String(chance)})) { atomicMax(&claims[c], key(id)); }\n`,
  ],
  [SIM, CLAIM_GROUP, `${CLAIM_GROUP}          this.ensureSlime(),\n`],
];
const SLIME_BAN: Edit = [GROWTH, CHILD, `${CHILD}      if (slimed(m)) { continue; }\n`];
const SLIME_RULES: Record<string, Edit> = { old: SLIME_PICK, wall: SLIME_WALL, ban: SLIME_BAN };
/** The variants of the slime with numbers in their name: slime-old-300, slime-wall-3000, slime-sense-300-10. */
function slimeVariant(name: string): Edit[] | undefined {
  const [, rule, age] = /^slime-(old|wall|ban)-(\d+)$/.exec(name) ?? [];
  const edit = SLIME_RULES[rule ?? ''];
  if (edit) return [...slimeField(Number(age)), edit];
  const [, stay, chance = '0.025'] = /^slime-stay-(\d+)(?:-(0\.\d+))?$/.exec(name) ?? [];
  if (stay) return slimeStay(Number(stay), Number(chance));
  const [, old, penalty] = /^slime-sense-(\d+)-(\d+(?:\.\d+)?)$/.exec(name) ?? [];
  return old ? slimeSense(Number(old), Number(penalty)) : undefined;
}

/** The free neighbours of a parent beside its birth: bits 3 to 5 the neighbour that it picked, bits 6 to 13 the free ones. */
const DIAGONALS = '    if ((walls & beside) == beside) { open &= ~(1u << k); }\n  }\n';
const BIRTH = 'births[place(u32(t))] = vec2u((a.bits & 3u) + 1u, u32(t));';
const LANES = 'vec4u(vec4u(b.x) == vec4u(1u, 2u, 3u, 4u))';
const BIRTHS: Edit[] = [
  [
    GROWTH,
    STREAMS,
    `// The free neighbours of the agent of this invocation, as divideInto() found them.\nvar<private> freeAround: u32;\n${STREAMS}`,
  ],
  [GROWTH, DIAGONALS, `${DIAGONALS}  freeAround = open;\n`],
  [
    GROWTH,
    BIRTH,
    `let picked = aroundIndex(cellCoord(u32(t)) - cellCoord(u32(c)));
    births[place(u32(t))] = vec2u((a.bits & 3u) + 1u + (picked << 3u) + (freeAround << 6u), u32(t));`,
  ],
  [GROWTH, LANES, 'vec4u(vec4u(b.x & 7u) == vec4u(1u, 2u, 3u, 4u))'],
];

const VARIANTS: Record<string, Edit[]> = {
  parent: [[GROWTH, CHILD, '']],
  child: [[GROWTH, PARENT, '']],
  left: [NO_BIRTH_ON_LEFT, LEFT],
  weight: [LEFT, [GROWTH, PICK, WEIGHTED_PICK]],
  leaky: [[FLOW, FLOOR, '']],
  mark: [[FLOW, FLOOR, '  if (m.y >= U.c.z && body < U.c.z && d < U.c.w) { d = U.d.x; }\n']],
  'slime-bind': [...slimeField(-1), SLIME_BIND],
  'slime-weight': [...slimeField(-1), SLIME_PICK],
  births: BIRTHS,
};
/** The ages of the records of ADR 0056, for `check`. */
for (const name of [
  'slime-old-300',
  'slime-old-3000',
  'slime-wall-300',
  'slime-wall-3000',
  'slime-ban-300',
  'slime-stay-300',
  'slime-sense-300-10',
])
  VARIANTS[name] = slimeVariant(name) ?? [];

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
/** The edits of every variant of the name, in their order: `births+slime-wall-300` is two variants. */
const parts = name.split('+').map((part) => VARIANTS[part] ?? slimeVariant(part));
const edits = parts.every((part) => part !== undefined) ? parts.flat() : undefined;
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
    const env = { ...process.env, VITE_VARIANT: name };
    return spawnSync(program, args, { cwd: ROOT, stdio: 'inherit', env }).status ?? 1;
  } finally {
    restore();
  }
}
process.exit(run(edits));
