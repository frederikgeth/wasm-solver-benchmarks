import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createPounceRunner } from "../pounce-runner.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const caseName = process.env.ACOPF_CASE ?? "case3";
const scaling = process.env.ACOPF_POUNCE_SCALING ?? null;
assert.ok(scaling === null || scaling === "identity", `unsupported POUNCE scaling ${scaling}`);
const fixture = `${root}/fixtures/acopf/${caseName}/${caseName}-acopf`;
const [wasm, nl, col, row] = await Promise.all([
  readFile(`${root}/target/wasm32-wasip1/release/acopf_pounce_browser_wasm.wasm`),
  readFile(`${fixture}.nl`, "utf8"),
  readFile(`${fixture}.col`, "utf8"),
  readFile(`${fixture}.row`, "utf8"),
]);
const mapping = JSON.parse(await readFile(`${fixture}.mapping.json`, "utf8"));
const reference = JSON.parse(await readFile(`${fixture}.reference.json`, "utf8"));
const runner = await createPounceRunner(wasm);
const summary = runner.load(nl, col, row);
// NL rows include differently scaled quantities (for example squared MVA).
// This is a gross callback regression guard; the source-data validator owns
// the normalized 1e-6 p.u. feasibility gate.
const rawConstraintTolerance = 1e-5;

assert.equal(summary.n_vars, mapping.dimensions.variables);
assert.equal(summary.n_cons, mapping.dimensions.constraints);
assert.deepEqual(summary.external_funcs, []);

const result = runner.solve([
  "print_level 0",
  "tol 1e-9",
  "max_iter 1000",
  "presolve no",
  ...(scaling ? [`feral_scaling ${scaling}`] : []),
  "",
].join("\n"));
assert.equal(result.x.length, summary.n_vars);
assert.equal(result.g.length, summary.n_cons);
const report = {
  schema: "acopf-wasm-bench.solver-result/v1",
  backend: scaling === "identity" ? "pounce-identity" : "pounce-wasm",
  environment: "node-with-browser-wasi-shim",
  case: mapping.case,
  model_sha256: mapping.artifacts.nl_sha256,
  solver: {
    version: "0.12.0",
    upstream_revision: "925e75fbd036de309929e398159f946d42d0d94b",
    linear_solver: "FERAL",
  },
  status: result.status_code,
  raw_status: result.status,
  base_status: result.base_status,
  second_opinion: result.second_opinion,
  objective: result.objective,
  x: result.x,
  constraints: result.g,
  max_constraint_violation: result.constraint_violation,
  raw_constraint_tolerance: rawConstraintTolerance,
  solution_transport: result.preview_truncated ? "full CSV export" : "solve JSON",
  iterations: result.iterations,
  restoration_calls: result.restoration_calls,
  evaluations: result.evals,
  dimensions: {
    variables: summary.n_vars,
    constraints: summary.n_cons,
    jacobian_nonzeros: summary.nnz_jac,
    hessian_nonzeros: summary.nnz_hess,
  },
  options: {
    print_level: 0,
    tol: 1e-9,
    max_iter: 1000,
    presolve: false,
    feral_scaling: scaling ?? "default",
  },
};

console.log(JSON.stringify(report, null, 2));

if (process.env.ACOPF_RESULT_PATH) {
  await mkdir(dirname(process.env.ACOPF_RESULT_PATH), { recursive: true });
  await writeFile(process.env.ACOPF_RESULT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

assert.equal(result.success, true, `POUNCE returned ${result.status}`);
assert.equal(result.status_code, 0, `POUNCE returned ${result.status}`);
assert.ok(Math.abs(result.objective - reference.objective) <= Math.max(1e-3, Math.abs(reference.objective) * 1e-5));
assert.ok(result.constraint_violation <= rawConstraintTolerance);
