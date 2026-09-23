import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { perturbedStart } from "../start-perturbation.mjs";

const webRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(webRoot, "..");
const baseUrl = "http://127.0.0.1:4173";

function usage() {
  return [
    "usage: node benchmark/run-browser-benchmark.mjs --output PATH [options]",
    "",
    "  --browser chrome|edge      desktop browser executable (default: chrome)",
    "  --cases LIST               comma-separated case names",
    "  --backends LIST            comma-separated browser backends",
    "  --runs N                  measured fresh-worker runs per pair (default: 7)",
    "  --warmups N               unmeasured warmups per pair (default: 1)",
    "  --cold-runs N             fresh-browser runs per pair (default: 1)",
    "  --seed N                  deterministic schedule seed (default: 20260922)",
    "  --start-seeds LIST        deterministic alternative-start seeds (default: NL starts)",
    "  --timeout-ms N            timeout for each worker solve (default: 120000)",
    "  --headed                  show the automated browser",
  ].join("\n");
}

function parsePositiveInteger(raw, name, allowZero = false) {
  const value = Number.parseInt(raw, 10);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function parseArguments(argv) {
  const options = {
    browser: "chrome",
    cases: ["case118", "case300", "case1354"],
    backends: ["ipopt-wasm", "pounce-wasm"],
    runs: 7,
    warmups: 1,
    coldRuns: 1,
    seed: 20260922,
    startSeeds: [null],
    timeoutMs: 120000,
    headed: false,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };
    if (argument === "--browser") options.browser = next();
    else if (argument === "--cases") options.cases = next().split(",").filter(Boolean);
    else if (argument === "--backends") options.backends = next().split(",").filter(Boolean);
    else if (argument === "--runs") options.runs = parsePositiveInteger(next(), argument);
    else if (argument === "--warmups") options.warmups = parsePositiveInteger(next(), argument, true);
    else if (argument === "--cold-runs") options.coldRuns = parsePositiveInteger(next(), argument, true);
    else if (argument === "--seed") options.seed = parsePositiveInteger(next(), argument, true);
    else if (argument === "--start-seeds") options.startSeeds = next().split(",").map((value) => parsePositiveInteger(value, argument, true));
    else if (argument === "--timeout-ms") options.timeoutMs = parsePositiveInteger(next(), argument);
    else if (argument === "--output") options.output = path.resolve(repositoryRoot, next());
    else if (argument === "--headed") options.headed = true;
    else if (argument === "--") continue;
    else if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (!options.output) throw new Error(`--output is required\n\n${usage()}`);
  if (!options.cases.length || options.cases.some((item) => !/^case[0-9]+(?:api|sad)?$/.test(item))) {
    throw new Error("--cases must contain case names such as case118, case118api, or case1354sad");
  }
  const supportedBackends = new Set(["ipopt-wasm", "ipopt-wasm64", "pounce-wasm", "pounce-identity"]);
  if (!options.backends.length || options.backends.some((item) => !supportedBackends.has(item))) {
    throw new Error("--backends must contain ipopt-wasm, ipopt-wasm64, pounce-wasm, or pounce-identity");
  }
  if (!["chrome", "edge"].includes(options.browser)) {
    throw new Error("--browser must be chrome or edge");
  }
  if (!options.startSeeds.length || new Set(options.startSeeds).size !== options.startSeeds.length) {
    throw new Error("--start-seeds must be a nonempty list without duplicates");
  }
  return options;
}

async function browserExecutable(name) {
  const candidates = name === "edge"
    ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next documented desktop location.
    }
  }
  throw new Error(`could not find a ${name} executable in: ${candidates.join(", ")}`);
}

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("local server did not start")), 10000);
    const inspect = (chunk) => {
      output += chunk;
      if (output.includes("AC OPF WASM smoke page")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    server.stdout.on("data", inspect);
    server.stderr.on("data", inspect);
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`local server exited before startup with code ${code}: ${output}`));
    });
  });
}

