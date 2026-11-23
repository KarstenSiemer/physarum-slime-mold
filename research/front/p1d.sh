#!/usr/bin/env bash
# Study 1d of the plan of 2026-11-22 (ADR 0097): the rules of studies 1b and 1c together, and the band at the wall. The
# dish of Food ring (384 cells) with the rules of the growth front at Flow strength 8, with one food or nine, 20,000
# steps, on the CPU (feed.ts). At most JOBS runs at once (8). The records lie in research/front/out/p1d/ (git ignores
# it). Usage:
#   bash research/front/p1d.sh probe [case...]            seed 1 of each case (default: all of them)
#   SEEDS="2 3 4 5 6" bash research/front/p1d.sh campaign case...   the seeds of each case
# The cases (the word of a case, then the foods):
#   base-f1, base-f9     today with one food, and `feed=flux` of study 1c with nine (the baseline)
#   jones-f1, jones-f9   rules 1 and 2: every birth from the budget, Jones' births first; the dead give plasm back
#   front-f1, front-f9   the same, the births of the front first
#   alone-f1             rule 1 without rule 2
#   mr-f1, mr-f9         rules 1 and 2 (Jones' births first) under the doubling of Mohberg and Rusch, 14,400 steps
#   nopay-f9             the band: `feed=flux`, and the flux pays no birth (a birth costs 10^12 of flux)
#   wide-f9              the band: `feed=flux` in a dish of 512 cells, the foods where they lie in Food ring
#   nodrift-f9           the band: `feed=flux` without the drift
#   drift9-f9            the band: `feed=flux` with a ninth of the drift, so that it reads the pressure of one food
#   foods-f9, fixed-f9   the band: the flux of one food, with the births of nine (`feed=foods`) or of one (today)
#   long-f9              the band: `feed=flux` as base-f9, to step 26,000, after the territory fills the dish
set -euo pipefail
cd "$(dirname "$0")/../.."
RUN="node --import ./research/flow/register.mjs research/front/feed.ts"
RULES="speed=0.004 speedOn=push reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app"
RULES+=" paidBy=rank fresh=box sums=fixed sinkTube=1 driftOn=take drift=1.5 norm=2 paid=20 flow=8"
PICS="pics=5000,10000,15000,20000"
OUT=research/front/out/p1d
ALL="base-f1 base-f9 jones-f1 jones-f9 front-f1 front-f9 alone-f1 mr-f1 mr-f9 nopay-f9 wide-f9 nodrift-f9"
mkdir -p "$OUT"

# The words of a case after the rules (a later word wins over the same key in the rules).
words() {
  local foods=${1##*-f}
  case "${1%-f*}" in
    base) [ "$foods" = 1 ] && echo "feed=fixed foods=1" || echo "feed=flux foods=9" ;;
    jones) echo "feed=flux payAll=jones refund=1 foods=$foods" ;;
    front) echo "feed=flux payAll=front refund=1 foods=$foods" ;;
    alone) echo "feed=flux payAll=jones foods=$foods" ;;
    mr) echo "feed=flux payAll=jones refund=1 double=14400 foods=$foods" ;;
    nopay) echo "feed=flux paid=1e12 foods=$foods" ;;
    wide) echo "feed=flux side=512 ring=0.225 foodR=5.376 foods=$foods" ;;
    nodrift) echo "feed=flux drift=0 foods=$foods" ;;
    drift9) echo "feed=flux drift=0.1667 foods=$foods" ;;
    foods) echo "feed=foods foods=$foods" ;;
    fixed) echo "feed=fixed foods=$foods" ;;
    long) echo "feed=flux steps=26000 pics=5000,10000,15000,20000,22000,24000,26000 foods=$foods" ;;
    *)
      echo "unknown case $1" >&2
      exit 1
      ;;
  esac
}

jobs=()
case "${1:-}" in
  probe)
    shift
    for c in ${@:-$ALL}; do
      w=$(words "$c")
      jobs+=("$RUN $RULES $PICS $w seeds=1-1 name=p1d/probe/$c > $OUT/probe-$c.txt 2>&1")
    done
    ;;
  campaign)
    shift
    for c in "$@"; do
      w=$(words "$c")
      for s in ${SEEDS:-2 3 4 5 6}; do
        jobs+=("$RUN $RULES $PICS $w seeds=$s-$s name=p1d/c6/$c-s$s > $OUT/c6-$c-s$s.txt 2>&1")
      done
    done
    ;;
  *)
    echo "usage: bash research/front/p1d.sh probe [case...] | campaign case..." >&2
    exit 1
    ;;
esac
printf '%s\0' "${jobs[@]}" | xargs -0 -P "${JOBS:-8}" -n 1 bash -c
