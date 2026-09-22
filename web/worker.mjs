import { createNlEvaluator } from "./nl-evaluator.mjs";
import { createPounceRunner } from "./pounce-runner.mjs";

const smokeCases = {
  hs071: {
    label: "HS071",
    nl: "/fixtures/tiny/hs071.nl",
    objective: 17.014017145179,
    objectiveTolerance: 1e-6,
    rawConstraintTolerance: 1e-6,
    modelSha256: null,
    maxIterations: 100,
  },
};

async function fetchAsset(url, format = "bytes") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`asset load failed: ${url} (${response.status})`);
  if (format === "text") return response.text();
  if (format === "json") return response.json();
  return response.arrayBuffer();
}

async function resolveSmokeCase(caseName) {
  if (smokeCases[caseName]) return smokeCases[caseName];
  if (!/^case[0-9]+$/.test(caseName)) throw new Error(`unknown smoke case ${caseName}`);

  const base = `/fixtures/acopf/${caseName}/${caseName}-acopf`;
  const [mapping, reference] = await Promise.all([
    fetchAsset(`${base}.mapping.json`, "json"),
    fetchAsset(`${base}.reference.json`, "json"),
  ]);
  return {
    label: mapping.case,
    nl: `${base}.nl`,
    col: `${base}.col`,
    row: `${base}.row`,
    objective: reference.objective,
    objectiveTolerance: Math.max(1e-3, Math.abs(reference.objective) * 1e-5),
    rawConstraintTolerance: 1e-5,
    modelSha256: mapping.artifacts.nl_sha256,
    maxIterations: 1000,
  };
}

async function runIpopt(smokeCase, totalStart) {
  self.postMessage({ type: "phase", phase: "loading" });
  const loadStart = performance.now();
  const [wasmBytes, nlBytes] = await Promise.all([
    fetchAsset("/artifacts/evaluator/acopf_nl_evaluator_wasm.wasm"),
    fetchAsset(smokeCase.nl),
  ]);
  const loadMilliseconds = performance.now() - loadStart;

  self.postMessage({ type: "phase", phase: "preparing" });
  const prepareStart = performance.now();
  const [{ solve }, evaluator] = await Promise.all([
    import("/vendor/ipopt-wasm/index.mjs"),
    createNlEvaluator(wasmBytes, new Uint8Array(nlBytes)),
  ]);
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

    let maxConstraintViolation = 0;
    for (let row = 0; row < result.constraints.length; row += 1) {
      const value = result.constraints[row];
      maxConstraintViolation = Math.max(maxConstraintViolation,
        evaluator.problem.gl[row] - value,
        value - evaluator.problem.gu[row],
        0,
      );
    }
    let maxBoundViolation = 0;
    for (let column = 0; column < result.x.length; column += 1) {
      const value = result.x[column];
      maxBoundViolation = Math.max(maxBoundViolation,
        evaluator.problem.xl[column] - value,
        value - evaluator.problem.xu[column],
        0,
      );
    }
    const passed = result.status === 0
      && maxConstraintViolation <= smokeCase.rawConstraintTolerance
      && maxBoundViolation <= 1e-6
      && Math.abs(result.objective - smokeCase.objective) <= smokeCase.objectiveTolerance;

    return {
      schema: "acopf-wasm-bench.smoke-result/v1",
      backend: "ipopt-wasm",
      environment: "browser-worker",
      case: smokeCase.label,
      model_sha256: smokeCase.modelSha256,
      passed,
      status: result.status,
      objective: result.objective,
      x: Array.from(result.x),
      constraints: Array.from(result.constraints),
      max_constraint_violation: maxConstraintViolation,
      max_bound_violation: maxBoundViolation,
      raw_constraint_tolerance: smokeCase.rawConstraintTolerance,
      wasm_linear_memory_bytes: {
        evaluator: evaluator.memoryBytes(),
        ipopt_wasm: null,
      },
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
        evaluator_and_solver_preparation: prepareMilliseconds,
        optimization: solveMilliseconds,
        total: performance.now() - totalStart,
      },
      options: {
        print_level: 0,
        tol: 1e-9,
        max_iter: smokeCase.maxIterations,
        linear_solver: "mumps",
      },
    };
  } finally {
    evaluator.dispose();
  }
}

