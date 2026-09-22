# AC OPF WebAssembly solver benchmarks

This repository is a standalone experiment comparing browser builds of
Ipopt/MUMPS and POUNCE on continuous, balanced AC optimal power flow. It does
not integrate with Tellegen or PowerIO.

The first milestone proved that one AMPL `.nl` model exported by JuMP can be
parsed by POUNCE's evaluator and used to supply the callback contract expected
by `ipopt-wasm`. The second milestone carries the same path through frozen
PowerModels 3-, 14-, and 30-bus AC OPFs and validates every solution
independently from the shared evaluator. The third milestone extends that
correctness path to PGLib-OPF 118-, 300-, and 1,354-bus cases.
An additional 6,468-bus RTE case probes solver robustness and the wasm32
memory boundary.

## Current status

- POUNCE's current `pounce-nl::NlTnlp` exposes objective, gradient,
  constraints, sparse Jacobian, and lower-triangular Lagrangian Hessian
  evaluation through its public `TNLP` interface.
- The evaluator reports zero-based sparse indices, matching `ipopt-wasm`.
- `ipopt-wasm` requires exactly those callbacks and a lower-triangular
  Hessian. It does not parse `.nl` itself.
- JuMP-exported HS071, PowerModels small AC OPFs, and representative PGLib-OPF
  fixtures through 1,354 buses are included with mappings and interface tests.
- Native and browser POUNCE plus browser Ipopt/MUMPS solve the same frozen
  models to the same local solutions across both correctness ladders.
- Every browser-solver candidate passes explicit AC branch-flow, bus-balance,
  DC-loss, limit, bound, reference-angle, and objective checks reconstructed
  from the original MATPOWER case. This validator does not call the shared
  `.nl` evaluator.
- The dedicated worker path has been exercised in a real browser. Single-run
  smoke timings remain diagnostic and are not benchmark evidence.
- A reproducible installed-browser harness now separates cold browser runs,
  unmeasured warm-ups, and seeded fresh-worker repetitions while retaining
  every failure in the denominator.
- The installed package's default Ipopt entry point is wasm32. Its nominal
  address space is 4 GiB, but the generated Emscripten wrapper currently caps
  heap growth at 2 GiB. The package's Memory64 entry point is available as an
  explicit benchmark backend, although its shipped wrapper retains that same
  2 GiB growth cap.

Run the current proof with:

```sh
rustup target add wasm32-unknown-unknown wasm32-wasip1
cargo test --workspace
./scripts/build-evaluator-wasm.sh
./scripts/build-pounce-wasm.sh
cd web && pnpm install --frozen-lockfile && pnpm test:small-cases
```

Build both browser paths, record all six small-case solutions, and independently
validate them with:

```sh
./scripts/run-small-case-correctness.sh
```

Run the equivalent 118-, 300-, and 1,354-bus correctness ladder with:

```sh
./scripts/run-representative-correctness.sh
```

Run the representative timing matrix in installed Chrome with:

```sh
./scripts/run-browser-benchmark.sh \
  --output results/benchmarks/chrome-m4max-2026-09-22.json
```

For the real-browser worker harness, start `pnpm serve` in `web/` and open
`http://127.0.0.1:4173/?autorun=1&case=case3&backend=ipopt-wasm` or replace
the backend with `pounce-wasm`. Cancellation terminates the worker, which is
also the recovery boundary for callback exceptions or a stuck solve.

Regenerate the tiny fixture with:

```sh
./scripts/generate-tiny-fixture.sh
```

Regenerate the frozen AC OPF model, identity maps, and native reference with:

```sh
./scripts/generate-acopf-fixture.sh case14
```

See [`docs/nl-evaluator-feasibility.md`](docs/nl-evaluator-feasibility.md) for
the verified compatibility boundary and
[`docs/case3-acopf.md`](docs/case3-acopf.md) for the first power-system
correctness result. The complete small-case result is in
[`docs/small-case-correctness.md`](docs/small-case-correctness.md). The
representative-scale result is in
[`docs/representative-scale-correctness.md`](docs/representative-scale-correctness.md).
The timing definitions and reproducibility controls are documented in
[`docs/browser-benchmark-protocol.md`](docs/browser-benchmark-protocol.md).
The first installed-Chrome result and recommendation are in
[`docs/browser-benchmark-results.md`](docs/browser-benchmark-results.md).
The 6,468-bus RTE result and memory-limit estimate are in
[`docs/rte-scale-memory.md`](docs/rte-scale-memory.md).
The non-MIT solver boundary is summarized in
[`docs/solver-licenses.md`](docs/solver-licenses.md).

## Intended layout

```text
julia/       pinned reference-model generation and validation
crates/      shared evaluator and native/WASM adapters
web/         minimal browser runner and workers
fixtures/    frozen models, mappings, and provenance
scripts/     repeatable generation and benchmark commands
results/     machine-readable benchmark records
```

Solver and model-source revisions are immutable inputs recorded under
`provenance/`. Benchmark results must record their exact inputs rather than
relying on branch names or package defaults.
