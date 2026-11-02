import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import { runCommand } from "../src/runners/command.ts";
import { ensurePr, findPr, mergePr } from "../src/team/pr.ts";

const REMOTE = "github.example.com/team/be";
const BASE = "feature/story-1/base";
const HEAD = "feature/story-1/task-2";
const SHA = "a".repeat(40);
const MERGED_AT = "b".repeat(40);
const URL = "https://github.example.com/team/be/pull/7";

/** The branches a Story Task PR runs between, as `gh pr view` names them. */
const REFS = { baseRefName: BASE, headRefName: HEAD };
const REFS_JSON = `"baseRefName":"${BASE}","headRefName":"${HEAD}"`;
const VIEW = ["pr", "view", "7", "-R", REMOTE, "--json", "state,mergeCommit,baseRefName,headRefName"];
const pr = (state, extra = {}) => ({ number: 7, url: URL, state, mergeCommit: null, ...extra });
const oid = (value) => ({ oid: value });

/** An empty HOME and a PATH whose `gh` is a `#!/bin/sh` fake. Every call's argv is appended to `calls()`,
 * so the order and the exact arguments can be asserted; `body` decides what the fake prints. */
function world(body = "exit 0") {
  const root = mkdtempSync(join(tmpdir(), "pazmo-team-pr-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  const log = join(root, "calls");
  // Arguments are NUL-terminated and a call ends with an extra NUL, so a multi-line --body stays one argument.
  const record = `printf '%s\\0' "$@" >> ${JSON.stringify(log)}\nprintf '\\0' >> ${JSON.stringify(log)}`;
  const w = {
    root,
    home,
    log,
    // The fake needs cat/touch, so the system dirs ride along on the injected PATH.
    pathEnv: `${bin}:/usr/bin:/bin`,
    env: (extra = {}) => ({ home, pathEnv: w.pathEnv, ...extra }),
    file: (name, content) => {
      const path = join(root, name);
      writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
      return path;
    },
    setGh: (script) => {
      writeFileSync(join(bin, "gh"), `#!/bin/sh\n${record}\n${script}\n`);
      chmodSync(join(bin, "gh"), 0o755);
    },
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\0\0")
            .filter(Boolean)
            .map((call) => call.split("\0"))
        : [],
  };
  w.setGh(body);
  return w;
}

/** A fake `gh` that answers by its first two arguments from the `answers` files (each printed as is). */
const answering = (w, answers) =>
  w.setGh(
    `case "$1 $2" in\n${Object.entries(answers)
      .map(([key, script]) => `"${key}") ${script} ;;`)
      .join("\n")}\n*) echo "unexpected: $*" >&2; exit 9 ;;\nesac`,
  );
const say = (path) => `cat ${JSON.stringify(path)}`;

/** A `run` that records what the runner was given and delegates to the real one. */
function spy() {
  const seen = [];
  return {
    seen,
    run: (exe, argv, options) => {
      seen.push({ exe, argv, options });
      return runCommand(exe, argv, options);
    },
  };
}

const gone = (code, message) => (error) => {
  assert.ok(error instanceof OfficeError, String(error));
  assert.equal(error.code, code);
  if (message instanceof RegExp) assert.match(error.message, message);
  else if (message !== undefined) assert.equal(error.message, message);
  return true;
};

const LIST = ["pr", "list", "-R", REMOTE, "--head", HEAD, "--base", BASE, "--state", "all", "--json", "number,url,state,mergeCommit"];
const CREATE = ["pr", "create", "-R", REMOTE, "--base", BASE, "--head", HEAD, "--title", "Task 2: coupons", "--body", "- one\n- two\n\n# not a flag"];
const PARAMS = { base: BASE, head: HEAD, title: "Task 2: coupons", body: "- one\n- two\n\n# not a flag" };

test("ensurePr reuses an open or merged PR of the same head and base", async () => {
  const open = world();
  answering(open, { "pr list": say(open.file("list", [pr("CLOSED"), pr("OPEN")])) });
  assert.deepEqual(await ensurePr(REMOTE, PARAMS, open.env()), pr("OPEN"));
  assert.deepEqual(open.calls(), [LIST], "found it with one list, so nothing was created");

  const merged = world();
  answering(merged, {
    "pr list": say(merged.file("list", [pr("MERGED", { mergeCommit: oid(MERGED_AT.toUpperCase()) })])),
  });
  assert.deepEqual(await ensurePr(REMOTE, PARAMS, merged.env()), pr("MERGED", { mergeCommit: MERGED_AT }));
  assert.deepEqual(merged.calls(), [LIST]);
});

test("ensurePr prefers the open PR over a merged one", async () => {
  const w = world();
  answering(w, {
    "pr list": say(
      w.file("list", [
        pr("MERGED", { number: 3, mergeCommit: oid(MERGED_AT) }),
        pr("OPEN", { number: 9 }),
      ]),
    ),
  });
  assert.equal((await ensurePr(REMOTE, PARAMS, w.env())).number, 9);
});

test("ensurePr creates one with -R <host>/<owner>/<repo> --base --head, then reads it back", async () => {
  const w = world();
  const mark = join(w.root, "created");
  answering(w, {
    "pr list": `if [ -e ${JSON.stringify(mark)} ]; then ${say(w.file("after", [pr("OPEN")]))}; else echo '[]'; fi`,
    "pr create": `: > ${JSON.stringify(mark)}; echo ${URL}`,
  });
  assert.deepEqual(await ensurePr(REMOTE, PARAMS, w.env()), pr("OPEN"));
  assert.deepEqual(w.calls(), [LIST, CREATE, LIST]);
});

test("ensurePr never opens a new PR over one closed without merging: it returns the newest closed one", async () => {
  const w = world();
  answering(w, {
    "pr list": say(w.file("list", [pr("CLOSED", { number: 4 }), pr("CLOSED", { number: 11 }), pr("CLOSED", { number: 6 })])),
    "pr create": "echo created",
  });
  assert.deepEqual(await ensurePr(REMOTE, PARAMS, w.env()), pr("CLOSED", { number: 11 }));
  assert.deepEqual(w.calls(), [LIST], "closing the PR is a person's stop: nothing is created");

  // An open or merged PR still comes before any closed one.
  const reopened = world();
  answering(reopened, { "pr list": say(reopened.file("list", [pr("CLOSED", { number: 11 }), pr("OPEN", { number: 4 })])) });
  assert.equal((await ensurePr(REMOTE, PARAMS, reopened.env())).number, 4);
  const merged = world();
  answering(merged, { "pr list": say(merged.file("list", [pr("CLOSED", { number: 11 }), pr("MERGED", { number: 4, mergeCommit: oid(MERGED_AT) })])) });
  assert.equal((await ensurePr(REMOTE, PARAMS, merged.env())).number, 4);
});

test("ensurePr fails when the PR it created cannot be found again", async () => {
  const w = world();
  answering(w, { "pr list": "echo '[]'", "pr create": `echo ${URL}` });
  await assert.rejects(ensurePr(REMOTE, PARAMS, w.env()), gone("GH_FAILED", /could not be found/));
});

test("a bad remote, base, head or Story pairing is INVALID and gh is never run", async () => {
  const w = world();
  const { seen, run } = spy();
  const cases = [
    [`https://user:secret@${REMOTE}`, PARAMS],
    [`user:secret@${REMOTE}`, PARAMS],
    ["github.example.com/team", PARAMS],
    ["github.example.com/team/be/extra", PARAMS],
    ["GitHub.Example.com/team/be", PARAMS],
    ["-x.example.com/team/be", PARAMS],
    [REMOTE, { ...PARAMS, base: "main" }],
    [REMOTE, { ...PARAMS, base: "feature/story-1/task-1" }],
    [REMOTE, { ...PARAMS, base: `${BASE}\n` }],
    [REMOTE, { ...PARAMS, base: "feature/story-1/base/../x" }],
    [REMOTE, { ...PARAMS, head: "main" }],
    [REMOTE, { ...PARAMS, head: "feature/story-1/base" }],
    [REMOTE, { ...PARAMS, head: "--head=x" }],
    [REMOTE, { ...PARAMS, head: "feature/story-1/task-2/x" }],
    [REMOTE, { ...PARAMS, head: "feature/story-2/task-2" }],
  ];
  for (const [remote, params] of cases)
    await assert.rejects(ensurePr(remote, params, w.env({ run })), gone("INVALID"), `${remote} ${params.base} ${params.head}`);
  assert.equal(seen.length, 0);
  assert.deepEqual(w.calls(), []);
});

test("mergePr passes --merge --match-head-commit and returns the lowercase 40-hex merge commit", async () => {
  const w = world();
  const mark = join(w.root, "merged");
  answering(w, {
    "pr view": `if [ -e ${JSON.stringify(mark)} ]; then ${say(w.file("after", { mergeCommit: oid(MERGED_AT.toUpperCase()) }))}; else ${say(w.file("before", { state: "OPEN", mergeCommit: null, ...REFS }))}; fi`,
    "pr merge": `: > ${JSON.stringify(mark)}`,
  });
  assert.deepEqual(await mergePr(REMOTE, { number: 7, headSha: SHA }, w.env()), { mergeCommit: MERGED_AT });
  assert.deepEqual(w.calls(), [
    VIEW,
    ["pr", "merge", "7", "-R", REMOTE, "--merge", "--match-head-commit", SHA],
    ["pr", "view", "7", "-R", REMOTE, "--json", "mergeCommit"],
  ]);
});

test("mergePr accepts a 64-hex merge commit from a sha256 repository", async () => {
  const w = world();
  const long = "c".repeat(64);
  const mark = join(w.root, "merged");
  answering(w, {
    "pr view": `if [ -e ${JSON.stringify(mark)} ]; then ${say(w.file("after", { mergeCommit: oid(long) }))}; else echo '{"state":"OPEN","mergeCommit":null,${REFS_JSON}}'; fi`,
    "pr merge": `: > ${JSON.stringify(mark)}`,
  });
  assert.deepEqual(await mergePr(REMOTE, { number: 7, headSha: "d".repeat(64) }, w.env()), { mergeCommit: long });
});

test("mergePr on a PR that is already merged returns its merge commit without merging again", async () => {
  const w = world();
  answering(w, { "pr view": say(w.file("view", { state: "MERGED", mergeCommit: oid(MERGED_AT), ...REFS })) });
  assert.deepEqual(await mergePr(REMOTE, { number: 7, headSha: SHA }, w.env()), { mergeCommit: MERGED_AT });
  assert.deepEqual(w.calls(), [VIEW]);
});

test("mergePr fails GH_FAILED when the merge commit is missing or not hex", async () => {
  for (const [label, mergeCommit] of [
    ["null (held by a merge queue)", null],
    ["not hex", oid("not-a-commit")],
    ["too short", oid("abc123")],
    ["wrong length", oid("a".repeat(41))],
    ["no oid", {}],
  ]) {
    const w = world();
    const mark = join(w.root, "merged");
    answering(w, {
      "pr view": `if [ -e ${JSON.stringify(mark)} ]; then ${say(w.file("after", { mergeCommit }))}; else echo '{"state":"OPEN","mergeCommit":null,${REFS_JSON}}'; fi`,
      "pr merge": `: > ${JSON.stringify(mark)}`,
    });
    await assert.rejects(mergePr(REMOTE, { number: 7, headSha: SHA }, w.env()), gone("GH_FAILED", /no merge commit/), label);
  }
  const merged = world();
  answering(merged, { "pr view": `echo '{"state":"MERGED","mergeCommit":null,${REFS_JSON}}'` });
  await assert.rejects(mergePr(REMOTE, { number: 7, headSha: SHA }, merged.env()), gone("GH_FAILED", /no merge commit/));
  assert.equal(merged.calls().length, 1, "an already merged PR is never merged again");
});

test("mergePr rejects a bad PR number or head sha as INVALID without running gh", async () => {
  const w = world();
  const { seen, run } = spy();
  for (const bad of [
    { number: 0, headSha: SHA },
    { number: -1, headSha: SHA },
    { number: 1.5, headSha: SHA },
    { number: 7, headSha: "abc123" },
    { number: 7, headSha: SHA.toUpperCase() },
    { number: 7, headSha: "--delete-branch" },
    { number: 7, headSha: "" },
  ])
    await assert.rejects(mergePr(REMOTE, bad, w.env({ run })), gone("INVALID"), JSON.stringify(bad));
  await assert.rejects(mergePr(`https://u:p@${REMOTE}`, { number: 7, headSha: SHA }, w.env({ run })), gone("INVALID"));
  assert.equal(seen.length, 0);
});

test("findPr reads the open, merged or else newest closed PR of a head and base and never creates one", async () => {
  const merged = world();
  answering(merged, { "pr list": say(merged.file("list", [pr("CLOSED", { number: 3 }), pr("MERGED", { mergeCommit: oid(MERGED_AT) })])) });
  assert.deepEqual(await findPr(REMOTE, { base: BASE, head: HEAD }, merged.env()), pr("MERGED", { mergeCommit: MERGED_AT }));
  assert.deepEqual(merged.calls(), [LIST]);

  const closed = world();
  answering(closed, { "pr list": say(closed.file("list", [pr("CLOSED", { number: 3 }), pr("CLOSED")])) });
  assert.deepEqual(await findPr(REMOTE, { base: BASE, head: HEAD }, closed.env()), pr("CLOSED"), "the newest closed one");
  assert.deepEqual(closed.calls(), [LIST], "nothing is created");

  const none = world();
  answering(none, { "pr list": "echo '[]'" });
  assert.equal(await findPr(REMOTE, { base: BASE, head: HEAD }, none.env()), null);
  assert.deepEqual(none.calls(), [LIST], "nothing is created");

  const { seen, run } = spy();
  for (const [remote, p] of [
    [`https://u:p@${REMOTE}`, { base: BASE, head: HEAD }],
    [REMOTE, { base: "main", head: HEAD }],
    [REMOTE, { base: BASE, head: "feature/story-2/task-2" }],
  ])
    await assert.rejects(findPr(remote, p, none.env({ run })), gone("INVALID"), `${remote} ${p.base} ${p.head}`);
  assert.equal(seen.length, 0);
});

test("ensurePr refuses an empty title or body, or one with a NUL character, as INVALID and never runs gh", async () => {
  const w = world();
  const { seen, run } = spy();
  for (const bad of [
    { title: "" },
    { title: "   " },
    { title: "Task 2\0: coupons" },
    { body: "" },
    { body: "\n\n" },
    { body: "- one\0- two" },
    { title: undefined },
    { body: 7 },
  ])
    await assert.rejects(ensurePr(REMOTE, { ...PARAMS, ...bad }, w.env({ run })), gone("INVALID", /title|body/), JSON.stringify(bad));
  assert.equal(seen.length, 0);
  assert.deepEqual(w.calls(), []);
});

test("mergePr merges only a Task branch into its own Story base: other branches are INVALID and never merged", async () => {
  for (const [label, refs] of [
    ["base is main", { baseRefName: "main", headRefName: HEAD }],
    ["base is another Task branch", { baseRefName: "feature/story-1/task-1", headRefName: HEAD }],
    ["head of another Story", { baseRefName: BASE, headRefName: "feature/story-2/task-2" }],
    ["head is the Story base", { baseRefName: BASE, headRefName: BASE }],
    ["head is main", { baseRefName: BASE, headRefName: "main" }],
    ["no branch names", {}],
    ["names that are not text", { baseRefName: 1, headRefName: ["x"] }],
  ]) {
    for (const state of ["OPEN", "MERGED"]) {
      const w = world();
      answering(w, {
        "pr view": say(w.file("view", { state, mergeCommit: state === "MERGED" ? oid(MERGED_AT) : null, ...refs })),
        "pr merge": "exit 0",
      });
      await assert.rejects(
        mergePr(REMOTE, { number: 7, headSha: SHA }, w.env()),
        gone("INVALID", /Story/),
        `${label} (${state})`,
      );
      assert.deepEqual(w.calls(), [VIEW], `${label} (${state}): only the view ran`);
    }
  }
});

test("a gh failure is GH_FAILED with the first stderr line", async () => {
  const w = world(`printf '\\n  X Pull request #7 is not mergeable\\nsecond line\\n' >&2\nexit 1`);
  await assert.rejects(
    mergePr(REMOTE, { number: 7, headSha: SHA }, w.env()),
    gone("GH_FAILED", "X Pull request #7 is not mergeable"),
  );
  await assert.rejects(ensurePr(REMOTE, PARAMS, w.env()), gone("GH_FAILED", "X Pull request #7 is not mergeable"));
});

test("the stderr line is cut to 160 characters, and an empty stderr still names the command", async () => {
  const long = world(`printf '%s\\n' ${"x".repeat(300)} >&2\nexit 1`);
  await assert.rejects(
    ensurePr(REMOTE, PARAMS, long.env()),
    (error) => gone("GH_FAILED")(error) && error.message === "x".repeat(160),
  );
  const quiet = world("exit 3");
  await assert.rejects(ensurePr(REMOTE, PARAMS, quiet.env()), gone("GH_FAILED", "gh pr list failed (exit 3)."));
});

test("unreadable gh output is GH_FAILED", async () => {
  for (const out of ["not json", "{}", '[{"number":"7","url":"u","state":"OPEN"}]', '[{"number":7,"url":"u","state":"DRAFT"}]', "[null]"]) {
    const w = world(`printf '%s' '${out}'`);
    await assert.rejects(ensurePr(REMOTE, PARAMS, w.env()), gone("GH_FAILED"), out);
  }
  const view = world("echo 'not json'");
  await assert.rejects(mergePr(REMOTE, { number: 7, headSha: SHA }, view.env()), gone("GH_FAILED"));
});

test("a missing gh, a relative PATH entry and a timeout are GH_FAILED", async () => {
  const w = world();
  const empty = join(w.root, "empty");
  mkdirSync(empty);
  await assert.rejects(
    ensurePr(REMOTE, PARAMS, { home: w.home, pathEnv: empty }),
    gone("GH_FAILED", "gh was not found on PATH."),
  );
  // A relative entry would resolve against whatever folder Office runs in, so gh is not taken from it.
  await assert.rejects(
    ensurePr(REMOTE, PARAMS, { home: w.home, pathEnv: "bin:." }),
    gone("GH_FAILED", "gh was not found on PATH."),
  );
  const timedOut = async () => ({ exitCode: null, signal: null, stdout: "", stderr: "", timedOut: true, error: "TIMEOUT" });
  await assert.rejects(ensurePr(REMOTE, PARAMS, w.env({ run: timedOut })), gone("GH_FAILED", "gh pr list timed out."));
  const broken = async () => ({ exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false, error: "ENOENT" });
  await assert.rejects(mergePr(REMOTE, { number: 7, headSha: SHA }, w.env({ run: broken })), gone("GH_FAILED", /ENOENT/));
});

test("env is exactly HOME, PATH, LANG, GH_PROMPT_DISABLED, with a 60 s limit and the absolute gh", async () => {
  const w = world();
  answering(w, {
    "pr list": say(w.file("list", [pr("OPEN")])),
    "pr view": `echo '{"state":"MERGED","mergeCommit":{"oid":"${MERGED_AT}"},${REFS_JSON}}'`,
  });
  const { seen, run } = spy();
  await ensurePr(REMOTE, PARAMS, w.env({ run }));
  await mergePr(REMOTE, { number: 7, headSha: SHA }, w.env({ run }));
  assert.equal(seen.length, 2);
  for (const { exe, options } of seen) {
    assert.equal(exe, join(w.root, "bin", "gh"));
    assert.deepEqual(options.env, { HOME: w.home, PATH: w.pathEnv, LANG: "C", GH_PROMPT_DISABLED: "1" });
    assert.equal(options.timeoutMs, 60000);
    assert.ok(Number.isInteger(options.maxBytes) && options.maxBytes > 0);
  }
});

test("a token in Office's own environment never reaches the gh process", async () => {
  const w = world();
  const dump = join(w.root, "env");
  answering(w, { "pr list": `env > ${JSON.stringify(dump)}; echo '[]'; ` , "pr create": "exit 0" });
  const before = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_HOST: process.env.GH_HOST };
  process.env.GH_TOKEN = "tok-from-office";
  process.env.GITHUB_TOKEN = "tok-from-office";
  process.env.GH_HOST = "evil.example.com";
  try {
    await assert.rejects(ensurePr(REMOTE, PARAMS, w.env()), gone("GH_FAILED"));
  } finally {
    for (const [key, value] of Object.entries(before))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
  const names = readFileSync(dump, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("=")[0])
    .filter((name) => !["PWD", "SHLVL", "_", "OLDPWD"].includes(name));
  assert.deepEqual(names.toSorted(), ["GH_PROMPT_DISABLED", "HOME", "LANG", "PATH"]);
});
