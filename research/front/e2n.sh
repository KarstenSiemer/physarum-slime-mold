#!/usr/bin/env bash
# Part E2n of stage 4 (ADR 0084): a front that splits into crowns that move on. The case of E2m with the base
# conductance 0.002 at k = 2 (ADR 0083): the neck and the rule set of E2f with 8 edges, equal shares, the drift 1.5,
# seeds 1 and 2, to step 16,000, for four rows: neither option, `sinkOn=fed`, `jones=young`, both. The box is 520 × 340
# cells, not 260 × 240: at step 8,000 the colony of E2m reaches 128 to 133 cells from the food and grows 11 to 12 cells
# per 1,000 steps, so by step 16,000 its half disc would reach the walls of the old box. One more run, both options
# off in the box of E2m to step 8,000 (seed 1), must give the record of E2m again. 9 jobs on 6 cores. The runs lie in
# research/front/out/e2n/c1/<case>/ (git ignores it). Usage:
#   bash research/front/e2n.sh run       the 9 runs
#   bash research/front/e2n.sh measure   the measures of e2n.ts at steps 8,000 and 16,000, the pictures of D, and the
#                                        montages of the look and of D
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=research/front/out/e2n
RUN="node --import ./research/flow/register.mjs research/front"
RULES="layout=neck every=1000 speed=0.004 speedOn=push reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks"
RULES+=" sinkAt=edge solver=app paidBy=rank fresh=box sums=fixed sinkTube=1 scent=0 driftOn=take drift=1.5 stencil=8"
RULES+=" norm=4 paid=40 base=0.002"
BIG="side=520 long=340 steps=16000 pics=8000,16000 dump=8000,12000,16000"
# The rows: a case name and its words.
CASES=(
  "none|jones=all"
  "fed|jones=all sinkOn=fed"
  "young|jones=young"
  "both|jones=young sinkOn=fed"
)
if [ "${1:-}" = run ]; then
  mkdir -p "$OUT"
  jobs=()
  for c in "${CASES[@]}"; do
    name=${c%%|*}
    words=${c#*|}
    for s in 1 2; do
      jobs+=("$RUN/crowns.ts $RULES $BIG $words seeds=$s-$s name=e2n/c1/$name/s$s > $OUT/c1-$name-s$s.txt 2>&1")
    done
  done
  # The check: the box and the steps of E2m, both options off.
  jobs+=("$RUN/crowns.ts $RULES side=260 long=240 steps=8000 jones=all seeds=1-1 name=e2n/check/s1 > $OUT/check-s1.txt 2>&1")
  printf '%s\0' "${jobs[@]}" | xargs -0 -P 6 -n 1 bash -c
elif [ "${1:-}" = measure ]; then
  for k in 8000 16000; do $RUN/e2n.ts measure=$OUT/c1 at=$k > "$OUT/c1-m$k.txt"; done
  for k in 8000 16000; do $RUN/e2l.ts pics=$OUT/c1 at=$k; done
  mkdir -p "$OUT/montage"
  for pic in look d; do
    rows=()
    for c in "${CASES[@]}"; do
      name=${c%%|*}
      row=""
      for s in 1 2; do
        for k in 8000 16000; do row+=" $OUT/c1/$name/s$s-pics/s$s/$pic-$k.png"; done
      done
      rows+=("$row")
    done
    bash research/front/crown-montage.sh "$OUT/montage/$pic.png" "${rows[@]}"
  done
else
  echo "usage: bash research/front/e2n.sh run|measure" >&2
  exit 1
fi
