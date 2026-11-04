import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fail, locate, noSymlinks } from "../cli/project.ts";
import type { MacRepo } from "../hub/store.ts";
import { normalizeRemote } from "../hub/remote.ts";
import { printable, readLinkConfig, removeLinkConfig, writeLinkConfig } from "../runtime/hub-link.ts";
import type { HubLinkConfig } from "../runtime/hub-link.ts";
import { runCommand } from "../runners/command.ts";
import { CREDENTIALS_REFUSED, cloneRepo, originUrl } from "./branch.ts";
import type { GitEnv } from "./branch.ts";
import { findOnPath, ghStatus, remoteHost } from "./gh.ts";
import type { GhResult } from "./gh.ts";
import { macClient, readMacLink } from "./mac.ts";
import type { MacClient } from "./mac.ts";
import { MAX_REPOS, addTeamRepo, readTeam, removeTeamRepo, teamRunning } from "./registry.ts";
import type { Team } from "./registry.ts";

const NAME_MAX = 80;
const SETUP_TIMEOUT_MS = 30000;
const SETUP_MAX_BYTES = 64 * 1024;
/** Only folders this module names `.<folder>.<uuid>.partial`; anything else in the clone folder is left alone. */
const PARTIAL = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.partial$/;

/** Where a Mac keeps the clones of the repos its member owns. */
export const reposDir = (root: string): string => join(root, "repos");

const safe = (text: string): string => text.replace(/[^A-Za-z0-9._-]/g, "-");
/** A Hub name as a folder name: letters, digits, `.`, `_` and `-` only, no leading `.` (so it is never `.`, `..` or
 * a `.partial`), at most 80 characters; a name with nothing left is `repo-<repoId first 8>`. */
function folderName(repo: MacRepo): string {
  return safe(repo.name).replace(/^\.+/, "").slice(0, NAME_MAX) || `repo-${safe(repo.repoId.slice(0, 8))}`;
}

/** `<root>/repos/<name>`, or `<name>-<repoId first 8>` when another owned repo has the same folder name. Names that
 * differ only in letter case count as the same: macOS folders do not tell them apart. */
export function cloneDirFor(root: string, repo: MacRepo, all: MacRepo[]): string {
  const name = folderName(repo);
  const shared = all.some((other) => other.repoId !== repo.repoId && folderName(other).toLowerCase() === name.toLowerCase());
  return join(reposDir(root), shared ? `${name}-${safe(repo.repoId.slice(0, 8))}` : name);
}

export type MacSyncDeps = {
  root: string;
  hub: string;
  macId: string;
  member: { id: string; name: string };
  client: Pick<MacClient, "repos" | "link">;
  git: GitEnv;
  /** Whether gh is logged in to a Git host; default `ghStatus` with the person's HOME and PATH. */
  gh?: (host: string) => Promise<GhResult>;
  /** Given only when a person is at a terminal: runs `gh auth login` for the host and returns when it ends. */
  ghLogin?: ((host: string) => Promise<void>) | null;
  /** Makes gh git's credential helper for the host; default `gh auth setup-git --hostname <host>`, true on exit 0. */
  setupGit?: (host: string) => Promise<boolean>;
  say: (line: string) => void;
};
/** One repo after a sync. `linked`: a hub-link.json is in place for it (minted now, this Mac's live one, or the
 * person's own). `problem`: the line said about it (`<name>: <what>`), with the command that fixes it. */
export type MacRepoResult = {
  repoId: string;
  name: string;
  project: string | null;
  cloned: boolean;
  registered: boolean;
  linked: boolean;
  problem: string | null;
};
/** `removed`: registry projects taken out. `pending` (links-only): owned repos (by name) that are not registered and
 * that the registry has a place for (`MAX_REPOS`), and Mac clones (by project) that are registered but no longer
 * owned. `minted`: the repoIds whose link this sync minted and wrote. */
export type MacSyncResult = {
  repos: MacRepoResult[];
  removed: string[];
  pending: { add: string[]; remove: string[] };
  minted: string[];
};

