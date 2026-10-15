#!/usr/bin/env node
const [major] = process.versions.node.split(".").map(Number);
if (major !== 24) {
  console.error(
    JSON.stringify({
      code: "NODE_VERSION",
      error: "Use Node 24 (any 24.x release).",
    }),
  );
  process.exitCode = 1;
} else {
  const { main } = await import("../src/hub/main.ts");
  await main();
}
