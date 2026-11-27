#!/usr/bin/env bash
# More seeds where a campaign of the forms of a GPU came near the edge of the spread (README.md, step 9): the tree in
# the open dish, seeds 11 to 40 with slime everywhere and 11 to 20 without slime, and the Y-maze with slime everywhere
# and without at the drift 1.5 and 5, seeds 41 to 120. Each with the rule set of step 6 (`rules`) and with the extra
# rules given (`forms`); a third argument `forms` runs the second alone. Records:
# research/front/out/<name>/<form>/<case>.jsonl, named as those of campaign.sh.
# Usage: bash research/front/more.sh <name> "key=value ..." [forms]
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=$1
FORMS=$2
WHICH=${3:-rules forms}
RULES="speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app"
OUT=research/front/out/$NAME
RUN="node --import ./research/flow/register.mjs research/front"
DISH_ALL=(11 13 15 17 19 21 23 25 27 29 31 33 35 37 39)
DISH_NONE=(11 13 15 17 19)
jobs=()
for form in $WHICH; do
  extra=""
  [[ $form == forms ]] && extra=$FORMS
  mkdir -p "$OUT/$form/parts"
  for slime in all none; do
    if [[ $slime == all ]]; then seeds=("${DISH_ALL[@]}"); else seeds=("${DISH_NONE[@]}"); fi
    for s in "${seeds[@]}"; do
      part="d0-$slime-$s-$((s + 1))"
      jobs+=("$RUN/dish.ts slime=$slime seeds=$s-$((s + 1)) steps=20000 $RULES drift=0 $extra name=$NAME/$form/parts/$part > $OUT/$form/parts/$part.txt 2>&1")
    done
  done
  for d in 1.5 5; do
    for c in all none; do
      for s in 41 51 61 71 81 91 101 111; do
        part="d$d-$c-$s-$((s + 9))"
        jobs+=("$RUN/ymaze.ts case=$c seeds=$s-$((s + 9)) limit=20000 $RULES drift=$d $extra name=$NAME/$form/parts/$part > $OUT/$form/parts/$part.txt 2>&1")
      done
    done
  done
done
printf '%s\0' "${jobs[@]}" | xargs -0 -P 11 -n 1 bash -c
for form in $WHICH; do
  for slime in all none; do
    if [[ $slime == all ]]; then seeds=("${DISH_ALL[@]}"); else seeds=("${DISH_NONE[@]}"); fi
    : > "$OUT/$form/d0-$slime.jsonl"
    for s in "${seeds[@]}"; do cat "$OUT/$form/parts/d0-$slime-$s-$((s + 1)).jsonl" >> "$OUT/$form/d0-$slime.jsonl"; done
  done
  for d in 1.5 5; do
    for c in all none; do
      cat "$OUT/$form/parts/d$d-$c-"{41-50,51-60,61-70,71-80,81-90,91-100,101-110,111-120}.jsonl > "$OUT/$form/d$d-$c.jsonl"
    done
  done
done