const login = (host: string) => `gh auth login --hostname ${host} --web --git-protocol https`;
const setupCommand = (host: string) => `gh auth setup-git --hostname ${host}`;
/** An error as one printable line, with any `user:secret@` taken out of URLs it quotes. */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return printable(message.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1")).trim();
}
const codeOf = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};
/** A Hub refusal: its plain-language message, with its code when it has one. */
function hubReason(error: unknown): string {
  const code = codeOf(error);
  const reason = reasonOf(error);
  return code && !reason.includes(code) ? `${reason} (${printable(code)})` : reason;
}
/** The https address to clone and its Git host, only for a remote the Hub could have stored (`normalizeRemote`
 * output): it reaches git as an argument. */
function cloneTarget(remote: string): { url: string; host: string } | null {
  try {
    if (normalizeRemote(`https://${remote}`) !== remote) return null;
    return { url: `https://${remote}.git`, host: remoteHost(remote) };
  } catch {
    return null;
  }
}
function sameRemote(origin: string | null, remote: string): boolean {
  if (origin === null) return false;
  try {
    return normalizeRemote(origin) === remote;
  } catch {
    return false;
  }
}
const canonical = (dir: string): string => (existsSync(dir) ? realpathSync(dir) : dir);

/** What a killed run left: a clone folder that never got its final name. */
function clearPartials(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir))
    if (PARTIAL.test(entry)) rmSync(join(dir, entry), { recursive: true, force: true });
}

/** Clones into a `.partial` folder beside `target` and renames it into place, so `target` exists only as a whole
 * clone. Whatever fails, the `.partial` goes. */
async function cloneInto(url: string, target: string, git: GitEnv): Promise<void> {
  const dir = dirname(target);
  noSymlinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const partial = join(dir, `.${basename(target)}.${randomUUID()}.partial`);
  try {
    await cloneRepo(url, partial, git);
    if (existsSync(target)) fail("CLONE_DIR_TAKEN", `${target} appeared while the clone ran.`);
    renameSync(partial, target);
  } finally {
    rmSync(partial, { recursive: true, force: true });
  }
}

/** gh's own credential helper for `host`, with the same environment `ghStatus` gives gh. */
async function setupGitDefault(host: string, env: GitEnv): Promise<boolean> {
  const gh = findOnPath(env.pathEnv, "gh");
  if (!gh) return false;
  const result = await runCommand(gh, ["auth", "setup-git", "--hostname", host], {
    timeoutMs: SETUP_TIMEOUT_MS,
    maxBytes: SETUP_MAX_BYTES,
    env: { HOME: env.home, PATH: env.pathEnv, LANG: "C" },
  });
  return !result.timedOut && result.exitCode === 0;
}

function ghProblem(host: string, status: Extract<GhResult, { ok: false }>): string {
  if (status.reason === "missing") return `gh(GitHub CLI)가 설치되어 있지 않습니다 — 설치한 뒤 실행하세요: ${login(host)}`;
  if (status.reason === "timeout")
    return `${host}의 gh 로그인을 제한 시간 안에 확인하지 못했습니다 — 네트워크를 확인하거나 실행하세요: ${login(host)}`;
  return `gh 로그인이 필요합니다 — ${login(host)}`;
}

/**
 * Brings this Mac in line with the repos its member owns on the Hub, in the Hub's order; one repo's failure never
 * stops the next, and each is said as `<name>: <what>`.
 *
 * `full` (the team Office is stopped): checks gh once per Git host (a `ghLogin` prompt once, when given), clones a repo
 * that is not registered into `cloneDirFor` (through a `.partial` folder, after one `setupGit` per host), registers it,
 * and takes Mac clones that are no longer owned out of the registry (their folders stay). A repo the person registered
 * from their own folder (the same remote) is used as it is and never unregistered.
 *
 * `links-only` (the team Office runs): touches no registry, folder, gh or git; it reports what a full sync would add
 * or remove in `pending`.
 *
 * Both mint a repo link when its hub-link.json is missing, or carries a macId that is not this Mac's (or this Mac holds
 * no live link for the repo). A link file without macId is the person's own and is never rewritten.
 * Only a failed `repos()` or an unreadable registry throws.
 */
