// One value for every pixel that passes the stencil test (gl/sim.ts deposit()).
precision highp float;

uniform vec4 value;

out vec4 result;

void main() { result = value; }
