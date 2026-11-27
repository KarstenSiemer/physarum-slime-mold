#!/usr/bin/env bash
# The measures of ADR 0100 (every birth from the budget, the plasm of the dead back to it, the flux per covered food,
# the cap on the credit) in the engine. One GPU job at a time; the records lie in research/front/out/ (git ignores it).
# Usage:
#   bash research/front/p100.sh ring      Food ring with the levers of the crown, 3 seeds per backend, to step 20,000
#   bash research/front/p100.sh help      the runs behind the numbers of the help texts (WebGPU, seed 1)
#   bash research/front/p100.sh y         the Y-maze with slime, 10 seeds per backend (e4-reid.gpu.test.ts)
#   bash research/front/p100.sh crown     the Crown of veins, WebGPU seeds 1 to 3, to step 16,000 (e5b-crown.gpu.test.ts)
#   bash research/front/p100.sh table     the tables of ring and help
set -euo pipefail
cd "$(dirname "$0")/../.."
RING="npx vitest run --config research/vitest.config.ts research/front/p100-ring.gpu.test.ts"
LEVERS='"territory":true,"flowEdges":8,"flowBase":0.002,"frontFlux":2,"flowStrength":8'
case "${1:-}" in
  ring)
    for kind in webgpu webgl2; do
      for seed in 1 2 3; do
        VITE_BACKEND=$kind VITE_NAME=ring-$kind-s$seed VITE_SCENE=food-ring VITE_PATCH="{$LEVERS,\"seed\":$seed}" \
          VITE_STEPS=20002 VITE_EVERY=100 VITE_PICS=5000,10000,15000,20000 $RING > /dev/null
      done
    done
    ;;
  help)
    # Flow strength 2 with the other levers of the crown; and the rules with the levers of the scene (Flow 2).
    VITE_NAME=help-flow2 VITE_SCENE=food-ring \
      VITE_PATCH='{"territory":true,"flowEdges":8,"flowBase":0.002,"frontFlux":2,"flowStrength":2,"seed":1}' \
      VITE_STEPS=20002 VITE_EVERY=100 $RING > /dev/null
    VITE_NAME=help-scene VITE_SCENE=food-ring VITE_PATCH='{"territory":true,"seed":1}' VITE_STEPS=8002 VITE_EVERY=100 \
      $RING > /dev/null
    ;;
  y)
    for kind in webgpu webgl2; do
      VITE_CASES=one VITE_KINDS=$kind VITE_SEEDS=1-10 VITE_OUT=p100/y \
        npx vitest run --config research/vitest.config.ts research/front/e4-reid.gpu.test.ts > /dev/null
    done
    node --import ./research/flow/register.mjs research/front/e4.ts out=research/front/out/p100
    ;;
  crown)
    VITE_KINDS=webgpu VITE_SEEDS=1,2,3 VITE_STEPS=16000 VITE_EVERY=500 VITE_OUT=p100/crown \
      npx vitest run --config research/vitest.config.ts research/front/e5b-crown.gpu.test.ts > /dev/null
    ;;
  table)
    node --import ./research/flow/register.mjs research/front/p100-table.ts research/front/out/p100
    ;;
  *)
    echo "usage: bash research/front/p100.sh ring|help|y|crown|table" >&2
    exit 1
    ;;
esac
