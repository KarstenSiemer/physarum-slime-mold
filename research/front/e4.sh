#!/usr/bin/env bash
# Part E4 of stage 4 (ADR 0088): the scenes of Reid et al. 2012 with the rules of the growth front, in the real engine.
# One GPU job at a time:
#   bash research/front/e4.sh backends   both backends, seeds 1 to 6, to step 1,500: the four scenes
#   bash research/front/e4.sh y          WebGPU, seeds 1 to 40, the Y-maze with slime on one arm, on both and on neither
#   bash research/front/e4.sh ygl        WebGL2, seeds 1 to 40 with slime on one arm, 1 to 10 on both and on neither
#   bash research/front/e4.sh dish       both backends, seeds 1 to 10: Slime everywhere, the same dish without slime,
#                                        and the open dish of the prototype
#   bash research/front/e4.sh reach      WebGPU, seeds 1 to 10 of each case of the Y-maze and of the open dish: the
#                                        least steps of a path from each sink to ground without slime at the steps 1,500
#                                        and 3,000 (the study of the reach)
#   bash research/front/e4.sh pics       WebGPU, seed 1 of each case: the pictures at the first food and at the glucose
#   bash research/front/e4.sh montage    docs/images/reid-y-maze.jpg and docs/images/reid-dish.jpg from the pictures
#   bash research/front/e4.sh times      the time of a step, both backends, in turns (turns.sh)
#   bash research/front/e4.sh table      the tables of the records (e4.ts)
# The runs lie in research/front/out/e4/ (git ignores it).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=research/front/out/e4
RUN="npx vitest run --config research/vitest.config.ts research/front/e4-reid.gpu.test.ts"
case "${1:-}" in
  backends)
    VITE_CASES=one,both,none,dish VITE_KINDS=webgpu,webgl2 VITE_SEEDS=1-6 VITE_STEPS=1500 VITE_EVERY=500 \
      VITE_OUT=e4/backends $RUN
    ;;
  y)
    VITE_CASES=one,both,none VITE_KINDS=webgpu VITE_SEEDS=1-40 VITE_OUT=e4/y $RUN
    ;;
  ygl)
    VITE_CASES=one VITE_KINDS=webgl2 VITE_SEEDS=1-40 VITE_OUT=e4/y $RUN
    VITE_CASES=both,none VITE_KINDS=webgl2 VITE_SEEDS=1-10 VITE_OUT=e4/y $RUN
    ;;
  dish)
    VITE_CASES=dish,dish-blank,open VITE_KINDS=webgpu,webgl2 VITE_SEEDS=1-10 VITE_OUT=e4/dish $RUN
    ;;
  reach)
    VITE_CASES=one,both,none,open VITE_KINDS=webgpu VITE_SEEDS=1-10 VITE_STEPS=3000 VITE_EVERY=500 \
      VITE_REACH=1500,3000 VITE_OUT=e4/reach $RUN
    ;;
  pics)
    VITE_CASES=one,both,none,dish,dish-blank VITE_KINDS=webgpu VITE_SEEDS=1 VITE_PICS=1 VITE_OUT=e4/pics $RUN
    ;;
  montage)
    node --import ./research/flow/register.mjs research/front/e4.ts montage="$OUT/pics/webgpu/pics"
    ;;
  times)
    # The time of a step (bench.gpu.test.ts), both backends, from step 1,000 on: the four scenes with the rules and
    # without them, and the Corn maze, in 4 rounds of turns: odd rounds run the rules first, even rounds last. Each run
    # prints the load of the machine; the records go to research/flow/out/engine/e4-<on|off>-r<round>.jsonl.
    for r in 1 2 3 4; do
      if ((r % 2)); then order="on off"; else order="off on"; fi
      for k in $order; do
        if [[ $k == on ]]; then patch='{}'; else patch='{"territory":false}'; fi
        echo "$(date +%H:%M:%S) start e4-$k-r$r load $(sysctl -n vm.loadavg)"
        VITE_SCENES=y-maze,y-maze-both,y-maze-blank,slime-everywhere,corn-maze VITE_FLOWS=on VITE_WARM=1000 \
          VITE_PATCH="$patch" VITE_NAME=e4-$k-r$r \
          npx vitest run --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts > /dev/null
        echo "$(date +%H:%M:%S) end e4-$k-r$r"
      done
    done
    ;;
  table)
    node --import ./research/flow/register.mjs research/front/e4.ts out="$OUT"
    ;;
  *)
    echo "usage: bash research/front/e4.sh backends|y|ygl|dish|reach|pics|montage|times|table" >&2
    exit 1
    ;;
esac
