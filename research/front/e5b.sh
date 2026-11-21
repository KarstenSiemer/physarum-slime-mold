#!/usr/bin/env bash
# Part E5b of stage 4 (ADR 0087): the scene Crown of veins in the real engine. One GPU job at a time, in turns:
#   bash research/front/e5b.sh backends   both backends, seeds 1 to 6, to step 1,500: the front and the colony
#   bash research/front/e5b.sh long       WebGPU seeds 1 and 2 and WebGL2 seed 1 to step 16,000, the states at the
#                                         steps 8,000, 12,000 and 16,000 for the measures of the crown (e2n.ts)
#   bash research/front/e5b.sh neck       both backends, seeds 1 to 6, to step 2,000: when the colony leaves the neck
#   bash research/front/e5b.sh measure    the measures of e2n.ts at the steps 8,000 and 16,000, and the pictures of D
#   bash research/front/e5b.sh montage    docs/images/crown-app.jpg, after tests/pictures/crown.spec.ts
#   bash research/front/e5b.sh times      the time of a step, both backends, in turns
# The runs lie in research/front/out/e5b/ (git ignores it).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=research/front/out/e5b
RUN="npx vitest run --config research/vitest.config.ts research/front/e5b-crown.gpu.test.ts"
case "${1:-}" in
  backends)
    VITE_KINDS=webgpu,webgl2 VITE_SEEDS=1,2,3,4,5,6 VITE_STEPS=1500 VITE_EVERY=500 VITE_DUMP=1500 \
      VITE_OUT=e5b/backends $RUN
    ;;
  neck)
    # The step at which the colony leaves the neck, for the e2e test: both backends, seeds 1 to 6, every 50 steps.
    VITE_KINDS=webgpu,webgl2 VITE_SEEDS=1,2,3,4,5,6 VITE_STEPS=2000 VITE_EVERY=50 VITE_OUT=e5b/neck $RUN
    node --import ./research/flow/register.mjs research/front/e5b.ts neck="$OUT/neck"
    ;;
  long)
    VITE_KINDS=webgpu VITE_SEEDS=1,2 VITE_STEPS=16000 VITE_EVERY=500 VITE_DUMP=8000,12000,16000 \
      VITE_OUT=e5b/c1 $RUN
    VITE_KINDS=webgl2 VITE_SEEDS=1 VITE_STEPS=16000 VITE_EVERY=500 VITE_DUMP=8000,12000,16000 \
      VITE_OUT=e5b/c1 $RUN
    ;;
  times)
    # The time of a step (bench.gpu.test.ts), both backends, 4 rounds each (turns.sh): the scene and the Corn maze from
    # step 3,000 on, and the scene from step 15,000 on, its colony 7 times as large. Records in research/flow/out/engine/.
    VITE_SCENES=crown,corn-maze VITE_FLOWS=on VITE_WARM=3000 zsh research/flow/engine/turns.sh 4 e5b-3k=.
    VITE_SCENES=crown VITE_FLOWS=on VITE_WARM=15000 zsh research/flow/engine/turns.sh 4 e5b-15k=.
    ;;
  all)
    mkdir -p "$OUT"
    bash "$0" backends > "$OUT/backends.log" 2>&1
    bash "$0" long > "$OUT/long.log" 2>&1
    ;;
  measure)
    node --import ./research/flow/register.mjs research/front/e5b.ts records="$OUT/c1"
    # The folders of the pictures of D, as crowns.ts makes them for its own pictures.
    for state in "$OUT"/c1/*/s*-state; do
      seed=$(basename "$state" -state)
      mkdir -p "$(dirname "$state")/$seed-pics/$seed"
    done
    for k in 8000 16000; do
      node --import ./research/flow/register.mjs research/front/e2n.ts measure="$OUT/c1" at=$k > "$OUT/c1-m$k.txt"
      node --import ./research/flow/register.mjs research/front/e2l.ts pics="$OUT/c1" at=$k
    done
    ;;
  montage)
    # docs/images/crown-app.jpg: seed 1, step 8,000 above and 16,000 below; from the left the look of the prototype and
    # of the app (WebGPU), then D of the prototype and of the engine. The prototype's pictures are the quarters of
    # docs/images/crown-growth.jpg (ADR 0085); the app's come from tests/pictures/crown.spec.ts. Every picture shows
    # the frame of ADR 0085, x 140 to 1,420 and y 0 to 672 of 1,560 × 1,020 pixels, 320 pixels wide.
    P=docs/images/crown-growth.jpg
    A=$OUT/app/webgpu-s1
    D=$OUT/c1/webgpu/s1-pics/s1/d
    cut="crop=1280:672:140:0,scale=320:168"
    quarter() { echo "crop=592:311:$1:$2,scale=320:168"; }
    pad="pad=iw+8:ih+8:4:4:color=0x101014"
    ffmpeg -hide_banner -loglevel error -y -i "$P" -i "$A-8000.png" -i "$A-16000.png" -i "$D-8000.png" -i "$D-16000.png" \
      -filter_complex "[0]split=4[p1][p2][p3][p4];\
[p1]$(quarter 4 4),$pad[a];[1]$cut,$pad[b];[p2]$(quarter 604 4),$pad[c];[3]$cut,$pad[d];\
[p3]$(quarter 4 323),$pad[e];[2]$cut,$pad[f];[p4]$(quarter 604 323),$pad[g];[4]$cut,$pad[h];\
[a][b][c][d]hstack=inputs=4[r1];[e][f][g][h]hstack=inputs=4[r2];[r1][r2]vstack=inputs=2" \
      -frames:v 1 -q:v "${QUALITY:-3}" docs/images/crown-app.jpg
    ls -l docs/images/crown-app.jpg
    ;;
  *)
    echo "usage: bash research/front/e5b.sh backends|neck|long|measure|montage|times" >&2
    exit 1
    ;;
esac
