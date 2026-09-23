import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { nlWithStart, perturbedStart } from "../start-perturbation.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("alternative starts are deterministic, different by seed, and bounded", async () => {
  const mapping = JSON.parse(await readFile(`${root}/fixtures/acopf/case118api/case118api-acopf.mapping.json`, "utf8"));
  const first = perturbedStart(mapping.variables, 101);
  const again = perturbedStart(mapping.variables, 101);
  const second = perturbedStart(mapping.variables, 202);
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, second);
  assert.equal(first.length, mapping.variables.length);
  for (let index = 0; index < first.length; index += 1) {
    const variable = mapping.variables[index];
    const lower = variable.lower === "-inf" ? -Infinity : Number(variable.lower);
    const upper = variable.upper === "inf" ? Infinity : Number(variable.upper);
    assert.ok(first[index] >= lower && first[index] <= upper, `bound at ${index}`);
  }
});

test("NL rewriting changes only the initial-point segment", async () => {
  const stem = `${root}/fixtures/acopf/case118api/case118api-acopf`;
  const mapping = JSON.parse(await readFile(`${stem}.mapping.json`, "utf8"));
  const nl = await readFile(`${stem}.nl`, "utf8");
  const x0 = perturbedStart(mapping.variables, 101);
  const rewritten = nlWithStart(nl, x0);
  const marker = `x${x0.length}\n`;
  const originalAt = nl.indexOf(marker);
  const rewrittenAt = rewritten.indexOf(marker);
  assert.ok(originalAt > 0);
  assert.equal(rewrittenAt, originalAt);
  assert.equal(rewritten.slice(0, rewrittenAt), nl.slice(0, originalAt));
  const lines = rewritten.slice(rewrittenAt + marker.length).split("\n");
  for (let index = 0; index < x0.length; index += 1) {
    assert.equal(lines[index], `${index} ${x0[index]}`);
  }
  const originalSuffix = nl.slice(originalAt + marker.length).split("\n").slice(x0.length).join("\n");
  assert.equal(lines.slice(x0.length).join("\n"), originalSuffix);
});
