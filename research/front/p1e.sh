#!/usr/bin/env bash
# Nine foods, seed 1, in the prototype (ADR 0100, decision 2): the front first with Jones' births only at the edge of the
# territory, with and without the cap of docs/model.md 9.1 on the credit, or only on young ground (an open point of ADR
# 0097). The coordinator ran it on 2026-11-26. The rules are those of research/front/p1d.sh; the records and pictures go
# to research/front/out/p1e/ (git ignores it). The case with the cap and Jones' births everywhere is `cap-f9` of p1d.sh.
# Usage: bash research/front/p1e.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
RUN="node --import ./research/flow/register.mjs research/front/feed.ts"
RULES="speed=0.004 speedOn=push reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app"
RULES+=" paidBy=rank fresh=box sums=fixed sinkTube=1 driftOn=take drift=1.5 norm=2 paid=20 flow=8"
PICS="pics=5000,10000,15000,20000"
OUT=research/front/out/p1e
mkdir -p "$OUT"
$RUN $RULES $PICS feed=flux payAll=front refund=1 jones=edge foods=9 seeds=1-1 name=p1e/fedge-f9 > "$OUT/fedge-f9.txt" 2>&1 &
$RUN $RULES $PICS feed=flux payAll=front refund=1 feedCap=1 jones=edge foods=9 seeds=1-1 name=p1e/edge-f9 \
  > "$OUT/edge-f9.txt" 2>&1 &
$RUN $RULES $PICS feed=flux payAll=front refund=1 jones=young foods=9 seeds=1-1 name=p1e/young-f9 > "$OUT/young-f9.txt" 2>&1 &
wait
