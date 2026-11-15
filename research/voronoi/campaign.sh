#!/bin/sh
# The campaign of ADR 0048 (README.md): every run of the record, a few minutes on an M3 Pro. It writes
# research/voronoi/out/*.jsonl; copy them to research/voronoi/logs/ and pack the archive (README.md, Commands).
# Usage: sh research/voronoi/campaign.sh
set -e
# Each run in a shell of its own with `env`: a variable of one run must not reach the next.
run() {
  file=$1
  shift
  env "$@" npx vitest run --config research/vitest.config.ts "research/voronoi/$file.gpu.test.ts"
}
TEN=1,2,3,4,5,6,7,8,9,10

# The scene as it is, over time.
run voronoi VITE_VO_LABEL=scene VITE_VO_SEEDS=$TEN VITE_VO_SAMPLES=300,1000,3000,10000,20000
# The dot: the paper's hard 3 × 3 cells, a smooth dot of the paper's size, and a dot that releases 3.5 times as much.
run voronoi VITE_VO_LABEL=dots VITE_VO_SEEDS=$TEN VITE_VO_DOTS=hard,1.5,4.72 VITE_VO_SAMPLES=10000
# The repellent strength, with the weights of the paper's Fig. 14 that the app's range holds.
run voronoi VITE_VO_LABEL=sweep VITE_VO_SEEDS=$TEN VITE_VO_LIGHT=0.005,0.025,0.05,0.075,0.125,0.15,0.25,0.45 \
  VITE_VO_SAMPLES=10000
# The strength of the ring.
run voronoi VITE_VO_LABEL=food VITE_VO_SEEDS=$TEN VITE_VO_FOOD=0.05,0.2 VITE_VO_SAMPLES=10000
# Twenty more seeds of the scene, and the other backend with all thirty.
MORE=11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30
run voronoi VITE_VO_LABEL=seeds VITE_VO_SEEDS=$MORE VITE_VO_SAMPLES=10000
run voronoi VITE_VO_KIND=webgl2 VITE_VO_LABEL=webgl2 VITE_VO_SEEDS=$TEN,$MORE VITE_VO_SAMPLES=10000
# The deflected path of Fig. 8.
run deflect VITE_VO_LABEL=deflect VITE_VO_SEEDS=1,2,3,4,5 VITE_VO_LIGHT=0.05,0.2,0.5
