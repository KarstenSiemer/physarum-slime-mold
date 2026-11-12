// The order of the point passes (gl/sim.ts sortOrder(), ADR 0028): the agent slots sorted by the tile of ORDER_TILE ×
// ORDER_TILE cells that holds their agent, so that the points of a draw that follow each other lie close together on
// the grid. A radix sort of 2 bits a pass in fragment passes, after common.glsl. programs.ts compiles one program per
// PASS: 0 the keys, 1 one level of a pyramid of digit counts, 2 the gather of one radix pass.
// An order texel holds a key and an agent index. Each pass is stable, so the result is sorted by tile and, inside a
// tile, by agent index. Every key, count and index is an integer below 2^24, exact in a 32-bit float. Only the
// order of the points changes, and every point pass sums integers or takes a maximum: no result depends on it.

out vec4 result;

const int FAN = 4;            // children of a node of the pyramid
const int LEVEL_WIDTH = 2048; // nodes in a row of a level

#if PASS == 0
// Per slot: the tile of its agent's cell and the agent's index, the slot itself. A dead agent, an agent outside a
// closed arena and a slot past the last agent get the key `none`, which sorts last.
uniform sampler2D agentsIn;
uniform int agentWidth;
uniform int tilesX; // tiles in a row of the grid
uniform int none;

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  int i = t.y * agentWidth + t.x;
  int key = none;
  if (uint(i) < P.grid.z) {
    vec4 a = texelFetch(agentsIn, t, 0);
    if ((bitsOf(a) & ALIVE) != 0u) {
      ivec2 c = cellXY(ivec2(floor(a.xy)));
      if (c.x >= 0) key = (c.y / ORDER_TILE) * tilesX + c.x / ORDER_TILE;
    }
  }
  result = vec4(float(key), float(i), 0.0, 0.0);
}
#endif

#if PASS == 1
// One level of the pyramid: per node the number of elements under it with each value of the digit (bits `shift` and
// `shift` + 1 of the key), from FAN children. The first level counts the elements of the order, the others sum the
// level below. A node past the end of its level counts 0.
uniform sampler2D below;
uniform int first;      // 1 if `below` is the order
uniform int belowWidth; // texels in a row of `below`
uniform int belowSize;  // elements or nodes in `below`
uniform int shift;

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  int j = t.y * LEVEL_WIDTH + t.x;
  vec4 n = vec4(0.0);
  for (int c = 0; c < FAN; c++) {
    int e = FAN * j + c;
    if (e >= belowSize) break;
    vec4 v = texelFetch(below, ivec2(e % belowWidth, e / belowWidth), 0);
    if (first == 1) {
      n[(int(v.x) >> shift) & 3] += 1.0;
    } else {
      n += v;
    }
  }
  result = n;
}
#endif

#if PASS == 2
// One radix pass: slot s of the new order takes the element whose digit and rank among the elements of that digit
// put it there. The elements of digit d take the slots after those of the smaller digits, in their old order. The
// rank leads from the top of the pyramid down to the element.
uniform sampler2D orderIn;
uniform sampler2D level1;
uniform sampler2D level2;
uniform sampler2D level3;
uniform sampler2D level4;
uniform sampler2D level5;
uniform sampler2D level6;
uniform sampler2D level7;
uniform sampler2D level8;
uniform sampler2D level9;
uniform sampler2D level10;
uniform sampler2D level11;
uniform int agentWidth;
uniform int slots; // elements of the order
uniform int shift;
uniform int top; // the level of one node: the count of each digit value over all slots

vec2 element(int e) { return texelFetch(orderIn, ivec2(e % agentWidth, e / agentWidth), 0).xy; }

int digit(vec2 e) { return (int(e.x) >> shift) & 3; }

// One step down the pyramid: from node j of level K to the child under which rank r lies, with the rank under that
// child. LV is the sampler of level K − 1: each level has its own, so that no read chooses between samplers. The reads
// of the children depend on j only, not on the comparisons. A child past the end of its level reads as 0: in the last
// row of a level its pass wrote 0, and a texel fetch outside a texture gives 0. The levels of a fan-in of 4 hold 4^11
// = 2^22 slots, the most agents of WebGL2.
#define DESCEND(K, LV)                                                                                                 \
  if (top >= K) {                                                                                                      \
    int c = 0;                                                                                                         \
    int below = 0;                                                                                                     \
    for (int i = 0; i < FAN - 1; i++) {                                                                                \
      int n = FAN * j + i;                                                                                             \
      int m = int(dot(texelFetch(LV, ivec2(n % LEVEL_WIDTH, n / LEVEL_WIDTH), 0), lane));                              \
      if (c == i && below + m <= r) {                                                                                  \
        below += m;                                                                                                    \
        c = i + 1;                                                                                                     \
      }                                                                                                                \
    }                                                                                                                  \
    r -= below;                                                                                                        \
    j = FAN * j + c;                                                                                                   \
  }

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  int s = t.y * agentWidth + t.x;
  vec4 total = top == 1 ? texelFetch(level1, ivec2(0), 0)
             : top == 2 ? texelFetch(level2, ivec2(0), 0)
             : top == 3 ? texelFetch(level3, ivec2(0), 0)
             : top == 4 ? texelFetch(level4, ivec2(0), 0)
             : top == 5 ? texelFetch(level5, ivec2(0), 0)
             : top == 6 ? texelFetch(level6, ivec2(0), 0)
             : top == 7 ? texelFetch(level7, ivec2(0), 0)
             : top == 8 ? texelFetch(level8, ivec2(0), 0)
             : top == 9 ? texelFetch(level9, ivec2(0), 0)
             : top == 10 ? texelFetch(level10, ivec2(0), 0)
                         : texelFetch(level11, ivec2(0), 0);
  int d = 0;
  int start = 0;
  for (; d < 3; d++) {
    int n = int(total[d]);
    if (s < start + n) break;
    start += n;
  }
  vec4 lane = vec4(equal(ivec4(d), ivec4(0, 1, 2, 3)));
  int r = s - start;
  int j = 0;
  DESCEND(11, level10)
  DESCEND(10, level9)
  DESCEND(9, level8)
  DESCEND(8, level7)
  DESCEND(7, level6)
  DESCEND(6, level5)
  DESCEND(5, level4)
  DESCEND(4, level3)
  DESCEND(3, level2)
  DESCEND(2, level1)
  vec2 found = element(FAN * j);
  for (int c = 0; c < FAN; c++) {
    int e = FAN * j + c;
    if (e >= slots) break;
    vec2 v = element(e);
    if (digit(v) == d) {
      if (r == 0) {
        found = v;
        break;
      }
      r--;
    }
  }
  result = vec4(found, 0.0, 0.0);
}
#endif
