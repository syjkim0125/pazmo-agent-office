import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, freezeCandidate } from "../core/candidates.ts";
import type { Candidate } from "../core/candidates.ts";
import type { RunnerInstall, RunnerName } from "./runner-discovery.ts";
import { codexModels, writeCodexCatalog } from "./runner-models.ts";
import {
  qualifyClaudeFixture,
  qualifyCodexFixture,
} from "./qualification-fixtures.ts";
import type { Check, FixtureInput } from "./qualification-fixtures.ts";

/** Office's own boundary code; a change here invalidates every earlier pass. */
export const BOUNDARY_DIGEST = digest(
  [
    "codex-profile.ts",
    "codex-controller.ts",
    "claude-profile.ts",
    "claude-controller.ts",
    "claude-tool-bridge.mjs",
    "exec-relay.ts",
    "qualification-fixtures.ts",
  ]
    .map((f) => readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url))))
    .reduce((all, b) => Buffer.concat([all, b]), Buffer.alloc(0)),
);

export type Qualification = {
  runner: RunnerName;
  boundary: string;
  sha256: string;
  version: string;
  model: string;
  executorSha256: string;
  catalog?: { path: string; digest: string };
  checks: Check[];
  passed: boolean;
  at: string;
};

/** Passing records only, one immutable file per (runner, binary SHA, model,
 * executor SHA). Failures are returned to the caller and always rerun. */
export class QualificationStore {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  #path(runner: string, sha256: string, model: string, executor: string, boundary: string) {
    return join(
      this.dir,
      `${runner}-${sha256.slice(0, 16)}-${digest(`${model}\n${executor}\n${boundary}`).slice(0, 16)}.json`,
    );
  }
  get(runner: RunnerName, sha256: string, model: string, executor: string, boundary: string) {
    const path = this.#path(runner, sha256, model, executor, boundary);
    if (!existsSync(path)) return null;
    let q: Qualification;
    try {
      q = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null; // unreadable record: qualify again
    }
    return q.passed &&
      q.runner === runner &&
      q.sha256 === sha256 &&
      q.model === model &&
      q.executorSha256 === executor &&
      q.boundary === boundary
      ? q
      : null;
  }
  put(q: Qualification) {
    if (!q.passed) return;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(
      this.#path(q.runner, q.sha256, q.model, q.executorSha256, q.boundary),
      JSON.stringify(q, null, 2),
      { mode: 0o600, flag: "wx" },
    );
  }
}

/** A one-file readonly candidate whose marker proves reads go through the VM. */
export function qualificationCandidate(dir: string): { candidate: Candidate; marker: string } {
  const project = join(dir, "project"),
    storage = join(dir, "candidates");
  mkdirSync(project, { recursive: true, mode: 0o700 });
  mkdirSync(storage, { recursive: true, mode: 0o700 });
  const marker = "PAZMO_QUALIFICATION_CANDIDATE_" + digest(String(Date.now())).slice(0, 12);
  writeFileSync(join(project, "README.md"), marker + "\n", { mode: 0o600 });
  return { candidate: freezeCandidate(project, ["README.md"], storage), marker };
}

/** First use of a (binary, model) pair runs the credential-free VM fixture. */
export async function qualify(i: {
  install: RunnerInstall;
  model: string;
  store: QualificationStore;
  executorSha256: string;
  fixture: FixtureInput;
  fixtures?: {
    codex: typeof qualifyCodexFixture;
    claude: typeof qualifyClaudeFixture;
  };
  codexCatalog?: typeof codexModels;
  boundary?: string;
}): Promise<Qualification> {
  const boundary = i.boundary ?? BOUNDARY_DIGEST;
  const { install, model } = i;
  if (install.status !== "ready" || !install.path || !install.sha256 || !install.version)
    throw Object.assign(new Error("RUNNER_NOT_READY"), { code: "RUNNER_NOT_READY" });
  const known = i.store.get(install.runner, install.sha256, model, i.executorSha256, boundary);
  if (known) return known;
  const fixtures = i.fixtures ?? { codex: qualifyCodexFixture, claude: qualifyClaudeFixture };
  let catalog: Qualification["catalog"];
  let checks: Check[];
  if (install.runner === "codex") {
    const { entries } = await (i.codexCatalog ?? codexModels)(install.path);
    if (!entries[model])
      throw Object.assign(new Error("RUNNER_MODEL_UNKNOWN"), { code: "RUNNER_MODEL_UNKNOWN" });
    catalog = writeCodexCatalog(join(i.store.dir, "catalogs"), entries[model]);
    checks = await fixtures.codex(
      { binary: install.path, sha256: install.sha256, model, catalog },
      i.fixture,
    );
  } else
    checks = await fixtures.claude(
      { binary: install.path, sha256: install.sha256, model },
      i.fixture,
    );
  const result: Qualification = {
    runner: install.runner,
    sha256: install.sha256,
    version: install.version,
    model,
    boundary,
    executorSha256: i.executorSha256,
    ...(catalog ? { catalog } : {}),
    checks,
    passed: checks.length > 0 && checks.every((c) => c.passed),
    at: new Date().toISOString(),
  };
  i.store.put(result);
  return result;
}
