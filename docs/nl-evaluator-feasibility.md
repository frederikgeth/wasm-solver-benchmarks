# Shared `.nl` evaluator feasibility

Status: native interface verified on the HS071 probe; WASM export and
end-to-end browser solves remain to be implemented.

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

JuMP's NL writer normalizes constants into the row expressions. In this
fixture, for example, `product(x) >= 25` becomes `product(x) - 25 >= 0`.
The evaluator therefore returns residual values `0` and `12` at the initial
point, not the unshifted left-hand sides `25` and `52`. The fixture sidecar
records the exported expressions and bounds so later feasibility checks do
not accidentally compare different row conventions.

The expected numbers in the Rust test are derived directly from the written
HS071 equations, so the test is not circular with POUNCE's evaluator.

## Remaining risks before AC OPF

1. Export the adapter as a small `wasm32-unknown-unknown` or
   `wasm32-wasip1` module and measure the cost of copying values into
   ipopt-wasm's separate Emscripten memory.
2. Feed those callbacks to ipopt-wasm in Node as a smoke test, then in a real
   browser worker. The browser measurement must not be inferred from Node.
3. Run POUNCE on the same retained evaluator instance and compare the two
   solutions with an independent HS071 calculation.
4. Confirm JuMP/PowerModels `.nl` output uses only operations supported by
   POUNCE on 3- and 14-bus AC OPF exports. Imported AMPL functions are not
   available on WASM and must be rejected explicitly.
5. Preserve `.col`/`.row` identities or an equivalent sidecar mapping; `.nl`
   text alone does not retain the names needed for benchmark diagnostics.

The shared-evaluator route is feasible enough to continue. There is no
evidence yet that the bounded standalone Rust AC OPF fallback is needed.
