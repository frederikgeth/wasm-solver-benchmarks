#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
benchmark_julia=${ACOPF_JULIA:-julia}
case_name=${1:?usage: validate-acopf-solution.sh CASE_NAME CANDIDATE [REPORT]}
candidate_path=${2:?usage: validate-acopf-solution.sh CASE_NAME CANDIDATE [REPORT]}
validation_path=${3:-"$candidate_path.validation.json"}

case "$case_name" in
  *[!A-Za-z0-9_-]*) echo "invalid case name: $case_name" >&2; exit 2 ;;
esac

"$benchmark_julia" --project="$benchmark_root/julia" \
  --startup-file=no --history-file=no \
  "$benchmark_root/julia/validate_acopf_solution.jl" \
  "$benchmark_root/fixtures/cases/$case_name.m" \
  "$benchmark_root/fixtures/acopf/$case_name/$case_name-acopf.mapping.json" \
  "$candidate_path" \
  "$validation_path"
