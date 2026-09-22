#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
benchmark_julia=${ACOPF_JULIA:-julia}
case_name=${1:?usage: generate-acopf-fixture.sh CASE_NAME}

case "$case_name" in
  *[!A-Za-z0-9_-]*) echo "invalid case name: $case_name" >&2; exit 2 ;;
esac

case_path="$benchmark_root/fixtures/cases/$case_name.m"
test -f "$case_path"

"$benchmark_julia" --project="$benchmark_root/julia" \
  --startup-file=no --history-file=no \
  "$benchmark_root/julia/export_acopf_fixture.jl" \
  "$case_path" \
  "$benchmark_root/fixtures/acopf/$case_name" \
  "$case_name-acopf" \
  "PowerModels $case_name"
