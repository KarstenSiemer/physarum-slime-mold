// The points of growth (ADR 0025), after growth.glsl, with points.frag: one point per agent that marked GROWS in
// growth.frag PASS 2. kind 0: the claim of its neighbour (MAX of claim keys, as a move claims its cell); kind 1: the
// winner of the claim writes its birth, at the cell's position in the order of the births (place()).

uniform sampler2D agents;
uniform sampler2D claims; // kind 1: the highest claim key per cell
uniform int agentWidth;
uniform int kind;

flat out vec4 value;

void main() {
  int i = gl_VertexID;
  vec4 a = texelFetch(agents, ivec2(i % agentWidth, i / agentWidth), 0);
  uint bits = bitsOf(a);
  gl_PointSize = 1.0;
  value = vec4(0.0);
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // outside the clip volume: dropped
  int c = cellOf(a.xy);
  if (uint(i) >= P.grid.z || (bits & GROWS) == 0u || c < 0) return;
  int t = cellAt(cellCoord(c) + around((bits >> DIR_SHIFT) & 7u));
  if (t < 0) return;
  float key = claimKey(uint(i));
  int at = t;
  if (kind == 0) {
    value = vec4(key);
  } else {
    if (texelFetch(claims, cellCoord(t), 0).r != key) return;
    value = vec4(float((bits & 3u) + 1u), float(t), 0.0, 0.0);
    at = int(place(uint(t)));
  }
  vec2 q = vec2(at % W(), at / W()) + 0.5;
  gl_Position = vec4(q / vec2(W(), H()) * 2.0 - 1.0, 0.0, 1.0);
}
