import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createPounceRunner } from "../pounce-runner.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const [wasm, nl, col, row] = await Promise.all([
  readFile(`${root}/target/wasm32-wasip1/release/acopf_pounce_browser_wasm.wasm`),
  readFile(`${root}/fixtures/acopf/case3/case3-acopf.nl`, "utf8"),
  readFile(`${root}/fixtures/acopf/case3/case3-acopf.col`, "utf8"),
  readFile(`${root}/fixtures/acopf/case3/case3-acopf.row`, "utf8"),
]);
const mapping = JSON.parse(
  await readFile(`${root}/fixtures/acopf/case3/case3-acopf.mapping.json`, "utf8"),
);
const runner = await createPounceRunner(wasm);
const summary = runner.load(nl, col, row);

assert.equal(summary.n_vars, 28);
assert.equal(summary.n_cons, 29);
assert.equal(summary.nnz_jac, 103);
assert.equal(summary.nnz_hess, 35);
assert.deepEqual(summary.external_funcs, []);

const result = runner.solve([
  "print_level 0",
  "tol 1e-9",
  "max_iter 1000",
  "presolve no",
  "",
].join("\n"));
const report = {
  schema: "acopf-wasm-bench.solver-result/v1",
  backend: "pounce-wasm",
  environment: "node-with-browser-wasi-shim",
  case: "PowerModels case3 AC OPF",
  model_sha256: mapping.artifacts.nl_sha256,
  solver: {
    version: "0.12.0",
    upstream_revision: "5a141d4f08349be668802830c7b7820a680ea9d0",
    linear_solver: "FERAL",
  },
  status: result.status_code,
  raw_status: result.status,
  objective: result.objective,
  x: result.x,
  constraints: result.g,
  max_constraint_violation: result.constraint_violation,
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
  },
};

console.log(JSON.stringify(report, null, 2));

if (process.env.ACOPF_RESULT_PATH) {
  await mkdir(dirname(process.env.ACOPF_RESULT_PATH), { recursive: true });
  await writeFile(process.env.ACOPF_RESULT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

assert.equal(result.success, true, `POUNCE returned ${result.status}`);
assert.equal(result.status_code, 0, `POUNCE returned ${result.status}`);
assert.ok(Math.abs(result.objective - 5906.879416645711) <= 1e-3);
assert.ok(result.constraint_violation <= 1e-6);
