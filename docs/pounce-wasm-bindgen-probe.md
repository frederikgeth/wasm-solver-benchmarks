# POUNCE `wasm-bindgen` target probe

23 September 2026, pinned POUNCE revision
`925e75fbd036de309929e398159f946d42d0d94b`.

This probe isolates the target/ABI question from PowerIO modeling. It wraps
the **same POUNCE NL load and solve functions** used by the working WASI
benchmark in a small `wasm-bindgen` crate and builds for Tellegen's
`wasm32-unknown-unknown` target. Frozen HS071 and case3 inputs are reused.
The generated package is ignored; no built binary is committed.

Reproduce with `wasm-pack` and Node available:

```sh
wasm-pack build crates/pounce-bindgen-probe --target web --release \
  --out-dir ../../web/generated/pounce-bindgen --no-opt
node web/test/pounce-bindgen-probe.mjs hs071
node web/test/pounce-bindgen-probe.mjs case3
```

| Gate | Result |
| --- | --- |
| Rust compile to `wasm32-unknown-unknown` | Pass |
| Generate `wasm-bindgen` JS and WASM package | Pass; 3.9 MiB WASM (no `wasm-opt`) |
| Load/parse frozen NL in Node | HS071 passes; case3 passes |
| Solve through the generated binding | **Fails at first `std::time::Instant::now()`** with `RuntimeError: unreachable` |

This is a target runtime problem, not a `wasm-bindgen` argument-conversion or
NL-parser problem. The stack enters
`pounce_algorithm::application::IpoptApplication::optimize_constrained` and
then Rust's `std::time::Instant::now`; the latter panics on
`wasm32-unknown-unknown`. [POUNCE's own browser README](https://github.com/jkitchin/pounce/blob/925e75fbd036de309929e398159f946d42d0d94b/crates/pounce-wasm/web/README.md#why-wasi-and-not-wasm-bindgen)
explains this WASI choice and notes timing calls throughout the solver. A
direct `wasm-bindgen` wrapper alone cannot fix the clock; testing a browser
would hit the same compiled panic, so this probe stops at the Node WASM
runtime rather than treating the successful build as a successful integration.

For Tellegen, keep the already-tested POUNCE WASI worker as the near-term
browser architecture, or ask upstream to introduce a portable clock
abstraction (and stdout handling) before attempting a single
`wasm32-unknown-unknown` module. The PowerIO → in-memory POUNCE expression
model remains a separate spike: this negative result does **not** imply NL
files should become Tellegen's permanent modeling format. The expression
model can be constructed inside a Rust/WASI module, with a typed JS worker
boundary. If upstream supplies the portable clock, rerun this probe and then
measure browser solve behavior and memory before changing that architecture.
