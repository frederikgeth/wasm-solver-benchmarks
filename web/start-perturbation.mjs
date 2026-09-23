// Deterministic, bounded perturbations of the frozen NL initial point.
// The same vector is passed to both browser solver backends.
export function perturbedStart(variables, seed) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("start seed must be a nonnegative integer");
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return variables.map((variable, index) => {
    if (variable.nl_index !== index) throw new Error(`mapping order mismatch at ${index}`);
    const start = Number(variable.start);
    const lower = variable.lower === "-inf" ? -Infinity : Number(variable.lower);
    const upper = variable.upper === "inf" ? Infinity : Number(variable.upper);
    if (!Number.isFinite(start) || Number.isNaN(lower) || Number.isNaN(upper) || lower > upper) {
      throw new Error(`invalid bounds or start at ${index}`);
    }
    const span = variable.name.startsWith("0_va[") ? 0.03
      : variable.name.startsWith("0_vm[") ? 0.02
        : 0.05 * Math.max(1, Math.abs(start));
    const candidate = start + (2 * random() - 1) * span;
    return Math.max(lower, Math.min(upper, candidate));
  });
}

export function nlWithStart(nl, x0) {
  const lines = nl.split("\n");
  const headerIndex = lines.findIndex((line) => /^x[0-9]+\r?$/.test(line));
  if (headerIndex < 0) throw new Error("NL initial-point segment is missing");
  const count = Number(lines[headerIndex].trim().slice(1));
  if (count !== x0.length) throw new Error(`NL start count ${count} differs from vector length ${x0.length}`);
  for (let index = 0; index < count; index += 1) {
    const lineIndex = headerIndex + 1 + index;
    const match = lines[lineIndex]?.match(/^([0-9]+)\s+([^\s]+)\r?$/);
    if (!match || Number(match[1]) !== index) throw new Error(`unexpected NL start line ${index}`);
    lines[lineIndex] = `${index} ${x0[index]}`;
  }
  return lines.join("\n");
}
