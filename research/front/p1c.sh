#!/usr/bin/env bash
# Study 1c of the plan of 2026-11-22 (ADR 0093): the food pays the growth. The dish of Food ring (384 cells) with the
# rules of the growth front at Flow strength 8, with one food or nine, 20,000 steps, on the CPU (feed.ts). At most 4
# jobs at once: three studies share the machine. The records lie in research/front/out/p1c/ (git ignores it). Usage:
#   bash research/front/p1c.sh probe     seed 1: today's rule with 1 and 9 foods, and the two new forms with 9 foods
#   [SEEDS="2 3"] bash research/front/p1c.sh campaign "fixed 1" "flux 9" ...  seeds 1 to 6 (or SEEDS) of each case:
#                                        a rule (the word of `feed`) and the foods; the probe holds seed 1
#   bash research/front/p1c.sh same      the new forms with one food give today's bytes (3,000 steps)
set -euo pipefail
cd "$(dirname "$0")/../.."
RUN="node --import ./research/flow/register.mjs research/front/feed.ts"
RULES="speed=0.004 speedOn=push reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app"
RULES+=" paidBy=rank fresh=box sums=fixed sinkTube=1 driftOn=take drift=1.5 norm=2 paid=20 flow=8"
PICS="pics=5000,10000,20000"
OUT=research/front/out/p1c
mkdir -p "$OUT"
jobs=()
case "${1:-}" in
  probe)
    for c in "fixed 1" "fixed 9" "foods 9" "flux 9"; do
      read -r rule foods <<< "$c"
      name=p1c/probe/$rule-f$foods
      jobs+=("$RUN $RULES $PICS feed=$rule foods=$foods seeds=1-1 name=$name > $OUT/probe-$rule-f$foods.txt 2>&1")
    done
    ;;
  campaign)
    shift
    for c in "$@"; do
      read -r rule foods <<< "$c"
      for s in ${SEEDS:-1 2 3 4 5 6}; do
        name=p1c/c6/$rule-f$foods-s$s
        jobs+=("$RUN $RULES $PICS feed=$rule foods=$foods seeds=$s-$s name=$name > $OUT/c6-$rule-f$foods-s$s.txt 2>&1")
      done
    done
    ;;
  same)
    for f in fixed foods flux; do
      jobs+=("$RUN $RULES feed=$f foods=1 seeds=1-1 steps=3000 every=100 name=p1c/same/$f > $OUT/same-$f.txt 2>&1")
    done
    ;;
  *)
    echo "usage: bash research/front/p1c.sh probe|campaign|same" >&2
    exit 1
    ;;
esac
printf '%s\0' "${jobs[@]}" | xargs -0 -P 4 -n 1 bash -c
