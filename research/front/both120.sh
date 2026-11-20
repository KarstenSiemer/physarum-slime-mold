#!/usr/bin/env bash
# Seeds 41 to 120 of the Y-maze with slime on both arms, at the drift 1.5 and 5 (README.md, steps 6 and 9): with the
# seeds 1 to 40 of campaign.sh they give 120 runs per drift. 16 jobs on 11 cores, a few minutes.
# Usage: bash research/front/both120.sh <name> ["key=value ..."]: the records go to research/front/out/<name>/
# d<drift>-both.jsonl, and the second argument adds rules, as for campaign.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=$1
EXTRA=${2:-}
RULES="speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app"
OUT=research/front/out/$NAME
mkdir -p "$OUT/parts"
jobs=()
for d in 1.5 5; do
  for s in 41 51 61 71 81 91 101 111; do
    part="d$d-$s-$((s + 9))"
    jobs+=("node --import ./research/flow/register.mjs research/front/ymaze.ts case=both seeds=$s-$((s + 9)) limit=20000 $RULES drift=$d $EXTRA name=$NAME/parts/$part > $OUT/parts/$part.txt 2>&1")
  done
done
printf '%s\0' "${jobs[@]}" | xargs -0 -P 11 -n 1 bash -c
for d in 1.5 5; do cat "$OUT/parts/d$d-"{41-50,51-60,61-70,71-80,81-90,91-100,101-110,111-120}.jsonl > "$OUT/d$d-both.jsonl"; done
