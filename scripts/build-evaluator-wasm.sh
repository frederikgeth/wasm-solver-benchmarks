#!/bin/sh
set -eu

benchmark_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$benchmark_root"
cargo build --locked --release --target wasm32-unknown-unknown \
  --package acopf-nl-evaluator-wasm

