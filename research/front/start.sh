#!/usr/bin/env bash
# The start of the colony in the prototype of stage 4 (ADR 0072): the rule set of step 9 at the drift 1.5, with the
# food scent at its steady state when the colony starts (300 steps of it, as the records of README.md ran) and
# without a scent (0, as the app starts), and each with the test of the tube of a sink (`sinkTube`). The Y-maze with
# slime on one arm and without slime, 40 seeds each, and the open dish without slime, 10 seeds. 52 jobs on 11 cores.
# Usage: bash research/front/start.sh <name>; the records go to research/front/out/<name>/.
# Tables: node --import ./research/flow/register.mjs research/front/tables.ts research/front/out/<name>/y, and
# research/front/dish.ts table=research/front/out/<name>/dish.
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=$1
RULES="speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app paidBy=rank fresh=box sums=fixed drift=1.5"
OUT=research/front/out/$NAME
RUN="node --import ./research/flow/register.mjs research/front"
mkdir -p "$OUT/y/parts" "$OUT/dish/parts"
jobs=()
for scent in 300 0; do
  for tube in 0 1; do
    tag="s$scent-t$tube"
    for s in 1 3 5 7 9; do
      part="$tag-none-$s-$((s + 1))"
      jobs+=("$RUN/dish.ts slime=none seeds=$s-$((s + 1)) steps=20000 $RULES sinkTube=$tube scent=$scent name=$NAME/dish/parts/$part > $OUT/dish/parts/$part.txt 2>&1")
    done
  done
done
for scent in 300 0; do
  for tube in 0 1; do
    tag="s$scent-t$tube"
    for c in one none; do
      for s in 1 11 21 31; do
        part="$tag-$c-$s-$((s + 9))"
        jobs+=("$RUN/ymaze.ts case=$c seeds=$s-$((s + 9)) limit=20000 $RULES sinkTube=$tube scent=$scent name=$NAME/y/parts/$part > $OUT/y/parts/$part.txt 2>&1")
      done
    done
  done
done
printf '%s\0' "${jobs[@]}" | xargs -0 -P 11 -n 1 bash -c
for scent in 300 0; do
  for tube in 0 1; do
    tag="s$scent-t$tube"
    for c in one none; do cat "$OUT/y/parts/$tag-$c-"{1-10,11-20,21-30,31-40}.jsonl > "$OUT/y/$tag-$c.jsonl"; done
    cat "$OUT/dish/parts/$tag-none-"{1-2,3-4,5-6,7-8,9-10}.jsonl > "$OUT/dish/$tag-none.jsonl"
  done
done
