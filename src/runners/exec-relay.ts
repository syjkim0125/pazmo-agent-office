import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AddressInfo } from "node:net";
const { WebSocketServer } = createRequire(
  new URL("../../vendor/claw-empire/package.json", import.meta.url),
)(
  "ws",
) as typeof import("../../vendor/claw-empire/node_modules/@types/ws/index.d.ts");

const frameLimit = 4 * 1024 * 1024,
  totalLimit = 64 * 1024 * 1024;
const allowed = new Set([
  "initialize",
  "initialized",
  "environment/info",
  "environment/status",
  "environmentConfig/read",
  "process/start",
  "process/read",
  "process/write",
  "process/signal",
  "process/terminate",
  "fs/readFile",
  "fs/open",
  "fs/readBlock",
  "fs/close",
  "fs/writeFile",
  "fs/createDirectory",
  "fs/getMetadata",
  "fs/canonicalize",
  "fs/readDirectory",
  "fs/walk",
  "fs/remove",
  "fs/copy",
]);

/** One controller connection to one trusted, detached executor transport.
 * This relay never runs a request or interprets a filesystem path on the host.
 * The caller must use a container-bound exec-server and bound the whole job time.
 */
export async function openExecRelay(
  openExecutor: () => ChildProcessWithoutNullStreams,
  onFailure?: (reason: string) => void,
) {
  const route = "/exec/" + randomUUID(),
    methods = new Set<string>();
  const server = createServer((_req, res) => {
    res.writeHead(404, { Connection: "close" });
    res.end();
  });
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: frameLimit,
    perMessageDeflate: false,
  });
  let child: ChildProcessWithoutNullStreams | undefined,
    childClosed: Promise<boolean> | undefined,
    closePromise: Promise<boolean> | undefined,
    closing = false,
    connected = false,
    stopRequested = false,
    error: string | null = null,
    total = 0;
  function stopExecutor() {
    if (
      !child?.pid ||
      stopRequested ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      return;
    stopRequested = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH" && !error)
        error = "RELAY_KILL_FAILED";
    }
  }
  function fail(reason: string) {
    if (!error && !closing) {
      error = reason;
      onFailure?.(reason);
    }
    for (const ws of sockets.clients) ws.terminate();
    stopExecutor();
  }
  function count(size: number) {
    total += size;
    if (size > frameLimit || total > totalLimit) {
      fail("RELAY_OUTPUT_LIMIT");
      return false;
    }
    return true;
  }
  server.on("upgrade", (req, socket, head) => {
    if (closing || connected || req.url !== route || req.headers.origin) {
      socket.destroy();
      return;
    }
    connected = true;
    sockets.handleUpgrade(req, socket, head, (ws) =>
      sockets.emit("connection", ws),
    );
  });
  server.on("error", () => fail("RELAY_SERVER_FAILED"));
  sockets.on("connection", (ws) => {
    try {
      child = openExecutor();
    } catch {
      fail("EXECUTOR_SPAWN_FAILED");
      return;
    }
    const proc = child;
    let disconnected = false;
    childClosed = new Promise((resolve) => {
      proc.once("close", () => {
        if (!closing && !disconnected) fail("EXECUTOR_CLOSED");
        resolve(true);
      });
    });
    proc.on("error", () => fail("EXECUTOR_FAILED"));
    proc.stdin.on("error", () => {
      if (!closing) fail("EXECUTOR_INPUT_FAILED");
    });
    let tail = Buffer.alloc(0),
      stderr = 0;
    proc.stdout.on("data", (chunk: Buffer) => {
      if (!count(chunk.length)) return;
      tail = Buffer.concat([tail, chunk]);
      let end;
      while ((end = tail.indexOf(10)) >= 0) {
        const line = tail.subarray(0, end);
        tail = tail.subarray(end + 1);
        if (line.length > frameLimit || ws.bufferedAmount > frameLimit) {
          fail("RELAY_OUTPUT_LIMIT");
          return;
        }
        try {
          const message = JSON.parse(line.toString("utf8"));
          if (!message || typeof message !== "object" || Array.isArray(message))
            throw new Error("Invalid frame");
          if (ws.readyState === 1) ws.send(line.toString("utf8"));
        } catch {
          fail("INVALID_EXECUTOR_FRAME");
          return;
        }
      }
      if (tail.length > frameLimit) fail("RELAY_OUTPUT_LIMIT");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.length;
      if (stderr > 65536) fail("EXECUTOR_STDERR_LIMIT");
    });
    ws.on("message", (data, isBinary) => {
      const frame = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      if (isBinary || !count(frame.length)) {
        fail("INVALID_CONTROLLER_FRAME");
        return;
      }
      try {
        const bytes = frame.toString(),
          message = JSON.parse(bytes);
        if (
          !message ||
          typeof message !== "object" ||
          !allowed.has(message.method)
        )
          throw new Error("Unknown method");
        methods.add(message.method);
        if (proc.stdin.writableLength > frameLimit) {
          fail("RELAY_INPUT_LIMIT");
          return;
        }
        proc.stdin.write(bytes + "\n");
      } catch {
        fail("INVALID_CONTROLLER_FRAME");
      }
    });
    ws.on("error", () => fail("RELAY_SOCKET_FAILED"));
    // Codex closes its connection during normal process shutdown. Only its caller
    // can establish successful completion; a socket close is neither pass nor fail.
    ws.on("close", () => {
      disconnected = true;
      stopExecutor();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}${route}`,
    methods: () => [...methods],
    failure: () => error,
    close: () =>
      (closePromise ??= (async () => {
        closing = true;
        fail("CLOSING");
        let timer: NodeJS.Timeout | undefined;
        const reaped = childClosed
          ? await Promise.race([
              childClosed,
              new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), 5000);
              }),
            ])
          : true;
        clearTimeout(timer);
        if (!reaped && child) {
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
        }
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
        await new Promise<void>((resolve) => sockets.close(() => resolve()));
        return reaped;
      })()),
  };
}
