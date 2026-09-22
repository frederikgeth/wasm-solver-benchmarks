const F64_BYTES = Float64Array.BYTES_PER_ELEMENT;
const I32_BYTES = Int32Array.BYTES_PER_ELEMENT;

export async function createNlEvaluator(wasmBytes, nlBytes) {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const api = instance.exports;
  const allocations = [];

  const allocate = (bytes) => {
    const pointer = api.acopf_alloc(bytes);
    if (!pointer) throw new Error(`NL evaluator could not allocate ${bytes} bytes`);
    allocations.push([pointer, bytes]);
    return pointer;
  };
  const bytesAt = (pointer, length) => new Uint8Array(api.memory.buffer, pointer, length);
  const f64At = (pointer, length) => new Float64Array(api.memory.buffer, pointer, length);
  const i32At = (pointer, length) => new Int32Array(api.memory.buffer, pointer, length);

  const lastError = () => {
    const length = api.acopf_last_error_length();
    if (!length) return "unknown NL evaluator error";
    const pointer = allocate(length);
    const copied = api.acopf_copy_last_error(pointer, length);
    return new TextDecoder().decode(bytesAt(pointer, copied));
  };
  const check = (status) => {
    if (status !== 0) throw new Error(lastError());
  };

  const nlPointer = allocate(nlBytes.byteLength);
  bytesAt(nlPointer, nlBytes.byteLength).set(nlBytes);
  check(api.acopf_load(nlPointer, nlBytes.byteLength));

  const n = api.acopf_n();
  const m = api.acopf_m();
  const nele_jac = api.acopf_jacobian_nonzeros();
  const nele_hess = api.acopf_hessian_nonzeros();
  if ([n, m, nele_jac, nele_hess].some((value) => value < 0)) {
    throw new Error("NL evaluator did not report valid dimensions");
  }

  const copyProblemVector = (selector, length) => {
    const pointer = allocate(length * F64_BYTES);
    check(api.acopf_copy_problem_vector(selector, pointer, length));
    return f64At(pointer, length).slice();
  };
  const copyStructure = (selector, length) => {
    const pointer = allocate(length * I32_BYTES);
    check(api.acopf_copy_structure(selector, pointer, length));
    return i32At(pointer, length).slice();
  };

  const xPointer = allocate(n * F64_BYTES);
  const lambdaPointer = allocate(m * F64_BYTES);
  const scalarPointer = allocate(F64_BYTES);
  const gradientPointer = allocate(n * F64_BYTES);
  const constraintsPointer = allocate(m * F64_BYTES);
  const jacobianPointer = allocate(nele_jac * F64_BYTES);
  const hessianPointer = allocate(nele_hess * F64_BYTES);

  const writeX = (x) => {
    if (x.length !== n) throw new Error(`x has length ${x.length}; expected ${n}`);
    f64At(xPointer, n).set(x);
  };
  const evaluateVector = (x, pointer, length, operation) => {
    writeX(x);
    check(operation());
    return f64At(pointer, length).slice();
  };

  const jacobian = {
    iRow: copyStructure(0, nele_jac),
    jCol: copyStructure(1, nele_jac),
  };
  const hessian = {
    iRow: copyStructure(2, nele_hess),
    jCol: copyStructure(3, nele_hess),
  };

  const problem = {
    n,
    m,
    nele_jac,
    nele_hess,
    x0: copyProblemVector(0, n),
    xl: copyProblemVector(1, n),
    xu: copyProblemVector(2, n),
    gl: copyProblemVector(3, m),
    gu: copyProblemVector(4, m),
    eval_f(x) {
      writeX(x);
      check(api.acopf_eval_f(xPointer, n, scalarPointer));
      return f64At(scalarPointer, 1)[0];
    },
    eval_grad_f(x) {
      return evaluateVector(
        x,
        gradientPointer,
        n,
        () => api.acopf_eval_grad_f(xPointer, n, gradientPointer, n),
      );
    },
    eval_g(x) {
      return evaluateVector(
        x,
        constraintsPointer,
        m,
        () => api.acopf_eval_g(xPointer, n, constraintsPointer, m),
      );
    },
    eval_jac_g(x, structure) {
      if (structure) return jacobian;
      return evaluateVector(
        x,
        jacobianPointer,
        nele_jac,
        () => api.acopf_eval_jac_g(xPointer, n, jacobianPointer, nele_jac),
      );
    },
    eval_h(x, objectiveFactor, lambda, structure) {
      if (structure) return hessian;
      writeX(x);
      if (lambda.length !== m) {
        throw new Error(`lambda has length ${lambda.length}; expected ${m}`);
      }
      f64At(lambdaPointer, m).set(lambda);
      check(
        api.acopf_eval_h(
          xPointer,
          n,
          objectiveFactor,
          lambdaPointer,
          m,
          hessianPointer,
          nele_hess,
        ),
      );
      return f64At(hessianPointer, nele_hess).slice();
    },
  };

  return {
    problem,
    memoryBytes() {
      return api.memory.buffer.byteLength;
    },
    dispose() {
      for (const [pointer, bytes] of allocations.splice(0)) api.acopf_free(pointer, bytes);
    },
  };
}
