import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClaudeStream } from "../src/runners/claude-profile.ts";
import { runnerAccountProblem, runnerNotReady } from "../src/runners/runner-account.ts";

const lines = (...events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
// What claude 2.1.280 said on 2026-11-02 when the account had hit its limit (the real check's Engineer runs).
const LIMIT =
  "You've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit · your weekly limit resets 4am (Asia/Seoul)";
const init = { type: "system", subtype: "init" };
/** The reply claude makes up itself when the API refused the turn: `error` names why (2.1.280 stream-json). */
const refused = (error, text) => ({
  type: "assistant",
  message: { model: "<synthetic>", content: [{ type: "text", text }] },
  error,
});
const failedResult = (text) => ({ type: "result", subtype: "success", is_error: true, result: text });
const claude = (...events) => runnerAccountProblem(normalizeClaudeStream(lines(init, ...events)));

test("claude's own error kind on its refused reply is the signal: limit, billing and login, with the limit's reset time", () => {
  const resetsAt = 1_762_196_400;
  assert.deepEqual(
    claude(
      { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "seven_day" } },
      refused("rate_limit", LIMIT),
      failedResult(LIMIT),
    ),
    { runner: "claude", kind: "limit", message: LIMIT, resetsAt: resetsAt * 1000 },
  );
  assert.deepEqual(claude(refused("billing_error", "Credit balance is too low"), failedResult("x")), {
    runner: "claude",
    kind: "billing",
    message: "Credit balance is too low",
    resetsAt: null,
  });
  assert.deepEqual(claude(refused("authentication_failed", "OAuth token has expired"), failedResult("x")), {
    runner: "claude",
    kind: "login",
    message: "OAuth token has expired",
    resetsAt: null,
  });
  // A limit event that still allows the turn says nothing about when a refusal ends.
  assert.equal(
    claude(
      { type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt } },
      refused("rate_limit", LIMIT),
      failedResult(LIMIT),
    ).resetsAt,
    null,
  );
});

test("claude's reset time is read as seconds, or as ms when it already is, rounded up to whole ms; anything else is none", () => {
  const rejected = (resetsAt) => ({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt } });
  const resetOf = (event) => claude(event, refused("rate_limit", LIMIT), failedResult(LIMIT)).resetsAt;
  assert.equal(resetOf(rejected(1_762_196_400_000)), 1_762_196_400_000);
  assert.equal(resetOf(rejected(1_762_196_400.0004)), 1_762_196_400_001, "a whole number of ms, which a stored wait needs");
  for (const resetsAt of [0, -1, "soon", null, Infinity]) assert.equal(resetOf(rejected(resetsAt)), null, String(resetsAt));
  assert.equal(resetOf({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }), null);
});

test("a refused reply claude went on from is not the turn's end: only a refusal that is its last reply counts", () => {
  assert.equal(
    claude(refused("rate_limit", LIMIT), { type: "assistant", message: { content: [{ type: "text", text: "Retrying." }] } }, failedResult("x")),
    null,
  );
  assert.equal(claude({ type: "assistant", message: { content: [{ type: "text", text: "Reading." }] } }, refused("rate_limit", LIMIT), failedResult(LIMIT)).kind, "limit");
  // Nor does the reset time of a limit claude went on from.
  const old = { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1_762_196_400 } };
  const reply = { type: "assistant", message: { content: [{ type: "text", text: "Retrying." }] } };
  assert.equal(claude(old, refused("rate_limit", LIMIT), reply, refused("rate_limit", LIMIT), failedResult(LIMIT)).resetsAt, null);
});

test("other claude failures are the work's, not the account's", () => {
  for (const kind of ["server_error", "invalid_request", "unknown", "max_output_tokens"])
    assert.equal(claude(refused(kind, "API Error: 500"), failedResult("x")), null, kind);
  // A failed turn with no kind, a crash, a turn that went on to complete.
  assert.equal(claude({ type: "assistant", message: { content: [{ type: "text", text: LIMIT }] } }, failedResult(LIMIT)), null);
  assert.equal(claude(), null);
  assert.equal(
    claude(refused("rate_limit", LIMIT), { type: "assistant", message: { content: [{ type: "text", text: "{}" }] } }, {
      type: "result",
      subtype: "success",
      is_error: false,
    }),
    null,
  );
});

