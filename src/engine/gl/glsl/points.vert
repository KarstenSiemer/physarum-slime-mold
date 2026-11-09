// One point per agent into a per-cell target, combined by blending (gl/sim.ts):
// kind 0 deposit (moved agents, additive, one lane per strain), 1 claims (MAX of keys),
// 2 occupancy (additive), 3 tally of alive agents per strain (additive, see below),
// 4 deposit into one panel per strain (2 × 2 panels of the grid size), for exact counts without
// float blending (gl/sim.ts deposit()).

uniform sampler2D agents;
uniform int agentWidth;
uniform int kind;
uniform int tallySide; // kind 3: side of the square tally target
uniform vec4 unit;     // kind 4: value per agent

flat out vec4 value;

void main() {
  int i = gl_VertexID;
  vec4 a = texelFetch(agents, ivec2(i % agentWidth, i / agentWidth), 0);
  uint bits = bitsOf(a);
  int s = int(bits & 3u);
  bool alive = (bits & ALIVE) != 0u && uint(i) < P.grid.z;
  int c = -1;
  ivec2 panel = ivec2(0);
  float panels = 1.0;
  value = vec4(0.0);
  gl_PointSize = 1.0;
  if (alive) {
    if ((kind == 0 || kind == 4) && (bits & MOVED) != 0u) {
      c = cellOf(a.xy);
      if (kind == 0) {
        value[s] = 1.0;
      } else {
        value = unit;
        panel = ivec2(s & 1, s >> 1);
        panels = 2.0;
      }
    } else if (kind == 1 && (bits & WANTS) != 0u) {
      c = cellOf(destination(a));
      value = vec4(claimKey(uint(i)));
    } else if (kind == 2) {
      c = cellOf(a.xy);
      value = vec4(1.0);
    } else if (kind == 3) {
      // Agent i adds 1 to its strain's lane of pixel i mod n² (n = tallySide). Spread like this, no
      // pixel sums more than 2^24 / n² agents: 1024 for n = 128, exact even in half floats.
      int n = tallySide;
      int k = i % (n * n);
      value[s] = 1.0;
      gl_Position = vec4((vec2(k % n, k / n) + 0.5) / float(n) * 2.0 - 1.0, 0.0, 1.0);
      return;
    }
  }
  if (c < 0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // outside the clip volume: dropped
    return;
  }
  vec2 q = vec2(cellCoord(c) + panel * ivec2(W(), H())) + 0.5;
  gl_Position = vec4(q / (panels * vec2(W(), H())) * 2.0 - 1.0, 0.0, 1.0);
}