async function runPage(browser, configuration) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = new URL("/benchmark.html", baseUrl);
  url.searchParams.set("cases", configuration.cases.join(","));
  url.searchParams.set("backends", configuration.backends.join(","));
  url.searchParams.set("runs", String(configuration.runs));
  url.searchParams.set("warmups", String(configuration.warmups));
  url.searchParams.set("seed", String(configuration.seed));
  if (configuration.startSeeds[0] !== null) url.searchParams.set("start_seeds", configuration.startSeeds.join(","));
  url.searchParams.set("timeout_ms", String(configuration.timeoutMs));
  const attempts = configuration.cases.length
    * configuration.backends.length
    * configuration.startSeeds.length
    * (configuration.runs + configuration.warmups);
  const pageTimeout = Math.max(30000, attempts * configuration.timeoutMs + 30000);
  try {
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("html[data-benchmark-complete='true']").waitFor({ timeout: pageTimeout });
    const report = JSON.parse(await page.locator("#output").textContent());
    if (report.error) throw new Error(report.error);
    return report;
  } finally {
    await context.close();
  }
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function statistics(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    max: sorted.at(-1) ?? null,
  };
}

function summarize(observations, cases, backends, startSeeds) {
  return cases.flatMap((caseName) => backends.flatMap((backend) => startSeeds.map((startSeed) => {
    const group = observations.filter((item) => item.case === caseName && item.backend === backend && item.start_seed === startSeed);
    const successes = group.filter((item) => item.passed);
    const timing = (name) => statistics(successes.map((item) => item.result?.timings_ms?.[name]));
    return {
      case: caseName,
      backend,
      start_seed: startSeed,
      attempts: group.length,
      successes: successes.length,
      failures: group.length - successes.length,
      objective: successes[0]?.result?.objective ?? null,
      optimization_ms: timing("optimization"),
      preparation_ms: statistics(successes.map((item) => {
        return item.result?.timings_ms?.evaluator_and_solver_preparation
          ?? item.result?.timings_ms?.solver_and_model_preparation;
      })),
      asset_loading_ms: timing("asset_loading"),
      worker_internal_total_ms: timing("total"),
      observed_total_ms: statistics(successes.map((item) => item.observed_total_ms)),
      wasm_linear_memory_bytes: successes[0]?.result?.wasm_linear_memory_bytes ?? null,
    };
  })));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function artifactRecord(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const bytes = await readFile(absolutePath);
  return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function inputRecords(cases, startSeeds) {
  const records = [];
  for (const caseName of cases) {
    const relativePath = `fixtures/acopf/${caseName}/${caseName}-acopf.mapping.json`;
    const mapping = JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
    const starts = startSeeds.map((startSeed) => ({
      start_seed: startSeed,
      initial_point_sha256: sha256(Buffer.from(JSON.stringify(startSeed === null
        ? mapping.variables.map((variable) => variable.start)
        : perturbedStart(mapping.variables, startSeed)))),
    }));
    records.push({
      case: caseName,
      label: mapping.case,
      mapping_path: relativePath,
      model_sha256: mapping.artifacts.nl_sha256,
      initial_points: starts,
      initial_point_hash_encoding: "SHA-256 of UTF-8 JSON array in NL column order",
      source_case: mapping.source_case,
      dimensions: mapping.dimensions,
    });
  }
  return records;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const executablePath = await browserExecutable(options.browser);
  const server = spawn(process.execPath, ["dev-server.mjs"], {
    cwd: webRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForServer(server);
    const coldStarts = [];
    let browserVersion = null;
    for (const caseName of options.cases) {
      for (const backend of options.backends) {
        for (const startSeed of options.startSeeds) {
          for (let run = 0; run < options.coldRuns; run += 1) {
            const launchStart = performance.now();
            const browser = await chromium.launch({ executablePath, headless: !options.headed });
            const browserLaunchMilliseconds = performance.now() - launchStart;
            try {
              browserVersion ??= browser.version();
              const pageDriverStart = performance.now();
              const pageReport = await runPage(browser, {
                cases: [caseName],
                backends: [backend],
                runs: 1,
                warmups: 0,
                seed: options.seed + run,
                startSeeds: [startSeed],
                timeoutMs: options.timeoutMs,
              });
              coldStarts.push({
                ...pageReport.observations[0],
                run_kind: "fresh-browser-process",
                cold_run_index: run + 1,
                browser_process_launch_ms: browserLaunchMilliseconds,
                page_driver_elapsed_ms: performance.now() - pageDriverStart,
              });
            } finally {
              await browser.close();
            }
          }
        }
      }
    }

    const browser = await chromium.launch({ executablePath, headless: !options.headed });
    let steadyReport;
    try {
      browserVersion ??= browser.version();
      steadyReport = await runPage(browser, {
        cases: options.cases,
        backends: options.backends,
        runs: options.runs,
        warmups: options.warmups,
        seed: options.seed,
        startSeeds: options.startSeeds,
        timeoutMs: options.timeoutMs,
      });
    } finally {
      await browser.close();
    }

    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
    const gitStatus = execFileSync("git", ["status", "--porcelain"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
    const ipoptPackage = JSON.parse(await readFile(
      path.join(webRoot, "node_modules/ipopt-wasm/package.json"),
      "utf8",
    ));
    const playwrightPackage = JSON.parse(await readFile(
      path.join(webRoot, "node_modules/playwright-core/package.json"),
      "utf8",
    ));
    const allMeasured = [...coldStarts, ...steadyReport.observations];
    const report = {
      schema: "acopf-wasm-bench.browser-benchmark/v1",
      created_at: new Date().toISOString(),
      passed: allMeasured.every((item) => item.passed),
      repository: {
        commit: gitCommit,
        worktree_dirty: gitStatus.length > 0,
      },
      host: {
        platform: os.platform(),
        release: os.release(),
        architecture: os.arch(),
        cpu_model: os.cpus()[0]?.model ?? null,
        logical_processors: os.cpus().length,
        total_memory_bytes: os.totalmem(),
      },
      browser: {
        requested: options.browser,
        version: browserVersion,
        executable_path: executablePath,
        headless: !options.headed,
        playwright_core_version: playwrightPackage.version,
        page_environment: steadyReport.browser,
      },
      runtime: {
        node: process.version,
        ipopt_wasm_package: ipoptPackage.version,
      },
      protocol: {
        cases: options.cases,
        backends: options.backends,
        start_seeds: options.startSeeds,
        options: {
          tol: 1e-9,
          max_iter: 1000,
          exact_hessian: true,
          pounce_presolve: false,
          ipopt_linear_solver: "mumps",
          pounce_linear_solver: "FERAL",
          pounce_scaling_by_backend: {
            "pounce-wasm": "default",
            "pounce-identity": "identity",
          },
        },
        cold_runs_per_pair: options.coldRuns,
        warmups_per_pair: options.warmups,
        measured_fresh_worker_runs_per_pair: options.runs,
        order: "seeded randomized across case/backend/start-seed tuples",
        seed: options.seed,
        start_perturbation: options.startSeeds[0] === null ? null : "deterministic bounded perturbations (angles ±0.03 rad, voltage ±0.02 p.u., other variables ±5% of max(1,abs(start)); clipped to bounds)",
        concurrency: 1,
        timeout_ms: options.timeoutMs,
        cold_start_definition: "new browser process, context, page, and worker; browser_process_launch_ms and page_driver_elapsed_ms record outer lifecycle costs, while observed_total_ms begins immediately before worker construction",
        repeated_run_definition: "reused browser process and page; new worker and solver instance",
        timing_clock: "browser performance.now() except outer cold-start lifecycle fields, which use Node performance.now()",
        observed_total_definition: "worker construction through receipt and compaction of the complete solution message, including asset fetch, instantiation, preparation, solve, and worker-to-page transfer",
        optimization_definition: "synchronous solver call only; excludes model loading, Wasm instantiation, and solution message transfer",
        memory_measurement: "post-solve WebAssembly.Memory buffer capacity, not process RSS or peak live allocation; the local server adds a read-only capacity export to the upstream ipopt-wasm JavaScript wrapper, and the separate evaluator memory is reported independently",
        solver_warm_start: false,
        logging_during_timed_solve: false,
      },
      inputs: await inputRecords(options.cases, options.startSeeds),
      artifacts: {
        evaluator_wasm: await artifactRecord(
          "target/wasm32-unknown-unknown/release/acopf_nl_evaluator_wasm.wasm",
        ),
        pounce_wasm: await artifactRecord(
          "target/wasm32-wasip1/release/acopf_pounce_browser_wasm.wasm",
        ),
        ipopt_wasm: await artifactRecord("web/node_modules/ipopt-wasm/ipopt.wasm"),
        ipopt_wasm64: await artifactRecord("web/node_modules/ipopt-wasm/ipopt64.wasm"),
      },
      cold_starts: coldStarts,
      warmups: steadyReport.warmups,
      observations: steadyReport.observations,
      summaries: summarize(
        steadyReport.observations,
        options.cases,
        options.backends,
        options.startSeeds,
      ),
      cold_start_summaries: summarize(
        coldStarts,
        options.cases,
        options.backends,
        options.startSeeds,
      ),
    };
    await mkdir(path.dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${options.output}`);
    console.log(JSON.stringify(report.summaries, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
