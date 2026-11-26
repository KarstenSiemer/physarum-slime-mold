#!/usr/bin/env bash
# The isolating study of ADR 0100, part A: why the Y-maze with slime on one arm loses its choice under the port of
# option 1 of ADR 0097. Each case changes one rule against the rules in force (ADR 0074, finding 5: the drift `take` at
# 1.5, the start of the app, the tube of a sink). 40 seeds per case, on the CPU (ymaze-why.ts), at most 10 jobs at once.
# Usage: bash research/front/ywhy.sh <name> <case>="key=value ..." ...: the records go to research/front/out/<name>/
# <case>.jsonl, and the counts of the choice to the standard output.
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=$1
shift
RULES="speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge"
RULES+=" solver=app paidBy=rank fresh=box sums=fixed sinkTube=1 driftOn=take drift=1.5"
OUT=research/front/out/$NAME
mkdir -p "$OUT/parts"
jobs=()
cases=()
for arg in "$@"; do
  c=${arg%%=*}
  words=${arg#*=}
  cases+=("$c")
  for s in 1 11 21 31; do
    jobs+=("node --import ./research/flow/register.mjs research/front/ymaze-why.ts seeds=$s-$((s + 9)) $RULES $words name=$NAME/parts/$c-$s > $OUT/parts/$c-$s.txt 2>&1")
  done
done
printf '%s\0' "${jobs[@]}" | xargs -0 -P 10 -n 1 bash -c
for c in "${cases[@]}"; do
  rm -f "$OUT/$c.jsonl"
  for s in 1 11 21 31; do cat "$OUT/parts/$c-$s.jsonl" >> "$OUT/$c.jsonl"; done
  echo "$c: blank $(grep -c '"chosen":"blank"' "$OUT/$c.jsonl") of $(wc -l < "$OUT/$c.jsonl" | tr -d ' ')"
done
