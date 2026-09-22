const parameters = new URL(location.href).searchParams;
const status = document.querySelector("#status");
const output = document.querySelector("#output");

function listParameter(name, fallback) {
  const value = parameters.get(name);
  return (value ? value.split(",") : fallback).map((item) => item.trim()).filter(Boolean);
}

function integerParameter(name, fallback, minimum = 0) {
  const value = Number.parseInt(parameters.get(name) ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function compactResult(result) {
  const { x, constraints, ...summary } = result;
  return {
    ...summary,
    solution_value_counts: {
      variables: x?.length ?? 0,
      constraints: constraints?.length ?? 0,
    },
  };
}

function runWorker(caseName, backend, timeoutMilliseconds) {
  return new Promise((resolve) => {
    const worker = new Worker("./worker.mjs", { type: "module" });
    const start = performance.now();
    const phases = [];
    let settled = false;
    const finish = (observation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      resolve(observation);
    };
    const timeout = setTimeout(() => finish({
      passed: false,
      failure: "timeout",
      error: `worker exceeded ${timeoutMilliseconds} ms`,
      observed_total_ms: performance.now() - start,
      phases,
    }), timeoutMilliseconds);

    worker.onmessage = ({ data }) => {
      if (data.type === "phase") {
        phases.push({ phase: data.phase, observed_at_ms: performance.now() - start });
      } else if (data.type === "result") {
        finish({
          passed: data.result.passed,
          failure: data.result.passed ? null : "validation",
          observed_total_ms: performance.now() - start,
          phases,
          result: compactResult(data.result),
        });
      } else if (data.type === "error") {
        finish({
          passed: false,
          failure: "worker-error",
          error: data.error,
          observed_total_ms: performance.now() - start,
          phases,
        });
      }
    };
    worker.onerror = ({ message }) => finish({
      passed: false,
      failure: "worker-error",
      error: message,
      observed_total_ms: performance.now() - start,
      phases,
    });
    worker.postMessage({ type: "run", case: caseName, backend });
  });
}

async function main() {
  const cases = listParameter("cases", ["case118", "case300", "case1354"]);
  const backends = listParameter("backends", ["ipopt-wasm", "pounce-wasm"]);
  const repetitions = integerParameter("runs", 7, 1);
  const warmups = integerParameter("warmups", 1);
  const seed = integerParameter("seed", 20260922);
  const timeoutMilliseconds = integerParameter("timeout_ms", 120000, 1);
  const random = seededRandom(seed);
  const pairs = cases.flatMap((caseName) => backends.map((backend) => ({ caseName, backend })));
  const measuredSchedule = shuffled(
    Array.from({ length: repetitions }, () => pairs).flat(),
    random,
  );
  const warmupSchedule = Array.from(
    { length: warmups },
    () => shuffled(pairs, random),
  ).flat();
  const pairCounts = new Map();
  const warmupObservations = [];
  const observations = [];
  const benchmarkStart = performance.now();

  async function execute(item, destination, runKind, scheduleIndex) {
    const key = `${item.caseName}/${item.backend}`;
    const pairIndex = (pairCounts.get(key) ?? 0) + 1;
    pairCounts.set(key, pairIndex);
    status.textContent = `${runKind} ${scheduleIndex + 1}: ${item.caseName} / ${item.backend}…`;
    const observation = await runWorker(item.caseName, item.backend, timeoutMilliseconds);
    destination.push({
      run_kind: runKind,
      schedule_index: scheduleIndex,
      pair_run_index: pairIndex,
      case: item.caseName,
      backend: item.backend,
      ...observation,
    });
  }

  for (let index = 0; index < warmupSchedule.length; index += 1) {
    await execute(warmupSchedule[index], warmupObservations, "warmup", index);
  }
  pairCounts.clear();
  for (let index = 0; index < measuredSchedule.length; index += 1) {
    await execute(measuredSchedule[index], observations, "measured", index);
  }

  const report = {
    schema: "acopf-wasm-bench.browser-page-run/v1",
    configuration: {
      cases,
      backends,
      repetitions,
      warmups,
      seed,
      timeout_ms: timeoutMilliseconds,
      worker_lifecycle: "new dedicated worker per observation",
      concurrency: 1,
    },
    browser: {
      user_agent: navigator.userAgent,
      platform: navigator.platform,
      logical_processors: navigator.hardwareConcurrency ?? null,
      device_memory_gib: navigator.deviceMemory ?? null,
      cross_origin_isolated: crossOriginIsolated,
    },
    warmups: warmupObservations,
    observations,
    elapsed_ms: performance.now() - benchmarkStart,
  };
  output.textContent = JSON.stringify(report, null, 2);
  status.dataset.state = observations.every((item) => item.passed) ? "complete" : "failed";
  status.textContent = observations.every((item) => item.passed)
    ? `Complete: ${observations.length} measured runs passed.`
    : "Complete with failures; inspect the report.";
  document.documentElement.dataset.benchmarkComplete = "true";
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  status.dataset.state = "failed";
  status.textContent = "Benchmark driver failed.";
  output.textContent = JSON.stringify({ error: message }, null, 2);
  document.documentElement.dataset.benchmarkComplete = "true";
});
