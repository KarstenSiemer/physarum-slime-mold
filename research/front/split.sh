#!/usr/bin/env bash
# The forms of a GPU one at a time, in the cases where all of them together left the spread of the seeds (README.md,
# step 9): the Y-maze with slime on both arms at drift 0 and with slime everywhere at drift 1.5 (40 seeds), and the
# dish without slime at drift 0 and with slime everywhere at drift 5 (10 seeds). Records go to research/front/out/
# <name>/<form>/, named as those of campaign.sh, so that compare.ts reads them against out/y6 and out/dish2.
# Usage: bash research/front/split.sh <name> <form>="key=value ..." [<form>="key=value ..." ...]
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=$1
shift
RULES="speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app"
OUT=research/front/out/$NAME
RUN="node --import ./research/flow/register.mjs research/front"
jobs=()
for spec in "$@"; do
  form=${spec%%=*}
  extra=${spec#*=}
  mkdir -p "$OUT/$form/y/parts" "$OUT/$form/dish/parts"
  for s in 1 3 5 7 9; do
    for c in "0 none" "5 all"; do
      read -r d slime <<< "$c"
      part="d$d-$slime-$s-$((s + 1))"
      jobs+=("$RUN/dish.ts slime=$slime seeds=$s-$((s + 1)) steps=20000 $RULES drift=$d $extra name=$NAME/$form/dish/parts/$part > $OUT/$form/dish/parts/$part.txt 2>&1")
    done
  done
  for s in 1 11 21 31; do
    for c in "0 both" "1.5 all"; do
      read -r d kind <<< "$c"
      part="d$d-$kind-$s-$((s + 9))"
      jobs+=("$RUN/ymaze.ts case=$kind seeds=$s-$((s + 9)) limit=20000 $RULES drift=$d $extra name=$NAME/$form/y/parts/$part > $OUT/$form/y/parts/$part.txt 2>&1")
    done
  done
done
printf '%s\0' "${jobs[@]}" | xargs -0 -P 11 -n 1 bash -c
# One record per case, the parts in the order of their seeds.
for spec in "$@"; do
  form=${spec%%=*}
  for c in d0-both d1.5-all; do cat "$OUT/$form/y/parts/$c-"{1-10,11-20,21-30,31-40}.jsonl > "$OUT/$form/y/$c.jsonl"; done
  for c in d0-none d5-all; do cat "$OUT/$form/dish/parts/$c-"{1-2,3-4,5-6,7-8,9-10}.jsonl > "$OUT/$form/dish/$c.jsonl"; done
done