async function runPounce(smokeCase, totalStart) {
  self.postMessage({ type: "phase", phase: "loading" });
  const loadStart = performance.now();
  const [wasmBytes, nl, col, row] = await Promise.all([
    fetchAsset("/artifacts/pounce/acopf_pounce_browser_wasm.wasm"),
    fetchAsset(smokeCase.nl, "text"),
    smokeCase.col ? fetchAsset(smokeCase.col, "text") : "",
    smokeCase.row ? fetchAsset(smokeCase.row, "text") : "",
  ]);
  const loadMilliseconds = performance.now() - loadStart;

  self.postMessage({ type: "phase", phase: "preparing" });
  const prepareStart = performance.now();
  const runner = await createPounceRunner(wasmBytes);
  const summary = runner.load(nl, col, row);
  const prepareMilliseconds = performance.now() - prepareStart;

  self.postMessage({ type: "phase", phase: "solving" });
  const solveStart = performance.now();
  const result = runner.solve([
    "print_level 0",
    "tol 1e-9",
    `max_iter ${smokeCase.maxIterations}`,
    "presolve no",
    "",
  ].join("\n"));
  const solveMilliseconds = performance.now() - solveStart;
  const passed = result.success
    && result.status_code === 0
    && result.x.length === summary.n_vars
    && result.g.length === summary.n_cons
    && result.constraint_violation <= smokeCase.rawConstraintTolerance
    && Math.abs(result.objective - smokeCase.objective) <= smokeCase.objectiveTolerance;

  return {
    schema: "acopf-wasm-bench.smoke-result/v1",
    backend: "pounce-wasm",
    environment: "browser-worker",
    case: smokeCase.label,
    model_sha256: smokeCase.modelSha256,
    passed,
    status: result.status_code,
    raw_status: result.status,
    objective: result.objective,
    x: result.x,
    constraints: result.g,
    max_constraint_violation: result.constraint_violation,
    raw_constraint_tolerance: smokeCase.rawConstraintTolerance,
    solution_transport: result.preview_truncated ? "full CSV export" : "solve JSON",
    wasm_linear_memory_bytes: {
      pounce_wasm: runner.memoryBytes(),
    },
    iterations: result.iterations,
    restoration_calls: result.restoration_calls,
    evaluations: result.evals,
    dimensions: {
      variables: summary.n_vars,
      constraints: summary.n_cons,
      jacobian_nonzeros: summary.nnz_jac,
      hessian_nonzeros: summary.nnz_hess,
    },
    artifact_bytes: {
      pounce_wasm: wasmBytes.byteLength,
      nl: new TextEncoder().encode(nl).byteLength,
    },
    timings_ms: {
      asset_loading: loadMilliseconds,
      solver_and_model_preparation: prepareMilliseconds,
      optimization: solveMilliseconds,
      solver_reported_optimization: result.wall_time_secs * 1000,
      total: performance.now() - totalStart,
    },
    options: {
      print_level: 0,
      tol: 1e-9,
      max_iter: smokeCase.maxIterations,
      presolve: false,
    },
  };
}

self.onmessage = async ({ data }) => {
  if (data?.type !== "run") return;

  const totalStart = performance.now();
  try {
    const smokeCase = await resolveSmokeCase(data.case ?? "hs071");
    const backend = data.backend ?? "ipopt-wasm";
    let result;
    if (backend === "ipopt-wasm") {
      result = await runIpopt(smokeCase, totalStart);
    } else if (backend === "pounce-wasm") {
      result = await runPounce(smokeCase, totalStart);
    } else {
      throw new Error(`unknown backend ${backend}`);
    }
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  } finally {
    self.close();
  }
};
