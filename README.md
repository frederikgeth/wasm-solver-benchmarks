# AC OPF WebAssembly solver benchmarks

This repository is a standalone experiment comparing browser builds of
Ipopt/MUMPS and POUNCE on continuous, balanced AC optimal power flow. It does
not integrate with Tellegen or PowerIO.

The first milestone is deliberately smaller than AC OPF: prove that one AMPL
`.nl` model exported by JuMP can be parsed by POUNCE's evaluator and used to
supply the callback contract expected by `ipopt-wasm`. The native Rust
`nl-evaluator` crate is the first executable proof of that interface.

## Current status

- POUNCE's current `pounce-nl::NlTnlp` exposes objective, gradient,
  constraints, sparse Jacobian, and lower-triangular Lagrangian Hessian
  evaluation through its public `TNLP` interface.
- The evaluator reports zero-based sparse indices, matching `ipopt-wasm`.
- `ipopt-wasm` requires exactly those callbacks and a lower-triangular
  Hessian. It does not parse `.nl` itself.
- A JuMP-exported HS071 fixture and numerical interface tests are included.

Run the current proof with:

```sh
cargo test --workspace
```

Regenerate the tiny fixture with:

```sh
./scripts/generate-tiny-fixture.sh
```

See [`docs/nl-evaluator-feasibility.md`](docs/nl-evaluator-feasibility.md) for
the verified compatibility boundary and the next browser step.

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

