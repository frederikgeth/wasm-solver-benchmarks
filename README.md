# AC OPF WebAssembly solver benchmarks

This repository is a standalone experiment comparing browser builds of
Ipopt/MUMPS and POUNCE on continuous, balanced AC optimal power flow. It does
not integrate with Tellegen or PowerIO.

The first milestone proved that one AMPL `.nl` model exported by JuMP can be
parsed by POUNCE's evaluator and used to supply the callback contract expected
by `ipopt-wasm`. The second milestone carries the same path through a frozen
PowerModels 3-bus AC OPF and validates its solution independently from the
shared evaluator.

## Current status

- POUNCE's current `pounce-nl::NlTnlp` exposes objective, gradient,
  constraints, sparse Jacobian, and lower-triangular Lagrangian Hessian
  evaluation through its public `TNLP` interface.
- The evaluator reports zero-based sparse indices, matching `ipopt-wasm`.
- `ipopt-wasm` requires exactly those callbacks and a lower-triangular
  Hessian. It does not parse `.nl` itself.
- JuMP-exported HS071 and PowerModels 3-bus AC OPF fixtures, mappings, and
  numerical interface tests are included.
- Native and browser POUNCE plus browser Ipopt/MUMPS solve the same frozen
  model to the same local solution on the 3-bus fixture.
- Both 3-bus browser-solver candidates pass explicit AC branch-flow, bus-balance,
  DC-loss, limit, bound, reference-angle, and objective checks reconstructed
  from the original MATPOWER case. This validator does not call the shared
  `.nl` evaluator.
- The dedicated worker path has been exercised in a real browser. Single-run
  smoke timings remain diagnostic and are not benchmark evidence.

Run the current proof with:

```sh
rustup target add wasm32-unknown-unknown wasm32-wasip1
cargo test --workspace
./scripts/build-evaluator-wasm.sh
./scripts/build-pounce-wasm.sh
cd web && pnpm install --frozen-lockfile && pnpm test:solver-smoke
```

Build both browser paths, record both 3-bus solutions, and independently
validate them with:

```sh
./scripts/run-case3-correctness.sh
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
./scripts/generate-case3-acopf.sh
```

See [`docs/nl-evaluator-feasibility.md`](docs/nl-evaluator-feasibility.md) for
the verified compatibility boundary and [`docs/case3-acopf.md`](docs/case3-acopf.md)
for the first power-system correctness result. The non-MIT solver boundary is
summarized in [`docs/solver-licenses.md`](docs/solver-licenses.md).

## Intended layout

```text
julia/       pinned reference-model generation and validation
crates/      shared evaluator and native/WASM adapters
web/         minimal browser runner and workers (next milestone)
fixtures/    frozen models, mappings, and provenance
scripts/     repeatable generation and benchmark commands
results/     machine-readable benchmark records
```

Solver and model-source revisions are immutable inputs recorded under
`provenance/`. Benchmark results must record their exact inputs rather than
relying on branch names or package defaults.
