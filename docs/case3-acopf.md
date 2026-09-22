# First AC OPF correctness result

The first power-system fixture is PowerModels' `case3.m` at immutable
PowerModels revision `f8ef54f762502cfae7760ea6314c4683b18b1ec5`. Its source
SHA-256 is
`d2173e913ab554dd4fe6cfdcf17bcc5d3f882b769bcdfc37470cb273f0df507b`.
The frozen model uses `PowerModels.ACPPowerModel` and `build_opf`, including
voltage and generator bounds, charging, both-end thermal limits, angle limits,
and the case's DC line.

The export contains 28 variables, 29 constraints, 103 Jacobian nonzeros, and
35 lower-triangular Hessian nonzeros. The committed `.col`, `.row`, and JSON
mapping preserve final NL ordering, bounds, starts, source expressions, and
artifact hashes. Regenerating the fixture twice with the pinned Julia manifest
produces byte-identical files.

## Controlled solves

All paths start from the initial point embedded in the same `.nl` file and use
exact Hessians.

| Path | Termination | Objective | Role |
| --- | --- | ---: | --- |
| PowerModels + native Ipopt/MUMPS | `LOCALLY_SOLVED` | 5906.879416645711 | formulation reference |
| Shared NL evaluator + native POUNCE | `SolveSucceeded` | 5906.879448872702 | native evaluator/solver check |
| Shared NL evaluator + browser POUNCE | `SolveSucceeded` | 5906.879448872702 | Node and real-browser worker smoke |
| Shared NL evaluator + browser ipopt-wasm | status `0` | 5906.879416645711 | Node and real-browser worker smoke |

These are compatibility and correctness results, not timings. A one-off worker
duration is affected by loading, compilation, and instrumentation and is not a
benchmark sample.

## Independent validation

`julia/validate_acopf_solution.jl` reads the original MATPOWER case and the
named primal vector. It uses PowerModels only to parse and normalize source
data; it explicitly recomputes the polar AC branch equations, active/reactive
bus balances, DC loss equation, both-end apparent-power limits, angle limits,
variable bounds, reference angle, and polynomial generation cost. It never
calls the shared `.nl` evaluator.

For the recorded ipopt-wasm candidate:

- maximum active balance residual: `0.0` p.u. (`0.0` MW);
- maximum reactive balance residual: `1.11e-16` p.u. (`1.11e-14` MVAr);
- maximum branch-equation residual: `3.33e-16` p.u.;
- maximum thermal-limit violation: `1.00e-8` p.u. (`1.00e-6` MVA);
- maximum variable-bound violation: `1.10e-8` in model units;
- objective recomputation difference: `9.09e-13` in absolute value.

The candidate passes the frozen `1e-6` p.u. feasibility gate and the `1e-6`
absolute objective-recomputation gate. PowerModels/Ipopt is still a local
reference, not a certificate of global optimality.

The recorded POUNCE WASM candidate independently passes the same gates. Its
maximum active/reactive balance residual is `2.22e-16`/`5.55e-17` p.u., its
maximum branch-equation residual is `3.89e-16` p.u., its maximum thermal-limit
violation is `2.50e-9` p.u., and the independently recomputed objective is
bit-identical to the reported value.

Reproduce the recorded candidate and validation report with:

```sh
./scripts/run-case3-correctness.sh
```

The machine-readable artifacts are
`results/smoke/case3-{ipopt,pounce}-wasm.json` and their corresponding
`.validation.json` reports.
