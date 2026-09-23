import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir, cpus, platform, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function argumentsFrom(argv) {
  const options = {
    cases: ["case300", "case1354", "case6468"],
    threads: [1, 14],
    runs: 3,
    warmups: 1,
    pounce: null,
    ipopt: "/opt/homebrew/bin/ipopt",
    output: null,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!value) throw new Error(`${name} requires a value`);
    if (name === "--cases") options.cases = value.split(",");
    else if (name === "--threads") options.threads = value.split(",").map(Number);
    else if (name === "--runs") options.runs = Number(value);
    else if (name === "--warmups") options.warmups = Number(value);
    else if (name === "--pounce") options.pounce = resolve(value);
    else if (name === "--ipopt") options.ipopt = resolve(value);
    else if (name === "--output") options.output = resolve(root, value);
    else throw new Error(`unknown argument ${name}`);
  }
  if (!options.pounce || !options.output) {
    throw new Error("usage: node scripts/profile-native-same-nl.mjs --pounce PATH --output PATH [--ipopt PATH] [--cases LIST] [--threads LIST] [--runs N] [--warmups N]");
  }
  if (!options.cases.length || options.cases.some((name) => !/^case[0-9]+(?:api|sad)?$/.test(name))) {
    throw new Error("invalid case list");
  }
  if (!options.threads.length || options.threads.some((n) => !Number.isSafeInteger(n) || n < 1)) {
    throw new Error("threads must be positive integers");
  }
  for (const [name, value, minimum] of [["runs", options.runs, 1], ["warmups", options.warmups, 0]]) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be >= ${minimum}`);
  }
  return options;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runProcess(executable, args, environment) {
  const started = performance.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: root, env: { ...process.env, ...environment } });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({
      exitCode,
      elapsed_ms: performance.now() - started,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

function timingStatistics(stdout) {
  const statistics = {};
  const pattern = /^\s*([A-Za-z][A-Za-z0-9 ]*[A-Za-z0-9])\.+:\s+([0-9.]+)(?:s\b)?(?:\s+\(sys:\s*[0-9.]+\s+wall:\s*([0-9.]+)\))?/gm;
  for (const match of stdout.matchAll(pattern)) {
    statistics[match[1].trim()] = {
      reported_seconds: Number(match[2]),
      wall_seconds: match[3] ? Number(match[3]) : null,
    };
  }
  return statistics;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function observe(backend, caseName, reference, model, scratch, pounce, ipopt, runKind, runIndex) {
  const singleThread = { OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1" };
  const isPounce = backend.startsWith("pounce-");
  const threads = isPounce ? Number(backend.split("t").at(-1)) : 1;
  let result;
  let objective;
  let status;
  let iterations;
  let additional = {};
  if (isPounce) {
    const jsonPath = join(scratch, `${caseName}-${backend}-${runKind}-${runIndex}.json`);
    result = await runProcess(pounce, [
      model, "--no-sol", "--no-options-file", "--json-output", jsonPath,
      "print_level=0", "tol=1e-9", "max_iter=1000", "presolve=no",
      "print_timing_statistics=yes",
    ], { ...singleThread, RAYON_NUM_THREADS: String(threads) });
    const report = JSON.parse(await readFile(jsonPath, "utf8"));
    objective = report.solution.objective;
    status = report.solution.status;
    iterations = report.statistics.iteration_count;
    additional = { restoration_calls: report.statistics.restoration_calls };
  } else {
    result = await runProcess(ipopt, [
      join(scratch, caseName), "print_level=5", "tol=1e-9", "max_iter=1000",
      "linear_solver=mumps", "print_timing_statistics=yes",
    ], singleThread);
    objective = Number(result.stdout.match(/^Objective\.+:\s+\S+\s+([0-9.eE+-]+)/m)?.[1]);
    status = result.stdout.match(/^EXIT:\s+(.+)$/m)?.[1] ?? null;
    iterations = Number(result.stdout.match(/^Number of Iterations\.+:\s+([0-9]+)/m)?.[1]);
  }
  const timing = timingStatistics(result.stdout);
  const tolerance = Math.max(1e-3, Math.abs(reference) * 1e-5);
  return {
    case: caseName,
    backend,
    run_kind: runKind,
    run_index: runIndex,
    passed: result.exitCode === 0 && Number.isFinite(objective)
      && Math.abs(objective - reference) <= tolerance
      && Boolean(timing.OverallAlgorithm)
      && (isPounce ? status === "SolveSucceeded" : /^Optimal Solution Found\.?$/.test(status ?? "")),
    exit_code: result.exitCode,
    status,
    iterations,
    objective,
    objective_difference: objective - reference,
    process_elapsed_ms: result.elapsed_ms,
    timing_statistics_seconds: timing,
    stdout_sha256: digest(result.stdout),
    stderr_tail: result.stderr.trim().slice(-2000),
    ...additional,
  };
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const scratch = await mkdtemp(join(tmpdir(), "opf-native-profile-"));
  const inputs = [];
  const observations = [];
  const warmups = [];
  try {
    for (const caseName of options.cases) {
      const stem = join(root, "fixtures", "acopf", caseName, `${caseName}-acopf`);
      const nl = `${stem}.nl`;
      const model = await readFile(nl);
      const reference = JSON.parse(await readFile(`${stem}.reference.json`, "utf8")).objective;
      await copyFile(nl, join(scratch, `${caseName}.nl`));
      inputs.push({ case: caseName, nl_sha256: digest(model), reference_objective: reference });
      const backends = [...options.threads.map((threads) => `pounce-native-t${threads}`), "ipopt-native-asl-t1"];
      for (let i = 1; i <= options.warmups + options.runs; i += 1) {
        const runKind = i <= options.warmups ? "warmup" : "measured";
        const runIndex = i <= options.warmups ? i : i - options.warmups;
        const first = (i - 1) % backends.length;
        const schedule = [...backends.slice(first), ...backends.slice(0, first)];
        for (const backend of schedule) {
          const observation = await observe(
            backend, caseName, reference, nl, scratch, options.pounce, options.ipopt, runKind, runIndex,
          );
          (runKind === "warmup" ? warmups : observations).push(observation);
          process.stdout.write(`${caseName} ${backend} ${runKind} ${runIndex}: ${observation.status}, ${observation.timing_statistics_seconds.OverallAlgorithm?.wall_seconds ?? observation.timing_statistics_seconds.OverallAlgorithm?.reported_seconds ?? "n/a"} s\n`);
        }
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const summaries = options.cases.flatMap((caseName) => [
    ...options.threads.map((threads) => `pounce-native-t${threads}`), "ipopt-native-asl-t1",
  ].map((backend) => {
    const runs = observations.filter((run) => run.case === caseName && run.backend === backend);
    const phaseMedian = (phase) => median(runs.filter((run) => run.passed).map((run) => {
      const value = run.timing_statistics_seconds[phase];
      return value?.wall_seconds ?? value?.reported_seconds;
    }));
    return {
      case: caseName,
      backend,
      attempts: runs.length,
      successes: runs.filter((run) => run.passed).length,
      overall_seconds_median: phaseMedian("OverallAlgorithm"),
      factorization_seconds_median: phaseMedian("LinearSystemFactorization"),
      backsolve_seconds_median: phaseMedian("LinearSystemBackSolve"),
      hessian_seconds_median: phaseMedian(backend.startsWith("pounce-") ? "LagrangianHessianEvaluations" : "Lagrangian Hessian"),
      jacobian_seconds_median: phaseMedian(backend.startsWith("pounce-") ? "ConstraintJacobianEvaluations" : "Equality constraint Jacobian"),
      function_evaluations_seconds_median: phaseMedian(backend.startsWith("pounce-") ? "TotalFunctionEvaluations" : "Function Evaluations"),
      intermediate_callback_seconds_median: phaseMedian("FireIntermediateCallback"),
    };
  }));
  const report = {
    schema: "acopf-wasm-bench.native-same-nl-profile/v1",
    created_at: new Date().toISOString(),
    repository: {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      worktree_dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()),
    },
    host: { platform: platform(), architecture: arch(), cpu_model: cpus()[0]?.model },
    binaries: {
      pounce: { path: options.pounce, sha256: digest(await readFile(options.pounce)) },
      ipopt: { path: options.ipopt, sha256: digest(await readFile(options.ipopt)) },
    },
    protocol: {
      cases: options.cases,
      pounce_rayon_threads: options.threads,
      ipopt_threads: 1,
      runs_per_pair: options.runs,
      warmups_per_pair: options.warmups,
      order: "round-robin rotation of backend order within each case",
      same_frozen_nl_bytes: true,
      exact_hessian: true,
      tol: 1e-9,
      max_iter: 1000,
      pounce_presolve: false,
      ipopt_linear_solver: "mumps",
      timing_statistics_enabled: true,
      phase_timers_are_solver_reported: true,
      timing_note: "Ipopt with MUMPS reports LinearSystemFactorization as zero; this is not an observed zero factorization cost",
    },
    inputs,
    warmups,
    observations,
    summaries,
    passed: observations.every((run) => run.passed),
  };
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`wrote ${options.output}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
