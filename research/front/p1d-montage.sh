#!/usr/bin/env bash
# The pictures of study 1d (ADR 0097) for the owner, seed 1, from the runs of p1d.sh: rows the cases, columns steps. A
# case whose pictures are missing is left out. Each montage gets a copy of at most 2,000 pixels in width, named
# *-small.png. Needs ffmpeg and sips (macOS). Usage:
#   bash research/front/p1d-montage.sh
set -euo pipefail
cd "$(dirname "$0")/out/p1d"
MONTAGE=../../crown-montage.sh
# The rows of a montage: for each case its pictures at the steps STEPS, if the last one exists.
rows() {
  local dir=${DIR:-probe} out=()
  for c in "$@"; do
    local last=${STEPS##* }
    [ -f "$dir/$c-pics/s1-$last.png" ] || continue
    local row=""
    for k in $STEPS; do row+="$dir/$c-pics/s1-$k.png "; done
    out+=("$row")
  done
  printf '%s\0' "${out[@]}"
}
montage() {
  local name=$1
  shift
  local list=()
  while IFS= read -r -d '' r; do list+=("$r"); done < <(rows "$@")
  bash $MONTAGE "$name" "${list[@]}"
}
# The rules, seed 1: one food and nine foods at the steps 5,000, 10,000 and 20,000.
STEPS="5000 10000 20000"
montage p1d-seed1-f1.png base-f1 jones-f1 front-f1 cap-f1 edge-f1 alone-f1 mr-f1 fast-f1
montage p1d-seed1-f9.png base-f9 jones-f9 front-f9 cap-f9 edge-f9 mr-f9 fast-f9
# The band: nine foods at the steps 10,000, 15,000 and 20,000; the dish of 512 cells scaled to the size of the others;
# the last row today's `feed=flux` after the dish is full, at the steps 22,000, 24,000 and 26,000.
mkdir -p wide/wide-f9-pics
for k in 10000 15000 20000; do
  ffmpeg -hide_banner -loglevel error -y -i "probe/wide-f9-pics/s1-$k.png" -vf scale=768:768 "wide/wide-f9-pics/s1-$k.png"
done
STEPS="10000 15000 20000"
list=()
while IFS= read -r -d '' r; do list+=("$r"); done < <(rows base-f9 nopay-f9)
while IFS= read -r -d '' r; do list+=("$r"); done < <(DIR=wide rows wide-f9)
while IFS= read -r -d '' r; do list+=("$r"); done < <(rows drift1-f9 foods-f9 fixed-f9)
while IFS= read -r -d '' r; do list+=("$r"); done < <(STEPS="22000 24000 26000" rows long-f9)
bash $MONTAGE p1d-band-seed1.png "${list[@]}"
for f in p1d-*.png; do
  case $f in *-small.png) continue ;; esac
  sips --resampleWidth 2000 "$f" --out "${f%.png}-small.png" > /dev/null
done