export async function syncMacRepos(d: MacSyncDeps, mode: "full" | "links-only"): Promise<MacSyncResult> {
  const full = mode === "full";
  const say = (line: string) => {
    try {
      d.say(line);
    } catch {
      // A log line never stops the sync.
    }
  };
  const dir = reposDir(d.root);
  if (full) {
    noSymlinks(dir);
    clearPartials(dir);
  }
  const owned = await d.client.repos();
  let team: Team = readTeam(d.root);
  const result: MacSyncResult = { repos: [], removed: [], pending: { add: [], remove: [] }, minted: [] };
  const problem = (r: MacRepoResult, what: string): MacRepoResult => {
    r.problem = `${r.name}: ${what}`;
    say(r.problem);
    return r;
  };

  // Mac clones of repos the member no longer owns. First, so their places count for the registry's limit.
  const clones = canonical(dir);
  const ownedRemotes = new Set(owned.map((repo) => repo.remote));
  for (const entry of team.repos.filter((e) => dirname(e.project) === clones && !ownedRemotes.has(e.remote))) {
    if (!full) {
      result.pending.remove.push(entry.project);
      continue;
    }
    // Its own link file names it best; the folder name otherwise.
    let link: { dataDir: string; cfg: HubLinkConfig | null } | null = null;
    try {
      const dataDir = locate(entry.project, d.root).dataDir;
      link = { dataDir, cfg: readLinkConfig(dataDir) };
    } catch {
      // gone or unreadable: nothing of it is used or removed
    }
    // readLinkConfig does not check field types; a value that is not a string is not used.
    const repoName = link?.cfg?.repoName;
    const repoId = link?.cfg?.repoId;
    const name = printable(typeof repoName === "string" && repoName ? repoName : basename(entry.project));
    try {
      await removeTeamRepo(d.root, entry.project);
    } catch (error) {
      const code = codeOf(error);
      result.repos.push(
        problem(
          { repoId: typeof repoId === "string" ? repoId : "", name, project: entry.project, cloned: false, registered: true, linked: false, problem: null },
          code === "OPEN_CLAIM"
            ? "더 이상 담당이 아니지만 팀 Office가 이 repo의 열린 Task를 갖고 있어 등록을 남겨 둡니다(OPEN_CLAIM) — Task가 끝나면 다음 맞추기에서 뺍니다"
            : `더 이상 담당이 아니지만 팀 Office 등록을 빼지 못했습니다(${code ?? "FAILED"}) — ${reasonOf(error)}`,
        ),
      );
      continue;
    }
    result.removed.push(entry.project);
    if (link?.cfg && link.cfg.macId !== undefined)
      try {
        removeLinkConfig(link.dataDir);
      } catch {
        // The Hub already refuses the link of a repo the member does not own.
      }
    say(`${name}: 더 이상 담당이 아니어서 팀 Office 등록을 뺐습니다 — 폴더 ${entry.project}는 남겨 둡니다`);
  }
  if (result.removed.length) team = readTeam(d.root);

  const ghOf = d.gh ?? ((host: string) => ghStatus(host, { pathEnv: d.git.pathEnv, home: d.git.home }));
  const setupOf = d.setupGit ?? ((host: string) => setupGitDefault(host, d.git));
  const ghChecked = new Map<string, string | null>();
  const setUp = new Map<string, boolean>();
  /** null when gh is logged in to `host`, else the problem; asked once per host, with one login prompt. */
  async function ghFor(host: string): Promise<string | null> {
    const known = ghChecked.get(host);
    if (known !== undefined) return known;
    const ask = async (): Promise<GhResult> => {
      try {
        return await ghOf(host);
      } catch {
        return { ok: false, reason: "logged-out", hint: "" };
      }
    };
    let status = await ask();
    if (!status.ok && status.reason !== "missing" && d.ghLogin) {
      try {
        await d.ghLogin(host);
      } catch {
        // A login that could not run is a login that did not help; gh is asked again either way.
      }
      status = await ask();
    }
    const outcome = status.ok ? null : ghProblem(host, status);
    ghChecked.set(host, outcome);
    return outcome;
  }
  async function setupFor(host: string): Promise<boolean> {
    let ok = setUp.get(host);
    if (ok === undefined) {
      try {
        ok = await setupOf(host);
      } catch {
        ok = false;
      }
      setUp.set(host, ok);
    }
    return ok;
  }

  async function link(r: MacRepoResult, repo: MacRepo, project: string): Promise<MacRepoResult> {
    if (!existsSync(project))
      return problem(r, `등록된 폴더 ${project}가 없습니다 — 폴더를 되돌리거나 pazmo-office team remove --project ${project}로 빼세요`);
    let dataDir: string;
    try {
      dataDir = locate(project, d.root).dataDir;
    } catch (error) {
      return problem(r, `등록된 폴더 ${project}를 쓸 수 없습니다 — ${reasonOf(error)}`);
    }
    const file = join(dataDir, "hub-link.json");
    let cfg: HubLinkConfig | null;
    try {
      cfg = readLinkConfig(dataDir);
    } catch {
      return problem(r, `연결 파일 ${file}을 읽을 수 없어 그대로 두었습니다 — 파일을 고치거나 지운 뒤 다시 실행하세요`);
    }
    if (cfg) {
      // The person's own link (from a connection string) is theirs: the Mac never rewrites it.
      if (cfg.macId === undefined) return { ...r, linked: true };
      if (cfg.macId === d.macId && repo.linked && cfg.repoId === repo.repoId) return { ...r, linked: true };
    }
    let minted: Awaited<ReturnType<MacClient["link"]>>;
    try {
      minted = await d.client.link(repo.repoId);
    } catch (error) {
      // The member's live connection-string link to this repo (another Office) stands: the Hub does not let a Mac
      // revoke it, and no retry here would change that. Office's own words, once per check.
      if (codeOf(error) === "LINKED_ELSEWHERE")
        return problem(
          r,
          "다른 곳의 Office가 연결 문자열로 이 repo에 연결해 쓰고 있어 이 Mac은 연결하지 않았습니다 — 이 Mac에서 쓰려면 허브의 레포 화면에서 그 연결을 해제하세요",
        );
      return problem(r, `허브 연결을 받지 못했습니다 — ${hubReason(error)}`);
    }
    if (minted.member.id !== d.member.id)
      return problem(r, "허브가 이 Mac의 팀원이 아닌 사람의 연결을 주어 쓰지 않았습니다 — 허브의 /mac에서 이 Mac을 다시 연결하세요");
    try {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      writeLinkConfig(dataDir, {
        hub: d.hub,
        caPem: null,
        fingerprint: null,
        token: minted.token,
        memberId: minted.member.id,
        memberName: minted.member.name,
        repoId: minted.repoId,
        repoName: minted.repoName,
        macId: d.macId,
      });
    } catch (error) {
      return problem(r, `연결 파일 ${file}을 쓰지 못했습니다 — ${reasonOf(error)}`);
    }
    result.minted.push(minted.repoId);
    say(`${r.name}: 허브 연결을 받았습니다`);
    return { ...r, linked: true };
  }

  async function one(repo: MacRepo): Promise<MacRepoResult> {
    const r: MacRepoResult = {
      repoId: repo.repoId,
      name: printable(repo.name),
      project: null,
      cloned: false,
      registered: false,
      linked: false,
      problem: null,
    };
    const target = cloneTarget(repo.remote);
    if (!target) return problem(r, "허브의 저장소 주소를 clone 주소로 쓸 수 없습니다 — 허브에서 이 레포의 git 원격 주소를 확인하세요");
    const entry = team.repos.find((e) => e.remote === repo.remote);
    if (entry) {
      r.project = entry.project;
      r.registered = true;
    }
    // A repo the registry has no place for is never cloned (it could never be registered) and, in links-only, is no
    // reason to restart: a full sync first takes out the Mac clones in `pending.remove`, then adds in this order.
    const registered = full ? team.repos.length : team.repos.length - result.pending.remove.length + result.pending.add.length;
    if (!entry && registered >= MAX_REPOS)
      return problem(
        r,
        `팀 Office는 repo를 ${MAX_REPOS}개까지 맡습니다 — 이미 ${MAX_REPOS}개가 등록돼 있어 clone하지 않았습니다(LIMIT). 담당 repo가 ${MAX_REPOS}개 이하가 되면 다음 맞추기에서 clone합니다`,
      );
    if (!full) {
      if (!entry) result.pending.add.push(r.name);
      return entry ? link(r, repo, entry.project) : r;
    }
    const gh = await ghFor(target.host);
    if (gh) return problem(r, gh);
    if (entry) return link(r, repo, entry.project);

    const folder = cloneDirFor(d.root, repo, owned);
    let found: Stats | undefined;
    try {
      found = lstatSync(folder);
    } catch {
      found = undefined;
    }
    const taken = () =>
      problem(r, `${folder} 폴더에 다른 저장소가 있어 clone하지 않았습니다(CLONE_DIR_TAKEN) — 그 폴더를 옮기거나 지운 뒤 다시 실행하세요`);
    if (found) {
      // A folder already there is used only when it is this repo's clone; anything else is the person's and stays as it is.
      if (!found.isDirectory()) return taken();
      let origin: string | null;
      try {
        origin = await originUrl(folder, d.git);
      } catch (error) {
        return problem(r, `${folder} 폴더를 확인하지 못했습니다 — ${reasonOf(error)}`);
      }
      if (!sameRemote(origin, repo.remote)) return taken();
    } else {
      if (!(await setupFor(target.host)))
        return problem(r, `git 자격 도우미를 설정하지 못했습니다 — ${setupCommand(target.host)}`);
      try {
        await cloneInto(target.url, folder, d.git);
      } catch (error) {
        const reason = reasonOf(error);
        return CREDENTIALS_REFUSED.test(reason)
          ? problem(r, `git 자격 증명이 없어 clone하지 못했습니다 — ${setupCommand(target.host)}`)
          : problem(r, `clone하지 못했습니다 — ${reason}`);
      }
      r.cloned = true;
      say(`${r.name}: clone했습니다`);
    }
    r.project = folder;
    try {
      r.project = (await addTeamRepo(d.root, folder)).project;
    } catch (error) {
      return problem(r, `팀 Office에 등록하지 못했습니다(${codeOf(error) ?? "FAILED"}) — ${reasonOf(error)}`);
    }
    r.registered = true;
    team = readTeam(d.root);
    say(`${r.name}: 팀 Office에 등록했습니다`);
    return link(r, repo, r.project);
  }

  const done: MacRepoResult[] = [];
  for (const repo of owned) done.push(await one(repo));
  result.repos = [...done, ...result.repos];
  return result;
}

