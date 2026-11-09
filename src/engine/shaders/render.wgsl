// Full-screen pass: trail (or agent counts) → color. Standalone module (no common.wgsl).

struct View {
  canvas: vec2f,      // canvas size, pixels
  center: vec2f,      // grid position shown at the canvas center, cells
  scale: f32,         // cells per pixel
  exposure: f32,      // linear gain from trail units to radiance
  style: u32,         // 0 glow, 1 gel, 2 paper, 3 agents
  boundary: u32,      // 0 wrap, 1 box, 2 dish
  colors: array<vec4f, 4>, // strain colors, linear RGB
  background: vec4f,  // linear RGB
  frame: vec4u,       // frame counter, strain count, overlays on/off, unused
  fx: vec4f,          // bloom strength, black level (summed trail), unused, unused
}

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var trail: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> env: array<u32>;
@group(0) @binding(3) var<storage, read> counts: array<vec4u>;
@group(0) @binding(4) var bloom: texture_2d<f32>;
@group(0) @binding(5) var bloomSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn size() -> vec2i { return vec2i(textureDimensions(trail)); }

// Cell index for the grid, wrapped (periodic) or −1 outside the arena.
fn cellAt(c: vec2i) -> i32 {
  let s = size();
  var q = c;
  if (V.boundary == 0u) {
    q = ((c % s) + s) % s;
  } else if (any(c < vec2i(0)) || any(c >= s)) {
    return -1;
  }
  return q.y * s.x + q.x;
}

fn trailAt(c: vec2i) -> vec4f {
  let i = cellAt(c);
  if (i < 0) { return vec4f(0.0); }
  return textureLoad(trail, vec2i(i % size().x, i / size().x), 0);
}

// Manual bilinear filter: rgba32float is not filterable without an optional feature.
fn bilinear(p: vec2f) -> vec4f {
  let q = p - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let a = mix(trailAt(i), trailAt(i + vec2i(1, 0)), f.x);
  let b = mix(trailAt(i + vec2i(0, 1)), trailAt(i + vec2i(1, 1)), f.x);
  return mix(a, b, f.y);
}

// Four taps spread over the pixel footprint when zoomed out, against aliasing.
fn trailFiltered(p: vec2f) -> vec4f {
  if (V.scale <= 1.0) { return bilinear(p); }
  let o = 0.25 * V.scale;
  return 0.25 * (bilinear(p + vec2f(-o, -o)) + bilinear(p + vec2f(o, -o)) +
                 bilinear(p + vec2f(-o, o)) + bilinear(p + vec2f(o, o)));
}

// Auto levels: subtract the black level from the summed trail, keep the strain ratios.
fn levels(v: vec4f) -> vec4f {
  let t = v.x + v.y + v.z + v.w;
  return v * (max(t - V.fx.y, 0.0) / max(t, 1e-20));
}

fn tint(v: vec4f) -> vec3f {
  var c = vec3f(0.0);
  for (var s = 0u; s < V.frame.y; s++) { c += v[s] * V.colors[s].rgb; }
  return c;
}

fn srgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

fn hash(p: vec2u) -> f32 {
  var x = p.x * 1664525u + p.y * 1013904223u + V.frame.x * 2654435761u;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return f32((x ^ (x >> 16u)) >> 8u) * (1.0 / 16777216.0);
}

// Linear light per strain, then a per-channel exponential tone curve: dense overlaps turn white-hot.
fn glow(v: vec4f, halo: vec4f) -> vec3f {
  // The bloom chain sums 5 blur levels (bloom.ts); divide to keep the strength scale intuitive.
  let l = 1.0 - exp(-(tint(v) * V.exposure + tint(halo) * V.fx.x * 0.2));
  return V.background.rgb + (1.0 - V.background.rgb) * l;
}

// Ink on paper: each strain absorbs the complement of its color (Beer–Lambert).
fn paper(v: vec4f) -> vec3f {
  var absorb = vec3f(0.0);
  for (var s = 0u; s < V.frame.y; s++) {
    absorb += v[s] * (0.15 + 0.85 * (1.0 - V.colors[s].rgb));
  }
  return V.background.rgb * exp(-absorb * V.exposure);
}

fn height(p: vec2f) -> f32 {
  let v = levels(trailFiltered(p));
  return 1.0 - exp(-(v.x + v.y + v.z + v.w) * V.exposure);
}

// Trail as a height field, lit like a wet gel.
fn gel(p: vec2f, v: vec4f) -> vec3f {
  let d = max(V.scale, 0.75);
  let h = height(p);
  let gx = height(p + vec2f(d, 0.0)) - height(p - vec2f(d, 0.0));
  let gy = height(p + vec2f(0.0, d)) - height(p - vec2f(0.0, d));
  let n = normalize(vec3f(-gx, -gy, 0.35 * d));
  let l = normalize(vec3f(-0.45, -0.6, 0.65));
  let diffuse = max(dot(n, l), 0.0);
  let spec = pow(max(dot(n, normalize(l + vec3f(0.0, 0.0, 1.0))), 0.0), 48.0);
  let total = v.x + v.y + v.z + v.w;
  let albedo = select(V.colors[0].rgb, tint(v) / max(total, 1e-6), total > 1e-6);
  let lit = albedo * (0.25 + 0.9 * diffuse) + 0.6 * spec * h;
  return mix(V.background.rgb, lit, smoothstep(0.02, 0.35, h));
}

fn agentsAt(p: vec2f) -> vec4f {
  let i = cellAt(vec2i(floor(p)));
  if (i < 0) { return vec4f(0.0); }
  return vec4f(counts[i]);
}

fn overlay(c: vec3f, p: vec2f) -> vec3f {
  let i = cellAt(vec2i(floor(p)));
  if (i < 0 || V.frame.z == 0u) { return c; }
  let e = unpack4x8unorm(env[i]);
  let paperStyle = V.style == 2u;
  var o = c + e.z * select(vec3f(0.22, 0.2, 0.12), vec3f(-0.04, -0.03, -0.12), paperStyle);
  o = mix(o, vec3f(0.85, 0.72, 0.48), e.y * 0.9);
  return mix(o, select(vec3f(0.06), vec3f(0.55), paperStyle), e.x);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let p = (frag.xy - 0.5 * V.canvas) * V.scale + V.center;
  let s = vec2f(size());
  var outside = V.boundary != 0u && (any(p < vec2f(0.0)) || any(p >= s));
  if (V.boundary == 2u) {
    outside = distance(p, 0.5 * s) > 0.5 * min(s.x, s.y) - 1.0;
  }
  var c: vec3f;
  if (outside) {
    c = V.background.rgb * select(0.55, 0.92, V.style == 2u);
  } else {
    let v = levels(trailFiltered(p));
    let halo = textureSampleLevel(bloom, bloomSampler, p / s, 0.0);
    switch V.style {
      case 1u: { c = gel(p, v); }
      case 2u: { c = paper(v); }
      case 3u: { c = glow(agentsAt(p), vec4f(0.0)); }
      default: { c = glow(v, halo); }
    }
    c = overlay(c, p);
  }
  // Triangular dither of ±1 LSB against banding in dark gradients.
  let n = hash(vec2u(frag.xy)) - hash(vec2u(frag.xy) + vec2u(7919u, 104729u));
  return vec4f(srgb(clamp(c, vec3f(0.0), vec3f(1.0))) + n / 255.0, 1.0);
}
