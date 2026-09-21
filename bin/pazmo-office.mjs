#!/usr/bin/env node
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 19) {
  console.error(
    JSON.stringify({
      code: "NODE_VERSION",
      error: "Use Node 24.19 or later in the Node 24 release line.",
    }),
  );
  process.exitCode = 1;
} else {
  const { main } = await import("../src/cli/index.ts");
  await main(process.argv.slice(2));
}
