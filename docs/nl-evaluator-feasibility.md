# Shared `.nl` evaluator feasibility

Status: native interface, POUNCE solve, WASM evaluator export, ipopt-wasm Node
solve, and dedicated real-browser workers are verified on the HS071 probe,
PowerModels 3-, 14-, and 30-bus AC OPFs, and PGLib-OPF cases through 1,354
buses. The smoke timing is diagnostic only, not benchmark evidence.

## Verified source boundary

At POUNCE revision `5a141d4f08349be668802830c7b7820a680ea9d0`,
`pounce-nl::nl_reader::NlTnlp` is a public evaluator implementing
`pounce_nlp::tnlp::TNLP`. The interface supplies:

- model dimensions, bounds, and initial primal values;
- objective and objective-gradient values;
- constraint and sparse Jacobian values;
- the sparse lower triangle of
  `objective_factor * Hessian(f) + sum(lambda[i] * Hessian(g[i]))`;
- fixed zero-based row/column structures whose value order is preserved.

These semantics match the callback contract in `ipopt-wasm` revision
`6b5ee1bb23d3a77ed291193647e3fdbf262dfd08`. That wrapper accepts no `.nl`
input; JavaScript provides the objective, derivative, constraint, Jacobian,
and Hessian callbacks. Its Hessian is documented and implemented as the lower
triangle with zero-based indices.

POUNCE's `pounce-wasm` crate currently exposes load, solve, and solution-file
operations. It does not export standalone evaluation calls. The required
adaptation is therefore a thin ABI around `NlTnlp`, not an `.nl` parser or an
automatic-differentiation implementation.

## Probe

`julia/export_tiny_fixture.jl` exports the standard four-variable HS071
problem through JuMP's AMPL `.nl` writer. `acopf-nl-evaluator` parses that
artifact and checks at its declared initial point:

- objective and constraint values;
- the objective gradient;
- sparse Jacobian values and ordering;
- the exact Lagrangian Hessian for nonzero objective and constraint weights;
- bounds, start values, dimensions, zero-based indexing, and lower-triangle
  convention.

Central finite-difference step sweeps at two additional points check the
objective gradient and sparse Jacobian. A directional finite-difference of
the weighted Lagrangian gradient checks a Hessian-vector product with nonzero
objective and constraint weights.

JuMP's NL writer normalizes constants into the row expressions. In this
fixture, for example, `product(x) >= 25` becomes `product(x) - 25 >= 0`.
The evaluator therefore returns residual values `0` and `12` at the initial
point, not the unshifted left-hand sides `25` and `52`. The fixture sidecar
records the exported expressions and bounds so later feasibility checks do
not accidentally compare different row conventions.

The expected numbers in the Rust test are derived directly from the written
HS071 equations, so the test is not circular with POUNCE's evaluator.

## Remaining risks before benchmarking

The current `wasm32-unknown-unknown` adapter keeps reusable numeric buffers in
its own linear memory. The JavaScript bridge copies callback inputs and outputs
between that memory and ipopt-wasm's separate Emscripten memory. On HS071,
native POUNCE converges in nine iterations, and POUNCE and ipopt-wasm both
return objective `17.01401727293647` and the same primal point to displayed
precision. The ipopt-wasm wrapper does not expose an iteration count. This is
interface evidence, not a browser benchmark.

1. Measure callback copying separately and add repeated cold-solve protocol;
   the current single browser smoke timing must not be treated as a benchmark.
2. Extend the confirmed case coverage to stressed variants and larger PGLib
   systems. Imported AMPL functions are not available on WASM and must be
   rejected explicitly.
3. Preserve `.col`/`.row` identities or an equivalent sidecar mapping; `.nl`
   text alone does not retain the names needed for benchmark diagnostics.

The browser POUNCE path uses upstream's `wasm32-wasip1` ABI and a small WASI
host for clocks, randomness, and stdout. Its evaluator and solver share one
WASM memory. The ipopt-wasm path uses a separate `wasm32-unknown-unknown`
evaluator module and copies callback data across JavaScript into Ipopt's
Emscripten memory. This is a relevant product-integration difference that the
benchmark must measure and disclose, not an algorithm-only comparison.

The shared-evaluator route is feasible through the 1,354-bus representative
case and remains the selected path for timed measurement. There is no evidence
yet that the bounded standalone Rust AC OPF fallback is needed.
