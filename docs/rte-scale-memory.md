# Large-case and WebAssembly memory probe

The installed `ipopt-wasm` 0.2.0 package defaults to `index.mjs` and
`ipopt.wasm`, which are wasm32. Although wasm32 has a nominal 4 GiB address
space, this package's generated `ipopt.mjs` defines a 2,147,483,648-byte heap
maximum. That 2 GiB setting—not the nominal 4 GiB address limit—is the
effective Ipopt ceiling in the tested build.

The shipped `index64.mjs`/`ipopt64.wasm` Memory64 variant has the same 2 GiB
growth setting. It solves case6468, but switching to it does not yet remove
the practical ceiling. The harness exposes the variants as `ipopt-wasm` and
`ipopt-wasm64` so this can be regression-tested when upstream changes.

## Successful large-case probes

The original case6468 POUNCE failure was rerun at revision
`925e75fbd036de309929e398159f946d42d0d94b`, containing the fix from
[`jkitchin/pounce#961`](https://github.com/jkitchin/pounce/pull/961). Two more
unmodified PGLib-OPF v23.07 cases were added to sample another RTE model and a
larger PEGASE topology.

| Case | Family | Variables | Constraints | Jacobian nnz | Hessian nnz |
| --- | --- | ---: | ---: | ---: | ---: |
| case6468 | RTE | 49,734 | 75,002 | 269,026 | 87,664 |
| case6515 | RTE | 50,546 | 75,357 | 270,715 | 88,109 |
| case9241 | PEGASE | 85,568 | 128,984 | 488,296 | 148,747 |

Installed Chrome produced these single-run scale diagnostics from clean commit
`1531ff8986fa654b7f14bcce5734c7a5a2076687`:

| Case | Backend | Result | Optimization | Solver memory | Evaluator memory |
| --- | --- | --- | ---: | ---: | ---: |
| case6468 | Ipopt wasm32 | success | 17.40 s | 622.75 MiB | 193.88 MiB |
| case6468 | POUNCE wasm32 | success, 146 iterations, 3 restorations | 25.86 s | 480.19 MiB | included |
| case6515 | Ipopt wasm32 | success | 15.69 s | 625.50 MiB | 194.69 MiB |
| case6515 | POUNCE wasm32 | success, 137 iterations, 1 restoration | 22.09 s | 483.31 MiB | included |
| case9241 | Ipopt wasm32 | success | 24.86 s | 912.56 MiB | 391.19 MiB |
| case9241 | POUNCE wasm32 | success, 78 iterations, 0 restorations | 24.57 s | 659.50 MiB | included |

The exact result is
[`chrome-large-pounce-pr961-m4max-2026-09-23.json`](../results/benchmarks/chrome-large-pounce-pr961-m4max-2026-09-23.json).
These timings have one sample per pair and are scale diagnostics, not stable
performance estimates. The memories are post-solve `WebAssembly.Memory`
capacities, not live allocation, peak allocation, or browser RSS.

The previous Memory64 observation remains in
[`chrome-case6468-m4max-2026-09-22.json`](../results/benchmarks/chrome-case6468-m4max-2026-09-22.json):
it solved case6468 in 19.45 s with a 622.81 MiB Ipopt memory. The old POUNCE
failure in that record is retained as historical evidence but is superseded
by the fixed-revision result above.

Both solvers' candidates on all three cases pass the independent explicit AC
validator. In particular, fixed POUNCE case6468 has maximum active and
reactive balance residuals of `4.72e-15` and `5.22e-15` p.u. and a maximum
branch-equation residual of `5.46e-12` p.u. The old failure occurred because
the WASM wrapper did not install POUNCE's restoration path; it was not an
out-of-memory event or evidence that the OPF was infeasible.

## Approximate Ipopt ceiling

The 1,354-, 6,468-, and 9,241-bus Ipopt probes use 117.94, 622.75, and 912.56
MiB of solver memory for 11,192, 49,734, and 85,568 variables. A log-log fit
across only those three points grows approximately as `variables^1.03` and
intersects the wrapper's 2 GiB cap near 175,000 variables, or about 19,000
buses at the case9241 variable-to-bus ratio.

That extrapolation is not an operational guarantee. MUMPS factorization
memory depends strongly on sparsity, ordering, and numerical behavior, so a
difficult case can fail materially earlier. The conservative planning range
remains 100,000–120,000 variables, approximately 13,000–16,000 similarly
structured buses, followed by an explicit memory check. The evaluator has a
separate WASM memory and the browser has additional non-WASM allocations.

Case9241 demonstrates success at 85,568 variables with 1,303.75 MiB across
Ipopt's and the evaluator's two linear memories. Because only the 912.56 MiB
Ipopt memory is subject to Ipopt's wrapper cap, those two capacities must not
be added when estimating when that specific 2 GiB heap will stop growing.

For problems expected to approach the conservative range, the correct next
step is to fix and verify the Memory64 package's growth configuration rather
than plan around a nominal 4 GiB wasm32 ceiling.

Reproduce the fixed-revision large-case observations with:

```sh
./scripts/run-browser-benchmark.sh \
  --output results/benchmarks/chrome-large-pounce-pr961-m4max-2026-09-23.json \
  --cases case6468,case6515,case9241 \
  --backends ipopt-wasm,pounce-wasm \
  --runs 1 --warmups 0 --cold-runs 0 --seed 20260923 \
  --timeout-ms 300000
```
