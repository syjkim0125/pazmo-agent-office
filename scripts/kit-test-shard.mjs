// Runs one shard of the root test files (`node scripts/kit-test-shard.mjs <index> <count>`), so each kit 5 check
// of this repo finishes within kit's 300 s limit (docs/verification/kit-checks.md). Every file lands in exactly
// one shard; `npm test` still runs them all at once.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const [index, count] = process.argv.slice(2).map(Number);
if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count) {
  console.error("Usage: node scripts/kit-test-shard.mjs <index> <count>");
  process.exitCode = 2;
} else {
  const files = readdirSync("tests")
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .filter((_, i) => i % count === index)
    .map((name) => `tests/${name}`);
  const run = spawnSync(process.execPath, ["--experimental-vm-modules", "--test", ...files], {
    stdio: "inherit",
  });
  process.exitCode = run.status ?? 1;
}
