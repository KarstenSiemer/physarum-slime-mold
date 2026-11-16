#!/bin/bash
# Runs a command in the Playwright image of CI (.github/workflows/ci.yml), on 4 cores like a runner of GitHub, on a
# copy of a checkout: the packages and the built site of that checkout, then the command as CI runs it (CI=1). The
# output goes to research/start/out/<name>.txt, and the JSON report of Playwright to <name>.json (ADR 0049, README.md).
# Usage: research/start/run.sh <checkout> <name> <command...>
set -euo pipefail
CHECKOUT=$(cd "$1" && pwd)
NAME=$2
shift 2
OUT="$(cd "$(dirname "$0")" && pwd)/out"
IMAGE=$(grep -o -m 1 'mcr.microsoft.com/playwright:[^ ]*' "$(dirname "$0")/../../.github/workflows/ci.yml")
mkdir -p "$OUT"
docker run --rm --ipc=host --cpus=4 -v "$CHECKOUT":/src:ro -v "$OUT":/out -e CI=1 -e NAME="$NAME" "$IMAGE" bash -c '
set -e
mkdir /work
tar -C /src --exclude=./.git --exclude=./node_modules --exclude=./dist --exclude="./research/*/out" -cf - . | tar -xf - -C /work
cd /work
npm ci --no-audit --no-fund > /dev/null 2>&1
npm run build > /dev/null 2>&1
PLAYWRIGHT_JSON_OUTPUT_NAME="/out/$NAME.json" "$@" > "/out/$NAME.txt" 2>&1 || echo "exit $?" >> "/out/$NAME.txt"
' bash "$@"
echo "research/start/out/$NAME.txt"
