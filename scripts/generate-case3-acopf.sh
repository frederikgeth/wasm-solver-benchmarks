#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
benchmark_julia=${ACOPF_JULIA:-julia}

"$benchmark_julia" --project="$benchmark_root/julia" \
  --startup-file=no --history-file=no \
  "$benchmark_root/julia/export_case3_acopf.jl" \
  "$benchmark_root/fixtures/cases/case3.m" \
  "$benchmark_root/fixtures/acopf/case3"
