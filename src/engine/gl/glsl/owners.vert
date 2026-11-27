// The owners of the territory (ADR 0068; `fillOwners` in ../../shaders/territory.wgsl), with PASS 2 of
// territory.frag: one point per agent into the target of the owners, after the moves and the births of a step. An
// alive agent puts the bit of its strain on its cell. With one agent per cell no two points meet, so the target needs
// no blending, which a target of unsigned integers does not have.

uniform sampler2D agents;
uniform int agentWidth;

flat out uint owner;

void main() {
  int i = gl_VertexID;
  vec4 a = texelFetch(agents, ivec2(i % agentWidth, i / agentWidth), 0);
  uint bits = bitsOf(a);
  gl_PointSize = 1.0;
  owner = 1u << (bits & 3u);
  // The cell as cellXY() gives it, (−1, −1) for none.
  ivec2 c = cellXY(ivec2(floor(a.xy)));
  if (uint(i) >= P.grid.z || (bits & ALIVE) == 0u || c.x < 0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // outside the clip volume: dropped
    return;
  }
  vec2 q = vec2(c) + 0.5;
  gl_Position = vec4(q / vec2(W(), H()) * 2.0 - 1.0, 0.0, 1.0);
}
