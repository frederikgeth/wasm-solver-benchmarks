import { createWasi } from "./pounce-wasi.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
      return invokeJson(wasm.acopf_pounce_solve, [options]);
    },
  };
}
