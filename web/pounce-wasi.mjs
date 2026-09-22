const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_NOSYS = 52;

export function createWasi(onOutput = () => {}) {
  let memory;
  const decoder = new TextDecoder();
  const view = () => new DataView(memory.buffer);

  const imports = {
    fd_write(_fd, vectors, vectorCount, bytesWritten) {
      const data = view();
      let written = 0;
      let output = "";
      for (let index = 0; index < vectorCount; index += 1) {
        const pointer = data.getUint32(vectors + index * 8, true);
        const length = data.getUint32(vectors + index * 8 + 4, true);
        if (length > 0) {
          output += decoder.decode(new Uint8Array(memory.buffer, pointer, length));
        }
        written += length;
      }
      data.setUint32(bytesWritten, written, true);
      if (output) onOutput(output);
      return ERRNO_SUCCESS;
    },
    clock_time_get(_clock, _precision, output) {
      view().setBigUint64(output, BigInt(Math.round(performance.now() * 1e6)), true);
      return ERRNO_SUCCESS;
    },
    clock_res_get(_clock, output) {
      view().setBigUint64(output, 1000n, true);
      return ERRNO_SUCCESS;
    },
    random_get(buffer, length) {
      crypto.getRandomValues(new Uint8Array(memory.buffer, buffer, length));
      return ERRNO_SUCCESS;
    },
    environ_sizes_get(count, size) {
      const data = view();
      data.setUint32(count, 0, true);
      data.setUint32(size, 0, true);
      return ERRNO_SUCCESS;
    },
    environ_get: () => ERRNO_SUCCESS,
    args_sizes_get(count, size) {
      const data = view();
      data.setUint32(count, 0, true);
      data.setUint32(size, 0, true);
      return ERRNO_SUCCESS;
    },
    args_get: () => ERRNO_SUCCESS,
    proc_exit(code) {
      throw new Error(`POUNCE called proc_exit(${code})`);
    },
    sched_yield: () => ERRNO_SUCCESS,
    fd_close: () => ERRNO_BADF,
    fd_fdstat_get: () => ERRNO_BADF,
    fd_fdstat_set_flags: () => ERRNO_BADF,
    fd_prestat_get: () => ERRNO_BADF,
    fd_prestat_dir_name: () => ERRNO_BADF,
    fd_read: () => ERRNO_BADF,
    fd_seek: () => ERRNO_BADF,
    path_create_directory: () => ERRNO_NOSYS,
    path_filestat_get: () => ERRNO_NOSYS,
    path_open: () => ERRNO_NOSYS,
  };

  return {
    imports: { wasi_snapshot_preview1: imports },
    bind(instance) {
      memory = instance.exports.memory;
      instance.exports._initialize?.();
    },
  };
}
