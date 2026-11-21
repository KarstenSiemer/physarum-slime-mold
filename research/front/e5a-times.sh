#!/bin/zsh
# Part E5a of stage 4 (ADR 0086): the time of a step of the Maze with the flow, on both backends, in turns as
# research/flow/engine/turns.sh times builds, so that a change of the machine slows every build alike. Four builds:
# `main`; this branch with the flow over 8 neighbours as a branch on a uniform (research/front/e5a-uniform.ts), at 4
# neighbours; this branch at 4 neighbours; and this branch at 8 neighbours. The copies of `main` and of the uniform form
# lie in .main-src and .uniform-src at the root of the checkout, outside research/ (research/front/E2e-NOTES.md, part 6,
# has the trap). Delete both before `npm run lint`. Each run writes <copy>/research/flow/out/engine/<build>-r<round>.jsonl.
# Usage:
#   zsh research/front/e5a-times.sh copies                   the two copies, from origin/main and from HEAD
#   zsh research/front/e5a-times.sh run <rounds> [<first>]   the rounds: odd ones in the order above, even ones reversed
#   node research/front/e5a-times.ts                         the medians of the rounds
set -eu
cd "$(dirname "$0")/../.."
root=$PWD
if [ "${1:-}" = copies ]; then
  rm -rf .main-src .uniform-src
  mkdir -p .main-src .uniform-src
  git archive origin/main | tar -x -C .main-src
  git archive HEAD | tar -x -C .uniform-src
  node research/front/e5a-uniform.ts .uniform-src/src/engine/shaders/flow.wgsl .uniform-src/src/engine/gl/glsl/flow.frag
  exit 0
fi
if [ "${1:-}" != run ]; then
  print -u2 'usage: zsh research/front/e5a-times.sh copies | run <rounds> [<first>]'
  exit 1
fi
rounds=$2
first=${3:-1}
run() {
  local name=$1 tree=$2 patch=$3 round=$4
  local others=$(pgrep -f vitest | wc -l | tr -d ' ')
  print "$(date +%H:%M:%S) start $name-r$round load $(sysctl -n vm.loadavg) other-vitest $others"
  (cd $root/$tree && VITE_NAME=$name-r$round VITE_SCENES=maze VITE_FLOWS=on VITE_PATCH=$patch npx vitest run \
    --config research/vitest.config.ts research/flow/engine/bench.gpu.test.ts | grep -E 'Tests ')
  print "$(date +%H:%M:%S) end $name-r$round"
}
builds=('main|.main-src|{}' 'uniform4|.uniform-src|{}' 'edges4|.|{}' 'edges8|.|{"flowEdges":8}')
for r in $(seq $first $((first + rounds - 1))); do
  if (( r % 2 )); then order=("${builds[@]}"); else order=("${(@Oa)builds}"); fi
  for b in "${order[@]}"; do
    parts=("${(@s:|:)b}")
    run $parts[1] $parts[2] $parts[3] $r
  done
done
