# Handover: canonical transmission AC OPF in Tellegen with POUNCE

Prepared 23 September 2026. Planning document, not an implementation or a claim
that the new model path has passed the standalone benchmark gates.

## Decision and evidence

POUNCE is the chosen first nonlinear AC OPF solver for Tellegen. The deciding
factors are its responsive maintainer community and an end-to-end Rust solver
stack, despite slower measured solves on some cases. Do not spend the first
implementation cycle building a competing Ipopt adapter. Preserve an internal
solver boundary so another backend can be considered later without changing
PowerIO's problem or solution contract.

This choice follows the [PR #961 restoration fix](https://github.com/jkitchin/pounce/pull/961)
and [issue #965 experiments](pounce-issue-965-follow-up.md). Both tested browser
backends produced independently feasible solutions on the eleven checked
fixtures (nine original cases plus two stress variants), with further
alternative-start checks. In a randomized three-run
Chrome control, POUNCE with identity FERAL scaling took 23.188 s versus
17.599 s for Ipopt/MUMPS on case6468 RTE, but 20.822 s versus 24.590 s on
case9241 PEGASE; these are solver-call medians on one M4 Max, not general
performance guarantees. Browser POUNCE's measured post-solve WASM memory was
480 MiB on case6468 and 660 MiB on case9241; the product's new expression
construction could use more memory than the benchmark's frozen-NL path.

The existing [Tellegen solver discussion #134](https://github.com/eigenergy/tellegen/issues/134)
predates this explicit product decision and the latest #965 follow-up. It needs
a dated decision comment or edited top-level warning before being treated as a
current recommendation. The raw benchmark evidence should remain unchanged.

## Repository boundaries and existing seams

| Owner | Existing contract | AC OPF work |
| --- | --- | --- |
| PowerIO `powerio-prob` | `AcOpfInstance` declares the canonical balanced problem, objective, active constraints, and optional initial operating point; `AcOpfSolution` is the portable result. | Change only for a demonstrated missing semantic or result field. Do not put POUNCE here. |
| PowerIO `powerio-matrix` | `build_ac_opf_preparation` lowers the canonical instance into per-unit bus/branch/generator arrays and source-row mappings, including transformer lowering. | Use as the only model-preparation source; submit small PowerIO fixes independently if fidelity gaps appear. |
| Tellegen `tellegen` | `Problem::Acopf` already exists as an unavailable wire tag; `solve_module_json` dispatches PowerIO modules; private workspaces and `emit.rs` convert solutions. | Own exact AC equations, POUNCE integration, validation, status mapping, and portable solution emission. |
| Tellegen `tellegen-wasm` / `@tellegen/engine` | `solve_module` and capabilities already cross the Rust/worker boundary. | Add an optional AC OPF build/capability and keep long-running solves in a terminable worker. |
| POUNCE | `pounce-nl::NlProblem::from_expressions` accepts in-memory expressions and `NlTnlp` supplies sparse exact derivatives to the NLP solver. | Pin and exercise a public API; no JuMP or `.nl` serialization in the product path unless the spike shows an unavoidable gap. |

The intended data path is `PioModule<AcOpfInstance>` (or network promoted to
that instance) → PowerIO AC preparation → private Tellegen polar AC OPF model →
POUNCE → independently checked primal/dual data → `AcOpfSolution` plus
`SolveResponse`. Keep both output shapes aligned; do not invent a second
persisted AC OPF schema.

Important distinctions:

- `Socwr` is a convex relaxation and **must not** be relabeled as canonical
  `Acopf`. Its W-space equations/solution are not an exact polar NLP.
- Tellegen's existing `AcNetwork::from_network` contains a near-ideal-jumper
  charging adjustment for a CATS stability case. The canonical AC OPF path
  must not silently adopt that changed physics. Share only electrical kernels
  whose equality with PowerIO preparation is tested.
- Tellegen `Study` currently assumes differentiable DC/PF/SOCWR solved states.
  A one-shot AC OPF solve is the first scope. Do not expose preview/sensitivity
  menus for AC OPF until a separate, validated NLP KKT contract exists.
- No server round-trip is needed for the first browser path. Native Rust and
  browser execution should share the same model builder and source mapping.

## The critical feasibility spike

1. On a branch from **Tellegen `main`**, add an opt-in `acopf` feature and a
   minimal native probe: construct HS071 through
   `NlProblem::from_expressions`, build `NlTnlp`, and solve it through POUNCE
   with exact sparse derivatives. Pin the POUNCE revision and options. Avoid
   the convenient high-level builder if it defaults to dense finite-difference
   Jacobians or limited-memory Hessians.
2. Compile and run the same probe with Tellegen's actual
   `wasm32-unknown-unknown` / `wasm-bindgen` package, including its JS worker.
   The benchmark's working `pounce-wasm` artifact is **`wasm32-wasip1` plus a
   WASI shim**; it does not establish that POUNCE links directly into the
   existing Tellegen WASM crate. A preliminary
   [`wasm-bindgen` probe](pounce-wasm-bindgen-probe.md) now confirms it
   compiles and loads but traps on POUNCE's first `std::time::Instant::now()`
   during solve. Retain the proven separate WASI worker-module approach as
   the near-term path, with a small typed message boundary and one POUNCE
   memory. Revisit a single-module build if upstream supplies a portable
   clock; then measure asset size and test worker termination in-browser.
3. Build 3-, 14-, and 300-bus PowerIO-prepared prototypes in memory. Compare
   objective, constraint residuals, sparse Jacobian, and Lagrangian Hessian at
   the same points against the frozen benchmark NL model and finite differences.
   Record expression/tape construction time, solve time, peak process/browser
   memory, and WASM memory growth. `from_expressions` safely treats truly
   linear rows as nonlinear in presolve metadata; assess whether this harms
   large-case time/memory before committing to this route.
4. Decide the model API at this gate: prefer the in-memory expression DAG if
   exactness and scaling hold. If not, keep the same Tellegen model/row-map
   boundary and implement a sparse analytic `TNLP` callback, or document why a
   WASI/NL bridge is temporarily necessary. Do not turn a feasibility spike
   into a permanent file-format dependency by default.

The spike must also review the POUNCE EPL-2.0 dependency and required notices
against Tellegen's MIT publication/release policy. This is a distribution
gate, not a claim of license incompatibility or an automatic approval.

## Model contract for the first usable solver

Use a private variable/constraint index map with generator-level `Pg/Qg`, bus
`Vm/Va`, and any explicit epigraph variables needed by supported piecewise
costs. Evaluate exact AC nodal P/Q balances and full pi-model flows with taps,
phase shifts, charging, shunts, voltage bounds, generator bounds, reference
angles, branch-angle differences, and **both-end** apparent-power limits as
selected by the `AcOpfInstance`. Use PowerIO's per-unit preparation and source
maps, not new MATPOWER interpretation in Tellegen. Preserve each original
generator and branch identity through the solution, including out-of-service
and lowered-transformer rows.

Make PowerIO assembly options explicit in the model fingerprint and tests.
In particular, its default can correct unusable angle intervals to ±60° in
the PowerModels style; that is a modeling policy choice, not an invisible
solver setting. Zero-impedance skipping and synthetic thermal ratings should
also never be enabled merely to get a case to solve without recording the
change from the declared instance.

Choose and document one consistent constraint sign convention for P/Q balance,
thermal inequalities, and duals. Test objective and outputs in source units
(MW, MVAr, degrees, source cost units). Only publish active/reactive LMPs and
limit multipliers after sign and per-unit scaling are checked by finite
perturbations and against a trusted reference; otherwise return `None`, not a
plausible-looking but unverified price.

For the first iteration, support the continuous balanced transmission cases
represented by the benchmark. Reject, with named element and reason, any
declared feature not modeled exactly: e.g. unsupported storage behavior,
voltage-dependent loads, nonsmooth/nonconvex cost forms, or transformer
configurations beyond those verified by tests. Do not silently approximate
piecewise costs through Tellegen's separate `ConvexQuadraticFit`; if exact
piecewise costs are not implemented in the first PR, report that explicitly.
Likewise, no topology switching, commitment, multiconductor distribution OPF,
or contingency/scenario solve is implied by this work.

Map POUNCE convergence, iteration limit, infeasibility, and numerical failure
carefully into `SolveResponse` and PowerIO `Termination`. Because AC OPF is
nonconvex, a converged local solution is not a proof of global optimality.
Likewise, a local NLP solver's infeasibility indication is not generally a
proof that the canonical problem is infeasible; avoid PowerIO's proof-strength
`Termination::Infeasible` unless that claim can actually be supported.
Do not call an unvalidated early stop `Optimal`; expose residuals and solver
diagnostics sufficient for the UI to explain failures. A numerical solver
status alone is not the independent AC feasibility check.

## Suggested PR stack and relation to open work

As of this handover, local `origin/main` agrees with GitHub main at Tellegen
`3130e92474f54455eef5fd53ce6ce301e1f880a7` and PowerIO
`593b73c5739e6b29b3172ca7b681f9d00d0e5700`. Refresh these refs before
creating branches. The local Tellegen checkout is the `codex/interactive-mc-pf`
worktree for [PR #129](https://github.com/eigenergy/tellegen/pull/129), with
untracked user drafts; **do not branch the AC OPF stack from that checkout**.

1. **Tellegen PR A — feasibility, feature, and release boundary.** Base on
   `main`. Add the POUNCE dependency behind `acopf`, the native/browser
   probe, a short architecture decision record, and license/notice review.
   [PR #136](https://github.com/eigenergy/tellegen/pull/136) only bumps the
   PowerIO 0.11.1→0.11.3 group in `Cargo.lock`; merge/rebase it when ready,
   but it is not a conceptual prerequisite. Pin whichever released PowerIO
   version actually contains the required preparation/solution API and test
   against it; do not build on unpublished PowerIO `main` accidentally.
2. **Tellegen PR B — exact canonical model.** Stack on A. Add a private
   PowerIO-preparation-to-POUNCE model compiler with stable row/column maps,
   supported-feature checks, starts/bounds, physics/derivative parity tests,
   and no UI. Use focused 3/14/30/300-bus cases before adding larger cases.
3. **Tellegen PR C — solve and emit.** Stack on B. Add
   `solve_ac_opf_instance` (separate from `solve_ac_instance`, which currently
   means SOCWR), network promotion and `PioValue::AcOpfInstance` dispatch in
   `solve_module_json`, a truthful `Problem::Acopf` capability, cancellation
   and diagnostics, and a typed `solve_ac_opf_instance_to_solution` (or
   equivalent) returning a full `AcOpfSolution` with a round-trip test.
   Follow the source-row mapping pattern in `emit.rs`; no false duals. Apply
   request edits to the canonical instance with documented semantics, or
   reject unsupported edits explicitly rather than dropping them.
4. **Tellegen PR D — browser/package/documentation.** Stack on C. Expose the
   one-shot mode through the existing worker `solve_module` protocol and
   capability-driven UI, with progress/error presentation and hard worker
   termination for cancellation. Do not let a heavy AC OPF silently fall back
   to synchronous main-thread execution. Add browser bundle, memory, and
   representative-case tests; update formulation/direction docs and third
   party notices. Coordinate any later Python exposure with
   [PR #133](https://github.com/eigenergy/tellegen/pull/133), rather than
   making it a base for the numerical implementation.
5. **Separate follow-up, not in the first stack:** AC OPF warm starts, retained
   interactive sessions, parametric/KKT sensitivities, and `Study` previews.
   Define a sensitivity contract and issue first; never return a SOCWR/DC
   preview under an AC OPF label. [Issue #132](https://github.com/eigenergy/tellegen/issues/132)
   is about multiconductor edit serialization and need not block one-shot AC OPF.

[Issue #102](https://github.com/eigenergy/tellegen/issues/102) asks Tellegen to
reuse PowerIO's Ybus/DC-incidence assembly. It is architecturally aligned with
this work. Reuse `build_ac_opf_preparation` directly in PR B, and factor any
verified shared Ybus/flow primitive with #102 if it reduces duplication; do
not wait for a wholesale PF refactor if a separate exact AC OPF workspace is
cleaner. [PR #107](https://github.com/eigenergy/tellegen/pull/107) is an
optional Moreau **DC** backend and provides a feature/notice/cancellation
pattern, not a base branch. [PR #128](https://github.com/eigenergy/tellegen/pull/128)
and #129 are multiconductor distribution work, not prerequisites. PowerIO's
open [#530 → #531 → #532 stack](https://github.com/eigenergy/powerio/pull/530)
is LinDist3Flow distribution preparation/dispatch; do not stack transmission
AC OPF changes on it. PowerIO's #501–#503 in-memory source/browser-converter
stack can later inform file ingestion, but not the solve architecture.

No currently open PowerIO issue is needed merely to host a POUNCE backend.
If the first fixture exposes a specific PowerIO semantic/preparation/output
gap, file that narrow issue and PR against **PowerIO main**, then pin a
released version (or an explicitly temporary commit) in Tellegen. Keep
PowerIO solver-agnostic.

## Acceptance gate and reproducibility

- Fixture ladder: HS071 API probe; 3/14/30/118/300/1354-bus model/solve
  checks; stressed 1354 variants; case6468 and case6515 RTE; case9241 PEGASE.
  Reuse the standalone benchmark's frozen inputs and independent validator,
  but ensure Tellegen's new PowerIO→expression model is checked rather than
  merely re-solving the benchmark NL file. Include at least three distinct
  starts on small, stressed, and RTE cases. Record all failures and solver
  settings, not just medians.
- Verify objective and balance/flow/limit residuals from **source network
  equations**, not from POUNCE's callback; compare exact derivatives at
  sampled points. Test taps, phase shifts, shunts, angle limits, both branch
  ends, multiple generators on one bus, inactive elements, and source row
  mapping. Treat discrepancies as model bugs before solver tuning.
- For native and real browser, record model construction, solver-call and
  end-to-end time separately; peak process/RSS where available, WASM memory,
  asset size, worker lifecycle, and cancellation. Test a clean production
  build, not only a developer build. The previous WASM memory figures are
  **not** a size guarantee for the new expression-DAG path or the nominal
  4 GiB wasm32 address space.
- Golden tests: PowerIO instance serialize/deserialize, solution
  serialize/deserialize, canonical ID preservation, capability gating without
  `acopf`, unsupported-feature errors, no synchronous browser fallback, and
  accurate failure/partial-convergence status. Run Tellegen's Rust/JS gates
  and a real-browser smoke after each relevant PR.

## Coordination to finish the handover

Post a dated note on [Tellegen #134](https://github.com/eigenergy/tellegen/issues/134):
POUNCE is selected for community/support and the Rust stack, with the new
evidence linked; the issue's earlier two-adapter recommendation is historical.
Open one implementation tracking issue for PRs A–D and the gates above. Keep
this handover as the detailed checklist, not as a replacement for the open
discussion. The implementation may begin only after confirming the current
PowerIO release API, browser ABI plan, and license/notice gate.
