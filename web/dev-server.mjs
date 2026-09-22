import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const webRoot = resolve(root, "web");
const routes = [
  ["/vendor/ipopt-wasm/", resolve(webRoot, "node_modules/ipopt-wasm")],
  ["/artifacts/evaluator/", resolve(root, "target/wasm32-unknown-unknown/release")],
  ["/artifacts/pounce/", resolve(root, "target/wasm32-wasip1/release")],
  ["/fixtures/", resolve(root, "fixtures")],
  ["/", webRoot],
];
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".nl", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
]);
const instrumentedIpoptModules = new Map([
  ["/vendor/ipopt-wasm/index-with-memory.mjs", "index.mjs"],
  ["/vendor/ipopt-wasm/index64-with-memory.mjs", "index64.mjs"],
]);

async function serveInstrumentedIpoptModule(pathname, response) {
  const sourceName = instrumentedIpoptModules.get(pathname);
  if (!sourceName) return false;
  const source = await readFile(resolve(webRoot, "node_modules/ipopt-wasm", sourceName), "utf8");
  const memoryExport = [
    "",
    "// Benchmark-local read-only instrumentation; getModule is defined by the upstream wrapper.",
    "export async function memoryBytes() {",
    "  return (await getModule()).HEAPF64.buffer.byteLength;",
    "}",
    "",
  ].join("\n");
  response.setHeader("Content-Type", "text/javascript; charset=utf-8");
  response.end(source + memoryExport);
  return true;
}

function mappedPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  for (const [prefix, directory] of routes) {
    if (!pathname.startsWith(prefix)) continue;
    const suffix = pathname.slice(prefix.length) || "index.html";
    const candidate = resolve(directory, suffix);
    if (candidate === directory || candidate.startsWith(`${directory}${sep}`)) return candidate;
  }
  return undefined;
}

const port = Number.parseInt(process.env.ACOPF_WEB_PORT ?? "4173", 10);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    if (await serveInstrumentedIpoptModule(pathname, response)) return;
    const path = mappedPath(request.url ?? "/");
    if (!path || !(await stat(path)).isFile()) {
      response.writeHead(404).end("Not found\n");
      return;
    }
    response.setHeader("Content-Type", contentTypes.get(extname(path)) ?? "application/octet-stream");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    createReadStream(path).pipe(response);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end(`${error}\n`);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AC OPF WASM smoke page: http://127.0.0.1:${port}/?autorun=1`);
});
