#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
benchmark_julia=${ACOPF_JULIA:-julia}
candidate_path=${1:-"$benchmark_root/results/smoke/case3-ipopt-wasm.json"}
validation_path=${2:-"$benchmark_root/results/smoke/case3-ipopt-wasm.validation.json"}

"$benchmark_julia" --project="$benchmark_root/julia" \
  --startup-file=no --history-file=no \
  "$benchmark_root/julia/validate_case3_solution.jl" \
  "$benchmark_root/fixtures/cases/case3.m" \
  "$benchmark_root/fixtures/acopf/case3/case3-acopf.mapping.json" \
  "$candidate_path" \
  "$validation_path"
