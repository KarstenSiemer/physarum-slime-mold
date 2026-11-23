#!/usr/bin/env bash
# Study 1a of the plan of 2026-11-22 (ADR 0091): the credit of fresh ground in the prototype, with the rules and the
# levers of the Crown of veins, in the box of E2n and in a dish with a ring of foods, 6 seeds, to step 12,000. At most
# 4 jobs at once: three helpers share the CPU. The runs lie in research/front/out/p1a/<layout>/<case>/ (git ignores
# it). Usage:
#   bash research/front/p1a.sh sweep          the credit 0.2, 0.05, 0.02 and 0.01, and the forms (i) and (ii)
#   bash research/front/p1a.sh jobs <credit>  the three jobs of the constant one by one at <credit>, in the dish
#   bash research/front/p1a.sh table          the measures of every case
# The case 0.01 runs at the next float32 above 0.01: the prototype compares a float32 D with the double 0.01, so
# float32(0.01) reads as starved there; the passes of the engine square D in float32 and read it as open (ADR 0091).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=research/front/out/p1a
RUN="node --import ./research/flow/register.mjs research/front/p1a.ts"
AT="steps=12000 at=3000,4500,6000,7500,9000,10500,12000 dump=6000,12000"
SEEDS="1 2 3 4 5 6"
job() { # layout case seed words
  local pics=""
  [ "$3" = 1 ] && pics="pics=4000,8000,12000"
  echo "$RUN layout=$1 seed=$3 $AT $pics name=p1a/$1/$2/s$3 $4 > $OUT/$1/$2/s$3.txt 2>&1"
}
pool() { printf '%s\0' "$@" | xargs -0 -P 4 -n 1 bash -c; }
if [ "${1:-}" = sweep ]; then
  CASES=(
    "c020|"
    "c005|credit=0.05"
    "c002|credit=0.02"
    "c001|credit=0.010000000707805157"
    "feeder|creditOn=feeder"
    "births|creditOn=births"
  )
  jobs=()
  for s in $SEEDS; do
    for layout in ring box; do
      for c in "${CASES[@]}"; do
        mkdir -p "$OUT/$layout/${c%%|*}"
        jobs+=("$(job "$layout" "${c%%|*}" "$s" "${c#*|}")")
      done
    done
  done
  pool "${jobs[@]}"
elif [ "${1:-}" = jobs ]; then
  credit=${2:?the credit}
  jobs=()
  for s in $SEEDS; do
    for j in start cap fall; do
      mkdir -p "$OUT/ring/$j"
      jobs+=("$(job ring "$j" "$s" "credit=$credit creditJobs=$j")")
    done
  done
  pool "${jobs[@]}"
elif [ "${1:-}" = table ]; then
  for layout in box ring; do $RUN table="$OUT/$layout"; done
else
  echo "usage: bash research/front/p1a.sh sweep|jobs <credit>|table" >&2
  exit 1
fi
