// Initial agent placement. Prepended with common.wgsl.

@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(4) var<storage, read> env: array<u32>;

const MIXED = 0u;
const BANDS = 1u;
const SECTORS = 2u;
const COLONIES = 3u;
const RING = 4u;
const CENTER = 5u;
const EMPTY = 6u;

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

@compute @workgroup_size(256)
fn init(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = gid.x + gid.y * groups.x * 256u;
  if (i >= P.grid.z) { return; }
  var s = 0u;
  while (s < 3u && i >= P.strainEnd[s]) { s++; }
  let n = f32(P.cfg.y);
  let fs = f32(s);
  var rng = rngSeed(i, 7u);
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
      if (P.cfg.w != 0u && P.grid.z <= P.grid.x * P.grid.y) {
        let c = uniqueCell(i, P.grid.x * P.grid.y);
        p = vec2f(cellCoord(c)) + vec2f(rand(&rng), rand(&rng));
      } else {
        p = anywhere(&rng);
      }
    }
  }
  // Closed arenas and walls: retry a few random spots, then park the agent as dead.
  var c = cellOf(p);
  for (var k = 0u; k < 8u && (c < 0 || isWall(env[c])); k++) {
    p = anywhere(&rng);
    c = cellOf(p);
  }
  let alive = c >= 0 && !isWall(env[c]) && P.extra.x != EMPTY;
  // The slot at init becomes the agent's id for good (ADR 0005).
  agents[i] = Agent(wrapPos(p), heading, s | select(0u, ALIVE, alive) | (i << ID_SHIFT));
}
