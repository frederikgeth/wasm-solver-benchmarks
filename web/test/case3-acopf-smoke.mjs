import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { solve } from "ipopt-wasm";

import { createNlEvaluator } from "../nl-evaluator.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const evaluatorWasm = await readFile(
  `${root}/target/wasm32-unknown-unknown/release/acopf_nl_evaluator_wasm.wasm`,
);
const nl = await readFile(`${root}/fixtures/acopf/case3/case3-acopf.nl`);
const evaluator = await createNlEvaluator(evaluatorWasm, nl);

try {
  const result = await solve(evaluator.problem, {
    print_level: 0,
    tol: 1e-9,
    max_iter: 1000,
    linear_solver: "mumps",
  });

  const constraintViolation = Math.max(...result.constraints.map((value, row) => {
    const lower = evaluator.problem.gl[row];
    const upper = evaluator.problem.gu[row];
    return Math.max(lower - value, value - upper, 0);
  }), 0);
  const boundViolation = Math.max(...result.x.map((value, column) => {
    return Math.max(
      evaluator.problem.xl[column] - value,
      value - evaluator.problem.xu[column],
      0,
    );
  }), 0);

  const report = {
    schema: "acopf-wasm-bench.solver-result/v1",
    backend: "ipopt-wasm",
    case: "PowerModels case3 AC OPF",
    status: result.status,
    objective: result.objective,
    x: Array.from(result.x),
    constraints: Array.from(result.constraints),
    max_constraint_violation: constraintViolation,
    max_bound_violation: boundViolation,
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
  assert.ok(Math.abs(result.objective - 5906.879416645711) <= 1e-3);
  assert.ok(constraintViolation <= 1e-6);
  assert.ok(boundViolation <= 1e-6);
} finally {
  evaluator.dispose();
}
