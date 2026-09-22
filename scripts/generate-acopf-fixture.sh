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

case "$case_name" in
  case3|case14|case30)
    case_label="PowerModels $case_name"
    upstream_path="PowerModels.jl/test/data/matpower/$case_name.m"
    upstream_revision="f8ef54f762502cfae7760ea6314c4683b18b1ec5"
    ;;
  case118)
    case_label="PGLib-OPF v23.07 case118_ieee"
    upstream_path="pglib-opf-23.07/pglib_opf_case118_ieee.m"
    upstream_revision="v23.07; artifact tree 0e8968a89b6ad43910a8eda4ec30656add35cf91"
    ;;
  case300)
    case_label="PGLib-OPF v23.07 case300_ieee"
    upstream_path="pglib-opf-23.07/pglib_opf_case300_ieee.m"
    upstream_revision="v23.07; artifact tree 0e8968a89b6ad43910a8eda4ec30656add35cf91"
    ;;
  case1354)
    case_label="PGLib-OPF v23.07 case1354_pegase"
    upstream_path="pglib-opf-23.07/pglib_opf_case1354_pegase.m"
    upstream_revision="v23.07; artifact tree 0e8968a89b6ad43910a8eda4ec30656add35cf91"
    ;;
  case6468)
    case_label="PGLib-OPF v23.07 case6468_rte"
    upstream_path="pglib-opf-23.07/pglib_opf_case6468_rte.m"
    upstream_revision="v23.07; artifact tree 0e8968a89b6ad43910a8eda4ec30656add35cf91"
    ;;
  case6515)
    case_label="PGLib-OPF v23.07 case6515_rte"
    upstream_path="pglib-opf-23.07/pglib_opf_case6515_rte.m"
    upstream_revision="v23.07; artifact tree 0e8968a89b6ad43910a8eda4ec30656add35cf91"
    ;;
  case9241)
    case_label="PGLib-OPF v23.07 case9241_pegase"
    upstream_path="pglib-opf-23.07/pglib_opf_case9241_pegase.m"
    upstream_revision="v23.07; artifact tree 0e8968a89b6ad43910a8eda4ec30656add35cf91"
    ;;
  *)
    echo "case $case_name has no pinned provenance entry" >&2
    exit 2
    ;;
esac

"$benchmark_julia" --project="$benchmark_root/julia" \
  --startup-file=no --history-file=no \
  "$benchmark_root/julia/export_acopf_fixture.jl" \
  "$case_path" \
  "$benchmark_root/fixtures/acopf/$case_name" \
  "$case_name-acopf" \
  "$case_label" \
  "$upstream_path" \
  "$upstream_revision"
