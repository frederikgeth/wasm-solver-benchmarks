#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$benchmark_root"
cargo build --locked --release --target wasm32-wasip1 \
  --package acopf-pounce-browser-wasm \
  --config profile.release.debug=false \
  --config 'profile.release.strip="symbols"'
