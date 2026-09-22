#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

"$benchmark_root/scripts/build-evaluator-wasm.sh"
"$benchmark_root/scripts/build-pounce-wasm.sh"

for case_name in case118 case300 case1354; do
  "$benchmark_root/scripts/record-acopf-solver.sh" "$case_name" ipopt-wasm
  "$benchmark_root/scripts/record-acopf-solver.sh" "$case_name" pounce-wasm
done
