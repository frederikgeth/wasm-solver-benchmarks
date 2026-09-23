// Reproduce the wasm32-unknown-unknown POUNCE/wasm-bindgen target check.
// A clock trap is an expected diagnostic at the pinned upstream revision;
// the script also accepts a future successful solve after an upstream fix.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import init, { load_nl, solve } from "../generated/pounce-bindgen/acopf_pounce_bindgen_probe.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const caseName = process.argv[2] ?? "hs071";
assert.ok(["hs071", "case3"].includes(caseName), `unsupported probe case ${caseName}`);
const stub = caseName === "hs071"
  ? `${root}/fixtures/tiny/hs071`
  : `${root}/fixtures/acopf/case3/case3-acopf`;
const wasmPath = `${root}/web/generated/pounce-bindgen/acopf_pounce_bindgen_probe_bg.wasm`;
const [wasm, nl, col, row] = await Promise.all([
  readFile(wasmPath),
  readFile(`${stub}.nl`, "utf8"),
  caseName === "hs071" ? "" : readFile(`${stub}.col`, "utf8"),
  caseName === "hs071" ? "" : readFile(`${stub}.row`, "utf8"),
]);

await init({ module_or_path: wasm });
const loaded = JSON.parse(load_nl(nl, col, row));
assert.ok(!loaded.error, `POUNCE load failed: ${loaded.error}`);
assert.equal(loaded.n_vars, caseName === "hs071" ? 4 : 28);
const report = {
  case: caseName,
  target: "wasm32-unknown-unknown",
  binding: "wasm-bindgen",
  wasm_bytes: (await stat(wasmPath)).size,
  load: "ok",
  variables: loaded.n_vars,
  constraints: loaded.n_cons,
};

try {
  const result = JSON.parse(solve("print_level 0\ntol 1e-9\nmax_iter 1000\npresolve no\n"));
  assert.ok(!result.error, `POUNCE solve failed: ${result.error}`);
  assert.equal(result.status_code, 0, `POUNCE returned ${result.status}`);
  const expectedObjective = caseName === "hs071" ? 17.014017145179 : 5906.879416645711;
  assert.ok(Math.abs(result.objective - expectedObjective) < 1e-3);
  report.solve = "ok";
  report.objective = result.objective;
} catch (error) {
  const stack = error?.stack ?? String(error);
  if (!(error instanceof WebAssembly.RuntimeError && stack.includes("Instant"))) throw error;
  report.solve = "clock_trap";
  report.reason = "POUNCE calls std::time::Instant::now(), unsupported on wasm32-unknown-unknown";
}

console.log(JSON.stringify(report, null, 2));
