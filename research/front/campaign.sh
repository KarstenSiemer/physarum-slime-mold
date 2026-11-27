#!/usr/bin/env bash
# The campaign of the rule set of stage 4 (README.md, steps 6, 7 and 9): the Y-maze in its four cases with 40 seeds,
# and the dish with slime everywhere and without slime with 10 seeds, for the three forms of the drift. 78 jobs on 11
# cores, about 25 minutes. Each case and drift gets one record of its own: <y>/d<drift>-<case>.jsonl and
# <dish>/d<drift>-<slime>.jsonl below research/front/out/.
# Usage: bash research/front/campaign.sh <y> <dish> ["key=value ..."]: the third argument adds rules, for example the
# forms of a GPU of ADR 0067, "paidBy=chance fresh=box sums=fixed start=agents".
# Tables: node --import ./research/flow/register.mjs research/front/tables.ts research/front/out/<y>, and
# research/front/dish.ts table=research/front/out/<dish>.
set -euo pipefail
cd "$(dirname "$0")/../.."
Y=$1
DISH=$2
EXTRA=${3:-}
RULES="speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app"
OUT=research/front/out
RUN="node --import ./research/flow/register.mjs research/front"
mkdir -p "$OUT/$Y/parts" "$OUT/$DISH/parts"
jobs=()
# The dish first: its jobs take longest.
for d in 0 1.5 5; do
  for slime in all none; do
    for s in 1 3 5 7 9; do
      part="d$d-$slime-$s-$((s + 1))"
      jobs+=("$RUN/dish.ts slime=$slime seeds=$s-$((s + 1)) steps=20000 $RULES drift=$d $EXTRA name=$DISH/parts/$part > $OUT/$DISH/parts/$part.txt 2>&1")
    done
  done
done
for d in 0 1.5 5; do
  for c in one both none all; do
    for s in 1 11 21 31; do
      part="d$d-$c-$s-$((s + 9))"
      jobs+=("$RUN/ymaze.ts case=$c seeds=$s-$((s + 9)) limit=20000 $RULES drift=$d $EXTRA name=$Y/parts/$part > $OUT/$Y/parts/$part.txt 2>&1")
    done
  done
done
printf '%s\0' "${jobs[@]}" | xargs -0 -P 11 -n 1 bash -c
# One record per case and drift, the parts in the order of their seeds.
for d in 0 1.5 5; do
  for c in one both none all; do cat "$OUT/$Y/parts/d$d-$c-"{1-10,11-20,21-30,31-40}.jsonl > "$OUT/$Y/d$d-$c.jsonl"; done
  for slime in all none; do cat "$OUT/$DISH/parts/d$d-$slime-"{1-2,3-4,5-6,7-8,9-10}.jsonl > "$OUT/$DISH/d$d-$slime.jsonl"; done
done
