# Small AC OPF correctness ladder

PowerModels 0.21.6 builds each fixture with `ACPPowerModel` and `build_opf`.
Native Ipopt/MUMPS supplies the formulation reference. Browser ipopt-wasm and
browser POUNCE then consume the same frozen `.nl` model and start point. All
six browser candidates were also exercised in dedicated workers in the in-app
Chromium browser; the table deliberately omits one-off smoke durations.

| Case | Variables × constraints | Jacobian / Hessian nnz | Native reference | ipopt-wasm | POUNCE WASM |
| --- | ---: | ---: | ---: | ---: | ---: |
| case3 | 28 × 29 | 103 / 35 | 5906.879416645711 | 5906.879416645711 | 5906.879448872702 |
| case14 | 118 × 129 | 532 / 127 | 8081.524734833990 | 8081.524734833997 | 8081.524734834003 |
| case30 | 236 × 348 | 1245 / 418 | 204.968350791295 | 204.968350791294 | 204.968350791295 |

Every solver returned its strict success status. POUNCE used 15, 12, and 18
iterations respectively, with no restoration calls. The ipopt-wasm wrapper
does not expose iteration counts.

## Independent feasibility

The explicit source-data validator passed every candidate at the `1e-6` p.u.
gate. Across all six results:

- active and reactive balance residuals are at most `5.07e-16` and
  `3.33e-16` p.u.;
- AC branch-equation residuals are at most `1.02e-14` p.u.;
- thermal-limit excess is at most `1.00e-8` p.u. (`1.00e-6` MVA);
- variable-bound excess is at most `1.10e-8` in model units;
- independently recomputed objectives differ from reported objectives by at
  most `9.10e-13` absolute.

The cases add distinct coverage. Case3 contains a DC line and tight AC branch
rating. Case14 includes off-nominal transformer taps and charging but declares
no branch MVA ratings, so no thermal-limit claim is made for it. Its source
uses ±360° angle bounds; PowerModels warns and normalizes these to ±60° before
model construction. The frozen mapping and independent validator both use
that processed convention. Case30 includes taps, charging, shunts, explicit
±30° angle bounds, reactive limits, and finite both-end thermal ratings.

These results establish model/evaluator/solver compatibility and local
feasibility, not performance or global optimality. Timed ranking still needs a
repeated, randomized real-browser protocol with host/browser metadata and
failures retained in the denominator.

Rebuild both WASM paths, reproduce all six candidates, and run their independent
checks with:

```sh
./scripts/run-small-case-correctness.sh
```
