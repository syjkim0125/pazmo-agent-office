// Scripted team PM/Lead output for planner tests; never live model evidence.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OfficeError } from "../src/cli/project.ts";

/**
 * The observation of one closed model turn over `packet` whose final message is `body` with the packet's
 * version and digest, in the stdout shape `planning-coordinator.test.mjs` uses. A Lead turn first shows a
 * readonly command on the snapshot, the way Lead nodes ground their split.
 */
export function turn(packet, body) {
  return {
    closed: true,
    result: {
      exitCode: 0,
      signal: null,
      timedOut: false,
      error: null,
      stderr: "",
      stdout: [
        { type: "turn.started" },
        ...(packet.role === "lead"
          ? [
              {
                type: "item.completed",
                item: {
                  type: "command_execution",
                  command: "/bin/bash -lc 'ls /candidate/tree'",
                  exit_code: 0,
                  status: "completed",
                },
              },
            ]
          : []),
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({ version: 1, inputDigest: packet.inputDigest, ...body }),
          },
        },
        { type: "turn.completed" },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    },
  };
}

export const PLAN_ID = "6f1c2d3e-4a5b-4c6d-8e7f-001122334455";
export const BE = "0a1b2c3d-1111-4222-8333-444455556666";
export const FE = "9f8e7d6c-1111-4222-8333-444455556666";

/** A plan record as `plan-next` hands it out: a queued normal-risk plan over app-be (main) and app-fe (develop). */
export function planRecord(over = {}) {
  return {
    id: PLAN_ID,
    projectId: "p-1",
    plMemberId: "m-pl",
    title: "주문 내역 화면",
    intent: "주문 내역 화면을 만들고 싶습니다.\n고객은 지난 주문을 봅니다.",
    risk: "normal",
    state: "queued",
    rounds: [],
    draft: null,
    rewrite: null,
    design: null,
    split: null,
    g1: null,
    g3: null,
    repos: [
      { id: BE, name: "app-be", baseBranch: "main" },
      { id: FE, name: "app-fe", baseBranch: "develop" },
    ],
    published: null,
    ...over,
  };
}
export const leaseOf = (plan, { leaseId = "lease-1", revision = 1 } = {}) => ({ leaseId, revision, plan });

/** An answered question round, as the Hub keeps it. */
export const round = (text, answer, { blocking = false, id = "Q1" } = {}) => ({
  questions: [{ id, text, reason: "범위가 바뀝니다.", blocking }],
  answers: [{ id, answer }],
});

/** The project repos of `planRecord`, as the Hub names them in a Story's branches. */
const REPOS = {
  [BE]: { name: "app-be", baseBranch: "main" },
  [FE]: { name: "app-fe", baseBranch: "develop" },
};

/**
 * A PlanLink that records its calls in `calls` as [name, call, ...args]. `lease` is what `next` answers until a
 * result is taken (the Hub ends the lease then); `nextError` makes every `next` throw; `on.<call>` runs before the
 * call answers (throw to refuse it). The Story routes keep the Hub's rules over `stories` (storyId -> { id, number,
 * key, state, input }): `publish` answers `already: true` for a key it has and numbers a new Story, a draft, from
 * `nextNumber`; `open` takes only a draft (409 STATE otherwise); `story` names one branch per repo of the Story's
 * tasks and Story checks (`feature/story-<N>/base`); `cancel` refuses a cancelled Story (409 STATE).
 */
