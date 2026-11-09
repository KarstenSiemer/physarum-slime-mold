// Bloom in trail space (one lane per strain): prefilter → 4 × downsample → 4 × additive upsample.
// Dual-filter kernels (Bjørge, SIGGRAPH 2015). Standalone module.

const THRESHOLD = 0.5; // radiance; the white level maps to 1.3 (exposure.ts)

struct Pass {
  texel: vec2f, // 1 / source size
  gain: f32,    // prefilter only: trail units → radiance
  black: f32,   // prefilter only: summed trail level shown as black
}

@group(0) @binding(0) var<uniform> U: Pass;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var trail: texture_2d<f32>;

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return Out(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

// Half resolution: average of 2 × 2 trail cells (unfilterable float32, so textureLoad).
@fragment
fn prefilter(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let base = vec2i(floor(pos.xy)) * 2;
  let size = vec2i(textureDimensions(trail)) - 1;
  var sum = vec4f(0.0);
  for (var y = 0; y < 2; y++) {
    for (var x = 0; x < 2; x++) {
      sum += textureLoad(trail, min(base + vec2i(x, y), size), 0);
    }
  }
  // Auto levels as in render.wgsl. Only radiance above the threshold glows, so dense networks
  // keep dark lacunae; soft compression keeps a few dense nodes from dominating.
  let avg = 0.25 * sum;
  let t = avg.x + avg.y + avg.z + avg.w;
  let v = avg * (max(t - U.black, 0.0) / max(t, 1e-20)) * U.gain;
  let bright = max(v - vec4f(THRESHOLD), vec4f(0.0));
  return bright / (1.0 + 0.25 * bright);
}

@fragment
fn down(in: Out) -> @location(0) vec4f {
  let o = U.texel;
  return (4.0 * textureSample(src, samp, in.uv) +
          textureSample(src, samp, in.uv + vec2f(-o.x, -o.y)) +
          textureSample(src, samp, in.uv + vec2f(o.x, -o.y)) +
          textureSample(src, samp, in.uv + vec2f(-o.x, o.y)) +
          textureSample(src, samp, in.uv + vec2f(o.x, o.y))) / 8.0;
}

@fragment
fn up(in: Out) -> @location(0) vec4f {
  let o = U.texel;
  var s = textureSample(src, samp, in.uv + vec2f(-2.0 * o.x, 0.0)) +
          textureSample(src, samp, in.uv + vec2f(2.0 * o.x, 0.0)) +
          textureSample(src, samp, in.uv + vec2f(0.0, -2.0 * o.y)) +
          textureSample(src, samp, in.uv + vec2f(0.0, 2.0 * o.y));
  s += 2.0 * (textureSample(src, samp, in.uv + vec2f(-o.x, -o.y)) +
              textureSample(src, samp, in.uv + vec2f(o.x, -o.y)) +
              textureSample(src, samp, in.uv + vec2f(-o.x, o.y)) +
              textureSample(src, samp, in.uv + vec2f(o.x, o.y)));
  return s / 12.0;
}
