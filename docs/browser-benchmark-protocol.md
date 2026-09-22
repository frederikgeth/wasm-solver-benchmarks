# Browser benchmark protocol

The browser benchmark runs the two solver paths in an installed desktop
Chromium browser through the same dedicated worker used by the interactive
smoke page. It is a runtime comparison, not a replacement for the independent
AC feasibility records in `results/correctness/`.

Run the default representative matrix with:

```sh
./scripts/run-browser-benchmark.sh \
  --output results/benchmarks/chrome-m4max-2026-09-22.json \
  --runs 7 \
  --warmups 1 \
  --cold-runs 1 \
  --seed 20260922
```

The script rebuilds both project-owned Wasm artifacts before launching the
browser. Chrome is the default; `--browser edge` selects Microsoft Edge, and
`--headed` makes the automated window visible. The output records the exact
Git revision and dirty state, browser and Playwright versions, host details,
artifact hashes and sizes, model hashes, initial-point hashes, solver options,
every observation, failure counts, and summary statistics.

## Run definitions

- A cold run launches a new browser process, context, page, worker, and solver
  instance for one case/backend pair. Browser process launch and complete page
  driver elapsed time are recorded separately. The observation's own total
  begins immediately before worker construction.
- A repeated run reuses only the browser process and benchmark page. Each
  observation creates a fresh worker and solver instance, so there is no
  solver warm start. One unmeasured warm-up per pair is the default.
- Measured case/backend pairs are shuffled with the recorded deterministic
  seed. Runs are serial to avoid CPU and memory contention between solvers.
- A timeout terminates the worker and is retained as a failed observation.
  Summaries always report attempts, successes, and failures rather than
  silently dropping failed solves.

`observed_total_ms` spans worker construction, asset fetches, Wasm
instantiation, model/solver preparation, optimization, and transfer of the
full solution back to the page. `worker_internal_total_ms` starts at the
worker's receipt of the request. `optimization_ms` times only the synchronous
solver call. `asset_loading_ms` and preparation time make the main setup costs
visible. All worker timings use `performance.now()`.

The memory field is deliberately narrow: it is the post-solve capacity of the
solver's `WebAssembly.Memory`, not process RSS or peak live allocation.
POUNCE's solver memory is visible. The public `ipopt-wasm` wrapper does not
expose its internal module memory, so that value is `null`; the separate NL
evaluator's memory is reported. These figures must not be presented as a
complete solver-memory comparison.

## Interpretation boundary

Both paths solve the identical frozen JuMP/PowerModels `.nl` bytes from the
same starting point and use exact Hessians, `tol = 1e-9`, `max_iter = 1000`,
and no warm start. Ipopt uses MUMPS. POUNCE uses its built-in FERAL linear
solver with presolve disabled. This is an intentional comparison of the
deployable browser stacks, not an isolation of nonlinear algorithms or linear
solvers.

There is also an integration asymmetry. Ipopt receives callbacks from the
project's Rust NL evaluator Wasm module. POUNCE parses the NL model and solves
inside its WASI Wasm module. Setup and total times therefore matter alongside
optimization time.

Correctness claims come from the independent explicit AC validator documented
in [`representative-scale-correctness.md`](representative-scale-correctness.md).
The timing harness performs a lighter raw-model and objective guard on every
run. It does not claim a cross-solver stationarity comparison because the two
browser adapters do not yet expose a compatible complete multiplier vector.
