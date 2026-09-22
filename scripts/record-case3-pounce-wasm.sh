#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$benchmark_root/scripts/record-acopf-solver.sh" case3 pounce-wasm
