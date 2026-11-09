// Shared by the WebGL2 view passes (render.frag, height.frag): the View block and grid lookups.
precision highp float;
precision highp int;
precision highp sampler2D;

// std140 = the layout of `struct View` in render.wgsl, filled by packView() in render.ts.
layout(std140) uniform View {
  vec2 canvas;
  vec2 center;
  float scale;
  float exposure;
  uint style;
  uint boundary;
  vec4 colors[4];
  vec4 background;
  uvec4 frame; // frame counter, strain count, overlays on/off, unused
  vec4 fx;     // bloom strength, black level, unused, unused
} V;

uniform sampler2D trail;

out vec4 result;

ivec2 gridSize() { return textureSize(trail, 0); }

int cellAt(ivec2 c) {
  ivec2 s = gridSize();
  ivec2 q = c;
  if (V.boundary == 0u) {
    q = c - s * ivec2(floor(vec2(c) / vec2(s)));
  } else if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, s))) {
    return -1;
  }
  return q.y * s.x + q.x;
}

ivec2 coord(int i) { return ivec2(i % gridSize().x, i / gridSize().x); }

vec4 trailAt(ivec2 c) {
  int i = cellAt(c);
  return i < 0 ? vec4(0.0) : texelFetch(trail, coord(i), 0);
}
