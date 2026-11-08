// Deposit + 3 × 3 mean diffusion + decay. Mirrors ../../shaders/diffuse.wgsl (no tiling: one
// fragment reads its 3 × 3 neighbourhood).

uniform sampler2D trailIn;
uniform sampler2D scentIn;
uniform sampler2D counts;
uniform sampler2D env;
uniform bool first;
uniform bool last;
uniform bool blur;

layout(location = 0) out vec4 outTrail;
layout(location = 1) out vec4 outScent;

// Trail and scent of a cell including this step's sources; `open` is 0 for walls and outside.
void load(ivec2 c, out vec4 t, out vec2 s, out float open) {
  t = vec4(0.0);
  s = vec2(0.0);
  open = 0.0;
  int i = cellAt(c);
  if (i < 0) return;
  ivec2 q = cellCoord(i);
  vec4 e = texelFetch(env, q, 0);
  if (e.r > 0.5) return;
  t = texelFetch(trailIn, q, 0);
  s = texelFetch(scentIn, q, 0).xy;
  if (first) {
    t += texelFetch(counts, q, 0) * P.deposit;
    s += vec2(e.g * P.scent.x, e.b * P.scent.y);
    if (P.tool.w == 2.0 && distance(vec2(q) + 0.5, P.tool.xy) < P.tool.z) {
      t = vec4(0.0);
      s = vec2(0.0);
    }
  }
  open = 1.0;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 t;
  vec2 s;
  float open;
  load(p, t, s, open);
  if (blur && open > 0.0) {
    vec4 sum = vec4(0.0);
    vec2 ssum = vec2(0.0);
    float n = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec4 tt;
        vec2 ss;
        float o;
        load(p + ivec2(dx, dy), tt, ss, o);
        sum += tt;
        ssum += ss;
        n += o;
      }
    }
    t = sum / n;
    s = ssum / n;
  }
  if (last) {
    t *= P.keep;
    s *= P.scent.z;
  }
  outTrail = t;
  outScent = vec4(s, 0.0, 0.0);
}
