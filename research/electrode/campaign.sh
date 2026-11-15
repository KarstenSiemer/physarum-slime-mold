#!/bin/zsh
# The runs behind the numbers of ADR 0047 (README.md): the scene Electrotaxis over 10 seeds, as the app runs it on
# both backends, with a field that settled first, with the poles swapped, without the electrodes, and with other
# values of the damping and of the mean window. Not a test of the app. Run it from the root of the repository:
#
#   research/electrode/campaign.sh
#
# Each run writes research/electrode/out/<label>.jsonl (electrotaxis.gpu.test.ts).
set -eu
run() {
  local label=$1
  shift
  env "$@" VITE_EL_STEPS=800 VITE_EL_LABEL=$label npx vitest run --config research/vitest.config.ts \
    research/electrode/electrotaxis.gpu.test.ts | grep -E "Tests|FAIL|Error"
}
run app-webgpu VITE_EL_KIND=webgpu
run app-webgl2 VITE_EL_KIND=webgl2
run settled-webgpu VITE_EL_KIND=webgpu VITE_EL_SETTLE=400
run settled-webgl2 VITE_EL_KIND=webgl2 VITE_EL_SETTLE=400
run swap-webgpu VITE_EL_KIND=webgpu VITE_EL_SWAP=1
run off-webgpu VITE_EL_KIND=webgpu 'VITE_EL_PATCH={"electrodeStrength":0}'
run d0.1-webgpu VITE_EL_KIND=webgpu 'VITE_EL_STRAIN={"decay":0.1}'
run d0.03-webgpu VITE_EL_KIND=webgpu 'VITE_EL_STRAIN={"decay":0.03}'
run d0.003-webgpu VITE_EL_KIND=webgpu 'VITE_EL_STRAIN={"decay":0.003}'
run window3-webgpu VITE_EL_KIND=webgpu 'VITE_EL_PATCH={"meanWindow":3}'
