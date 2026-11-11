// Initial agent placement. Prepended with common.wgsl.
// `init` draws every agent's start in its layout. Without the one-agent-per-cell rule, an agent whose cell is a
// wall or outside the arena draws again in its layout's region, up to ROUNDS times, and starts dead if no draw
// is free. With the rule, `claimStart` and `settleStart` then run the claim rounds (sim.ts reset(); their number
// is startRounds() in pack.ts): every agent not placed yet claims its cell with a unique key, the highest key
// takes the cell, and the others draw again. An agent with no free cell after the last round starts dead. So
// every alive agent starts in its own cell. `census` then counts the alive agents.

@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(4) var<storage, read> env: array<u32>;
@group(0) @binding(6) var<storage, read_write> stats: array<atomic<u32>>; // alive agents per strain (agents.wgsl)
@group(0) @binding(7) var<storage, read_write> occ: array<atomic<u32>>; // cells taken in earlier rounds
@group(0) @binding(8) var<storage, read_write> claims: array<atomic<u32>>;

const MIXED = 0u;
const BANDS = 1u;
const SECTORS = 2u;
const COLONIES = 3u;
const RING = 4u;
const CENTER = 5u;
const EMPTY = 6u;

// Draws after the first without the rule. The claim rounds with the rule are counted apart (pack.ts START_ROUNDS).
const ROUNDS = 32u;

// Bijection on [0, 2^k): odd multiply-add and xorshift are both invertible modulo 2^k.
fn scramble(x0: u32, k: u32) -> u32 {
  let mask = (1u << k) - 1u;
  var x = x0;
  for (var r = 0u; r < 3u; r++) {
    x = (x * 0x2c1b3c6du + pcg(P.cfg.x + r)) & mask;
    x ^= x >> ((k + 1u) / 2u);
  }
  return x;
}

// Distinct cell for every agent index i < n (cycle walking over the permutation). Terminates
// because scramble is a bijection and i < n; the guard only protects against future edits.
fn uniqueCell(i: u32, n: u32) -> u32 {
  let k = 32u - countLeadingZeros(max(n - 1u, 1u));
  var x = scramble(i, k);
  for (var guard = 0u; guard < 64u && x >= n; guard++) { x = scramble(x, k); }
  return x % n;
}

fn anywhere(rng: ptr<function, u32>) -> vec2f {
  return vec2f(rand(rng) * f32(W()), rand(rng) * f32(H()));
}

fn disc(c: vec2f, r: f32, rng: ptr<function, u32>) -> vec2f {
  return c + r * sqrt(rand(rng)) * dir(rand(rng) * TAU);
}

// A position in cell c at offset f in [0, 1]². c + f alone can round up into the next cell: f32 has 24 bits,
// so from coordinate 256 on an offset just below 1 lands on c + 1. Clamped to the largest f32 below c + 1.
fn inCell(c: vec2i, f: vec2f) -> vec2f {
  let lo = vec2f(c);
  let hi = bitcast<vec2f>(bitcast<vec2u>(lo + 1.0) - 1u);
  return clamp(lo + f, lo, hi);
}

fn habitable(c: i32) -> bool { return c >= 0 && !isWall(env[c]); }

struct Start {
  pos: vec2f,
  heading: f32,
}

// Draw `round` of agent `id`'s start (strain s). Every draw lies in the layout's region; the mixed layout's
// first draw with the rule is a cell of its own (a permutation of the grid), and its later draws lie anywhere in
// the arena: the dish, or the whole grid.
fn start(id: u32, s: u32, round: u32) -> Start {
  var rng = rngSeed(id, 7u + round * 0x10000u);
  let n = f32(P.cfg.y);
  let fs = f32(s);
  let size = vec2f(f32(W()), f32(H()));
  let center = 0.5 * size;
  let m = min(size.x, size.y);
  var heading = rand(&rng) * TAU;
  var p = vec2f(0.0);
  switch P.extra.x {
    case BANDS: { p = vec2f((fs + rand(&rng)) / n * size.x, rand(&rng) * size.y); }
    case SECTORS: { p = center + 0.45 * m * sqrt(rand(&rng)) * dir((fs + rand(&rng)) / n * TAU); }
    case COLONIES: {
      let c = select(center + 0.28 * m * dir(fs / n * TAU - 0.5 * PI), center, P.cfg.y == 1u);
      p = disc(c, 0.1 * m, &rng);
    }
    case RING: {
      let a = rand(&rng) * TAU;
      p = center + (0.3 * m + 2.0 * (rand(&rng) - 0.5)) * dir(a);
      heading = a;
    }
    case CENTER: { p = disc(center, 0.08 * m, &rng); }
    default: {
      if (round == 0u && P.cfg.w != 0u && P.grid.z <= P.grid.x * P.grid.y) {
        let c = uniqueCell(id, P.grid.x * P.grid.y);
        p = inCell(cellCoord(c), vec2f(rand(&rng), rand(&rng)));
      } else if (round > 0u && P.cfg.z == 2u) {
        p = disc(center, dishRadius(), &rng);
      } else {
        p = anywhere(&rng);
      }
    }
  }
  return Start(p, heading);
}

