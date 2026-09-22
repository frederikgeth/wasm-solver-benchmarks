import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { solve } from "ipopt-wasm";

import { createNlEvaluator } from "../nl-evaluator.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const evaluatorWasm = await readFile(
  `${root}/target/wasm32-unknown-unknown/release/acopf_nl_evaluator_wasm.wasm`,
);
const nl = await readFile(`${root}/fixtures/tiny/hs071.nl`);
const evaluator = await createNlEvaluator(evaluatorWasm, nl);

try {
  const result = await solve(evaluator.problem, {
    print_level: 0,
    tol: 1e-9,
    max_iter: 100,
    linear_solver: "mumps",
  });

  console.log(JSON.stringify({
    backend: "ipopt-wasm",
    status: result.status,
    objective: result.objective,
    x: Array.from(result.x),
    constraints: Array.from(result.constraints),
  }, null, 2));

  assert.equal(result.status, 0, `Ipopt returned status ${result.status}`);
  assert.ok(Math.abs(result.objective - 17.014017145179) <= 1e-6);
  assert.ok(Math.max(...result.constraints.map((value, row) => {
    const lower = evaluator.problem.gl[row];
    const upper = evaluator.problem.gu[row];
    return Math.max(lower - value, value - upper, 0);
  })) <= 1e-6);
  assert.ok(Math.abs(result.x[0] - 1.0) <= 1e-6);
} finally {
  evaluator.dispose();
}
