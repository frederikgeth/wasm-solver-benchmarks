import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { solve } from "ipopt-wasm";

import { createNlEvaluator } from "../nl-evaluator.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const caseName = process.env.ACOPF_CASE ?? "case3";
const fixture = `${root}/fixtures/acopf/${caseName}/${caseName}-acopf`;
const evaluatorWasm = await readFile(
  `${root}/target/wasm32-unknown-unknown/release/acopf_nl_evaluator_wasm.wasm`,
);
const nl = await readFile(`${fixture}.nl`);
const mapping = JSON.parse(await readFile(`${fixture}.mapping.json`, "utf8"));
const reference = JSON.parse(await readFile(`${fixture}.reference.json`, "utf8"));
const evaluator = await createNlEvaluator(evaluatorWasm, nl);
// NL rows include differently scaled quantities (for example squared MVA).
// This is a gross callback regression guard; the source-data validator owns
// the normalized 1e-6 p.u. feasibility gate.
const rawConstraintTolerance = 1e-5;

try {
  const result = await solve(evaluator.problem, {
    print_level: 0,
    tol: 1e-9,
    max_iter: 1000,
    linear_solver: "mumps",
  });

  let constraintViolation = 0;
  for (let row = 0; row < result.constraints.length; row += 1) {
    const value = result.constraints[row];
    constraintViolation = Math.max(
      constraintViolation,
      evaluator.problem.gl[row] - value,
      value - evaluator.problem.gu[row],
    );
  }
  let boundViolation = 0;
  for (let column = 0; column < result.x.length; column += 1) {
    const value = result.x[column];
    boundViolation = Math.max(
      boundViolation,
      evaluator.problem.xl[column] - value,
      value - evaluator.problem.xu[column],
    );
  }

  const report = {
    schema: "acopf-wasm-bench.solver-result/v1",
    backend: "ipopt-wasm",
    environment: "node",
    case: mapping.case,
    model_sha256: mapping.artifacts.nl_sha256,
    solver: {
      package_version: "0.2.0",
      upstream_revision: "6b5ee1bb23d3a77ed291193647e3fdbf262dfd08",
      linear_solver: "MUMPS",
    },
    status: result.status,
    objective: result.objective,
    x: Array.from(result.x),
    constraints: Array.from(result.constraints),
    max_constraint_violation: constraintViolation,
    max_bound_violation: boundViolation,
    raw_constraint_tolerance: rawConstraintTolerance,
    dimensions: {
      variables: evaluator.problem.n,
      constraints: evaluator.problem.m,
      jacobian_nonzeros: evaluator.problem.nele_jac,
      hessian_nonzeros: evaluator.problem.nele_hess,
    },
    options: {
      print_level: 0,
      tol: 1e-9,
      max_iter: 1000,
      linear_solver: "mumps",
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (process.env.ACOPF_RESULT_PATH) {
    await mkdir(dirname(process.env.ACOPF_RESULT_PATH), { recursive: true });
    await writeFile(
      process.env.ACOPF_RESULT_PATH,
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }

  assert.equal(result.status, 0, `Ipopt returned status ${result.status}`);
  assert.ok(Math.abs(result.objective - reference.objective) <= Math.max(1e-3, Math.abs(reference.objective) * 1e-5));
  assert.ok(constraintViolation <= rawConstraintTolerance);
  assert.ok(boundViolation <= 1e-6);
} finally {
  evaluator.dispose();
}
