import { OfficeError } from "../cli/project.ts";
import type { DevPr, DevRepo, DevReport, RevertPr } from "../hub/story-store.ts";
import type { PullRequest } from "./pr.ts";
import { describe } from "./story-check.ts";
import type { FinishLane } from "./story-finish.ts";
import type { StoryLink } from "./story-link.ts";

export type DevGit = {
  /** `branch.pushDevBranch`: a verified commit to its own to-dev branch. */
  push(checkout: string, p: { storyBase: string; branch: string; sha: string }): Promise<"pushed" | "exists">;
  /** `branch.revertDevMerge`: the revert of every merged dev PR of the Story on its own revert-dev branch. */
  revert(
    checkout: string,
    p: { devBranch: string; merges: { commit: string; head: string }[]; branch: string; repo?: string },
  ): Promise<
    | { kind: "pushed"; head: string }
    | { kind: "exists" }
    | { kind: "missing" }
    | { kind: "unsupported"; commit: string }
    | { kind: "conflict"; files: string[] }
  >;
};
export type DevPrApi = {
  /** `pr.ensureDevPr`, `pr.viewDevPr` and `pr.closeDevPr`, bound to the person's gh. */
  ensure(remote: string, p: { base: string; head: string; title: string; body: string }): Promise<PullRequest & { headSha: string }>;
  view(remote: string, number: number): Promise<{ state: PullRequest["state"]; mergeCommit: string | null; headSha: string }>;
  close(remote: string, p: { number: number; comment: string }): Promise<PullRequest["state"]>;
};
export type StoryDev = { tick(): Promise<{ ran: boolean }>; active(): boolean; stop(): void };

/** An open PR is read again at most this often. */
const FOLLOW_MS = 60_000;
const STATE: Record<PullRequest["state"], DevPr["state"]> = { OPEN: "opened", MERGED: "merged", CLOSED: "closed" };
/** What a person may read of a git or gh refusal; anything else is the Office's own failure, tried again. */
const SAID = new Set(["GIT_FAILED", "GH_FAILED", "PUSH_REFUSED", "INVALID"]);
const codeOf = (error: unknown) => (error instanceof OfficeError ? error.code : null);

/**
 * The PL Office's dev QA (D50). On each tick it reads the Stories its PL asked something of (`devReady`) and, repo by
 * repo:
 * - a dev request pushes the verified commit to its own `feature/story-<N>/to-dev-<sha12>` branch (never the Story base,
 *   so a conflict a person resolves there stays off the way to main) and opens its PR into the dev branch, after closing
 *   an open dev PR of another commit;
 * - a revert request reverts the merged dev PR's merge on dev's tip on `feature/story-<N>/revert-dev-<sha12>` and opens
 *   its PR into dev; a conflict or a merge no longer in dev opens nothing and says why;
 * - open dev and revert PRs are read at most once a minute and reported when they change (merged, closed, a new head).
 * A git or gh refusal is the request's reason on the Story page, and the PL may press again. The Office never merges a
 * dev PR: people review and merge it. The timer that calls `tick` is the caller's.
 */
