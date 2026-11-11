// Shared by all simulation shaders. Every member is 16 bytes, so the layout is sequential
// and src/engine/pack.ts can write it slot by slot.
struct Params {
  grid: vec4u,           // W, H, agent count, step
  cfg: vec4u,            // seed, strain count, boundary (0 wrap, 1 box, 2 dish), collisions
  sensorAngle: vec4f,    // radians, one lane per strain
  sensorOffset: vec4f,   // cells
  rotationAngle: vec4f,  // radians
  stepSize: vec4f,       // cells
  deposit: vec4f,
  keep: vec4f,           // 1 − decay
  randomTurn: vec4f,     // probability
  food: vec4f,           // weight of food scent
  light: vec4f,          // weight of light repellent
  attraction: array<vec4f, 4>, // row s: weight of each strain's trail for strain s
  scent: vec4f,          // food source, light source, scent keep, shrink probability
  tool: vec4f,           // x, y (cells), radius, kind (0 none, 1 inoculate, 2 cut)
  tool2: vec4f,          // strain, chance per step to place a dead agent of the strain (inoculate), unused, unused
  strainEnd: vec4u,      // exclusive end index of each strain's agents (initial layout)
  extra: vec4u,          // layout, walls (1 if the environment may hold walls), start claim round, unused
}

struct Agent {
  pos: vec2f,
  heading: f32,
  bits: u32, // bits 0–1 strain, bit 2 alive, bits 3–26 id (ADR 0005)
}

const PI = 3.14159265358979;
const TAU = 6.28318530717959;
const BLOCKED = -1e30; // sensor value for walls and outside; finite on purpose
const ALIVE = 4u;
const ID_SHIFT = 3u; // the id field starts here; up to 2^24 agents (webgpu.ts MAX_AGENTS)

@group(0) @binding(0) var<uniform> P: Params;

fn W() -> u32 { return P.grid.x; }
fn H() -> u32 { return P.grid.y; }

// PCG hash (Jarzynski & Olano 2020). A bijection on u32, also used for collision keys.
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

// Persistent agent id: its slot at init. The sort (sort.wgsl) moves agents between slots, so random
// streams and collision keys use the id, never the slot.
fn agentId(a: Agent) -> u32 { return a.bits >> ID_SHIFT; }

// Stateless stream: one seed per (agent id, step), advanced per draw.
fn rngSeed(id: u32, salt: u32) -> u32 {
  return pcg(id ^ pcg(P.grid.w ^ pcg(P.cfg.x ^ salt)));
}
fn rand(s: ptr<function, u32>) -> f32 {
  *s = pcg(*s);
  return f32(*s >> 8u) * (1.0 / 16777216.0);
}

// Direction for any angle; reduces to [−π, π) first, where WGSL guarantees sin/cos accuracy.
fn dir(a: f32) -> vec2f {
  let w = a - TAU * floor((a + PI) / TAU);
  return vec2f(cos(w), sin(w));
}

// A position wrapped into the periodic grid, below W and H. A position a hair below 0 would round up to W in f32,
// in cell 0, while cellOf() of the unwrapped position is cell W − 1: the largest f32 below W keeps it in that cell.
fn wrapPos(p: vec2f) -> vec2f {
  let size = vec2f(f32(W()), f32(H()));
  return min(p - size * floor(p / size), bitcast<vec2f>(bitcast<vec2u>(size) - 1u));
}

fn dishRadius() -> f32 { return 0.5 * f32(min(W(), H())) - 1.0; }

// Index of a cell, wrapped for the periodic boundary, or −1 outside a closed arena.
// Agents and diffusion share this rule, so a position is habitable exactly when its cell is.
fn cellAt(c: vec2i) -> i32 {
  let size = vec2i(i32(W()), i32(H()));
  var q = c;
  if (P.cfg.z == 0u) {
    q = ((c % size) + size) % size;
  } else {
    if (any(c < vec2i(0)) || any(c >= size)) { return -1; }
    if (P.cfg.z == 2u && distance(vec2f(c) + 0.5, 0.5 * vec2f(size)) > dishRadius()) { return -1; }
  }
  return q.y * size.x + q.x;
}

fn cellOf(p: vec2f) -> i32 { return cellAt(vec2i(floor(p))); }

fn cellCoord(i: u32) -> vec2i { return vec2i(i32(i % W()), i32(i / W())); }

// A position in cell c at offset f in [0, 1]². c + f alone can round up into the next cell: f32 has 24 bits,
// so from coordinate 256 on an offset just below 1 lands on c + 1. Clamped to the largest f32 below c + 1.
fn inCell(c: vec2i, f: vec2f) -> vec2f {
  let lo = vec2f(c);
  let hi = bitcast<vec2f>(bitcast<vec2u>(lo + 1.0) - 1u);
  return clamp(lo + f, lo, hi);
}

// Where an agent that goes to p lands: p wrapped into the grid, in c = cellOf(p), the cell its move or placement
// claimed and counted. wrapPos() alone can round up into the next cell: on a grid 512 cells wide, x = −1.000001
// (cell 510) wraps to 511.0, in cell 511. Bit for bit the same as wrapPos(p) wherever that stays in c.
fn landed(p: vec2f, c: i32) -> vec2f {
  let lo = cellCoord(u32(c));
  return inCell(lo, wrapPos(p) - vec2f(lo));
}

// Environment bytes: x wall, y food, z light (0…1).
fn envOf(e: u32) -> vec4f { return unpack4x8unorm(e); }
// A cell is a wall when its wall byte is at least 128 (0.5). isWall in common.glsl uses the same threshold.
const WALL_BYTE = 128u;
fn isWall(e: u32) -> bool { return (e & 0xffu) >= WALL_BYTE; }

// Cells per side of a clearance tile (walls.wgsl, ADR 0020); CLEAR_TILE in common.glsl and src/engine/pack.ts is the
// same.
const CLEAR_TILE = 8;
