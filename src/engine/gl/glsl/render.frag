// Full-screen pass: trail (or agent counts) → color. Mirrors ../../shaders/render.wgsl.
// Prepended with view.glsl.

uniform sampler2D env;
uniform sampler2D counts;
uniform sampler2D bloom;
uniform sampler2D heights; // gel style: written by height.frag each frame

vec4 bilinear(vec2 p) {
  vec2 q = p - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec4 a = mix(trailAt(i), trailAt(i + ivec2(1, 0)), f.x);
  vec4 b = mix(trailAt(i + ivec2(0, 1)), trailAt(i + ivec2(1, 1)), f.x);
  return mix(a, b, f.y);
}

vec4 trailFiltered(vec2 p) {
  if (V.scale <= 1.0) return bilinear(p);
  float o = 0.25 * V.scale;
  return 0.25 * (bilinear(p + vec2(-o, -o)) + bilinear(p + vec2(o, -o)) + bilinear(p + vec2(-o, o)) +
                 bilinear(p + vec2(o, o)));
}

vec4 levels(vec4 v) {
  float t = v.x + v.y + v.z + v.w;
  return v * (max(t - V.fx.y, 0.0) / max(t, 1e-20));
}

vec3 tint(vec4 v) {
  vec3 c = vec3(0.0);
  for (int s = 0; s < int(V.frame.y); s++) c += v[s] * V.colors[s].rgb;
  return c;
}

vec3 srgb(vec3 c) {
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, 12.92 * c, vec3(lessThanEqual(c, vec3(0.0031308))));
}

float hash(uvec2 p) {
  uint x = p.x * 1664525u + p.y * 1013904223u + V.frame.x * 2654435761u;
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return float((x ^ (x >> 16u)) >> 8u) * (1.0 / 16777216.0);
}

vec3 glow(vec4 v, vec4 halo) {
  vec3 l = 1.0 - exp(-(tint(v) * V.exposure + tint(halo) * V.fx.x * 0.2));
  return V.background.rgb + (1.0 - V.background.rgb) * l;
}

vec3 paper(vec4 v) {
  vec3 absorb = vec3(0.0);
  for (int s = 0; s < int(V.frame.y); s++) absorb += v[s] * (0.15 + 0.85 * (1.0 - V.colors[s].rgb));
  return V.background.rgb * exp(-absorb * V.exposure);
}

// The gel height field (height.frag) with hardware bilinear filtering at grid position q, wrapped
// for the periodic boundary; outside a closed arena the border holds the value of an empty cell.
float heightAt(vec2 q) {
  vec2 s = vec2(gridSize());
  vec2 p = V.boundary == 0u ? q - s * floor(q / s) : q;
  return textureLod(heights, (p + 1.0) / (s + 2.0), 0.0).r;
}

// Four taps spread over the pixel footprint when zoomed out, like trailFiltered().
float heightFiltered(vec2 p) {
  if (V.scale <= 1.0) return heightAt(p);
  float o = 0.25 * V.scale;
  return 0.25 * (heightAt(p + vec2(-o, -o)) + heightAt(p + vec2(o, -o)) + heightAt(p + vec2(-o, o)) +
                 heightAt(p + vec2(o, o)));
}

float height(vec2 p) { return 1.0 - exp(-max(heightFiltered(p), 0.0)); }

vec3 gel(vec2 p, vec4 v) {
  float d = max(V.scale, 0.75);
  float h = height(p);
  float gx = height(p + vec2(d, 0.0)) - height(p - vec2(d, 0.0));
  float gy = height(p + vec2(0.0, d)) - height(p - vec2(0.0, d));
  vec3 n = normalize(vec3(-gx, -gy, 0.35 * d));
  vec3 l = normalize(vec3(-0.45, -0.6, 0.65));
  float diffuse = max(dot(n, l), 0.0);
  float spec = pow(max(dot(n, normalize(l + vec3(0.0, 0.0, 1.0))), 0.0), 48.0);
  float total = v.x + v.y + v.z + v.w;
  vec3 albedo = total > 1e-6 ? tint(v) / total : V.colors[0].rgb;
  vec3 lit = albedo * (0.25 + 0.9 * diffuse) + 0.6 * spec * h;
  return mix(V.background.rgb, lit, smoothstep(0.02, 0.35, h));
}

vec4 agentsAt(vec2 p) {
  int i = cellAt(ivec2(floor(p)));
  return i < 0 ? vec4(0.0) : texelFetch(counts, coord(i), 0);
}

vec3 overlay(vec3 c, vec2 p) {
  int i = cellAt(ivec2(floor(p)));
  if (i < 0 || V.frame.z == 0u) return c;
  vec4 e = texelFetch(env, coord(i), 0);
  bool paperStyle = V.style == 2u;
  vec3 o = c + e.b * (paperStyle ? vec3(-0.04, -0.03, -0.12) : vec3(0.22, 0.2, 0.12));
  o = mix(o, vec3(0.85, 0.72, 0.48), e.g * 0.9);
  return mix(o, paperStyle ? vec3(0.55) : vec3(0.06), e.r);
}

void main() {
  // GL has its origin bottom-left; the view maps a top-left pixel grid (as in WebGPU).
  vec2 frag = vec2(gl_FragCoord.x, V.canvas.y - gl_FragCoord.y);
  vec2 p = (frag - 0.5 * V.canvas) * V.scale + V.center;
  vec2 s = vec2(gridSize());
  bool outside = V.boundary != 0u && (any(lessThan(p, vec2(0.0))) || any(greaterThanEqual(p, s)));
  if (V.boundary == 2u) outside = distance(p, 0.5 * s) > 0.5 * min(s.x, s.y) - 1.0;
  vec3 c;
  if (outside) {
    c = V.background.rgb * (V.style == 2u ? 0.92 : 0.55);
  } else {
    vec4 v = levels(trailFiltered(p));
    vec4 halo = texture(bloom, p / s);
    if (V.style == 1u) c = gel(p, v);
    else if (V.style == 2u) c = paper(v);
    else if (V.style == 3u) c = glow(agentsAt(p), vec4(0.0));
    else c = glow(v, halo);
    c = overlay(c, p);
  }
  uvec2 px = uvec2(gl_FragCoord.xy);
  float n = hash(px) - hash(px + uvec2(7919u, 104729u));
  result = vec4(srgb(clamp(c, vec3(0.0), vec3(1.0))) + n / 255.0, 1.0);
}
