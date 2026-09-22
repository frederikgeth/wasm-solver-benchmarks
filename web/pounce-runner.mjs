import { createWasi } from "./pounce-wasi.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parseCsvRow(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("POUNCE solution CSV contains an unterminated quote");
  fields.push(field);
  return fields;
}

function parseSolutionCsv(csv) {
  const lines = csv.trimEnd().split(/\r?\n/);
  if (lines.shift() !== "kind,index,name,value,lower,upper,multiplier") {
    throw new Error("POUNCE solution CSV has an unexpected header");
  }
  const x = [];
  const g = [];
  for (const line of lines) {
    const fields = parseCsvRow(line);
    if (fields.length !== 7) throw new Error("POUNCE solution CSV has a malformed row");
    const [kind, rawIndex, , rawValue] = fields;
    const index = Number.parseInt(rawIndex, 10);
    const value = Number.parseFloat(rawValue);
    if (!Number.isSafeInteger(index) || !Number.isFinite(value)) {
      throw new Error("POUNCE solution CSV has an invalid index or value");
    }
    const target = kind === "variable" ? x : kind === "constraint" ? g : null;
    if (!target) throw new Error(`POUNCE solution CSV has unknown row kind ${kind}`);
    target[index] = value;
  }
  if (Object.keys(x).length !== x.length || Object.keys(g).length !== g.length) {
    throw new Error("POUNCE solution CSV has missing rows");
  }
  return { x, g };
}

export async function createPounceRunner(wasmBytes, onOutput = () => {}) {
  const wasi = createWasi(onOutput);
  const { instance } = await WebAssembly.instantiate(wasmBytes, wasi.imports);
  wasi.bind(instance);
  const wasm = instance.exports;

  function intoWasm(text) {
    if (!text) return [0, 0];
    const bytes = encoder.encode(text);
    const pointer = wasm.acopf_pounce_alloc(bytes.length);
    if (!pointer) throw new Error("POUNCE WASM allocation failed");
    new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
    return [pointer, bytes.length];
  }

  function fromWasm(pointer) {
    if (!pointer) throw new Error("POUNCE WASM returned a null payload");
    const memory = new Uint8Array(wasm.memory.buffer);
    if (pointer + 4 > memory.length) throw new Error("POUNCE WASM returned an invalid pointer");
    const length = new DataView(wasm.memory.buffer).getUint32(pointer, true);
    if (pointer + 4 + length > memory.length) {
      throw new Error("POUNCE WASM returned an invalid payload length");
    }
    const text = decoder.decode(memory.subarray(pointer + 4, pointer + 4 + length));
    wasm.acopf_pounce_free_payload(pointer);
    return text;
  }

  function invokeJson(operation, inputs) {
    const buffers = inputs.map(intoWasm);
    try {
      const payload = operation(...buffers.flat());
      const result = JSON.parse(fromWasm(payload));
      if (result.error) throw new Error(result.error);
      return result;
    } finally {
      for (const [pointer, length] of buffers) {
        if (pointer) wasm.acopf_pounce_dealloc(pointer, length);
      }
    }
  }

  return {
    load(nl, col = "", row = "") {
      return invokeJson(wasm.acopf_pounce_load, [nl, col, row]);
    },
    solve(options = "") {
      const result = invokeJson(wasm.acopf_pounce_solve, [options]);
      if (result.truncated) {
        const fullSolution = parseSolutionCsv(fromWasm(wasm.acopf_pounce_solution_csv()));
        result.x = fullSolution.x;
        result.g = fullSolution.g;
        result.preview_truncated = true;
        result.truncated = false;
      }
      return result;
    },
  };
}
