// Test double for the VM exec-server: answers stdio JSON-RPC from recorded frames.
// process/read replays the recorded reads in order and ends closed, like the
// real server. argv[2] === "die" exits after environment/info (executor loss).
import { readFileSync } from "node:fs";

const frames = JSON.parse(readFileSync(new URL("./exec-server-frames.json", import.meta.url))).frames;
const reads = frames.filter((f) => f.method === "process/read").map((f) => f.response.result);
const cursor = new Map();
let buffer = "";
process.stdin.on("data", (d) => {
  buffer += d;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const m = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (m.id === undefined) continue;
    let result;
    if (m.method === "process/read") {
      const n = cursor.get(m.params.processId) ?? 0;
      cursor.set(m.params.processId, n + 1);
      result = reads[Math.min(n, reads.length - 1)];
    } else result = frames.find((f) => f.method === m.method)?.response.result ?? {};
    process.stdout.write(JSON.stringify({ id: m.id, result }) + "\n");
    if (process.argv[2] === "die" && m.method === "environment/info") process.exit(9);
  }
});
