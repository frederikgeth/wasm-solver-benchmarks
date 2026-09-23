# Follow-up experiments after POUNCE issue #965

The [POUNCE profiling discussion](https://github.com/jkitchin/pounce/issues/965)
explained two previously conflated effects: native POUNCE parallelizes Hessian
evaluation through Rayon, while the browser build is single-threaded; and
FERAL's scaling and linear-system work can affect whole-solve time. These
experiments test those explanations on the benchmark's frozen AC OPF models.
They use POUNCE revision `925e75fbd036de309929e398159f946d42d0d94b`,
which includes the earlier [restoration fix](https://github.com/jkitchin/pounce/pull/961).
All runs were on an Apple M4 Max on 23 September 2026. These are additional
samples, not a universal solver ranking.

## FERAL identity-scaling A/B in Chrome

The browser worker exposes `pounce-identity`, which adds only
`feral_scaling identity` to the default POUNCE options. Cases, frozen NL,
initial points, exact Hessian, tolerances, and worker lifecycle are unchanged.
The two options were randomized and run serially. Entries are median
browser solver-call time, not full page time; each pair had one unmeasured
warm-up. Every result passed the browser gate and the identity variant's
candidate was independently validated from the source AC equations.

| Case | Runs/option | Default FERAL | Identity scaling | Identity change |
| --- | ---: | ---: | ---: | ---: |
| case300 | 7 | 272.4 ms | 262.8 ms | 3.5% faster |
| case1354 | 7 | 1.781 s | 1.658 s | 6.9% faster |
| case1354sad | 7 | 1.863 s | 1.686 s | 9.5% faster |
| case6468 RTE | 3 | 25.103 s | 22.750 s | 9.4% faster |
| case9241 PEGASE | 3 | 23.473 s | 20.323 s | 13.4% faster |

Exact records: [small and stressed cases](../results/benchmarks/chrome-pounce-scaling-small-2026-09-23.json)
and [large cases](../results/benchmarks/chrome-pounce-scaling-large-2026-09-23.json).
This supports trying identity scaling as a performance option; the
alternative-start experiment below cautions against assuming it helps every
trajectory.

### Same-session three-backend control

A separate randomized Chrome matrix compared Ipopt, default POUNCE, and
identity-scaled POUNCE in one schedule on three cases. Each backend/case had
three measured runs after one unmeasured warm-up; all 27 measured solves
passed. Medians below are browser solver-call seconds, with browser-visible
end-to-end medians in parentheses.

| Case | Ipopt/MUMPS | POUNCE default | POUNCE identity |
| --- | ---: | ---: | ---: |
| case1354 | 1.376 (1.545) | 1.796 (1.981) | 1.650 (1.836) |
| case6468 RTE | 17.599 (18.188) | 25.647 (26.311) | 23.188 (23.858) |
| case9241 PEGASE | 24.590 (25.829) | 23.987 (25.436) | 20.822 (22.256) |

The [complete control record](../results/benchmarks/chrome-pounce-scaling-controlled-2026-09-23.json)
confirms the scaling gain on the baseline start. Compared with identity-scaled
POUNCE, Ipopt's solver call is 16.6% shorter on case1354 and 24.1% shorter on
case6468; identity-scaled POUNCE is 15.3% shorter on case9241. The case9241
POUNCE objective is about 1.56 absolute units above Ipopt's at a roughly
6.24-million objective (`2.5e-7` relative); both candidates pass independent
AC feasibility, but the table should not be read as bit-identical solution
quality. Three runs on one host are still a narrow performance sample.

## Same-NL native timing profile

The native POUNCE CLI and native Ipopt ASL executable solved the **same frozen
NL bytes**, with `tol=1e-9`, `max_iter=1000`, exact Hessian, POUNCE presolve
disabled, and one OpenBLAS/OpenMP thread. POUNCE was run with
`RAYON_NUM_THREADS=1` and `14`; Ipopt used sequential MUMPS. These are
medians of three measured solves after one warm-up per case/backend, rotating
backend order. Every run succeeded and objectives agreed to solver precision.

| Case | POUNCE 1 thread | POUNCE 14 threads | Ipopt ASL/MUMPS 1 thread |
| --- | ---: | ---: | ---: |
| case300 | 0.193 s | 0.172 s | 0.120 s |
| case1354 | 1.490 s | 1.088 s | 0.962 s |
| case6468 RTE | 23.353 s | 19.538 s | 14.181 s |

At case1354, POUNCE's reported Hessian-evaluation median falls from 0.314 s
to 0.051 s with 14 threads; at case6468 it falls from 4.089 s to 0.540 s.
The whole solve improves 27.0% and 16.3%, respectively, but native Ipopt
remains faster on both. On case6468, POUNCE's own numeric factorization
timer is still about 9 s with either thread count. Ipopt/MUMPS reports its
`LinearSystemFactorization` timer as zero, which is a reporting limitation,
**not** evidence that its factorization costs zero. Consequently, the phase
figures cannot be subtracted as if the solvers used identical timer scopes.

The [raw profile](../results/benchmarks/native-same-nl-profile-m4max-2026-09-23.json)
contains binary and NL SHA-256 hashes, all observations, options, and phase
timers. This same-NL comparison is distinct from the earlier native
PowerModels/Ipopt baseline, which evaluates a JuMP model and measures a
different execution path.

## Deterministic alternative starts

For seeds 101, 202, and 303, the harness perturbs every NL-order variable
deterministically: angle ±0.03 radians, voltage magnitude ±0.02 p.u., and
other variables ±0.05 × `max(1, abs(start))`, clipped to each bound. The
same vector is given to Ipopt and POUNCE. These are intentionally infeasible
NLP-start stresses, not plausible operating-point warm starts. The immutable
model equations and bounds do not change. The [start-vector tests](../web/test/start-perturbation.test.mjs)
check determinism, bounds, and that the POUNCE NL rewrite changes only the
initial-point segment.

The Node/WASM path produced **27/27 independently feasible candidates**:
three cases × three seeds × Ipopt, default POUNCE, and identity-scaled
POUNCE. The independent validator recomputes AC flows, balances, limits,
bounds, reference angles, and objective from source MATPOWER data. The
largest absolute objective recomputation difference was `1.17e-9`; the
largest variable-bound excess was `4.19e-7`, below the `1e-6` validation
gate. The [default-scaling and Ipopt report](../results/starts/summary-2026-09-23.json)
and [identity-scaling report](../results/starts/identity-summary-2026-09-23.json)
retain all candidate and validator file paths.

Installed Chrome also returned **27/27 successful dedicated-worker solves**
with the same seeds and backends. These are one observation per tuple, so the
times below illustrate trajectory sensitivity rather than a performance
distribution. Values are browser solver-call seconds.

| Case / seed | Ipopt | POUNCE default | POUNCE identity |
| --- | ---: | ---: | ---: |
| case1354sad / 101 | 2.18 | 2.84 | 2.61 |
| case1354sad / 202 | 1.94 | 2.41 | 2.32 |
| case1354sad / 303 | 8.85 | 12.45 | 12.35 |
| case6468 / 101 | 35.00 | 47.63 | 44.05 |
| case6468 / 202 | 46.96 | 38.77 | 48.39 |
| case6468 / 303 | 37.88 | 63.58 | 50.62 |

The [Chrome Ipopt/default POUNCE](../results/benchmarks/chrome-alternative-starts-2026-09-23.json)
and [Chrome identity-scaling](../results/benchmarks/chrome-identity-alternative-starts-2026-09-23.json)
records also retain iterations, restoration calls, objective, and memory
capacity. All three solvers converged to the same local objective within the
benchmark's numerical tolerances on each tested case. But alternative starts
can multiply solve time, and identity scaling is **not uniformly faster**:
on case6468 seed 202 it takes 48.39 s versus 38.77 s for default POUNCE.
These results do not establish comparative failure probabilities; three
deterministic seeds are a small, deliberately structured sample.

Two identity-scaled Node case6468 processes recorded anomalous 17- and
27-minute elapsed times, out of proportion to their iteration counts.
The same seeds completed in Chrome in 44 and 48 seconds, respectively, so
the extreme Node timings are not reproduced in the deployment path. We do
not use Node process elapsed time to rank solver speed.

## Interpretation for Tellegen

The author's hypothesis about missing browser-side Hessian parallelism is
supported: 14 native POUNCE threads substantially reduce that phase and the
whole solve. It does not, by itself, erase the native Ipopt gap on the same
NL. Identity scaling improves every tested **baseline-start** POUNCE case,
but its benefit is start-dependent. In the same-session browser control,
Ipopt retains a material lead on case1354 and case6468, while identity-scaled
POUNCE leads on case9241. The earlier conclusion that both browser backends
are viable remains; choosing one solely from a single start or topology
would be premature. A solver-neutral adapter and worker contract still lets
Tellegen trade POUNCE's simpler Rust/WASI packaging and lower observed
linear-memory capacity against Ipopt's measured RTE latency. Neither these
tests nor issue #965 resolve licensing, source-build provenance, peak memory,
Firefox/WebKit behavior, or a production-scale robustness distribution.

## Reproduction

After building the WASM artifacts and installing the repository's web
dependencies as described in the [README](../README.md), run the Chrome
control with:

```sh
./scripts/run-browser-benchmark.sh \
  --output results/benchmarks/reproduction/chrome-scaling-control.json \
  --cases case1354,case6468,case9241 \
  --backends ipopt-wasm,pounce-wasm,pounce-identity \
  --runs 3 --warmups 1 --cold-runs 0 --seed 20260924 \
  --timeout-ms 300000
```

The deterministic-start correctness sweep is:

```sh
node --test web/test/start-perturbation.test.mjs
node scripts/run-start-sweep.mjs \
  --cases case118api,case1354sad,case6468 \
  --seeds 101,202,303 \
  --backends ipopt-wasm,pounce-wasm,pounce-identity \
  --output results/starts/reproduction/summary.json
```

The Chrome start sweep uses `web/benchmark/run-browser-benchmark.mjs` with
the same cases, backends, and `--start-seeds 101,202,303`. The native profile
uses [`scripts/profile-native-same-nl.mjs`](../scripts/profile-native-same-nl.mjs)
with `--pounce` pointing to a native `pounce-cli` binary built at the pinned
POUNCE revision and `/opt/homebrew/bin/ipopt` 3.14.19 as the ASL/MUMPS binary.
The raw profile contains both binary hashes so a different build can be
identified rather than mistaken for a replicated run.
