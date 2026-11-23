#!/usr/bin/env bash
# The pictures of study 1d (ADR 0097) for the owner, seed 1, from the runs of p1d.sh: rows the cases, columns steps.
# Each montage gets a copy of at most 2,000 pixels in width, named *-small.png. Needs ffmpeg and sips (macOS). Usage:
#   bash research/front/p1d-montage.sh
set -euo pipefail
cd "$(dirname "$0")/out/p1d"
MONTAGE=../../crown-montage.sh
# The pictures of a case at the steps given, from the probe (seed 1).
row() {
  local case=$1
  shift
  for k in "$@"; do printf '%s ' "probe/$case-pics/s1-$k.png"; done
}
# The cases of the rules: one food, and nine foods, at the steps 5,000, 10,000 and 20,000.
bash $MONTAGE p1d-seed1-f1.png "$(row base-f1 5000 10000 20000)" "$(row jones-f1 5000 10000 20000)" \
  "$(row front-f1 5000 10000 20000)" "$(row alone-f1 5000 10000 20000)" "$(row mr-f1 5000 10000 20000)"
bash $MONTAGE p1d-seed1-f9.png "$(row base-f9 5000 10000 20000)" "$(row jones-f9 5000 10000 20000)" \
  "$(row front-f9 5000 10000 20000)" "$(row mr-f9 5000 10000 20000)"
# The band: nine foods at the steps 10,000, 15,000 and 20,000; the dish of 512 cells scaled to the size of the others.
if [ -f probe/long-f9-pics/s1-26000.png ]; then
  mkdir -p wide768
  for k in 10000 15000 20000; do
    ffmpeg -hide_banner -loglevel error -y -i "probe/wide-f9-pics/s1-$k.png" -vf scale=768:768 "wide768/s1-$k.png"
  done
  wide="wide768/s1-10000.png wide768/s1-15000.png wide768/s1-20000.png"
  bash $MONTAGE p1d-band-seed1.png "$(row base-f9 10000 15000 20000)" "$(row nopay-f9 10000 15000 20000)" \
    "$wide" "$(row drift9-f9 10000 15000 20000)" "$(row foods-f9 10000 15000 20000)" \
    "$(row fixed-f9 10000 15000 20000)" "$(row long-f9 22000 24000 26000)"
fi
for f in p1d-*.png; do
  case $f in *-small.png) continue ;; esac
  sips --resampleWidth 2000 "$f" --out "${f%.png}-small.png" > /dev/null
done
