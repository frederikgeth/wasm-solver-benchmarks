import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { perturbedStart } from "../web/start-perturbation.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArguments(argv) {
  const options = {
    cases: ["case118api", "case1354sad", "case6468"],
    seeds: [101, 202, 303],
    backends: ["ipopt-wasm", "pounce-wasm"],
    output: join(root, "results/starts/summary-2026-09-23.json"),
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`${key} needs a value`);
    if (key === "--cases") options.cases = value.split(",");
    else if (key === "--seeds") options.seeds = value.split(",").map(Number);
    else if (key === "--backends") options.backends = value.split(",");
    else if (key === "--output") options.output = resolve(root, value);
    else throw new Error(`unknown argument ${key}`);
  }
  if (!options.cases.length || options.cases.some((name) => !/^case[0-9]+(?:api|sad)?$/.test(name))) throw new Error("invalid cases");
  if (!options.seeds.length || options.seeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)) throw new Error("invalid seeds");
  if (!options.backends.length || options.backends.some((name) => !["ipopt-wasm", "pounce-wasm", "pounce-identity"].includes(name))) throw new Error("invalid backends");
  return options;
}

function runProcess(executable, args, environment = {}) {
  return new Promise((resolveProcess, reject) => {
    const start = performance.now();
    const child = spawn(executable, args, { cwd: root, env: { ...process.env, ...environment } });
    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => resolveProcess({ exit_code: exitCode, elapsed_ms: performance.now() - start, stderr_tail: stderr.slice(-2000) }));
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outputDirectory = dirname(options.output);
  await mkdir(outputDirectory, { recursive: true });
  const inputs = [];
  const observations = [];
  for (const caseName of options.cases) {
    const mapping = JSON.parse(await readFile(join(root, `fixtures/acopf/${caseName}/${caseName}-acopf.mapping.json`), "utf8"));
    for (const seed of options.seeds) {
      const x0 = perturbedStart(mapping.variables, seed);
      inputs.push({ case: caseName, start_seed: seed, initial_point_sha256: sha256(JSON.stringify(x0)) });
      for (const backend of options.backends) {
        const candidatePath = join(outputDirectory, `${caseName}-${backend}-start${seed}.json`);
        const validationPath = join(outputDirectory, `${caseName}-${backend}-start${seed}.validation.json`);
        const smoke = await runProcess(process.execPath, [
          join(root, backend === "ipopt-wasm" ? "web/test/acopf-ipopt-smoke.mjs" : "web/test/acopf-pounce-smoke.mjs"),
        ], {
          ACOPF_CASE: caseName,
          ACOPF_START_SEED: String(seed),
          ACOPF_RESULT_PATH: candidatePath,
          ...(backend === "pounce-identity" ? { ACOPF_POUNCE_SCALING: "identity" } : {}),
        });
        let candidate = null;
        let validation = null;
        let validator = null;
        try {
          candidate = JSON.parse(await readFile(candidatePath, "utf8"));
          validator = await runProcess(join(root, "scripts/validate-acopf-solution.sh"), [caseName, candidatePath, validationPath]);
          validation = JSON.parse(await readFile(validationPath, "utf8"));
        } catch (error) {
          validator ??= { exit_code: null, elapsed_ms: null, stderr_tail: String(error) };
        }
        const observation = {
          case: caseName,
          backend,
          start_seed: seed,
          candidate_path: candidate ? candidatePath : null,
          validation_path: validation ? validationPath : null,
          smoke,
          validator,
          solver_status: candidate?.status ?? null,
          raw_status: candidate?.raw_status ?? null,
          base_status: candidate?.base_status ?? null,
          second_opinion: candidate?.second_opinion ?? null,
          objective: candidate?.objective ?? null,
          max_constraint_violation: candidate?.max_constraint_violation ?? null,
          independent_validation_passed: validation?.passed ?? false,
          independent_objective_difference: validation?.objective_difference ?? null,
          passed: smoke.exit_code === 0 && validator?.exit_code === 0 && validation?.passed === true,
        };
        observations.push(observation);
        process.stdout.write(`${caseName} ${backend} start ${seed}: ${observation.passed ? "PASS" : "FAIL"}, status ${observation.solver_status}, objective ${observation.objective}\n`);
      }
    }
  }
  const report = {
    schema: "acopf-wasm-bench.start-sweep/v1",
    created_at: new Date().toISOString(),
    repository: {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      worktree_dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()),
    },
    protocol: {
      cases: options.cases,
      backends: options.backends,
      start_seeds: options.seeds,
      start_perturbation: "deterministic bounded perturbations (angles ±0.03 rad, voltage ±0.02 p.u., other variables ±5% of max(1,abs(start)); clipped to bounds)",
      same_start_vector_per_case_seed_for_both_solvers: true,
      validation: "independent explicit AC equations from source MATPOWER case, tolerance 1e-6",
    },
    inputs,
    observations,
    passed: observations.every((observation) => observation.passed),
  };
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`wrote ${options.output}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
