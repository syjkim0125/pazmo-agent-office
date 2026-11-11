import { storyBaseBranch } from "../hub/story-protocol.ts";

/** A Story repo with the PL's own checkout of it, where its base branch is fetched and its Story base pushed from. */
export type StoryBaseRepo = { id: string; name: string; baseBranch: string; checkout: string };
/** The two git steps of a Story's bases: the base branch tip on origin, and the one guarded push (D41). */
export type StoryBaseGit = {
  fetchBaseTip(checkout: string, baseBranch: string): Promise<string>;
  pushStoryBase(checkout: string, storyBase: string, sha: string): Promise<"created" | "exists">;
};

/** A git step of `openWithBases` that failed: which one, for which repo, and the git error it ended on (`cause`, with
 * its `code`: GIT_FAILED, BASE_EXISTS, …). The caller words it for its own person. */
export class StoryBaseError extends Error {
  step: "fetch" | "push";
  repo: StoryBaseRepo;
  storyBase: string;
  code: string | null;
  constructor(step: "fetch" | "push", repo: StoryBaseRepo, storyBase: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.step = step;
    this.repo = repo;
    this.storyBase = storyBase;
    const code = (cause as { code?: unknown } | null)?.code;
    this.code = typeof code === "string" ? code : null;
  }
}

/**
 * Makes a published Story's bases and opens it, the same way for the planning Office and the upload command (K1):
 * each repo's base commit is the one already `recorded` (the Hub's, kept once per repo), else its base branch tip
 * fetched now; `record` keeps them (the Hub refuses another commit) and gives back the commits to use; then every
 * repo's `feature/story-<N>/base` is pushed at its commit, and only once all are there the Story is opened. A fetch or
 * push that fails is a StoryBaseError naming its repo, and nothing after it runs (the Story stays a draft); `record`'s
 * and `open`'s own errors pass through as they are.
 */
export async function openWithBases(o: {
  story: { id: string; number: number };
  repos: StoryBaseRepo[];
  recorded: Record<string, string>;
  record: (bases: Record<string, string>) => Promise<Record<string, string>>;
  git: StoryBaseGit;
  open: () => Promise<void>;
}): Promise<void> {
  const storyBase = storyBaseBranch(o.story.number);
  const bases: Record<string, string> = {};
  for (const repo of o.repos) {
    const known = Object.hasOwn(o.recorded, repo.id) ? o.recorded[repo.id] : undefined;
    if (known) {
      bases[repo.id] = known;
      continue;
    }
    try {
      bases[repo.id] = await o.git.fetchBaseTip(repo.checkout, repo.baseBranch);
    } catch (error) {
      throw new StoryBaseError("fetch", repo, storyBase, error);
    }
  }
  const kept = await o.record(bases);
  for (const repo of o.repos) {
    const sha = Object.hasOwn(kept, repo.id) ? kept[repo.id] : bases[repo.id];
    try {
      await o.git.pushStoryBase(repo.checkout, storyBase, sha);
    } catch (error) {
      throw new StoryBaseError("push", repo, storyBase, error);
    }
  }
  await o.open();
}
