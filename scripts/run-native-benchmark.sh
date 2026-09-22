#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
benchmark_julia=${ACOPF_JULIA:-julia}

export JULIA_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1

exec "$benchmark_julia" --project="$benchmark_root/julia" \
  --startup-file=no --history-file=no \
  "$benchmark_root/julia/benchmark_native_acopf.jl" "$@"