test("the words alone are not the signal: the real check's stored output, recorded without the kind, is not an account problem", () => {
  const stored = lines(
    { type: "turn.started" },
    { type: "item.completed", item: { type: "agent_message", text: LIMIT } },
    { type: "turn.failed" },
  );
  assert.equal(runnerAccountProblem(stored), null);
});

const codex = (...events) => runnerAccountProblem(lines({ type: "thread.started", thread_id: "t" }, { type: "turn.started" }, ...events));
const turnFailed = (message) => ({ type: "turn.failed", error: { message } });

test("codex's failure event wording is the signal: usage limit, credits or quota, and a login that cannot be refreshed", () => {
  const cases = [
    ["Usage limit reached. You've reached your usage limit. Increase your limits to continue using codex.", "limit"],
    ["You’ve hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again in 2 days 3 hours.", "limit"],
    ["exceeded retry limit, last status: 429 Too Many Requests", "limit"],
    ["You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at 3:04 PM.", "limit"],
    ["You're out of credits. Your workspace is out of credits. Add credits to continue using Codex.", "billing"],
    ["Quota exceeded. Check your plan and billing details.", "billing"],
    ["unexpected status 429 Too Many Requests: insufficient_quota: You exceeded your current quota, please check your plan and billing details.", "billing"],
    ["To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus", "billing"],
    [
      "Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.",
      "login",
    ],
    ["unexpected status 401 Unauthorized: Missing bearer or basic authentication in header", "login"],
  ];
  for (const [message, kind] of cases)
    assert.deepEqual(codex({ type: "error", message }, turnFailed(message)), { runner: "codex", kind, message, resetsAt: null }, message);
  // An error event alone, as codex may exit after it.
  assert.equal(codex({ type: "error", message: cases[0][0] }).kind, "limit");
});

test("other codex failures, and errors it recovered from, are not account problems", () => {
  assert.equal(codex(turnFailed("Selected model is at capacity. Please try a different model.")), null);
  assert.equal(codex(turnFailed("stream disconnected before completion")), null);
  assert.equal(codex({ type: "error", message: "Reconnecting... 1/5 (429 Too Many Requests)" }, { type: "turn.completed" }), null);
  // A notice codex got past, its output cut before any end: the run went on, so the notice is not why it ended.
  assert.equal(
    codex({ type: "error", message: "Reconnecting... 1/5 (429 Too Many Requests)" }, { type: "item.completed", item: { type: "reasoning", text: "…" } }),
    null,
  );
  assert.equal(codex({ type: "item.completed", item: { type: "agent_message", text: "usage limit" } }, { type: "turn.failed" }), null);
});

test("the shown message is one line of at most 300 characters without control characters", () => {
  const long = `Usage limit reached.\n\u0007\t${"x".repeat(400)}\u0000`;
  const { message } = codex(turnFailed(long));
  assert.equal(message.length, 300);
  assert.match(message, /^Usage limit reached\. x+$/);
  assert.equal(runnerAccountProblem("not json\n"), null);
  assert.equal(runnerAccountProblem(""), null);
});

test("a run refused before its runner started because the runner was not ready names the runner and its hint (D39)", () => {
  const hint = "터미널에서 claude auth login을 실행하세요.";
  assert.deepEqual(runnerNotReady(`RUNNER_NOT_READY claude: ${hint}`), { runner: "claude", kind: "not_ready", message: hint, resetsAt: null });
  assert.deepEqual(runnerNotReady("RUNNER_NOT_READY codex: move\n~/.codex/AGENTS.md"), {
    runner: "codex",
    kind: "not_ready",
    message: "move ~/.codex/AGENTS.md",
    resetsAt: null,
  });
  assert.equal(runnerNotReady(`RUNNER_NOT_READY claude: ${"x".repeat(400)}`).message.length, 300);
  assert.equal(runnerNotReady("RUNNER_NOT_READY claude: ").message, "RUNNER_NOT_READY", "an empty hint still says why");
  // Any other refusal or failure is counted as before.
  for (const error of [null, "", "UNVERIFIED_CONTROLLER_BINARY", "RUNNER_QUALIFICATION_FAILED: turn-completed", "TIMEOUT", "RUNNER_NOT_READY gemini: x", "RUNNER_NOT_READY: login claude"])
    assert.equal(runnerNotReady(error), null, String(error));
});
