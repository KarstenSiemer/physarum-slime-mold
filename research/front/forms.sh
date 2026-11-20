#!/usr/bin/env bash
# The targets of ADR 0065 for the forms of the drift of part E2d (ADR 0074): the rule set of step 9 with the start of
# the app and the test of the tube of a sink (ADR 0072, ADR 0073), for each form and weight of the drift. The Y-maze with
# slime on one arm, on both arms and without slime (40 seeds each), the dish with slime everywhere and without slime
# (10 seeds, DISH_STEPS steps, 20,000 by default), and the lane of comb.ts for the crown and the speed of the front
# (10 seeds, 8,000 steps). Usage: bash research/front/forms.sh <name> "<forms>" "<drifts>" ["<parts>"] ["key=value ..."];
# the parts are y, dish and lane (all three by default). The records go to research/front/out/<name>/<form>/<part>/ as
# d<drift>-<case>.jsonl. Tables: tables.ts and compare.ts for y, dish.ts table= and compare.ts for dish, lane.ts
# table= for lane. MODE=jobs only writes the jobs to research/front/out/<name>/jobs (several campaigns then share one
# pool: cat the files and run them as below), and MODE=collect only joins the parts of a finished campaign.
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=$1
FORMS=$2
DRIFTS=$3
PARTS=${4:-dish lane y}
EXTRA=${5:-}
DISH_STEPS=${DISH_STEPS:-20000}
MODE=${MODE:-run}
RULES="speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app paidBy=rank fresh=box sums=fixed sinkTube=1 scent=0 $EXTRA"
OUT=research/front/out/$NAME
RUN="node --import ./research/flow/register.mjs research/front"
mkdir -p "$OUT"
JOBS=$OUT/jobs
[ "$MODE" = collect ] && JOBS=/dev/null
[ "$MODE" = collect ] || : >"$JOBS"
# The dish first: its jobs take longest.
for part in $PARTS; do
  for f in $FORMS; do
    mkdir -p "$OUT/$f/$part/parts"
    for d in $DRIFTS; do
      at="$NAME/$f/$part/parts"
      case $part in
      dish)
        for slime in all none; do
          for s in 1 3 5 7 9; do
            p="d$d-$slime-$s-$((s + 1))"
            echo "$RUN/dish.ts slime=$slime seeds=$s-$((s + 1)) steps=$DISH_STEPS $RULES driftOn=$f drift=$d name=$at/$p > $OUT/$f/$part/parts/$p.txt 2>&1" >>"$JOBS"
          done
        done
        ;;
      lane)
        for s in 1 3 5 7 9; do
          p="d$d-lane-$s-$((s + 1))"
          echo "$RUN/lane.ts seeds=$s-$((s + 1)) steps=8000 $RULES driftOn=$f drift=$d name=$at/$p > $OUT/$f/$part/parts/$p.txt 2>&1" >>"$JOBS"
        done
        ;;
      y)
        for c in one both none; do
          for s in 1 11 21 31; do
            p="d$d-$c-$s-$((s + 9))"
            echo "$RUN/ymaze.ts case=$c seeds=$s-$((s + 9)) limit=20000 $RULES driftOn=$f drift=$d name=$at/$p > $OUT/$f/$part/parts/$p.txt 2>&1" >>"$JOBS"
          done
        done
        ;;
      esac
    done
  done
done
[ "$MODE" = jobs ] && exit 0
[ "$MODE" = collect ] || tr '\n' '\0' <"$OUT/jobs" | xargs -0 -P 11 -n 1 bash -c
# One record per form, part, drift and case, the parts in the order of their seeds.
for f in $FORMS; do
  for part in $PARTS; do
    at="$OUT/$f/$part"
    for d in $DRIFTS; do
      case $part in
      dish) for slime in all none; do cat "$at/parts/d$d-$slime-"{1-2,3-4,5-6,7-8,9-10}.jsonl >"$at/d$d-$slime.jsonl"; done ;;
      lane) cat "$at/parts/d$d-lane-"{1-2,3-4,5-6,7-8,9-10}.jsonl >"$at/d$d-lane.jsonl" ;;
      y) for c in one both none; do cat "$at/parts/d$d-$c-"{1-10,11-20,21-30,31-40}.jsonl >"$at/d$d-$c.jsonl"; done ;;
      esac
    done
  done
done
