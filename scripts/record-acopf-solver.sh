#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
benchmark_node=${ACOPF_NODE:-node}
case_name=${1:?usage: record-acopf-solver.sh CASE_NAME BACKEND}
backend=${2:?usage: record-acopf-solver.sh CASE_NAME BACKEND}

case "$case_name" in
  *[!A-Za-z0-9_-]*) echo "invalid case name: $case_name" >&2; exit 2 ;;
esac
case "$backend" in
  ipopt-wasm) runner="$benchmark_root/web/test/acopf-ipopt-smoke.mjs" ;;
  pounce-wasm) runner="$benchmark_root/web/test/acopf-pounce-smoke.mjs" ;;
  *) echo "unsupported backend: $backend" >&2; exit 2 ;;
esac

candidate_path="$benchmark_root/results/smoke/$case_name-$backend.json"
validation_path="$benchmark_root/results/smoke/$case_name-$backend.validation.json"

ACOPF_CASE="$case_name" ACOPF_RESULT_PATH="$candidate_path" "$benchmark_node" "$runner"
"$benchmark_root/scripts/validate-acopf-solution.sh" \
  "$case_name" "$candidate_path" "$validation_path"
