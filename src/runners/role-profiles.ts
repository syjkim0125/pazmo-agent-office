import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { fail, noSymlinks, packageRoot } from "../cli/project.ts";
import { digest } from "../core/candidates.ts";
import lock from "../../upstream/skills.lock.json" with { type: "json" };

export type ExecutingRole = "engineer" | "reviewer" | "pm" | "lead";

// This registry and its files belong to the trusted installation, never the
// worker project. Hashes detect packaging/drift, not a compromised controller.
export function loadRoleProfile(
  role: ExecutingRole,
  root = realpathSync(packageRoot),
) {
  try {
    if (
      lock.version !== 1 ||
      !["engineer", "reviewer", "pm", "lead"].includes(role)
    )
      throw new Error("Unsupported profile");
    const entry = lock.profiles[role];
    const expectedPaths = [
      role === "pm" || role === "lead"
        ? "assets/roles/planning-common.md"
        : "assets/roles/common.md",
      `assets/roles/${role}.md`,
    ];
    if (
      entry.role !== role ||
      entry.origin !== "pazmo-authored" ||
      entry.ref !== `pazmo-${role}@1.0.0` ||
      entry.license !== "MIT" ||
      entry.licensePath !== "LICENSE" ||
      entry.source !== expectedPaths[1] ||
      entry.files.length !== expectedPaths.length
    )
      throw new Error("Invalid profile metadata");
    const files = entry.files.map((file, index) => {
      if (
        file.path !== expectedPaths[index] ||
        !/^[a-f0-9]{64}$/.test(file.digest)
      )
        throw new Error("Invalid profile reference");
      const path = join(root, file.path);
      noSymlinks(path);
      const fd = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = fstatSync(fd);
        if (!before.isFile() || before.size > 65536)
          throw new Error("Invalid profile file");
        const buffer = Buffer.alloc(65537);
        let size = 0;
        while (size < buffer.length) {
          const n = readSync(fd, buffer, size, buffer.length - size, null);
          if (!n) break;
          size += n;
        }
        const after = fstatSync(fd);
        const bytes = buffer.subarray(0, size);
        if (
          size > 65536 ||
          size !== before.size ||
          before.size !== after.size ||
          before.ctimeMs !== after.ctimeMs ||
          digest(bytes) !== file.digest
        )
          throw new Error("Profile integrity mismatch");
        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!content.trim()) throw new Error("Empty profile");
        return { ...file, content };
      } finally {
        closeSync(fd);
      }
    });
    return { ...entry, role, files };
  } catch {
    return fail(
      "ROLE_PROFILE_INVALID",
      "The packaged role profile is missing, unsupported or changed; restore the qualified Office installation.",
    );
  }
}

export type RoleProfile = ReturnType<typeof loadRoleProfile>;

export function assertRoleProfile(
  role: ExecutingRole,
  profile: RoleProfile,
): void {
  if (JSON.stringify(profile) !== JSON.stringify(loadRoleProfile(role)))
    fail(
      "ROLE_PROFILE_INVALID",
      "The role packet does not contain the current pinned instructions.",
    );
}
