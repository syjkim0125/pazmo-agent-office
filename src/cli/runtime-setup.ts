import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { dataRoot, fail, noSymlinks, packageRoot } from "./project.ts";
import { digest, readStable } from "../core/candidates.ts";
import { CONTROLLER_SHA256 } from "../runners/codex-profile.ts";
import { EXEC_SERVER_SHA256 } from "../runners/container-verifier.ts";
import { runCommand } from "../runners/command.ts";

// Official npm immutable artifacts, qualified in the existing Mac/VM boundary tests.
const artifacts = [
  {
    name: "controller",
    version: "0.155.1-darwin-arm64",
    member: "package/vendor/aarch64-apple-darwin/bin/codex",
    hash: CONTROLLER_SHA256,
    integrity:
      "cYxzGcRRoBrncyHlR8ed4yXwcoVJZC1pipGULSyJkGFKXJw/Uu57BklvzayuAptjJIipamnOk32CfUkk1F0bLw==",
  },
  {
    name: "executor",
    version: "0.154.0-linux-arm64",
    member: "package/vendor/aarch64-unknown-linux-musl/bin/codex",
    hash: EXEC_SERVER_SHA256,
    integrity:
      "KmTCB6ST484zeYlPpKP/K5P/gRaYmt6TihVD+zotoe6O9q0JSBP+FYvCz4A/zZXR7xDOHURTSjHp0sD8wWS0YQ==",
  },
] as const;
const urlFor = (version: string) =>
  `https://registry.npmjs.org/@openai/codex/-/codex-${version}.tgz`;
const maxArchive = 192 * 1024 * 1024;
const maxBinary = 256 * 1024 * 1024;

export function runtimePaths(dataArgument?: string) {
  const root = dataRoot(dataArgument);
  const rel = relative(packageRoot, root);
  if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../")))
    fail("UNSAFE_PATH", "Runtime storage must be outside the Office source.");
  const directory = join(root, "qualified-runtime", "codex-0.155.1-0.154.0");
  noSymlinks(directory);
  return {
    directory,
    controller: join(directory, "controller"),
    binary: join(directory, "executor"),
  };
}
export function installedRuntime(dataArgument?: string) {
  const paths = runtimePaths(dataArgument);
  if (!existsSync(paths.directory))
    fail(
      "RUNTIME_SETUP_REQUIRED",
      "Run setup-runtime --apply with the same --data-dir before start --live.",
    );
  for (const artifact of artifacts) {
    const path = join(paths.directory, artifact.name);
    noSymlinks(path);
    if (
      !existsSync(path) ||
      digest(readStable(path, maxBinary)) !== artifact.hash
    )
      fail(
        "RUNTIME_INSTALL_INVALID",
        "The existing runtime is incomplete or changed; preserve it for inspection. No files were replaced.",
      );
  }
  return paths;
}

async function download(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    return fail(
      "RUNTIME_DOWNLOAD_FAILED",
      "Could not download the pinned official runtime. Check network access and retry setup.",
    );
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return fail(
      "RUNTIME_DOWNLOAD_FAILED",
      "The pinned runtime download did not return a body.",
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxArchive)
        fail(
          "RUNTIME_DOWNLOAD_LIMIT",
          "Runtime archive exceeds its download limit.",
        );
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof Error && "code" in error) throw error;
    return fail(
      "RUNTIME_DOWNLOAD_FAILED",
      "Runtime download was interrupted; no installation was published.",
    );
  }
  return Buffer.concat(chunks);
}

/** Downloads data only: no npm lifecycle scripts, authentication, or model calls. */
export async function setupRuntime(dataArgument?: string, apply = false) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    fail(
      "UNSUPPORTED_RUNTIME",
      "This qualified runtime supports macOS arm64 only.",
    );
  const paths = runtimePaths(dataArgument);
  const result = {
    applied: apply,
    changed: false,
    execution: "locked",
    ...paths,
    artifacts: artifacts.map((a) => ({
      version: a.version,
      url: urlFor(a.version),
      sha256: a.hash,
    })),
  };
  if (existsSync(paths.directory)) {
    installedRuntime(dataArgument);
    return result;
  }
  if (!apply) return result;
  const parent = join(dataRoot(dataArgument), "qualified-runtime");
  noSymlinks(parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lock = join(parent, "setup.lock");
  noSymlinks(lock);
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    return fail(
      "RUNTIME_SETUP_BUSY",
      "Another runtime setup or interrupted setup owns this directory; preserve it for inspection.",
    );
  }
  let staging: string | undefined;
  try {
    if (existsSync(paths.directory)) {
      installedRuntime(dataArgument);
      return result;
    }
    staging = mkdtempSync(join(parent, ".staging-"));
    for (const artifact of artifacts) {
      const bytes = await download(urlFor(artifact.version));
      if (
        createHash("sha512").update(bytes).digest("base64") !==
        artifact.integrity
      )
        fail(
          "RUNTIME_ARCHIVE_CHANGED",
          "Official archive integrity does not match the qualified pin.",
        );
      const archive = join(staging, "download.tgz");
      writeFileSync(archive, bytes, { mode: 0o600, flag: "wx" });
      const extracted = await runCommand(
        "/usr/bin/tar",
        ["-xOzf", archive, artifact.member],
        {
          cwd: staging,
          env: { PATH: "/usr/bin:/bin", COPYFILE_DISABLE: "1" },
          timeoutMs: 60000,
          maxBytes: maxBinary,
          captureBytes: true,
        },
      );
      if (
        extracted.exitCode !== 0 ||
        extracted.error ||
        extracted.signal ||
        extracted.timedOut ||
        !extracted.stdoutBytes ||
        digest(extracted.stdoutBytes) !== artifact.hash
      )
        fail(
          "RUNTIME_BINARY_CHANGED",
          "Extracted runtime does not match its qualified binary hash.",
        );
      writeFileSync(join(staging, artifact.name), extracted.stdoutBytes, {
        mode: 0o500,
        flag: "wx",
      });
      rmSync(archive);
    }
    noSymlinks(paths.directory);
    if (existsSync(paths.directory))
      fail(
        "RUNTIME_SETUP_BUSY",
        "Runtime destination appeared during installation; it was not replaced.",
      );
    renameSync(staging, paths.directory);
    staging = undefined;
    installedRuntime(dataArgument);
    return { ...result, changed: true };
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    rmdirSync(lock);
  }
}
