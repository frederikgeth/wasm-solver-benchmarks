# Installed-Chrome benchmark result

The POUNCE restoration fix in
[`jkitchin/pounce#961`](https://github.com/jkitchin/pounce/pull/961) changes the
robustness conclusion from the first benchmark. At pinned revision
`925e75fbd036de309929e398159f946d42d0d94b`, POUNCE now solves `case6468_rte`
and both additional large PGLib cases. Browser Ipopt/MUMPS and POUNCE/FERAL
therefore each have independently feasible results for all nine original AC
fixtures. Two later PGLib stress variants also pass both backends, bringing
the checked corpus to eleven; see
[`stressed-case-correctness.md`](stressed-case-correctness.md).

The rerun used clean commit `1531ff8986fa654b7f14bcce5734c7a5a2076687`
on 23 September 2026, with headless installed Chrome 153.0.8010.53 on an Apple
M4 Max with 16 logical processors and 48 GiB physical RAM. The exact records
are
[`chrome-m4max-pounce-pr961-2026-09-23.json`](../results/benchmarks/chrome-m4max-pounce-pr961-2026-09-23.json)
and
[`chrome-large-pounce-pr961-m4max-2026-09-23.json`](../results/benchmarks/chrome-large-pounce-pr961-m4max-2026-09-23.json).

## Browser performance

The representative entries are medians of seven seeded, randomized, serial
runs after one unmeasured warm-up per case/backend pair. Every observation
used a fresh worker and solver instance. The interquartile range is shown for
the browser-visible total, which includes loading, preparation, optimization,
and full solution transfer.

| Case | Backend | Successes | Optimization median | Browser-visible median (IQR) |
| --- | --- | ---: | ---: | ---: |
| case118 | ipopt-wasm | 7/7 | 158.0 ms | 193.3 ms (191.9–194.7) |
| case118 | POUNCE WASM | 7/7 | 116.0 ms | 165.4 ms (165.1–167.0) |
| case300 | ipopt-wasm | 7/7 | 276.5 ms | 332.0 ms (331.1–332.6) |
| case300 | POUNCE WASM | 7/7 | 275.0 ms | 344.2 ms (341.1–346.1) |
| case1354 | ipopt-wasm | 7/7 | 1,377.1 ms | 1,547.3 ms (1,535.4–1,566.3) |
| case1354 | POUNCE WASM | 7/7 | 1,812.6 ms | 1,991.6 ms (1,978.3–2,010.2) |

POUNCE's browser-visible median is 14.4% lower on case118, 3.7% higher on
case300, and 28.7% higher on case1354. Equivalently, Ipopt completes the
case1354 end-to-end path 22.3% sooner. This preserves the ordering from the
pre-fix run: wiring restoration into POUNCE does not materially penalize
cases that do not invoke it.

The larger entries below are one-run scale diagnostics, not repeated timing
estimates:

| Case | Variables × constraints | Ipopt optimization / total | POUNCE optimization / total | Result |
| --- | ---: | ---: | ---: | --- |
| case6468 RTE | 49,734 × 75,002 | 17.40 / 17.99 s | 25.86 / 26.54 s | both pass; POUNCE used 3 restoration calls |
| case6515 RTE | 50,546 × 75,357 | 15.69 / 16.29 s | 22.09 / 22.77 s | both pass; POUNCE used 1 restoration call |
| case9241 PEGASE | 85,568 × 128,984 | 24.86 / 26.11 s | 24.57 / 26.01 s | both pass; POUNCE used no restoration |

Ipopt is 32.7% faster than POUNCE in the case6468 solver call and 29.0% faster
on case6515. Case9241 is effectively tied in this single observation: POUNCE's
solver call is 1.2% lower and its total is 0.4% lower. The difference between
the RTE and PEGASE results is a warning against extrapolating performance from
bus count alone.

## Correctness and the PR #961 rerun

The old POUNCE build returned `RestorationFailed` at case6468 iteration 54
without making a restoration call. PR #961 wires the restoration factory and
second-opinion ladder into `pounce-wasm`. With the fixed revision, case6468
returns `SolveSucceeded` after 146 iterations and three restoration calls at
objective `2069730.1451210277`.

Independent validation of that solution reports maximum active and reactive
balance residuals of `4.72e-15` and `5.22e-15` p.u., branch-equation residual
`5.46e-12` p.u., thermal excess `2.83e-8` p.u., and bound excess `2.86e-7`.
The failure was therefore a missing WASM integration path, not evidence of an
inherently weaker core algorithm on this model.

The added case6515 RTE and case9241 PEGASE solutions from both backends also
pass the independent `1e-6` p.u. AC-equation validator. On case9241, POUNCE's
objective is `6243091.942201016` versus the native/Ipopt objective
`6243090.382896348`; the relative difference is about `2.5e-7`, within the
benchmark's objective gate, and the candidate itself is independently
feasible. This should be described as objective agreement, not bit-identical
primal convergence.

The 9,241-bus sample also exposed a benchmark-harness bug: the Node smoke test
spread all 128,984 constraint residuals into `Math.max`, exceeding the
JavaScript call-stack argument limit after a successful Ipopt solve. The
checker now reduces constraints and bounds with explicit loops. The browser
worker already used loops and was unaffected.

## Native PowerModels/Ipopt-MUMPS comparison

The native baseline uses PowerModels 0.21.6, Ipopt.jl 1.16.0, native Ipopt
3.14.19.2, and sequential MUMPS 5.9.1 with one Julia and one OpenBLAS thread.
Each entry is the median of seven fresh PowerModels models after one warm-up.
The exact record is
[`native-powermodels-m4max-2026-09-22.json`](../results/benchmarks/native-powermodels-m4max-2026-09-22.json).

The closest calculation-time comparison is native Ipopt's `SolveTimeSec`
against the browser wrapper's synchronous solver-call timer:

| Case | Native PowerModels + Ipopt/MUMPS, solver median (IQR) | Browser Ipopt wasm32 | Browser/native |
| --- | ---: | ---: | ---: |
| case118 | 53.3 ms (53.0–53.7) | 158.0 ms | 2.96× |
| case300 | 157.9 ms (156.2–158.6) | 276.5 ms | 1.75× |
| case1354 | 1,504.3 ms (1,463.4–1,537.3) | 1,377.1 ms | 0.92× |
| case6468 RTE† | 21.64 s (21.18–21.85) | 17.40 s | 0.80× |

Native is substantially faster on the two smaller cases, while the paths
cross over on the larger cases under these evaluator and packaging choices.
Case6468 still has only one post-fix browser sample, so its apparent 19.6%
browser advantage is not a stable native-versus-WASM claim.

This is a product-path comparison, not a pure compilation ratio. Native
PowerModels evaluates the JuMP nonlinear model through Julia, whereas the
browser build uses the frozen NL model and the Rust/WASM evaluator through
JavaScript callbacks. The Ipopt/MUMPS binaries are independently packaged.

## Memory and deployment tradeoffs

The fixed POUNCE WASM artifact is 4,035,733 bytes. The ipopt-wasm module plus
the separate evaluator total 4,545,644 bytes, so POUNCE's uncompressed WASM
payload is 11.2% smaller. Compression and JavaScript package overhead were not
measured.

| Case | Ipopt solver memory | Separate evaluator | Ipopt total linear memories | POUNCE linear memory |
| --- | ---: | ---: | ---: | ---: |
| case6468 | 622.75 MiB | 193.88 MiB | 816.63 MiB | 480.19 MiB |
| case6515 | 625.50 MiB | 194.69 MiB | 820.19 MiB | 483.31 MiB |
| case9241 | 912.56 MiB | 391.19 MiB | 1,303.75 MiB | 659.50 MiB |

These are post-solve `WebAssembly.Memory` capacities, not peak live allocation
or browser RSS. They nevertheless show that both successful paths remain well
below their current address-space ceilings at 85,568 variables and that the
POUNCE module reserves materially less linear memory on these samples.

The default Ipopt module is wasm32. Its generated wrapper imposes a 2 GiB heap
cap despite wasm32's nominal 4 GiB address space; the shipped Memory64 wrapper
currently retains the same cap. The new case9241 observation does not alter
the conservative planning range of roughly 100,000–120,000 variables
(approximately 13,000–16,000 similarly structured buses) before an explicit
memory test. See [`rte-scale-memory.md`](rte-scale-memory.md).

POUNCE has the simpler project-owned build and execution shape: one Rust/WASI
module parses NL and calls the solver directly. The Ipopt product path uses a
pinned prebuilt npm module plus a separate Rust evaluator and JavaScript
callbacks. Both solvers are EPL-2.0; ipopt-wasm additionally bundles MUMPS and
its CeCILL-C obligations. Distribution review remains mandatory.

## Recommendation

PR #961 removes robustness-at-case6468 as a reason to prefer Ipopt. The two
backends are now tied at 11/11 independently feasible AC fixtures, and POUNCE has
the simpler integration plus lower observed linear-memory capacity. Ipopt
retains the stronger measured runtime on both ~6.5k-bus RTE samples and on the
repeated 1,354-bus case; case9241 is a single-run tie.

For Tellegen, keep the evaluator and worker contract solver-neutral and treat
the initial backend choice as an integration tradeoff rather than a settled
robustness decision. If minimizing implementation and memory complexity is
the priority, POUNCE is now credible as the first adapter. If the measured RTE
latency is the priority, Ipopt remains the evidence-backed lead. A short
Tellegen integration spike for both adapters, followed by stressed starts and
Firefox/WebKit runs, is now more defensible than selecting Ipopt solely from
the old case6468 failure.

Before production selection, add seeded alternative starts and
stressed/congested cases, reproduce the complete ipopt-wasm source-build or
otherwise harden its provenance, fix and verify Memory64 growth, obtain
comparable peak-memory/browser-RSS measurements, and complete distribution
review. Full timing definitions are in
[`browser-benchmark-protocol.md`](browser-benchmark-protocol.md).
