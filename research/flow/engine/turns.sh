#!/bin/zsh
# Times builds of the app in turns with bench.gpu.test.ts, so that a change of the machine slows every build alike
# (ADR 0038, check of 2026-11-15). Not a test of the app.
#
#   research/flow/engine/turns.sh <rounds> <name>=<worktree>[:wall][:w<side>] ...
#
# Each <worktree> is a checkout of one commit with node_modules and the same research/flow/engine/bench.gpu.test.ts
# (copy it from the newest commit). `:wall` runs it with VITE_WALL=1, and `:w<side>` with VITE_WINDOW=<side>, the mean
# window of the Jones model (ADR 0046): `:w15` is the window of 15 × 15 cells. Odd rounds run the builds in the order given,
# even rounds in the reverse order. VITE_SCENES, VITE_FLOWS and the other variables of bench.gpu.test.ts pass through.
# A round writes <worktree>/research/flow/out/engine/<name>-r<round>.jsonl. Each run prints a line with the time, the
# load and the number of other Vitest processes: a run beside another one does not count.
set -eu
rounds=$1
shift
builds=("$@")
run() {
  local name=${1%%=*} rest=${1#*=}
  local tree=${rest%%:*} wall=0 window=0
  [[ $rest == *:wall* ]] && wall=1
  [[ $rest == *:w<-> ]] && window=${rest##*:w}
  local others=$(pgrep -f vitest | wc -l | tr -d ' ')
  print "$(date +%H:%M:%S) start $name-r$2 load $(sysctl -n vm.loadavg) other-vitest $others"
  (cd $tree && VITE_NAME=$name-r$2 VITE_WALL=$wall VITE_WINDOW=$window npx vitest run --config research/vitest.config.ts \
    research/flow/engine/bench.gpu.test.ts > /dev/null)
  print "$(date +%H:%M:%S) end $name-r$2"
}
for r in $(seq 1 $rounds); do
  if (( r % 2 )); then order=("${builds[@]}"); else order=("${(@Oa)builds}"); fi
  for b in "${order[@]}"; do run $b $r; done
done
