#!/usr/bin/env bash
# Montages of pictures for the owner (ADR 0076): the pictures of a row side by side, the rows one below the other,
# with a gap of 8 pixels. All pictures of a montage must have the same size. CROP=w:h:x:y cuts each picture first
# (ffmpeg's crop). Needs ffmpeg. Usage:
#   [CROP=w:h:x:y] bash research/front/crown-montage.sh <out.png> "<the pictures of row 1>" "<the pictures of row 2>" ...
set -euo pipefail
OUT=$1
shift
CUT=${CROP:+crop=$CROP,}
inputs=()
filter=""
rows=""
n=0
r=0
for row in "$@"; do
  cols=""
  c=0
  for pic in $row; do
    inputs+=(-i "$pic")
    filter+="[$n]${CUT}pad=iw+8:ih+8:4:4:color=0x101014[p$n];"
    cols+="[p$n]"
    n=$((n + 1))
    c=$((c + 1))
  done
  if [ "$c" -gt 1 ]; then filter+="${cols}hstack=inputs=$c[r$r];"; else filter+="${cols}null[r$r];"; fi
  rows+="[r$r]"
  r=$((r + 1))
done
if [ "$r" -gt 1 ]; then filter+="${rows}vstack=inputs=$r[out]"; else filter+="${rows}null[out]"; fi
ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex "$filter" -map "[out]" -frames:v 1 "$OUT"
