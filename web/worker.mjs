import { solve } from "/vendor/ipopt-wasm/index.mjs";

import { createNlEvaluator } from "./nl-evaluator.mjs";

self.onmessage = async ({ data }) => {
  if (data?.type !== "run") return;

  const totalStart = performance.now();
  try {
    self.postMessage({ type: "phase", phase: "loading" });
    const loadStart = performance.now();
    const [wasmResponse, nlResponse] = await Promise.all([
      fetch("/artifacts/acopf_nl_evaluator_wasm.wasm"),
      fetch("/fixtures/tiny/hs071.nl"),
    ]);
    if (!wasmResponse.ok || !nlResponse.ok) {
      throw new Error(`asset load failed (${wasmResponse.status}, ${nlResponse.status})`);
    }
    const [wasmBytes, nlBytes] = await Promise.all([
      wasmResponse.arrayBuffer(),
      nlResponse.arrayBuffer(),
    ]);
    const loadMilliseconds = performance.now() - loadStart;

    self.postMessage({ type: "phase", phase: "preparing" });
    const prepareStart = performance.now();
    const evaluator = await createNlEvaluator(wasmBytes, new Uint8Array(nlBytes));
    const prepareMilliseconds = performance.now() - prepareStart;

    try {
      self.postMessage({ type: "phase", phase: "solving" });
      const solveStart = performance.now();
      const result = await solve(evaluator.problem, {
        print_level: 0,
        tol: 1e-9,
        max_iter: 100,
        linear_solver: "mumps",
      });
      const solveMilliseconds = performance.now() - solveStart;

      const violations = result.constraints.map((value, row) => {
        const lower = evaluator.problem.gl[row];
        const upper = evaluator.problem.gu[row];
        return Math.max(lower - value, value - upper, 0);
      });
      const maxConstraintViolation = Math.max(...violations, 0);
      const objectiveReference = 17.014017145179;
      const passed = result.status === 0
        && maxConstraintViolation <= 1e-6
        && Math.abs(result.objective - objectiveReference) <= 1e-6
        && Math.abs(result.x[0] - 1.0) <= 1e-6;

      self.postMessage({
        type: "result",
        result: {
          schema: "acopf-wasm-bench.smoke-result/v1",
          backend: "ipopt-wasm",
          environment: "browser-worker",
          passed,
          status: result.status,
          objective: result.objective,
          x: Array.from(result.x),
          constraints: Array.from(result.constraints),
          max_constraint_violation: maxConstraintViolation,
          dimensions: {
            variables: evaluator.problem.n,
            constraints: evaluator.problem.m,
            jacobian_nonzeros: evaluator.problem.nele_jac,
            hessian_nonzeros: evaluator.problem.nele_hess,
          },
          artifact_bytes: {
            evaluator_wasm: wasmBytes.byteLength,
            nl: nlBytes.byteLength,
          },
          timings_ms: {
            asset_loading: loadMilliseconds,
            evaluator_preparation: prepareMilliseconds,
            optimization: solveMilliseconds,
            total: performance.now() - totalStart,
          },
        },
      });
    } finally {
      evaluator.dispose();
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  } finally {
    self.close();
  }
};
