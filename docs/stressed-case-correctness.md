# PGLib stress-variant AC OPF checks

Two PGLib-OPF v23.07 variants extend the nine-case AC fixture ladder. PGLib
describes its `api` group as heavily loaded cases with binding thermal limits
and its `sad` group as cases with small, binding phase-angle limits; see the
[PGLib case overview](https://github.com/power-grid-lib/pglib-opf#case-file-overview).
The source MATPOWER files are copied unchanged from the same pinned Julia
artifact tree (`0e8968a89b6ad43910a8eda4ec30656add35cf91`) as the existing
base fixtures. Each mapping records its original path and source SHA-256.

| Local name | Upstream case | Variables × constraints | Native objective | Browser Ipopt objective | Browser POUNCE objective |
| --- | --- | ---: | ---: | ---: | ---: |
| `case118api` | `api/pglib_opf_case118_ieee__api.m` | 1,088 × 1,532 | 249614.51886768412 | 249614.5188676841 | 249614.51891387368 |
| `case1354sad` | `sad/pglib_opf_case1354_pegase__sad.m` | 11,192 × 16,365 | 1258848.0389971484 | 1258848.038997152 | 1258848.0390752822 |

Native PowerModels/Ipopt returned `LOCALLY_SOLVED` for both exported models.
Both WASM backends returned strict success on both cases. POUNCE used 47 and
55 iterations respectively, with no restoration or second-opinion retry.

All four candidates pass the independent `1e-6` p.u. source-data validation.
Across them, maximum active and reactive balance residuals are `8.72e-15` and
`2.22e-15` p.u.; maximum branch-equation residual is `1.69e-11` p.u.; maximum
thermal-limit excess is `8.55e-8` p.u. The tight-angle case has at most
`1.00e-8` radians of angle-limit excess. The candidate objective differences
from native are within the existing relative objective gate.

An installed-Chrome run on Apple M4 Max from clean commit
`851db4444d0873b4ef970264735c69b6f7a0ea98` passed all four pairs. Each
timing below is one run with a fresh worker and no warm-up, so it is only a
diagnostic:

| Case | Ipopt solve / total | POUNCE solve / total |
| --- | ---: | ---: |
| `case118api` | 194.7 / 230.9 ms | 161.2 / 214.4 ms |
| `case1354sad` | 1,414.1 / 1,593.4 ms | 1,838.6 / 2,026.9 ms |

The machine-readable record is
[`chrome-pglib-stress-m4max-2026-09-23.json`](../results/benchmarks/chrome-pglib-stress-m4max-2026-09-23.json).
The variants did expose one harness issue: the browser CLI and worker had
accepted only `case` followed by digits. Their case-name checks now also
accept the `api` and `sad` suffixes. No new solver failure was observed.

Reproduce the correctness checks with `./scripts/run-stressed-correctness.sh`.
For the same single-run browser probe:

```sh
./scripts/run-browser-benchmark.sh \
  --output results/benchmarks/chrome-pglib-stress-m4max-2026-09-23.json \
  --cases case118api,case1354sad \
  --backends ipopt-wasm,pounce-wasm \
  --runs 1 --warmups 0 --cold-runs 0 --seed 20260923
```
