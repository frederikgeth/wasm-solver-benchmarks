#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

"$benchmark_root/scripts/build-evaluator-wasm.sh"
"$benchmark_root/scripts/build-pounce-wasm.sh"
"$benchmark_root/scripts/record-case3-ipopt-wasm.sh"
"$benchmark_root/scripts/record-case3-pounce-wasm.sh"
