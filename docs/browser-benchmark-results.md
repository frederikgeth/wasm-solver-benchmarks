# Installed-Chrome benchmark result

The controlled representative benchmark passed all 42 measured solves, all
six warm-ups, and all six fresh-browser cold runs. It ran on 22 September
2026 from clean commit `6eec6aa0dc771ff9e4bc4900fea4062f22d85677`
using headless installed Chrome 153.0.8010.53 on an Apple M4 Max with 16
logical processors and 48 GiB physical RAM. The exact machine-readable record
is [`chrome-m4max-2026-09-22.json`](../results/benchmarks/chrome-m4max-2026-09-22.json).

Each table entry is a median of seven seeded, randomized, serial runs after
one unmeasured warm-up per case/backend pair. Every observation used a fresh
worker and solver instance. The interquartile range is shown for the
browser-visible total, which includes loading, preparation, optimization, and
full solution transfer.

| Case | Backend | Successes | Optimization median | Browser-visible median (IQR) |
| --- | --- | ---: | ---: | ---: |
| case118 | ipopt-wasm | 7/7 | 155.8 ms | 191.1 ms (190.2–191.6) |
| case118 | POUNCE WASM | 7/7 | 116.0 ms | 163.6 ms (163.0–164.6) |
| case300 | ipopt-wasm | 7/7 | 273.7 ms | 327.9 ms (326.5–328.5) |
| case300 | POUNCE WASM | 7/7 | 268.7 ms | 336.2 ms (334.9–339.9) |
| case1354 | ipopt-wasm | 7/7 | 1,339.3 ms | 1,503.2 ms (1,502.4–1,506.9) |
| case1354 | POUNCE WASM | 7/7 | 1,752.4 ms | 1,932.0 ms (1,924.3–1,934.7) |

POUNCE's browser-visible median is 14.4% lower on case118. At case300 its
optimization call is 1.8% lower but its end-to-end median is 2.5% higher. On
case1354 its end-to-end median is 28.5% higher. Equivalently, Ipopt completes
the largest case about 22.2% sooner. The narrow IQRs and second full run's
similar ordering make this more persuasive than the earlier one-off smoke
timings, but it remains one host and browser.

All candidate objectives match the native PowerModels/Ipopt reference at the
same local solutions, and the separately recorded explicit AC validator passes
all six candidates at the `1e-6` p.u. gate. That independent evidence is in
[`representative-scale-correctness.md`](representative-scale-correctness.md);
the timing harness's raw-model checks also passed every attempt.

## Larger-case robustness result

The subsequent 6,468-bus `case6468_rte` probe changes the robustness picture.
Ipopt wasm32 and Ipopt Memory64 both return the native-reference local solution,
and the wasm32 result passes the independent physical validator. POUNCE returns
`RestorationFailed` after 54 iterations; its candidate has 19.36 p.u. active
balance error and a 530.50 p.u. branch-equation residual. This is a numerical
failure, not an out-of-memory event or evidence that the AC OPF is infeasible.

Across the complete AC fixture ladder, browser Ipopt therefore has seven
independently feasible results from seven cases. Browser POUNCE has six from
seven, with the failure occurring on the largest case. The exact scale record
and failure-inclusive result are documented in
[`rte-scale-memory.md`](rte-scale-memory.md).

## Deployment tradeoffs

The POUNCE Wasm artifact is 3,766,536 bytes. The ipopt-wasm module plus the
separate NL evaluator total 4,545,683 bytes, so POUNCE's uncompressed Wasm
payload is 17.1% smaller. Compression and JavaScript package overhead were not
measured.

The representative-scale POUNCE linear memories are 9.2, 18.1, and 80.4 MB for
the three cases. The Ipopt path's separate evaluator memories are 5.2, 10.1,
and 45.9 MB, but the public ipopt-wasm wrapper does not expose the solver's own
memory. These are memory capacities, not peak live allocations or browser RSS,
so they do not support a solver-memory ranking.

The later 6,468-bus scale probe adds benchmark-local read-only instrumentation
to expose Ipopt's memory capacity. Ipopt wasm32 uses 622.75 MiB for the solver
and 193.88 MiB in the separate evaluator; POUNCE reaches 337.19 MiB before its
numerical failure. Because the POUNCE observation is not a successful solve,
these numbers still do not establish a like-for-like memory winner. The
historical representative JSON remains unchanged and retains `null` for
Ipopt's solver-memory field.

The default Ipopt module is wasm32. Its generated wrapper imposes a 2 GiB heap
cap despite wasm32's nominal 4 GiB address space. The package's Memory64 module
solves case6468 but its shipped wrapper currently retains the same 2 GiB cap.
Measured scaling suggests a conservative transition range around
100,000–120,000 variables, or roughly 13,000–16,000 similarly structured
buses, until that Memory64 configuration is fixed and verified.

POUNCE has the simpler project-owned build and execution shape: one Rust/WASI
module parses NL and calls the solver directly. The Ipopt product path uses a
pinned prebuilt npm module plus a separate Rust evaluator and JavaScript
callbacks. Its full upstream Fortran/LLVM source-build pipeline has not been
reproduced here. Both solvers are EPL-2.0; ipopt-wasm additionally bundles
MUMPS and its CeCILL-C obligations. Distribution review remains mandatory.

## Recommendation

For the first balanced AC OPF integration spike, use **ipopt-wasm as the
leading backend** and retain POUNCE behind the same regression fixtures as the
challenger. Robust independently feasible solve rate is the first decision
criterion: Ipopt is 7/7 across the complete ladder, while POUNCE is 6/7 and
fails on the largest case. Runtime reinforces that choice—Ipopt wins two of
the three repeated representative comparisons and has the material advantage
at 1,354 buses. The successful 6,468-bus Ipopt solve extends the evidence that
it is currently the safer scale path.

This is a provisional integration ranking, not a production selection.
Before a broad-browser or distribution decision, verify the leading result in
Firefox and WebKit, reproduce or otherwise harden the ipopt-wasm artifact
supply chain, fix and verify the Memory64 heap configuration, obtain comparable
peak-memory measurements, and add seeded alternative starts plus
stressed/congested cases. POUNCE's case6468 restoration failure should be
diagnosed before reconsidering it for the lead. The later unbalanced four-wire
study remains a separate formulation experiment.

The single cold run per pair is retained in the JSON as a startup diagnostic,
including browser launch and full page-driver elapsed time. It is not used to
rank the solvers because browser launch variance dominates at that sample
count. Full definitions are in
[`browser-benchmark-protocol.md`](browser-benchmark-protocol.md).
