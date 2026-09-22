#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

"$benchmark_root/scripts/build-evaluator-wasm.sh"
"$benchmark_root/scripts/build-pounce-wasm.sh"

exec pnpm --dir "$benchmark_root/web" run benchmark:browser -- "$@"
