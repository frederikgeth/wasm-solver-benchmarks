import { solve } from "/vendor/ipopt-wasm/index.mjs";

import { createNlEvaluator } from "./nl-evaluator.mjs";

const smokeCases = {
  hs071: {
    label: "HS071",
    nl: "/fixtures/tiny/hs071.nl",
    objective: 17.014017145179,
    objectiveTolerance: 1e-6,
    maxIterations: 100,
  },
  case3: {
    label: "PowerModels case3 AC OPF",
    nl: "/fixtures/acopf/case3/case3-acopf.nl",
    objective: 5906.879416645711,
    objectiveTolerance: 1e-3,
    maxIterations: 1000,
  },
};

self.onmessage = async ({ data }) => {
  if (data?.type !== "run") return;

  const totalStart = performance.now();
  try {
    const smokeCase = smokeCases[data.case ?? "hs071"];
    if (!smokeCase) throw new Error(`unknown smoke case ${data.case}`);
    self.postMessage({ type: "phase", phase: "loading" });
    const loadStart = performance.now();
    const [wasmResponse, nlResponse] = await Promise.all([
      fetch("/artifacts/acopf_nl_evaluator_wasm.wasm"),
      fetch(smokeCase.nl),
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
        max_iter: smokeCase.maxIterations,
        linear_solver: "mumps",
      });
      const solveMilliseconds = performance.now() - solveStart;

      const violations = result.constraints.map((value, row) => {
        const lower = evaluator.problem.gl[row];
        const upper = evaluator.problem.gu[row];
        return Math.max(lower - value, value - upper, 0);
      });
      const maxConstraintViolation = Math.max(...violations, 0);
      const boundViolations = result.x.map((value, column) => {
        return Math.max(
          evaluator.problem.xl[column] - value,
          value - evaluator.problem.xu[column],
          0,
        );
      });
      const maxBoundViolation = Math.max(...boundViolations, 0);
      const passed = result.status === 0
        && maxConstraintViolation <= 1e-6
        && maxBoundViolation <= 1e-6
        && Math.abs(result.objective - smokeCase.objective) <= smokeCase.objectiveTolerance;

      self.postMessage({
        type: "result",
        result: {
          schema: "acopf-wasm-bench.smoke-result/v1",
          backend: "ipopt-wasm",
          environment: "browser-worker",
          case: smokeCase.label,
          passed,
          status: result.status,
          objective: result.objective,
          x: Array.from(result.x),
          constraints: Array.from(result.constraints),
          max_constraint_violation: maxConstraintViolation,
          max_bound_violation: maxBoundViolation,
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