export function createStoryDev(d: {
  lanes(): FinishLane[];
  canRun(): boolean;
  git: DevGit;
  pr: DevPrApi;
  log?: (line: string) => void;
  now?: () => number;
}): StoryDev {
  const now = d.now ?? Date.now;
  const log = (line: string) => {
    try {
      d.log?.(line);
    } catch {
      // nowhere left to say it
    }
  };
  const said = new Map<string, string>();
  const sayOnce = (key: string, line: string) => {
    if (said.get(key) === line) return;
    said.set(key, line);
    log(line);
  };
  /** When each open PR (`<remote>#<number>`) was last read. */
  const followed = new Map<string, number>();
  let running = false;
  let stopped = false;

  /** Runs a git or gh step; a refusal a person can act on is reported as the request's reason. Whether it finished. */
  async function attempt(via: StoryLink, storyId: string, r: DevRepo, what: string, step: () => Promise<void>): Promise<boolean> {
    try {
      await step();
      return true;
    } catch (error) {
      if (!SAID.has(codeOf(error) as string)) throw error;
      await fail(via, storyId, r, `${what}: ${describe(error).replace(/^[A-Z_]+: /, "")}`);
      return false;
    }
  }
  async function fail(via: StoryLink, storyId: string, r: DevRepo, reason: string) {
    await via.devReport(storyId, { kind: "failed", repoId: r.repoId, reason: reason.slice(0, 4000) });
    log(`team: story ${storyId}: ${r.repoName}: ${reason}`);
  }

  /** Whether a PR was opened. */
  async function openDev(via: StoryLink, view: { storyId: string; number: number; title: string }, r: DevRepo, lane: FinishLane): Promise<boolean> {
    const sha = r.wantCommit as string;
    const branch = `feature/story-${view.number}/to-dev-${sha.slice(0, 12)}`;
    const devBranch = r.devBranch as string;
    // An open dev PR of another commit is closed first; if it cannot be, nothing new opens beside it (review 1 M2).
    if (r.dev && r.dev.state === "opened" && r.dev.commit !== sha) {
      const old = r.dev;
      const closed = await attempt(via, view.storyId, r, "옛 dev PR을 정리하지 못해 새 PR을 열지 않았습니다", async () => {
        const was = await d.pr.close(lane.remote, { number: old.prNumber, comment: `Pazmo Office: Story #${view.number}의 새 검증 커밋 ${sha.slice(0, 12)}로 dev PR을 다시 엽니다. 이 PR은 머지하지 마세요.` });
        // A person merged (or closed) it since it was last read: its merge is recorded before the new PR replaces it,
        // so a later revert still takes it back (review 2 of U57).
        if (was !== "OPEN") {
          const v = await d.pr.view(lane.remote, old.prNumber);
          const state = STATE[v.state];
          if (state === "merged" && !v.mergeCommit)
            throw new OfficeError("GH_FAILED", "옛 dev PR이 머지됐지만 GitHub이 아직 머지 커밋을 알려 주지 않습니다. 잠시 뒤 다시 누르세요.");
          await via.devReport(view.storyId, { kind: "dev", repoId: r.repoId, ...old, state, head: v.headSha, mergeCommit: state === "merged" ? v.mergeCommit : null } as DevReport);
        }
      });
      if (!closed) return false;
    }
    const pushed = await attempt(via, view.storyId, r, "dev로 보낼 브랜치를 올리지 못했습니다", async () => {
      await d.git.push(lane.checkout, { storyBase: r.storyBase, branch, sha });
    });
    if (!pushed) return false;
    return attempt(via, view.storyId, r, "dev로 가는 PR을 열지 못했습니다", async () => {
      const pr = await d.pr.ensure(lane.remote, {
        base: devBranch,
        head: branch,
        title: `Story #${view.number} dev 확인: ${view.title}`.slice(0, 200),
        body: `PL이 Story #${view.number}의 검증한 커밋 ${sha}을 dev에서 확인하려고 엽니다(Pazmo Office). 리뷰와 머지는 사람이 합니다. 결과 승인과 main 머지는 이 PR과 상관없이 검증한 커밋으로 합니다.`,
      });
      await via.devReport(view.storyId, {
        kind: "dev", repoId: r.repoId, state: STATE[pr.state], prNumber: pr.number, prUrl: pr.url, commit: sha, head: pr.headSha,
        mergeCommit: pr.state === "MERGED" ? pr.mergeCommit : null,
      } as DevReport);
      followed.set(`${lane.remote}#${pr.number}`, now());
      log(`team: story-${view.number}: ${r.repoName}: dev PR #${pr.number} of ${sha.slice(0, 12)} is open`);
    });
  }

  /** Reverts every dev PR of the Story merged into dev, newest first, on one branch; whether a PR was opened. */
  async function openRevert(via: StoryLink, view: { storyId: string; number: number }, r: DevRepo, lane: FinishLane): Promise<boolean> {
    const merges = [...r.merged].reverse();
    if (!merges.length) {
      await fail(via, view.storyId, r, "dev에 머지된 PR이 없어 되돌릴 것이 없습니다.");
      return false;
    }
    const newest = merges[0].mergeCommit;
    const branch = `feature/story-${view.number}/revert-dev-${newest.slice(0, 12)}`;
    const devBranch = r.devBranch as string;
    let ready = false;
    await attempt(via, view.storyId, r, "dev에서 되돌리지 못했습니다", async () => {
      const done = await d.git.revert(lane.checkout, { devBranch, merges: merges.map((m) => ({ commit: m.mergeCommit, head: m.head })), branch, repo: lane.project });
      if (done.kind === "conflict") return fail(via, view.storyId, r, `dev에서 되돌리기가 충돌합니다: ${done.files.slice(0, 20).join(", ")}`);
      if (done.kind === "missing") return fail(via, view.storyId, r, "dev에 그 머지가 없거나 이미 되돌려져 있습니다(dev가 다시 만들어졌을 수 있습니다).");
      // A squashed or rebased PR leaves a commit that may hold only part of it: GitHub's own Revert takes the whole PR.
      if (done.kind === "unsupported")
        return fail(via, view.storyId, r, `merge commit이 아닌 방식(squash·rebase)으로 머지된 dev PR(${done.commit.slice(0, 12)})은 Office가 정확히 되돌릴 수 없습니다. GitHub의 PR 화면에서 Revert 단추로 되돌리세요.`);
      ready = true;
    });
    if (!ready) return false;
    return attempt(via, view.storyId, r, "dev 되돌리기 PR을 열지 못했습니다", async () => {
      const pr = await d.pr.ensure(lane.remote, {
        base: devBranch,
        head: branch,
        title: `Story #${view.number} dev 되돌리기`,
        body: `Story #${view.number}이(가) dev에 머지한 PR ${merges.map((m) => `#${m.prNumber}`).join(", ")}을 dev에서 되돌립니다(Pazmo Office). 리뷰와 머지는 사람이 합니다.`,
      });
      await via.devReport(view.storyId, { kind: "revert", repoId: r.repoId, state: STATE[pr.state], prNumber: pr.number, prUrl: pr.url });
      followed.set(`${lane.remote}#${pr.number}`, now());
      log(`team: story-${view.number}: ${r.repoName}: dev revert PR #${pr.number} is open`);
    });
  }

  /** Reads an open dev or revert PR again (at most once a minute) and reports a change. */
  async function follow(via: StoryLink, storyId: string, r: DevRepo, lane: FinishLane) {
    const due = (number: number) => {
      const key = `${lane.remote}#${number}`;
      const last = followed.get(key);
      if (last !== undefined && now() - last < FOLLOW_MS) return false;
      followed.set(key, now());
      return true;
    };
    if (r.dev?.state === "opened" && due(r.dev.prNumber)) {
      const v = await d.pr.view(lane.remote, r.dev.prNumber);
      const state = STATE[v.state];
      if (state === "merged" && !v.mergeCommit) return;
      if (state !== r.dev.state || v.headSha !== r.dev.head)
        await via.devReport(storyId, { kind: "dev", repoId: r.repoId, ...r.dev, state, head: v.headSha, mergeCommit: state === "merged" ? v.mergeCommit : null } as DevReport);
    }
    if (r.revert?.state === "opened" && due(r.revert.prNumber)) {
      const v = await d.pr.view(lane.remote, r.revert.prNumber);
      const state = STATE[v.state];
      if (state !== r.revert.state) await via.devReport(storyId, { kind: "revert", repoId: r.repoId, ...(r.revert as RevertPr), state });
    }
  }

  async function runTick(): Promise<{ ran: boolean }> {
    if (stopped || !d.canRun()) return { ran: false };
    const via = d.lanes().find((l) => l.ready && l.link !== null)?.link;
    if (!via) return { ran: false };
    let ready: string[];
    try {
      ready = (await via.inbox()).devReady ?? [];
    } catch (error) {
      sayOnce("inbox", `team: looking for dev requests failed (${describe(error)}); trying again next cycle`);
      return { ran: false };
    }
    running = true;
    let ran = false;
    try {
      for (const storyId of ready) {
        if (stopped) break;
        try {
          const view = await via.devView(storyId);
          const lanes = d.lanes();
          for (const r of view.repos) {
            const lane = lanes.find((l) => l.repoId === r.repoId);
            // A request that cannot be done here is answered, so it never waits forever (review 1 I4, M8).
            const refused = !r.want
              ? null
              : !r.devBranch
                ? "이 레포의 dev 브랜치가 비워졌습니다."
                : !lane
                  ? "이 레포가 PL의 Office에 연결돼 있지 않습니다."
                  : r.want === "dev" && view.state !== "awaiting_g4"
                    ? "Story가 승인 대기가 아니어서 dev PR을 열지 않았습니다."
                    : r.want === "revert" && view.state === "done"
                      ? "완료된 Story는 dev에서 되돌리지 않습니다."
                      : null;
            if (refused) {
              await fail(via, storyId, r, refused);
              continue;
            }
            if (!lane || !r.devBranch) continue;
            // Only a PR actually opened counts as a run: a request that keeps failing never holds the claim tick (M1).
            if (r.want === "dev" && r.wantCommit) ran = (await openDev(via, view, r, lane)) || ran;
            else if (r.want === "revert") ran = (await openRevert(via, view, r, lane)) || ran;
            else if (view.state !== "done") await follow(via, storyId, r, lane);
          }
          said.delete(storyId);
        } catch (error) {
          sayOnce(storyId, `team: the dev PRs of Story ${storyId} failed (${describe(error)}); trying again next cycle`);
        }
      }
      return { ran };
    } finally {
      running = false;
    }
  }

  let ticking: Promise<{ ran: boolean }> | null = null;
  return {
    tick() {
      ticking ??= runTick().finally(() => {
        ticking = null;
      });
      return ticking;
    },
    active: () => running,
    stop() {
      stopped = true;
    },
  };
}
