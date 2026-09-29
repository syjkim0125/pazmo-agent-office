// Trusted VM copy only. Docker may retain a private host owner/mode.
// CHOWN is already granted to preparation; worker containers keep zero capabilities.
if (!fs.lstatSync("/runner/codex").isFile())
  throw Error("UNVERIFIED_EXEC_SERVER");
fs.lchownSync("/runner/codex", 0, 0);
const runtimeHash = crypto.createHash("sha256");
const runtimeBuffer = Buffer.alloc(65536);
const runtimeFd = fs.openSync(
  "/runner/codex",
  fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
);
try {
  let runtimeRead;
  while (
    (runtimeRead = fs.readSync(
      runtimeFd,
      runtimeBuffer,
      0,
      runtimeBuffer.length,
      null,
    )) > 0
  )
    runtimeHash.update(runtimeBuffer.subarray(0, runtimeRead));
} finally {
  fs.closeSync(runtimeFd);
}
if (runtimeHash.digest("hex") !== expectedExecutorDigest)
  throw Error("UNVERIFIED_EXEC_SERVER");
fs.chmodSync("/runner/codex", 0o555);
