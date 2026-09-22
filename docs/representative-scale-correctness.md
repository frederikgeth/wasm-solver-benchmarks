# Representative-scale AC OPF correctness

The representative ladder uses the unmodified PGLib-OPF v23.07 base cases
`case118_ieee`, `case300_ieee`, and `case1354_pegase`. The frozen source bytes
come from Julia artifact tree
`0e8968a89b6ad43910a8eda4ec30656add35cf91`; their original filenames and
SHA-256 hashes are recorded in every model mapping. PGLib's CC-BY-4.0 data
notice is retained in `fixtures/cases/LICENSE.PGLib-OPF`.

PowerModels 0.21.6 constructs `ACPPowerModel`/`build_opf` and native
Ipopt/MUMPS provides the formulation reference. The browser candidates use
the same exported NL model and initial point.

| Case | Variables × constraints | Jacobian / Hessian nnz | Native reference | ipopt-wasm | POUNCE WASM |
| --- | ---: | ---: | ---: | ---: | ---: |
| case118 | 1,088 × 1,532 | 5,689 / 1,814 | 97213.60692340179 | 97213.60692340172 | 97213.60692780619 |
| case300 | 2,382 × 3,476 | 12,496 / 4,180 | 565219.9718341250 | 565219.9718341244 | 565219.9718341349 |
| case1354 | 11,192 × 16,365 | 60,771 / 18,866 | 1258843.9849803096 | 1258843.9849803005 | 1258843.9849803005 |

All six candidates returned strict solver success. POUNCE required 30, 35,
and 53 iterations with no restoration calls. Native POUNCE regression tests
also parse and solve these three frozen models through the same evaluator.

## Independent feasibility

Every candidate passes the explicit source-data validator at the `1e-6` p.u.
gate. Across the six results:

- active and reactive balance residuals are at most `7.11e-15` and
  `2.00e-15` p.u.;
- AC branch-equation residuals are at most `1.68e-11` p.u.;
- thermal-limit excess is at most `8.55e-8` p.u. (`8.55e-6` MVA);
- variable-bound excess is at most `4.19e-7` in model units;
- independently recomputed objectives differ from the reported values by at
  most `6.99e-10` absolute.

The largest ipopt-wasm result reports a `2.93e-6` maximum violation in raw NL
row units. NL rows are not uniformly normalized—thermal rows include squared
apparent power—so this number is retained as a diagnostic rather than treated
as a p.u. feasibility measure. The independent validator recomputes physical
quantities from the original case and passes that solution at the stated gate.

## Scale-specific bridge finding

POUNCE's browser JSON intentionally previews only the first 2,000 primal and
constraint values. That is sufficient for its demo UI but not for independent
validation of case300 or case1354. The benchmark's thin WASM adapter now
exposes POUNCE's full CSV solution export and reconstructs the complete vectors
inside the worker. The returned lengths are checked against the model
dimensions before source-data validation.

Both backends were exercised for all three cases in dedicated workers in the
in-app Chromium browser. The one-off timings were used only to confirm the
worker path and are not retained as performance evidence. A timed comparison
still requires randomized repeated runs, host/browser metadata, timeouts, and
failure-inclusive summaries.

Rebuild both WASM paths, reproduce all six candidates, and run their independent
checks with:

```sh
./scripts/run-representative-correctness.sh
```
