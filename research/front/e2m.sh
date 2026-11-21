#!/usr/bin/env bash
# Part E2m of stage 4 (ADR 0083): more flux for the veins of the growing colony. The neck and the rule set of E2f with
# 8 edges (ADR 0081, ADR 0082), equal shares, the drift 1.5 (not scaled), step 8,000, seeds 1 and 2, `jones=all` and
# `jones=edge`, for four levers: k = 8 and 16 (`norm=2k paid=20k`, the base conductance 0.02), and the base 0.002 at
# k = 2 and 4 (a diagnostic). 16 jobs on 6 cores. The runs lie in research/front/out/e2m/c1/<case>/ (git ignores it).
# Usage:
#   bash research/front/e2m.sh run       the 16 runs
#   bash research/front/e2m.sh measure   the measures of e2m.ts at steps 4,000, 6,000 and 8,000, the pictures of D,
#                                        and the montages of the look and of D at step 8,000
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=research/front/out/e2m
RUN="node --import ./research/flow/register.mjs research/front"
RULES="layout=neck side=260 long=240 steps=8000 every=1000 pics=4000,6000,8000 dump=2000,4000,6000,8000 speed=0.004"
RULES+=" speedOn=push reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app paidBy=rank"
RULES+=" fresh=box sums=fixed sinkTube=1 scent=0 driftOn=take drift=1.5 stencil=8"
# The levers: a case name and its words. The heaviest first.
CASES=(
  "k16|norm=32 paid=320"
  "k8|norm=16 paid=160"
  "k4-b0.002|norm=8 paid=80 base=0.002"
  "k2-b0.002|norm=4 paid=40 base=0.002"
)
if [ "${1:-}" = run ]; then
  mkdir -p "$OUT"
  jobs=()
  for c in "${CASES[@]}"; do
    name=${c%%|*}
    words=${c#*|}
    for j in all edge; do
      for s in 1 2; do
        jobs+=("$RUN/crowns.ts $RULES $words jones=$j seeds=$s-$s name=e2m/c1/$name-$j/s$s > $OUT/c1-$name-$j-s$s.txt 2>&1")
      done
    done
  done
  printf '%s\0' "${jobs[@]}" | xargs -0 -P 6 -n 1 bash -c
elif [ "${1:-}" = measure ]; then
  for k in 4000 6000 8000; do $RUN/e2m.ts measure=$OUT/c1 at=$k > "$OUT/c1-m$k.txt"; done
  $RUN/e2l.ts pics=$OUT/c1 at=8000
  mkdir -p "$OUT/montage"
  for pic in look d; do
    rows=()
    for c in "${CASES[@]}"; do
      name=${c%%|*}
      row=""
      for j in all edge; do
        for s in 1 2; do row+=" $OUT/c1/$name-$j/s$s-pics/s$s/$pic-8000.png"; done
      done
      rows+=("$row")
    done
    # The rows k = 8, k = 16, then the base 0.002 at k = 2 and k = 4.
    bash research/front/crown-montage.sh "$OUT/montage/$pic-8000.png" "${rows[1]}" "${rows[0]}" "${rows[3]}" "${rows[2]}"
  done
else
  echo "usage: bash research/front/e2m.sh run|measure" >&2
  exit 1
fi
