# Solver license boundary

The benchmark's original adapter and harness code is MIT-licensed. Building
or installing the solver paths also brings in software under other licenses;
the wrapper licenses do not relicense the solvers they contain.

- POUNCE 0.12.0 at the pinned revision is EPL-2.0. Both the shared NL
  evaluator and `acopf-pounce-browser-wasm` link its Rust crates.
- `ipopt-wasm` 0.2.0's JavaScript/C wrapper is MIT. Its prebuilt module
  bundles Ipopt (EPL-2.0), MUMPS (CeCILL-C), reference LAPACK (BSD-3-Clause),
  and flang runtime components (Apache-2.0 with LLVM exception), as recorded
  by upstream's `THIRD_PARTY_LICENSES.md`.

Built solver artifacts live under ignored `target/` and `web/node_modules/`
directories and are not committed here. Any later distribution must carry the
complete license texts and notices required by the pinned upstream packages.
This standalone experiment does not modify Tellegen's dependency or release
policy.