const hostGit = (): GitEnv => ({
  home: homedir(),
  pathEnv: process.env.PATH ?? "",
  ...(process.env.SSH_AUTH_SOCK ? { sshAuthSock: process.env.SSH_AUTH_SOCK } : {}),
});

/**
 * The full sync `up --team` runs before it starts the team Office: nothing without a Mac link or while a team Office
 * runs (its registry must not change under it). Never throws and never prompts: a failure (no Hub, a bad Mac link)
 * is one line, and the Office starts with what is registered.
 */
export async function syncBeforeUp(
  root: string,
  o: { client?: MacClient; git?: GitEnv; gh?: (host: string) => Promise<GhResult>; say?: (line: string) => void } = {},
): Promise<void> {
  const say = (line: string) => {
    try {
      (o.say ?? ((text: string) => console.error(text)))(line);
    } catch {
      // nowhere left to say it
    }
  };
  try {
    const file = readMacLink(root);
    if (!file || teamRunning(root)) return;
    await syncMacRepos(
      {
        root,
        hub: file.hub,
        macId: file.macId,
        member: { id: file.memberId, name: file.memberName },
        client: o.client ?? macClient(file),
        git: o.git ?? hostGit(),
        ...(o.gh ? { gh: o.gh } : {}),
        ghLogin: null,
        say,
      },
      "full",
    );
  } catch (error) {
    say(`Mac 담당 repo 맞추기를 건너뜁니다 — ${hubReason(error)}`);
  }
}
