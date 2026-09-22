#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$benchmark_root/scripts/generate-acopf-fixture.sh" case3
