#!/usr/bin/env bash
# Study 1b (ADR 0092): the cases of the boom at a new food, one GPU job after the other (boom.gpu.test.ts).
# Food ring with the levers of the Crown of veins and the rules on. Each case: a name, a patch of settings, a patch of
# FLOW. `one`: every case on the seed of the scene, with the births sorted from step 6,000 to 16,000 and pictures.
# `seeds <case>...`: those cases on 6 seeds, the alive count alone.
# Usage: bash research/front/boom.sh one [case...] | seeds <case>... | png (the pictures as PNG files)
cd "$(dirname "$0")/../.." || exit 1
LOGS=research/front/out/p1b/logs
mkdir -p "$LOGS"
LEVERS='"territory":true,"flowEdges":8,"flowBase":0.002'
declare -A PATCH=(
  [today]='"frontFlux":2,"flowStrength":8' [a-i2]='"frontFlux":8,"flowStrength":2' [a-i4]='"frontFlux":4,"flowStrength":4'
  [b]='"frontFlux":2,"flowStrength":8' [c-h32]='"frontFlux":2,"flowStrength":8' [c-h8]='"frontFlux":2,"flowStrength":8'
  [k025]='"frontFlux":0.25,"flowStrength":8' [k05]='"frontFlux":0.5,"flowStrength":8'
  [d]='"frontFlux":2,"flowStrength":8,"growthMin":81,"growthMax":81'
)
declare -A FLOWS=([today]='{}' [a-i2]='{}' [a-i4]='{}' [b]='{"birth":0}' [c-h32]='{"head":32}' [c-h8]='{"head":8}'
  [k025]='{}' [k05]='{}' [d]='{}')
SEEDS=(3787577443 1 2 3 4 5)

run() { # name, case, seed or '', and the extra variables
  local name=$1 case=$2 seed=$3
  shift 3
  local patch="{$LEVERS,${PATCH[$case]}${seed:+,\"seed\":$seed}}"
  env VITE_NAME="$name" VITE_PATCH="$patch" VITE_FLOW="${FLOWS[$case]}" VITE_STEPS=20000 "$@" \
    npx vitest run --config research/vitest.config.ts research/front/boom.gpu.test.ts > "$LOGS/$name.log" 2>&1
  echo "$name: $(grep -E 'Tests ' "$LOGS/$name.log" | head -1)"
}

if [ "$1" = one ]; then
  shift
  for c in ${@:-today a-i2 a-i4 b c-h32 c-h8}; do
    run "$c" "$c" '' VITE_FROM=6000 VITE_TO=16000 VITE_PICS=6001,8001,9001,10001,11001,12001,14001,16001,20000
  done
elif [ "$1" = png ]; then
  # The runner writes each picture as base64 (vitest's writeFile); this turns them into PNG files.
  find research/front/out/p1b -name '*.png.b64' | while read -r f; do base64 -D -i "$f" -o "${f%.b64}" && rm "$f"; done
elif [ "$1" = seeds ]; then
  shift
  for c in "$@"; do
    for s in "${SEEDS[@]}"; do run "$c-s$s" "$c" "$s"; done
  done
fi
