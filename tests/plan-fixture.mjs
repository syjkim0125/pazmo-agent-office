// Scripted team PM/Lead output for planner tests; never live model evidence.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

/**
 * A PlanLink that records its calls in `calls` as [name, call, ...args]. `lease` is what `next` answers until a
 * result is taken (the Hub ends the lease then); `nextError` makes every `next` throw; `on.heartbeat` / `on.result`
 * run before the call answers (throw to refuse it). Task 6 never publishes, opens or reads a Story.
 */
export function fakePlanLink(repoId, calls, name = repoId) {
  const link = {
    repoId,
    lease: null,
    nextError: null,
    on: {},
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
    publish: async () => assert.fail("publish is not a PM step's"),
    open: async () => assert.fail("open is not a PM step's"),
    story: async () => assert.fail("story is not a PM step's"),
  };
  return link;
}

/** A Hub error as hubCall throws it. */
export const hubError = (status, code) => Object.assign(new Error(code ?? `HTTP ${status}`), { status, code });

/**
 * The host git of a planning tree without git: every checkout's base tip is one commit, its listing is
 * `listings[checkout]` (one README.md otherwise), and extracting writes those files. `hold`, when set, is awaited
 * before each fetch.
 */
export function fakePlanGit(listings = {}) {
  const g = {
    calls: [],
    hold: null,
    async fetchBaseTip(checkout, base) {
      g.calls.push(["fetchBaseTip", checkout, base]);
      if (g.hold) await g.hold;
      return "a".repeat(40);
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
