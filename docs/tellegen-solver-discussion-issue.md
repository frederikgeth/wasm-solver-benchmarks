# Proposed issue title

Discussion: choose the initial browser AC OPF solver backend

## Issue body

## Summary

We now have a standalone, reproducible browser benchmark comparing
`ipopt-wasm`/MUMPS and POUNCE/FERAL on balanced, continuous AC optimal power
flow, with PowerModels.jl + native Ipopt/MUMPS as the formulation reference
and native timing baseline.

An important update since the first results: the POUNCE developers fixed the
case6468 WASM failure in
[`jkitchin/pounce#961`](https://github.com/jkitchin/pounce/pull/961). The cause
was that `pounce-wasm` had not wired in the solver's restoration phase. With
that fix, both browser backends now produce independently feasible results on
all nine AC fixtures, including two additional large PGLib cases.

I therefore no longer think the evidence supports choosing Ipopt on
robustness alone. I propose that we:

1. keep Tellegen's evaluator and worker interface solver-neutral;
2. decide the first adapter based on the latency, memory, build, and licensing
   tradeoffs below;
3. keep both implementations behind the same correctness and performance
   fixtures during an initial spike; and
4. treat the result as provisional until we add stressed starts and broader
   browser coverage.

No Tellegen or PowerIO integration has been implemented as part of this work.
The experiment is isolated in
[`frederikgeth/wasm-solver-benchmarks`](https://github.com/frederikgeth/wasm-solver-benchmarks).

## What was tested

- Balanced continuous AC OPF models built with `PowerModels.ACPPowerModel`
  and `PowerModels.build_opf`.
- One frozen AMPL NL model, start point, sparse structure, and exact Hessian
  shared by both browser paths.
- Dedicated workers in installed Chrome on an Apple M4 Max with 48 GiB RAM.
- Ipopt with MUMPS versus POUNCE with its FERAL linear solver.
- Independent AC validation reconstructed from the original MATPOWER data,
  rather than trusting the shared NL evaluator or objective alone.
- Seven-run representative benchmarks for 118-, 300-, and 1,354-bus cases.
- Single-run scale diagnostics for 6,468- and 6,515-bus RTE cases and the
  9,241-bus PEGASE case.
- A seven-run, single-threaded native PowerModels + Ipopt/MUMPS baseline
  through case6468.

Both browser paths use `tol = 1e-9`, `max_iter = 1000`, exact Hessians, the
same initial point, and no warm start. Timed observations use a fresh worker
and solver instance. Failures remain in the denominator.

## Correctness and robustness

Both backends now pass all nine AC cases:

| Browser backend | Independently feasible cases |
| --- | ---: |
| Ipopt/MUMPS | 9/9 |
| POUNCE/FERAL | 9/9 |

At the fixed POUNCE revision, `case6468_rte` returns `SolveSucceeded` after
146 iterations and three restoration calls. Its independent maximum active
and reactive balance residuals are `4.72e-15` and `5.22e-15` p.u., and its
maximum branch-equation residual is `5.46e-12` p.u.

The additional `case6515_rte` sample also exercises restoration once and
passes. `case9241_pegase` is materially larger at 85,568 variables and 128,984
constraints; both backends pass it. POUNCE's case9241 objective differs from
the native/Ipopt objective by about `2.5e-7` relative, within the objective
gate, and its candidate is independently feasible.

This correction matters: the old `RestorationFailed` result reflected missing
WASM integration plumbing, not evidence that POUNCE's core algorithm could
not solve the model.

## Browser performance

Representative entries are medians of seven serial runs after one warm-up.
“Total” includes loading, preparation, optimization, and full solution
transfer.

| Case | Ipopt optimization | Ipopt total | POUNCE optimization | POUNCE total |
| --- | ---: | ---: | ---: | ---: |
| case118 | 158.0 ms | 193.3 ms | 116.0 ms | 165.4 ms |
| case300 | 276.5 ms | 332.0 ms | 275.0 ms | 344.2 ms |
| case1354 | 1,377.1 ms | 1,547.3 ms | 1,812.6 ms | 1,991.6 ms |

POUNCE's total median is 14.4% lower on case118, 3.7% higher on case300, and
28.7% higher on case1354. Ipopt completes the case1354 end-to-end path 22.3%
sooner.

The large cases have one browser run per pair and should be read as scale
diagnostics:

| Case | Ipopt optimization / total | POUNCE optimization / total |
| --- | ---: | ---: |
| case6468 RTE | 17.40 / 17.99 s | 25.86 / 26.54 s |
| case6515 RTE | 15.69 / 16.29 s | 22.09 / 22.77 s |
| case9241 PEGASE | 24.86 / 26.11 s | 24.57 / 26.01 s |

Ipopt's solver call is 32.7% faster on case6468 and 29.0% faster on case6515.
The case9241 observation is effectively tied. Performance is therefore
topology- and trajectory-dependent; bus count alone does not predict the
winner.

## Native PowerModels comparison

The closest calculation-time comparison is native Ipopt's reported solve time
against the browser Ipopt wrapper's synchronous solver-call time:

| Case | Native PowerModels + Ipopt/MUMPS | Browser Ipopt wasm32 | Browser/native |
| --- | ---: | ---: | ---: |
| case118 | 53.3 ms | 158.0 ms | 2.96× |
| case300 | 157.9 ms | 276.5 ms | 1.75× |
| case1354 | 1,504.3 ms | 1,377.1 ms | 0.92× |
| case6468 RTE | 21.64 s | 17.40 s | 0.80× |

This is not a pure native-versus-WASM compilation ratio. Native PowerModels
evaluates a JuMP model through Julia, while the browser path evaluates frozen
NL in a Rust/WASM module and supplies Ipopt through JavaScript callbacks. The
binaries are also independently packaged. The larger-case browser values have
one sample and should not drive architecture without repetition.

## Memory and scale

The installed `ipopt-wasm` package defaults to wasm32. Its generated wrapper
caps heap growth at 2 GiB despite wasm32's nominal 4 GiB address space. The
shipped Memory64 wrapper currently retains the same 2 GiB setting, so merely
selecting Memory64 does not remove the tested package's practical limit.

| Case | Ipopt solver + evaluator linear memories | POUNCE linear memory |
| --- | ---: | ---: |
| case6468 | 622.75 + 193.88 MiB | 480.19 MiB |
| case6515 | 625.50 + 194.69 MiB | 483.31 MiB |
| case9241 | 912.56 + 391.19 MiB | 659.50 MiB |

These are post-solve WASM memory capacities, not peak live allocation or
browser RSS. POUNCE nevertheless uses materially less linear-memory capacity
on all three successful large samples.

A three-point fit places Ipopt's 2 GiB solver-heap intersection near 175,000
variables, but that is only an extrapolation. MUMPS factorization memory is
sparsity- and ordering-dependent. A conservative planning threshold remains
100,000–120,000 variables, roughly 13,000–16,000 similarly structured buses,
followed by an explicit memory test. If Tellegen must approach that range, we
should fix and verify the Memory64 growth configuration.

## Integration and distribution tradeoffs

The Ipopt path comprises a prebuilt Ipopt/MUMPS WASM module, a separate
Rust/WASM evaluator, and synchronous JavaScript callbacks. The two modules
have separate memories and copy callback data. The complete upstream
Fortran/LLVM build has not yet been reproduced here.

POUNCE has a simpler project-owned Rust/WASI build and keeps parsing,
evaluation, and solving in one module. Its fixed solver artifact is 4.04 MB,
versus 4.55 MB for Ipopt plus the evaluator, and its observed large-case
linear-memory capacities are lower.

Licensing still needs an explicit Tellegen decision. POUNCE and Ipopt are
EPL-2.0. The `ipopt-wasm` module additionally bundles MUMPS under CeCILL-C and
other runtime dependencies. The MIT JavaScript wrapper does not relicense the
bundled solver.

## Proposed Tellegen direction

For the first balanced AC OPF spike:

- define a private solver-neutral NLP evaluator contract with stable sparse
  patterns and exact first/second derivatives;
- run evaluation and solving in a dedicated, disposable browser worker;
- implement thin adapters for both POUNCE and ipopt-wasm before committing to
  one as the distributed default;
- use worker termination for initial cancellation and discard the worker on
  callback errors, traps, or allocation failures; and
- keep explicit-neutral multiconductor/distribution AC OPF as a later,
  separately validated formulation milestone.

If we want one lead for that spike today, the choice is a priority call:

- choose **Ipopt first** if the measured RTE latency and mature ecosystem are
  more important;
- choose **POUNCE first** if the simpler Rust/WASI build and lower observed
  memory are more important.

The corrected results do not justify claiming either backend is universally
faster or more robust.

## Evidence still needed before production selection

- Repeat the benchmark in Firefox and WebKit.
- Repeat the three large-case timings.
- Add seeded alternative starts and stressed, congested, and weakly
  conditioned cases.
- Reproduce or otherwise harden the ipopt-wasm source-build and provenance
  chain.
- Fix and verify Memory64 heap growth.
- Obtain comparable peak-memory/browser-RSS measurements.
- Verify repeated solves, cancellation, cleanup, and any multiplier warm-start
  support required by retained Tellegen sessions.
- Complete dependency, notice, and distribution review for both candidates.

## Questions for discussion

1. Which should lead the initial spike: Ipopt for the measured RTE latency, or
   POUNCE for the simpler build and lower observed memory?
2. Do we agree that the evaluator and public execution contract should remain
   solver-neutral while we gather stressed-start evidence?
3. What packaging boundary is acceptable for EPL/CeCILL-C solver artifacts?
4. Which missing evidence should block the spike, and which should block only
   production enablement?
5. What practical in-browser network size should Tellegen support before
   Memory64 is a requirement?

## Detailed results and reproducibility

- [Benchmark result and recommendation](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/browser-benchmark-results.md)
- [Large-case and memory probe](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/rte-scale-memory.md)
- [Browser benchmark protocol](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/browser-benchmark-protocol.md)
- [Correctness evidence through 1,354 buses](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/representative-scale-correctness.md)
- [Solver license boundary](https://github.com/frederikgeth/wasm-solver-benchmarks/blob/main/docs/solver-licenses.md)
- [Machine-readable browser results](https://github.com/frederikgeth/wasm-solver-benchmarks/tree/main/results/benchmarks)