// The position of an agent placed in cell c (an index of cellOf(p)), wrapped and inside c.
fn placed(p: vec2f, c: i32) -> vec2f { return inCell(cellCoord(u32(c)), p - floor(p)); }

fn index(gid: vec3u, groups: vec3u) -> u32 { return gid.x + gid.y * groups.x * 256u; }

@compute @workgroup_size(256)
fn init(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i >= P.grid.z) { return; }
  var s = 0u;
  while (s < 3u && i >= P.strainEnd[s]) { s++; }
  var st = start(i, s, 0u);
  var c = cellOf(st.pos);
  var alive = false;
  // With the rule, the claim rounds place the agent; it waits dead until then.
  if (P.extra.x != EMPTY && P.cfg.w == 0u) {
    for (var r = 1u; r <= ROUNDS && !habitable(c); r++) {
      st = start(i, s, r);
      c = cellOf(st.pos);
    }
    alive = habitable(c);
  }
  var p = wrapPos(st.pos);
  if (alive) { p = placed(st.pos, c); }
  // The slot at init becomes the agent's id for good (ADR 0005).
  agents[i] = Agent(p, st.heading, s | select(0u, ALIVE, alive) | (i << ID_SHIFT));
}

// Not placed yet: a claim round may still give it a cell.
fn waiting(a: Agent) -> bool { return (a.bits & ALIVE) == 0u && P.extra.x != EMPTY; }

// Unique per round (pcg is a bijection on u32 and ids are unique), so claims never tie. P.extra.z is the round.
fn startKey(id: u32) -> u32 { return pcg(id ^ pcg(P.extra.z ^ 0x51ed270bu ^ P.cfg.x)); }

fn freeCell(c: i32) -> bool { return habitable(c) && atomicLoad(&occ[c]) == 0u; }

@compute @workgroup_size(256)
fn claimStart(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i >= P.grid.z) { return; }
  let a = agents[i];
  let c = cellOf(a.pos);
  if (waiting(a) && freeCell(c)) { atomicMax(&claims[c], startKey(agentId(a))); }
}

// The winner of a cell takes it; every other waiting agent draws its next start. Only the winner of cell c
// writes occ[c] here, so a winner reads occ[c] before any write to it.
@compute @workgroup_size(256)
fn settleStart(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = index(gid, groups);
  if (i >= P.grid.z) { return; }
  var a = agents[i];
  if (!waiting(a)) { return; }
  let id = agentId(a);
  let c = cellOf(a.pos);
  if (freeCell(c) && atomicLoad(&claims[c]) == startKey(id)) {
    atomicStore(&occ[c], 1u);
    a.pos = placed(a.pos, c);
    a.bits |= ALIVE;
  } else {
    let st = start(id, a.bits & 3u, P.extra.z + 1u);
    a.pos = wrapPos(st.pos);
    a.heading = st.heading;
  }
  agents[i] = a;
}

var<workgroup> tally: array<atomic<u32>, 4>;

// The alive agents per strain into `stats`, as every step counts them (agents.wgsl count()), so that Sim.alive()
// gives the new population before its first step. Before, it gave the count of the last step before the reset.
@compute @workgroup_size(256)
fn census(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u,
          @builtin(local_invocation_index) li: u32) {
  let i = index(gid, groups);
  if (i < P.grid.z) {
    let bits = agents[i].bits;
    if ((bits & ALIVE) != 0u) { atomicAdd(&tally[bits & 3u], 1u); }
  }
  workgroupBarrier();
  if (li < 4u) { atomicAdd(&stats[li], atomicLoad(&tally[li])); }
}
