#!/usr/bin/env bash
# ADR 0100, part A: the forms of what the front may spend of the budget (`frontPay` of sim.ts) in the dish of Food ring
# with nine foods, seed 1, on the CPU (feed.ts), with the rules of the port: `cap-f9` of p1d.sh and the drift of one
# food (`driftPerFood=1`, part B). The case with `frontPay=all` is the coordinator's `capdrift-f9` of 2026-11-26. The
# records and pictures go to research/front/out/p1f/ (git ignores it). About 25 minutes per run, all at once.
# Usage: bash research/front/p1f.sh [form ...]   (default: take rates step)
set -euo pipefail
cd "$(dirname "$0")/../.."
RUN="node --import ./research/flow/register.mjs research/front/feed.ts"
RULES="speed=0.004 speedOn=push reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app"
RULES+=" paidBy=rank fresh=box sums=fixed sinkTube=1 driftOn=take drift=1.5 norm=2 paid=20 flow=8"
RULES+=" feed=flux payAll=front refund=1 feedCap=1 driftPerFood=1"
PICS="pics=5000,10000,15000,20000"
OUT=research/front/out/p1f
mkdir -p "$OUT"
forms=${*:-take rates step}
for f in $forms; do
  $RUN $RULES $PICS frontPay=$f foods=9 seeds=1-1 name=p1f/$f-f9 > "$OUT/$f-f9.txt" 2>&1 &
done
wait
