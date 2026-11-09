// One point per agent into a per-cell target, combined by blending (gl/sim.ts):
// kind 0 deposit (moved agents, additive, one lane per strain), 1 claims (MAX of keys),
// 2 occupancy (additive), 3 tally of alive agents per strain into a 1 × 1 target.

uniform sampler2D agents;
uniform int agentWidth;
uniform int kind;

flat out vec4 value;

void main() {
  int i = gl_VertexID;
  vec4 a = texelFetch(agents, ivec2(i % agentWidth, i / agentWidth), 0);
  uint bits = bitsOf(a);
  int s = int(bits & 3u);
  bool alive = (bits & ALIVE) != 0u && uint(i) < P.grid.z;
  int c = -1;
  value = vec4(0.0);
  gl_PointSize = 1.0;
  if (alive) {
    if (kind == 0 && (bits & MOVED) != 0u) {
      c = cellOf(a.xy);
      value[s] = 1.0;
    } else if (kind == 1 && (bits & WANTS) != 0u) {
      c = cellOf(destination(a));
      value = vec4(claimKey(uint(i)));
    } else if (kind == 2) {
      c = cellOf(a.xy);
      value = vec4(1.0);
    } else if (kind == 3) {
      value[s] = 1.0;
      gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }
  if (c < 0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // outside the clip volume: dropped
    return;
  }
  vec2 q = vec2(cellCoord(c)) + 0.5;
  gl_Position = vec4(q / vec2(W(), H()) * 2.0 - 1.0, 0.0, 1.0);
}
