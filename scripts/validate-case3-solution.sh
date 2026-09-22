#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
candidate_path=${1:-"$benchmark_root/results/smoke/case3-ipopt-wasm.json"}
validation_path=${2:-"$benchmark_root/results/smoke/case3-ipopt-wasm.validation.json"}

exec "$benchmark_root/scripts/validate-acopf-solution.sh" \
  case3 "$candidate_path" "$validation_path"
