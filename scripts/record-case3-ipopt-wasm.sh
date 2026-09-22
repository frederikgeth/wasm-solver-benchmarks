#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
candidate_path="$benchmark_root/results/smoke/case3-ipopt-wasm.json"
validation_path="$benchmark_root/results/smoke/case3-ipopt-wasm.validation.json"

ACOPF_RESULT_PATH="$candidate_path" pnpm --dir "$benchmark_root/web" run test:case3
"$benchmark_root/scripts/validate-case3-solution.sh" "$candidate_path" "$validation_path"
