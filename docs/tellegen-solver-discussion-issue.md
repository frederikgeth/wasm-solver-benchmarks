# Proposed issue title

Discussion: choose the initial browser AC OPF solver backend

## Issue body

## Summary

We now have a standalone, reproducible browser benchmark comparing
`ipopt-wasm`/MUMPS and POUNCE on balanced, continuous AC optimal power flow,
with PowerModels.jl + native Ipopt/MUMPS as the formulation reference and
native timing baseline.

Based on the evidence so far, I propose that we:

1. use **ipopt-wasm as the leading backend for Tellegen's first balanced AC
   OPF integration spike**;
2. keep the Tellegen nonlinear model/evaluator and execution interface
   solver-neutral;
3. retain POUNCE behind the same correctness and performance fixtures as a
   challenger; and
4. treat this as a provisional integration choice, not yet a production or
   distribution decision.

The main reason is robustness at scale. Browser Ipopt produced independently
feasible solutions for all seven cases in the current ladder. POUNCE solved
six but failed restoration on the largest, 6,468-bus RTE case and returned an
infeasible candidate. Ipopt also had the stronger runtime result at the
largest repeatedly benchmarked case.

No Tellegen or PowerIO integration has been implemented as part of this work.
The experiment is isolated in
[`frederikgeth/wasm-solver-benchmarks`](https://github.com/frederikgeth/wasm-solver-benchmarks).

## What was tested

- Balanced continuous AC OPF models built with `PowerModels.ACPPowerModel`
  and `PowerModels.build_opf`.
- A frozen AMPL NL model, starting point, sparse structures, and exact
  Hessian shared by both browser solver paths.
- Browser execution in dedicated workers using installed Chrome on an Apple
  M4 Max with 48 GiB RAM.
- Ipopt with MUMPS versus POUNCE with its FERAL linear solver.
- Independent AC validation reconstructed from the original MATPOWER data,
  rather than trusting the shared NL evaluator or objective alone.
- Seven-run representative benchmarks for 118-, 300-, and 1,354-bus cases.
- A 6,468-bus RTE scale and memory probe.
- A separate seven-run, single-threaded native PowerModels + Ipopt/MUMPS
  baseline.

Both browser paths use `tol = 1e-9`, `max_iter = 1000`, exact Hessians, the
same initial point, and no warm start. Timed observations use a fresh worker
and solver instance. The benchmark retains failures in the denominator.

## Correctness and robustness

Both browser solvers reached the native-reference local solution and passed
the independent `1e-6` p.u. feasibility gate through 1,354 buses.

On `case6468_rte`:

- Ipopt wasm32 succeeded and matched the native-reference objective. Its
  solution passed the independent AC validator.
- Ipopt Memory64 also succeeded at the same objective.
- POUNCE returned `RestorationFailed` after 54 iterations. Independent
  validation found 19.36 p.u. maximum active-power balance error and a
  530.50 p.u. branch-equation residual. This is a solver robustness failure,
  not evidence that the AC OPF is infeasible.

The current independently feasible solve rate is therefore:

| Browser backend | Feasible cases |
| --- | ---: |
| Ipopt/MUMPS | 7/7 |
| POUNCE/FERAL | 6/7 |

## Browser performance

The representative entries below are medians of seven serial runs after one
warm-up. “Total” includes browser-side loading, preparation, optimization,
and full solution transfer.

| Case | Ipopt optimization | Ipopt total | POUNCE optimization | POUNCE total |
| --- | ---: | ---: | ---: | ---: |
| case118 | 155.8 ms | 191.1 ms | 116.0 ms | 163.6 ms |
| case300 | 273.7 ms | 327.9 ms | 268.7 ms | 336.2 ms |
| case1354 | 1,339.3 ms | 1,503.2 ms | 1,752.4 ms | 1,932.0 ms |

POUNCE's total median was 14.4% lower on case118 and 2.5% higher on case300.
On case1354, Ipopt completed the end-to-end path 22.2% sooner. The RTE probe
was a single browser run rather than a repeated benchmark: Ipopt wasm32 solved
in 17.84 s, Memory64 solved in 19.45 s, and POUNCE failed after 10.66 s.
POUNCE's failure time is not a successful-solve performance result.

## Native PowerModels comparison

The closest available calculation-time comparison is native Ipopt's reported
solve time against the browser Ipopt wrapper's synchronous solver-call time:

| Case | Native PowerModels + Ipopt/MUMPS | Browser Ipopt wasm32 | Browser/native |
| --- | ---: | ---: | ---: |
| case118 | 53.3 ms | 155.8 ms | 2.92× |
| case300 | 157.9 ms | 273.7 ms | 1.73× |
| case1354 | 1,504.3 ms | 1,339.3 ms | 0.89× |
| case6468 RTE | 21.64 s | 17.84 s | 0.82× |

This is not a pure native-versus-Wasm compilation ratio. Native PowerModels
evaluates the JuMP model through Julia, while the browser path evaluates the
frozen NL model in a separate Rust/Wasm module and supplies Ipopt through
JavaScript callbacks. The Ipopt/MUMPS binaries are also independently
packaged builds. The apparent crossover on the larger cases is interesting,
but the RTE browser value has only one sample and should be repeated before we
draw an architectural conclusion from it.

## Memory and scale

The installed `ipopt-wasm` package defaults to wasm32. Although wasm32 has a
nominal 4 GiB address space, this package's generated wrapper caps heap growth
at 2 GiB. The shipped Memory64 wrapper currently retains the same 2 GiB cap,
so selecting Memory64 does not yet remove the practical limit.

For case6468, Ipopt wasm32 used 622.75 MiB of solver linear-memory capacity
plus 193.88 MiB in the separate evaluator. These are post-solve Wasm memory
capacities, not peak live allocation or browser RSS.

Using the limited measurements available, a conservative planning threshold
for similarly structured AC OPFs is around 100,000–120,000 variables, or
roughly 13,000–16,000 buses, followed by an explicit memory check. This is not
a guaranteed cutoff: MUMPS factorization memory depends on sparsity and
ordering. If Tellegen must approach this range, we should fix and verify the
Memory64 heap-growth configuration rather than design around the wasm32 cap.

## Integration and distribution tradeoffs

Ipopt currently has the stronger numerical evidence, but the integration is
more complex:

- the product path comprises the prebuilt Ipopt/MUMPS Wasm module, a separate
  Rust/Wasm evaluator, and synchronous JavaScript callbacks;
- the two modules have separate memories and copy callback data;
- the full upstream Fortran/LLVM source-build pipeline has not yet been
  reproduced in this benchmark; and
- the wrapper needs stronger cleanup guarantees around callback exceptions.

POUNCE has a simpler project-owned Rust/WASI build and keeps parsing,
evaluation, and solving in one Wasm module. Its uncompressed solver artifact
was also smaller: 3.77 MB versus 4.55 MB for the Ipopt module plus evaluator.
Those advantages are material, but they do not currently outweigh the RTE
robustness result.

Licensing needs an explicit Tellegen decision before distribution. POUNCE and
Ipopt are EPL-2.0. The `ipopt-wasm` module additionally bundles MUMPS under
CeCILL-C and other runtime dependencies. The MIT wrapper does not relicense
the bundled solver. This experiment does not change Tellegen's existing
dependency policy.

## Proposed Tellegen direction

For the first balanced AC OPF spike:

- implement or retain a private solver-neutral NLP evaluator contract in
  Rust, with stable sparse patterns and exact first/second derivatives;
- run the evaluator and solver in a dedicated, disposable browser worker;
- add an ipopt-wasm adapter first;
- preserve POUNCE as a second adapter/regression target rather than embedding
  solver-specific assumptions in the mathematical model;
- align solver selection and nonlinear settings with the execution-options
  work rather than introducing a separate public selector; and
- keep explicit-neutral multiconductor/distribution AC OPF as a later,
  separately validated formulation milestone.

Cancellation should initially terminate the dedicated worker. Callback
errors, Wasm traps, and allocation failures should also discard it. A
restoration or local-infeasibility return must be reported as a failed local
solve, not as proof of global infeasibility.

## Evidence still needed before production selection

- Repeat the benchmark in Firefox and WebKit.
- Repeat the case6468 browser timing and add more large, congested, stressed,
  and weakly conditioned cases.
- Add seeded alternative starts and compare robust feasible-solve rates.
- Diagnose POUNCE's case6468 restoration failure and retest it.
- Reproduce or otherwise harden the complete ipopt-wasm source-build and
  artifact provenance chain.
- Fix and verify the Memory64 growth configuration.
- Obtain comparable peak-memory/browser-RSS measurements.
- Verify callback cleanup, repeated solves, cancellation, and any multiplier
  warm-start support required by retained Tellegen sessions.
- Complete dependency, notice, and distribution review for both candidates.
- Validate the later explicit-neutral formulation independently before making
  any claim about distribution-network suitability.

## Questions for discussion

1. Are we comfortable using ipopt-wasm as the lead backend for the initial
   balanced AC OPF integration spike?
2. Do we agree that the evaluator and public execution contract should remain
   solver-neutral, with POUNCE retained as a challenger?
3. What packaging boundary is acceptable for EPL/CeCILL-C solver artifacts:
   optional feature, separately loaded browser package, downstream-provided
   backend, or another arrangement?
4. Which missing evidence above should block the spike, and which should block
   only production enablement?
5. What practical network-size target should Tellegen support in-browser
   before Memory64 is a requirement?

## Detailed results and reproducibility

- [Benchmark result and recommendation](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/browser-benchmark-results.md)
- [RTE scale and memory probe](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/rte-scale-memory.md)
- [Browser benchmark protocol](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/browser-benchmark-protocol.md)
- [Correctness evidence through 1,354 buses](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/representative-scale-correctness.md)
- [Solver license boundary](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/solver-licenses.md)
- [Machine-readable browser results](https://github.com/frederikgeth/wasm-solver-benchmarks/tree/main/results/benchmarks)