export function fakePlanLink(repoId, calls, name = repoId) {
  const found = (storyId) => {
    const story = link.stories.get(storyId);
    if (!story) throw hubError(404, "NOT_FOUND");
    return story;
  };
  const link = {
    repoId,
    lease: null,
    nextError: null,
    on: {},
    stories: new Map(),
    nextNumber: 7,
    async next() {
      calls.push([name, "next"]);
      if (link.nextError) throw link.nextError;
      return link.lease;
    },
    async heartbeat(planId, leaseId) {
      calls.push([name, "heartbeat", planId, leaseId]);
      await link.on.heartbeat?.();
    },
    async result(planId, leaseId, revision, r) {
      calls.push([name, "result", planId, leaseId, revision, r]);
      await link.on.result?.(r);
      link.lease = null;
    },
    async publish(input) {
      calls.push([name, "publish", input]);
      await link.on.publish?.(input);
      const prior = [...link.stories.values()].find((story) => story.key === input.key);
      if (prior) return { storyId: prior.id, number: prior.number, already: true };
      const number = link.nextNumber++;
      const story = { id: `story-${number}`, number, key: input.key, state: "draft", input };
      link.stories.set(story.id, story);
      return { storyId: story.id, number, already: false };
    },
    async open(storyId) {
      calls.push([name, "open", storyId]);
      await link.on.open?.(storyId);
      const story = found(storyId);
      if (story.state !== "draft") throw hubError(409, "STATE");
      story.state = "open";
    },
    async story(storyId) {
      calls.push([name, "story", storyId]);
      await link.on.story?.(storyId);
      const story = found(storyId);
      const used = new Set([...story.input.graph.nodes.map((n) => n.repoId), ...story.input.storyVerify.map((v) => v.repoId)]);
      const branches = [...used]
        .map((id) => ({ repoId: id, repoName: REPOS[id].name, baseBranch: REPOS[id].baseBranch, storyBase: `feature/story-${story.number}/base` }))
        .sort((a, b) => a.repoName.localeCompare(b.repoName));
      return { id: story.id, number: story.number, state: story.state, title: story.input.title, body: story.input.body, risk: story.input.risk, branches, tasks: [] };
    },
    async cancel(storyId) {
      calls.push([name, "cancel", storyId]);
      await link.on.cancel?.(storyId);
      const story = found(storyId);
      if (story.state === "cancelled") throw hubError(409, "STATE");
      story.state = "cancelled";
    },
  };
  return link;
}

/** A Hub error as hubCall throws it. */
export const hubError = (status, code) => Object.assign(new Error(code ?? `HTTP ${status}`), { status, code });

/**
 * The host git of a planning tree without git: a checkout's base tip is `tips[checkout]` ("a" * 40 otherwise), its
 * listing is `listings[checkout]` (one README.md otherwise), and extracting writes those files. `hold`, when set, is
 * awaited before each fetch. `pushStoryBase` keeps the origins' Story bases in `remote` ("<checkout> <base>" -> sha):
 * a new base is created, the same commit is exists, another commit BASE_EXISTS; `on.pushStoryBase` runs first (throw
 * to refuse it).
 */
export function fakePlanGit(listings = {}) {
  const g = {
    calls: [],
    hold: null,
    tips: {},
    remote: {},
    on: {},
    async fetchBaseTip(checkout, base) {
      g.calls.push(["fetchBaseTip", checkout, base]);
      if (g.hold) await g.hold;
      return g.tips[checkout] ?? "a".repeat(40);
    },
    async listTree(checkout) {
      g.calls.push(["listTree", checkout]);
      return (listings[checkout] ?? [{ path: "README.md" }]).map(({ path, size = 1 }) => ({ path, size, link: false }));
    },
    async extractTree(checkout, _sha, target) {
      g.calls.push(["extractTree", checkout, target]);
      for (const { path, content = "x" } of listings[checkout] ?? [{ path: "README.md" }]) {
        const file = join(target, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
    },
    async pushStoryBase(checkout, storyBase, sha) {
      g.calls.push(["pushStoryBase", checkout, storyBase, sha]);
      await g.on.pushStoryBase?.(checkout, storyBase, sha);
      const key = `${checkout} ${storyBase}`;
      if (g.remote[key] === undefined) {
        g.remote[key] = sha;
        return "created";
      }
      if (g.remote[key] === sha) return "exists";
      throw new OfficeError("BASE_EXISTS", `레포에 ${storyBase}가 이미 다른 커밋으로 있습니다. 그 브랜치를 확인한 뒤 다시 시도하세요.`);
    },
  };
  return g;
}

/**
 * A runtime's (or an engine's) `planTurn` that answers each turn with the next of `answers`: a report body, an
 * observation, or a function of (packet, candidate, signal) giving either. `state.verifying` is on while it runs, as
 * the live runtime's single run slot is. Every turn is recorded in `seen`.
 */
export function scriptedTurns(state, answers, seen = []) {
  return async (packet, candidate, signal) => {
    seen.push({ packet, candidate, signal });
    state.verifying = true;
    try {
      const answer = answers.shift();
      if (answer === undefined) throw new Error("no scripted planning answer left");
      const out = typeof answer === "function" ? await answer(packet, candidate, signal) : answer;
      return out && typeof out === "object" && "closed" in out ? out : turn(packet, out);
    } finally {
      state.verifying = false;
    }
  };
}
