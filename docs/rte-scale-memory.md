# RTE scale and WebAssembly memory probe

The original representative benchmark used `ipopt-wasm` 0.2.0's default
`index.mjs` entry point. That loads `ipopt.wasm`, a wasm32 module. It did not
use the package's `index64.mjs`/`ipopt64.wasm` Memory64 variant.

Although wasm32 has a nominal 4 GiB address space, the generated
`ipopt.mjs` in this package defines `getHeapMax()` as 2,147,483,648 bytes.
That is the effective Ipopt heap-growth ceiling for this build. Inspection of
the shipped `ipopt64.mjs` finds the same 2 GiB value, so the Memory64 artifact
does not currently remove the practical ceiling claimed by its README. The
benchmark now exposes both entry points explicitly as `ipopt-wasm` and
`ipopt-wasm64` so this can be regression-tested if upstream changes.

## PGLib case6468_rte

The added fixture is the unmodified PGLib-OPF v23.07
`pglib_opf_case6468_rte.m`, SHA-256
`b10fbfb66104bc8592e9546d4c7370497fe249406c8915fe53b3a01b1f2dc631`.
PowerModels produces 49,734 variables, 75,002 constraints, 269,026 Jacobian
nonzeros, and 87,664 lower-triangular Hessian nonzeros. Native
PowerModels/Ipopt-MUMPS returns `LOCALLY_SOLVED` at objective
2,069,730.1451210186.

Installed Chrome produced these single-run scale diagnostics:

| Backend | Result | Optimization | Solver Wasm memory | Evaluator memory |
| --- | --- | ---: | ---: | ---: |
| Ipopt wasm32 | success, objective 2,069,730.1451210382 | 17.84 s | 622.75 MiB | 193.88 MiB |
| Ipopt Memory64 | success, same objective | 19.45 s | 622.81 MiB | 193.88 MiB |
| POUNCE wasm32 | `RestorationFailed`, 54 iterations | 10.66 s to failure | 337.19 MiB | included in solver module |

The exact clean-revision record is
[`chrome-case6468-m4max-2026-09-22.json`](../results/benchmarks/chrome-case6468-m4max-2026-09-22.json).
Its overall `passed` field is correctly false because POUNCE's failed attempt
remains in the denominator; both Ipopt observations pass.

The Ipopt wasm32 solution passes the independent explicit AC validator: the
maximum active and reactive balance residuals are `1.24e-14` and `5.11e-15`
p.u., branch-equation residual is `5.61e-12` p.u., thermal-limit excess is
`2.83e-8` p.u., and variable-bound excess is `2.86e-7`.

The POUNCE result is not a feasible candidate. Independent recomputation finds
active and reactive balance residuals of 19.36 and 6.20 p.u. and a maximum
branch-equation residual of 530.50 p.u. This is a restoration/robustness
failure, not evidence of global infeasibility and not an out-of-memory event.

The Ipopt memory values come from benchmark-local, read-only instrumentation
of the installed JavaScript wrapper after the solve. They are linear-memory
capacities, not live allocation or browser RSS. Timings are single-run scale
checks and are not incorporated into the seven-run performance ranking.

## Approximate ceiling

The 1,354-bus and 6,468-bus Ipopt probes use 117.94 and 622.75 MiB of solver
memory for 11,192 and 49,734 variables. A power-law fit across only those two
points grows approximately as `variables^1.12`. Extrapolating that fit to the
actual 2 GiB wrapper cap gives roughly 145,000 variables, or about 18,800 buses
at the case6468 variable-to-bus ratio. Upstream's own unrelated benchmark
reports wasm32 out of memory at 160,000 variables, which is consistent with
that order of magnitude.

This is a planning estimate, not a guaranteed cutoff. MUMPS factorization
memory depends strongly on network sparsity and ordering, so a difficult case
can fail materially earlier. A conservative operational threshold for similar
AC OPFs is therefore around 100,000–120,000 variables, approximately
13,000–16,000 buses, followed by an explicit memory check. The evaluator uses
a separate Wasm memory and the browser has additional non-Wasm allocations.

For problems expected to approach that range, the correct next step is to fix
and verify the Memory64 package's heap-growth configuration rather than plan
around a nominal 4 GiB wasm32 ceiling.

Reproduce the three browser observations with:

```sh
./scripts/run-browser-benchmark.sh \
  --output results/benchmarks/chrome-case6468-m4max-2026-09-22.json \
  --cases case6468 \
  --backends ipopt-wasm,ipopt-wasm64,pounce-wasm \
  --runs 1 --warmups 0 --cold-runs 0 --seed 20260922
```

The command exits nonzero after writing the report because the POUNCE
observation fails validation.
