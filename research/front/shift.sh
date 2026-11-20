#!/usr/bin/env bash
# The shift test of part E2d (ADR 0074): does a form of the drift read the level of a network against its ground? The
# dish of 160 cells with one food (e2c-proto.ts), the rule set of step 9 at the drift 1.5, the start of the app (no food
# scent before the colony) and the test of the tube of a sink (ADR 0072, ADR 0073). Seeds 1 to 10, 3,000 steps, the
# agents at the steps 1,500 and 3,000. Each form runs without a shift and with a shift of the pressure of every tube cell
# (and of its momentum) by +200 and by −200 at step 100 and at step 1,000. A form whose agents leave the spread of the
# seeds under a shift reads the level and is out. `extend` runs one seed per job: it solves the ground in each step.
# Usage: bash research/front/shift.sh <name> [forms] [key=value ...]; the records go to research/front/out/<name>/,
# the table: node --import ./research/flow/register.mjs research/front/shift.ts research/front/out/<name>.
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=$1
FORMS=${2:-all net mirror take sinks rim leak extend}
EXTRA=${3:-}
OUT=research/front/out/$NAME
RUN="node --import ./research/flow/register.mjs research/front/e2c-proto.ts layout=dish steps=3000 marks=1500,3000 scent=0 sinkTube=1 drift=1.5 $EXTRA"
mkdir -p "$OUT"
: >"$OUT/jobs"
for f in $FORMS; do
  for at in none 100:200 100:-200 1000:200 1000:-200; do
    tag="$f-${at/:/at}"
    move=""
    [ "$at" = none ] || move="shift=$at"
    if [ "$f" = extend ]; then
      for s in $(seq 1 10); do echo "$RUN driftOn=$f seeds=$s-$s $move > $OUT/$tag-s$s.txt 2>&1" >>"$OUT/jobs"; done
    else
      echo "$RUN driftOn=$f seeds=1-10 $move > $OUT/$tag.txt 2>&1" >>"$OUT/jobs"
    fi
  done
done
# The jobs of `extend` first: they take longest.
grep 'driftOn=extend' "$OUT/jobs" >"$OUT/jobs.sorted" || true
grep -v 'driftOn=extend' "$OUT/jobs" >>"$OUT/jobs.sorted" || true
tr '\n' '\0' <"$OUT/jobs.sorted" | xargs -0 -P 11 -n 1 bash -c
