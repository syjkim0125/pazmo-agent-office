---
title: 사용자 설치 CLI 실행기 선택 - Plan
type: feat
date: 2026-10-02
artifact_contract: ce-unified-plan/v1
product_contract_source: workflow-story
origin: docs/understanding/pazmo-agent-office-contract.md
execution: code
---
# 사용자 설치 CLI 실행기 선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM·Lead·Developer·Reviewer가 사용자 PC에 설치·로그인된 codex 또는 claude CLI를 구독 로그인 그대로 쓰게 한다. 역할별 실행기·모델은 Office 화면에서 고르고 저장한다.

**Architecture:**
- 모델 호출은 Mac의 사용자 CLI 프로세스가 한다. 파일·명령 도구는 기존 VM exec-server 컨테이너로만 보낸다. codex는 `CODEX_EXEC_SERVER_URL`, claude는 Office stdio MCP 도구 다리를 쓴다.
- 바이너리는 (SHA, 모델) 쌍마다 로그인 없는 가짜 모델 검사를 통과해야 실행된다.
- 역할 선택은 claw `agents` 테이블에 저장하고, live job 생성 시점에 읽는다.

**Tech Stack:** Node 24 (`node:test`, TS 직접 실행), `node:sqlite`, vendored `ws`, claw-empire React/Vite(vitest), Colima VM + docker.

**Spec:** `docs/understanding/cli-runner-selection-decision.md` (G3 Approved 2026-10-02). Story M3/M4, V3/V4/V9, D15.

## Global Constraints

- 로그인 정보(`~/.codex/auth.json`, macOS 키체인)를 복사하거나 내용을 읽지 않는다. 상태는 `codex login status`, `claude auth status`로만 확인한다.
- JS 런처는 실행하지 않는다. 네이티브 바이너리만 실행하고 SHA-256을 검사한다.
- live 실행 환경에는 상위 프로세스의 `ANTHROPIC_*`, `OPENAI_*`, `CODEX_API_KEY`를 전달하지 않는다. claude live 실행은 `system/init.apiKeySource === "none"`이어야 한다(구독만 허용).
- 다른 실행기·고정 런타임·API 키로 자동 전환하지 않는다(Story O2).
- 기존 VM 경계는 바꾸지 않는다: executor Linux codex 0.154.0 SHA 고정, `/candidate/tree` 읽기 전용, 네트워크 없음, 자동 병합 금지, G1/G4.
- 다른 세션 충돌 회피:
  - `vendor/claw-empire/server/pazmo/host.ts`, `src/runtime/native-office.ts`, `useAppActions.ts`, `DecisionInboxModal.tsx`는 편집 직전에 다시 읽고 최소 줄만 바꾼다.
  - `src/runners/*` 기존 파일 수정은 `codex-profile.ts`·`codex-controller.ts`의 시그니처 확장으로 한정하고, 새 기능은 새 파일에 둔다.
- 커밋·푸시는 사용자 요청 시에만 한다. 각 Task의 "Commit" 단계는 "변경 묶음 확인(git diff --stat)"으로 대체한다.
- 테스트 결과는 X/X로 보고한다. 실행 중인 61772 Office 인스턴스는 재시작·중지하지 않는다.

## File Structure

| 파일 | 책임 |
| - | - |
| Create `src/runners/runner-discovery.ts` | PATH·알려진 위치에서 codex/claude 탐색, JS 런처 → 네이티브 해석, 버전·SHA·로그인 상태 |
| Create `src/runners/runner-models.ts` | `codex debug models --bundled`, claude `initialize` → `CliModelInfo[]` + codex 단일 모델 catalog 생성 |
| Modify `src/runners/codex-profile.ts` | 고정 모델·catalog 검사를 인자로 일반화, `suppress_unstable_features_warning` 추가, 고정 상수는 고정 모드용으로 유지 |
| Modify `src/runners/codex-controller.ts` | `codexJob`에 `{model, catalog, reasoning, sha256}` 전달 |
| Create `src/runners/claude-profile.ts` | claude 인자·환경, `system/init` 검사, stream-json → 정규 이벤트 변환 |
| Create `src/runners/claude-tool-bridge.mjs` | claude가 띄우는 stdio MCP 서버. exec relay ws로만 전달 |
| Create `src/runners/claude-controller.ts` | `claudeJob(): RemoteJob` — relay·다리·claude 프로세스 수명, init 가드 |
| Create `src/runners/runner-qualification.ts` | (runner, sha, model) 검사 실행·기록 저장/조회 |
| Create `src/runners/qualification-fixtures.ts` | 가짜 Responses/Messages 서버와 함정 HOME (기존 `scripts/codex-fixture-controller.mjs`의 qualify 부분 이전) |
| Create `src/core/runner-evidence.ts` | 실행마다 runner·버전·SHA·모델 기록 (`pazmo_runner_runs`) |
| Create `src/runtime/runner-settings.ts` | 역할 → agents 선택 읽기/검증, cli-status/cli-models 응답 |
| Modify `src/runtime/live.ts` | `LiveConfig` 확장, 역할별 job 선택, status에 역할별 runner |
| Modify `src/runtime/native-office.ts` | 강제 codex 덮어쓰기 → 기본값만, `runnerFor`·검증·조회를 bridge에 연결 |
| Modify `vendor/claw-empire/server/pazmo/host.ts` | `GET /api/cli-status`·`/api/cli-models` 위임, `PATCH /api/agents/:id` 검증 후 허용 |
| Modify `vendor/claw-empire/src/components/AgentDetail.tsx` | 관리 모드에서 codex/claude만, claude effort, 저장 오류 표시 |
| Modify `src/cli/launcher.ts`, `src/cli/index.ts` | `~/.codex/auth.json` 필수 → "하나 이상 준비됨", `--codex-runtime pinned` |
| Tests | `tests/runner-discovery.test.mjs`, `runner-models.test.mjs`, `claude-profile.test.mjs`, `claude-tool-bridge.test.mjs`, `claude-controller.test.mjs`, `runner-qualification.test.mjs`, `runner-settings.test.mjs`, 기존 `codex-profile`·`codex-controller`·`live-runtime`·`native-office`·`claw-host`·`launcher` 확장, vitest `AgentDetail.runner.test.tsx` |
| Script `scripts/qualify-runners.mjs` | 실제 VM에서 사용자 CLI 검사 + (승인된) 실제 구독 1회 실행 |

---

### Task 1: 실행기 탐색

**Files:**
- Create: `src/runners/runner-discovery.ts`
- Test: `tests/runner-discovery.test.mjs`

**Interfaces:**
- Produces:
```ts
export type RunnerName = "codex" | "claude";
export type RunnerInstall = {
  runner: RunnerName;
  status: "missing" | "unsupported" | "ready";
  path?: string;          // realpath of native binary
  version?: string;       // e.g. "0.160.0", "2.1.280"
  sha256?: string;
  loggedIn: boolean;
  hint: string;           // user-facing 한국어 안내
};
export async function discoverRunners(o: {
  pathEnv: string; home: string;
  run?: typeof runCommand;   // injectable
}): Promise<Record<RunnerName, RunnerInstall>>;
export function nativeBinary(candidate: string): string | null; // JS launcher → native, script → null
```

- [ ] **Step 1: Write failing tests.** Build a temp dir with:
  - (a) a fake `codex` launcher file `bin/codex.js` whose package layout contains `node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`. The native file is a shell script for tests; `nativeBinary` decides by path pattern, not by content.
  - (b) a `claude` symlink to a native file.
  - (c) a script-only `claude` (`#!/usr/bin/env node`) → `unsupported`.
  - Fake binaries answer `--version`. Fake `codex login status` → exit 0 "Logged in using ChatGPT". Fake `claude auth status` → `{"loggedIn":false}`.
```js
test("finds native codex behind a bun/npm launcher and reports login", async () => {
  const r = await discoverRunners({ pathEnv: fx.bin, home: fx.home });
  assert.equal(r.codex.status, "ready");
  assert.equal(r.codex.path, fx.nativeCodex);
  assert.equal(r.codex.version, "0.160.0");
  assert.match(r.codex.sha256, /^[a-f0-9]{64}$/);
  assert.equal(r.codex.loggedIn, true);
});
test("script-only claude is unsupported and never executed", async () => {
  const r = await discoverRunners({ pathEnv: fx.scriptBin, home: fx.home });
  assert.equal(r.claude.status, "unsupported");
  assert.ok(!existsSync(fx.executedMarker));
});
test("missing runner explains install and login commands", async () => {
  const r = await discoverRunners({ pathEnv: fx.empty, home: fx.home });
  assert.equal(r.claude.status, "missing");
  assert.match(r.claude.hint, /claude auth login/);
  assert.match(r.codex.hint, /codex login/);
});
test("login check never reads credential files", async () => { /* fake HOME has ~/.codex/auth.json mode 000; discovery still succeeds */ });
```
- [ ] **Step 2: Run** `node --experimental-vm-modules --test tests/runner-discovery.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
  - Candidate paths, in order: each `pathEnv` entry, `~/.bun/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.npm-global/bin`.
  - Then `realpathSync` and `nativeBinary`:
    - `…/node_modules/@openai/codex/bin/codex.js` → `…/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`, which must exist.
    - Any file whose first two bytes are `#!` → `null`.
  - `noSymlinks` on the resolved path, `digest(readStable(path, 512MiB))`, version regex `/(\d+\.\d+\.\d+)/`.
  - Login commands run with `env: { HOME: home, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" }` and a 10 s timeout:
    - codex: `login status` exit 0 → `loggedIn = true`.
    - claude: `auth status`, JSON `.loggedIn === true`.
  - hint strings:
    - codex: `"codex 설치(npm i -g @openai/codex) 후 터미널에서 codex login"`
    - claude: `"Claude Code 설치 후 터미널에서 claude auth login"`
    - unsupported: `"네이티브 설치본만 지원합니다"`
- [ ] **Step 4: Run** the same command. Expected: PASS 4/4.
- [ ] **Step 5:** `git diff --stat`.

### Task 2: 모델 목록

**Files:**
- Create: `src/runners/runner-models.ts`
- Test: `tests/runner-models.test.mjs`

**Interfaces:**
- Consumes: `RunnerInstall` (Task 1).
- Produces:
```ts
export type RunnerModel = { slug: string; displayName?: string; reasoningLevels?: { effort: string; description?: string }[]; defaultReasoningLevel?: string };
export async function codexModels(binary: string): Promise<{ models: RunnerModel[]; entries: Record<string, unknown> }>;
export async function claudeModels(binary: string): Promise<RunnerModel[]>;
export function writeCodexCatalog(dir: string, entry: unknown): { path: string; digest: string }; // {"models":[entry]}, 0600, wx
```

- [ ] **Step 1: Failing tests.**
  - Fake codex prints the fixture JSON for `debug models --bundled` (three entries: two `visibility:"list"`, one `"hide"`).
  - Fake claude reads one stdin line `{"type":"control_request",…,"subtype":"initialize"}` and prints `{"type":"control_response","response":{"subtype":"success","request_id":"init-1","response":{"models":[{"value":"sonnet","displayName":"Sonnet","supportsEffort":true,"supportedEffortLevels":["low","high"]},{"value":"haiku","displayName":"Haiku"}]}}}`.
```js
test("codex lists only visible bundled models with reasoning levels", async () => {
  const { models, entries } = await codexModels(fx.codex);
  assert.deepEqual(models.map(m => m.slug), ["gpt-a", "gpt-b"]);
  assert.equal(models[0].defaultReasoningLevel, "medium");
  assert.ok(entries["gpt-a"]);
});
test("codex model listing uses an empty private CODEX_HOME, not ~/.codex", async () => { /* fake records env CODEX_HOME; assert it is under tmpdir and removed */ });
test("claude models come from the initialize control response", async () => {
  assert.deepEqual(await claudeModels(fx.claude), [
    { slug: "sonnet", displayName: "Sonnet", reasoningLevels: [{ effort: "low" }, { effort: "high" }] },
    { slug: "haiku", displayName: "Haiku" },
  ]);
});
test("malformed catalog output yields no models", async () => { /* assert rejects with MODEL_CATALOG_INVALID */ });
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - codex: `runCommand(binary, ["debug","models","--bundled"], { env: {HOME:tmp, CODEX_HOME:tmp, PATH:"/usr/bin:/bin"}, timeoutMs: 15000, maxBytes: 8 MiB })`. Keep entries with `visibility === "list"`. Map `supported_reasoning_levels[].effort` and `default_reasoning_level`.
  - claude: spawn `[-p, --input-format, stream-json, --output-format, stream-json, --verbose, --tools, "", --strict-mcp-config, --setting-sources, "", --no-session-persistence]` with cwd = empty tmp and env = `{HOME: real home, PATH:"/usr/bin:/bin", LANG}` (no `ANTHROPIC_*`). Write the initialize request, read until the `control_response`, then kill the process group. 15 s timeout.
- [ ] **Step 4: Run.** Expected: PASS 4/4.
- [ ] **Step 5:** `git diff --stat`.

### Task 3: codex 프로필 일반화

**Files:**
- Modify: `src/runners/codex-profile.ts:10-127`, `src/runners/codex-controller.ts:57-118`
- Test: `tests/codex-profile.test.mjs`, `tests/codex-controller.test.mjs`

**Interfaces:**
- Produces:
```ts
export type CodexSelection = { binary: string; sha256: string; model: string; catalog: { path: string; digest: string }; reasoning?: string };
export const PINNED_CODEX: CodexSelection; // CONTROLLER_SHA256 + gpt-5.5 + assets catalog (기존 동작)
export function verifyControllerBinary(binary: string, sha256 = CONTROLLER_SHA256): void;
export function codexRemoteProfile(input: { home; authHome; cwd; url; selection: CodexSelection }): { args; env };
```
- [ ] **Step 1: Failing tests.**
  - The existing profile tests switch to `selection: PINNED_CODEX` and the expected args are unchanged.
  - New cases:
```js
test("a selected model must match its recorded catalog digest", () => {
  assert.throws(() => codexRemoteProfile({ ...base, selection: { ...sel, catalog: { path: sel.catalog.path, digest: "0".repeat(64) } } }), /UNVERIFIED_CONTROLLER_CATALOG/);
});
test("reasoning and warning suppression are fixed config, model comes from selection", () => {
  const { args } = codexRemoteProfile({ ...base, selection: { ...sel, reasoning: "high" } });
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes("suppress_unstable_features_warning=true"));
  assert.equal(args.at(-1), "gpt-a");
});
test("reasoning outside the catalog entry is rejected", () => { /* reasoning "ultra" not in entry → INVALID_REMOTE_CONTROLLER_PROFILE */ });
```
- [ ] **Step 2: Run** `node --experimental-vm-modules --test tests/codex-profile.test.mjs tests/codex-controller.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Replace `input.model !== CONTROLLER_MODEL` with: `selection.model` matches the single entry's `slug` in the catalog file, the catalog digest matches, and `reasoning` is listed in that entry's `supported_reasoning_levels`.
  - Keep `CONTROLLER_MODEL` exported for `PINNED_CODEX`.
  - `codexJob` options take `selection` instead of `controller`. `verifyControllerBinary(selection.binary, selection.sha256)` runs at supervise time.
- [ ] **Step 4: Run.** Expected: PASS, with all existing cases retained.
- [ ] **Step 5:** `git diff --stat`.

### Task 4: claude 프로필·init 가드·출력 변환

**Files:**
- Create: `src/runners/claude-profile.ts`
- Test: `tests/claude-profile.test.mjs`

**Interfaces:**
- Produces:
```ts
export const OFFICE_TOOLS = ["read_file", "write_file", "list_directory", "run_command"] as const;
export function claudeProfile(i: { binary: string; home: string; cwd: string; mcpConfig: string; model: string; effort?: string }): { args: string[]; env: NodeJS.ProcessEnv };
export function checkClaudeInit(event: unknown, mode: "live" | "fixture"): string | null; // null = ok, else failure code
export function normalizeClaudeStream(stdout: string): string; // codex-shaped JSONL for terminalReport
```
- [ ] **Step 1: Failing tests.**
```js
test("profile disables built-in tools and user sources, allows only office MCP", () => {
  const { args, env } = claudeProfile(base);
  for (const a of ["-p","--tools","","--strict-mcp-config","--setting-sources","","--disable-slash-commands","--no-session-persistence","--permission-mode","dontAsk","--permission-prompts","none"]) assert.ok(args.includes(a));
  assert.ok(!args.includes("--bare") && !args.includes("--safe-mode"));
  assert.equal(args[args.indexOf("--allowedTools") + 1], OFFICE_TOOLS.map(t => `mcp__office__${t}`).join(","));
  assert.deepEqual(Object.keys(env).sort(), ["HOME","LANG","PATH"]);
});
test("init guard rejects extra tools, extra MCP, non-builtin plugins, skills, hooks, api key in live", () => {
  assert.equal(checkClaudeInit(goodInit, "live"), null);
  assert.equal(checkClaudeInit({ ...goodInit, tools: [...goodInit.tools, "Bash"] }, "live"), "CLAUDE_TOOLS_UNEXPECTED");
  assert.equal(checkClaudeInit({ ...goodInit, plugins: [{ source: "x@market" }] }, "live"), "CLAUDE_PLUGIN_UNEXPECTED");
  assert.equal(checkClaudeInit({ ...goodInit, apiKeySource: "ANTHROPIC_API_KEY" }, "live"), "CLAUDE_SUBSCRIPTION_REQUIRED");
  assert.equal(checkClaudeInit({ ...goodInit, mcp_servers: [{ name: "office", status: "failed" }] }, "live"), "CLAUDE_BRIDGE_UNAVAILABLE");
});
test("stream normalizes to exactly one turn with assistant texts as agent_message", () => {
  const out = normalizeClaudeStream(fixtureStream); // init, assistant(tool_use), user(tool_result), assistant(text '{"report":1}'), result success
  assert.deepEqual(terminalReport(out, ["report"]), { report: 1 });
});
test("result error or missing result normalizes to a failed turn", () => { /* terminalReport → null */ });
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Args:** `[-p, --output-format, stream-json, --verbose, --strict-mcp-config, --mcp-config, i.mcpConfig, --tools, "", --allowedTools, OFFICE_TOOLS…, --setting-sources, "", --disable-slash-commands, --no-session-persistence, --permission-mode, dontAsk, --permission-prompts, none, --model, i.model, ...(effort ? ["--effort", effort] : [])]`. The prompt goes on stdin.
  - **Env:** `{HOME: i.home, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8"}`.
  - **Init guard:**
    - tools must equal the `mcp__office__*` set.
    - mcp_servers must be exactly `office:connected`.
    - every plugin `source` must end with `@builtin`.
    - `skills` and `slash_commands` must be empty.
    - hook events before init → fail.
    - live mode also requires `apiKeySource === "none"`.
  - **Normalization:** emit `{"type":"turn.started"}`, then one `{"type":"item.completed","item":{"type":"agent_message","text":…}}` per assistant text block, then `{"type":"turn.completed"}` only when the `result` has `subtype:"success"` and `is_error:false`. Otherwise emit `{"type":"turn.failed"}`.
- [ ] **Step 4: Run.** Expected: PASS 4/4.
- [ ] **Step 5:** `git diff --stat`.

### Task 5: claude 도구 다리 (MCP → exec relay)

**Files:**
- Create: `src/runners/claude-tool-bridge.mjs`
- Test: `tests/claude-tool-bridge.test.mjs`

**Interfaces:**
- Consumes: relay URL (`openExecRelay().url`) via argv[2]; exec-server JSON-RPC.
- Produces: an MCP stdio server named `office` with tools `read_file{path}`, `write_file{path,content}`, `list_directory{path}`, `run_command{argv:string[],timeout_ms?}`.

- [ ] **Step 1: Confirm the exact schema.** Use a disposable container and the qualified executor via `dockerClient().openExecutor`, with the same container flags as `ContainerPlanner`. Capture `environment/info`, `fs/writeFile`, `fs/readDirectory` and `process/start`/`process/read` request/response frames. Record them in `tests/fixtures/exec-server-frames.json`. Known so far: `fs/readFile {path:file-uri, sandbox:null} → {dataBase64}`, `process/start {processId, argv, cwd, env:{}, tty:false, arg0:null}`, `process/read {processId, afterSeq, maxBytes, waitMs} → {chunks[{seq,chunk(b64)}], closed, exitCode}`. `fs/writeFile` requires `dataBase64`.
- [ ] **Step 2: Failing tests.** A fake exec-server ws replays the recorded frames.
```js
test("tools translate to exec-server methods against the remote cwd", async () => {
  const s = await startBridge(fakeRelay.url);
  await s.call("write_file", { path: "src/a.ts", content: "x" });
  assert.deepEqual(fakeRelay.last("fs/writeFile").params.path, "file:///candidate/tree/src/a.ts");
});
test("paths are confined lexically to the remote cwd", async () => {
  const r = await s.call("read_file", { path: "../../etc/passwd" });
  assert.equal(r.isError, true); assert.equal(fakeRelay.count("fs/readFile"), 0);
});
test("run_command polls until closed and returns exit code and bounded output", async () => { /* … */ });
test("bridge exits when relay socket closes; never touches host fs", async () => { /* bridge started with cwd=tmp; assert no files created in tmp */ });
```
- [ ] **Step 3: Run** `node --experimental-vm-modules --test tests/claude-tool-bridge.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Newline-delimited MCP JSON-RPC (`initialize`, `tools/list`, `tools/call`) and a ws client from vendored `ws`, using the same `createRequire` path as `exec-relay.ts`.
  - On start: send `initialize`, then `initialized`, then `environment/info` to learn the remote cwd.
  - Resolve each path with `posix.resolve(cwd, p)` and reject anything outside cwd.
  - Output limits: 256 KiB per tool result; `run_command` uses the default `timeout_ms` of 120000, capped at 600000.
  - The bridge does not import `node:fs` write APIs (lint check in the test: grep the source).
- [ ] **Step 5: Run.** Expected: PASS 4/4.
- [ ] **Step 6:** `git diff --stat`.

### Task 6: claudeJob

**Files:**
- Create: `src/runners/claude-controller.ts`
- Test: `tests/claude-controller.test.mjs`

**Interfaces:**
- Consumes: `claudeProfile`, `checkClaudeInit`, `normalizeClaudeStream` (Task 4); bridge (Task 5); `openExecRelay`; `RemoteJob`.
- Produces:
```ts
export type ClaudeSelection = { binary: string; sha256: string; model: string; effort?: string };
export function claudeJob(o: { selection: ClaudeSelection; home: string; timeoutMs: number; openExecutor: (h: string) => ChildProcessWithoutNullStreams; mode?: "live" | "fixture"; env?: NodeJS.ProcessEnv }, prompt: string): RemoteJob;
```
- [ ] **Step 1: Failing tests** with a fake `claude` node script that emits scripted stream-json, a fake executor and a fake relay.
```js
test("cancelled job starts neither claude nor executor", …);
test("binary SHA mismatch fails before spawn: UNVERIFIED_RUNNER_BINARY", …);
test("bad init kills the process group before any assistant event: CLAUDE_TOOLS_UNEXPECTED", async () => { /* fake waits 2s after init then writes marker; assert marker absent, closed true */ });
test("successful stream returns normalized stdout accepted by terminalReport", …);
test("relay failure overrides exit 0", …);
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Mirror `codexJob`: staging = `mkdtemp`. Write the mcp config `{mcpServers:{office:{command: process.execPath, args:[bridgePath, relay.url]}}}` to staging with mode 0600.
  - Spawn detached with the stdin prompt and parse stdout lines. On the first `system/init`, call `checkClaudeInit`; on failure, `process.kill(-pid,"SIGKILL")`.
  - Byte limit 256 KiB (same as codex). Afterwards `normalizeClaudeStream` produces the `CommandResult.stdout`.
  - Close the relay, and remove staging only when closure is confirmed.
- [ ] **Step 4: Run.** Expected: PASS 5/5.
- [ ] **Step 5:** `git diff --stat`.

### Task 7: 처음 쓸 때 검사와 기록

**Files:**
- Create: `src/runners/qualification-fixtures.ts`, `src/runners/runner-qualification.ts`
- Test: `tests/runner-qualification.test.mjs`
- Script: `scripts/qualify-runners.mjs`

**Interfaces:**
- Produces:
```ts
export type Qualification = { runner: RunnerName; sha256: string; version: string; model: string; executorSha256: string; catalog?: { path: string; digest: string }; checks: { name: string; passed: boolean }[]; passed: boolean; at: string };
export class QualificationStore { constructor(dir: string); get(runner, sha256, model): Qualification | null; put(q: Qualification): void } // <dataDir>/runner-qualification/<runner>-<sha>-<model>.json, 0600, wx
export async function qualify(i: { install: RunnerInstall; model: string; client: ReturnType<typeof dockerClient>; executorSha256: string; store: QualificationStore; signal?: AbortSignal }): Promise<Qualification>;
```
- [ ] **Step 1: Failing unit tests** with fake runner, fake docker client and fake executor:
  - an existing record is reused without a run;
  - SHA change → new run;
  - a failed check → `passed:false` stored, and the next call reruns;
  - records are never overwritten (`wx`).
- [ ] **Step 2: Implement the fixture.** Port the `qualify` path from `scripts/codex-fixture-controller.mjs` into `qualification-fixtures.ts` and keep the script as a thin wrapper.
  - **codex checks:**
    - shell tool remote write;
    - patch remote write;
    - `environment_id=local` denied;
    - poisoned private `CODEX_HOME` (invalid `config.toml`, SessionStart hook, poisoned skill/AGENTS) not loaded and hook marker absent;
    - advertised tool names ⊆ {exec_command/shell family, apply_patch, write_stdin}.
    - The checks run with the selected model's single-entry catalog.
  - **claude checks:**
    - fake Anthropic Messages SSE server on 127.0.0.1;
    - `ANTHROPIC_BASE_URL` and a fixture `ANTHROPIC_API_KEY` only in this mode;
    - `CLAUDE_CONFIG_DIR` = poisoned temp dir (CLAUDE.md sentinel, settings with SessionStart hook, `.mcp.json` server);
    - request `tools` names equal `mcp__office__*`;
    - system prompt and messages lack the sentinel;
    - hook marker absent;
    - tool_use `run_command` writes `/candidate/tree/.q` in the container and the host marker is absent;
    - final result success.
- [ ] **Step 3: Run** `node --experimental-vm-modules --test tests/runner-qualification.test.mjs`. Expected: PASS.
- [ ] **Step 4: Real VM run (no login used).** `node --experimental-vm-modules scripts/qualify-runners.mjs --fixture-only` uses the user's codex 0.160.0 with gpt-5.5, and claude 2.1.280 with haiku. Record the X/X checks. If codex fails because of the executor 0.154.0 mismatch, record it and keep the codex installed runner locked. Do not change the executor without a new decision.
- [ ] **Step 5:** `git diff --stat`.

### Task 8: 실행 증거와 live 연결

**Files:**
- Create: `src/core/runner-evidence.ts`, `src/runtime/runner-settings.ts`
- Modify: `src/runtime/live.ts:39-44,89,313-399`, `src/runtime/native-office.ts:43-50,108-156`, `src/runtime/claw-service.ts:17`, `src/cli/lifecycle.ts:109`
- Test: `tests/runner-settings.test.mjs`, `tests/live-runtime.test.mjs`, `tests/native-office.test.mjs`

**Interfaces:**
- Produces:
```ts
export type RunnerChoice = { runner: RunnerName; model: string | null; reasoning: string | null };
export type LiveConfig = { binary: string /* executor */; socket: string; codexRuntime: "installed" | "pinned"; pinnedController?: string };
// createLiveRuntime(config, project, dataDir, ledgers, token, runnerFor: (role: ExecutingRole) => RunnerChoice)
export class RunnerSettings {
  constructor(db: DatabaseSync, agentFor: (role: string) => string | null, installs: () => Promise<Record<RunnerName, RunnerInstall>>, models: …);
  choice(role: ExecutingRole): RunnerChoice;          // reads agents.cli_provider/cli_model/cli_reasoning_level
  checkAgentMutation(agentId: string, patch: unknown): void; // only role agents, only allowed fields, runner ∈ ready, model ∈ CLI list
  cliStatus(): Promise<{ providers: Record<string, CliToolStatus & { qualified?: boolean; reason?: string }> }>;
  cliModels(): Promise<{ models: Record<string, RunnerModel[]> }>;
}
export class RunnerEvidence { constructor(db: DatabaseSync); record(r: { taskId: string; role: string; runner: string; version: string; sha256: string; model: string }): void; list(taskId: string) }
```
- [ ] **Step 1: Failing tests.**
  - `runner-settings`: choice defaults to `{codex, null, null}` when the provider is not codex/claude. Mutations are rejected:
    - non-role agent → `RUNNER_ROLE_ONLY`;
    - extra field such as `api_provider_id` with a value → `RUNNER_FIELD_UNSUPPORTED`;
    - runner not ready → `RUNNER_NOT_READY` with the hint;
    - unknown model → `RUNNER_MODEL_UNKNOWN`.
  - `native-office`:
    - live start no longer overwrites `cli_provider='claude'`;
    - an unsupported value (`gemini`) is reset to `codex`;
    - choices survive a close/reopen of the DB (restart).
  - `live-runtime`:
    - job for `reviewer` with claude choice builds `claudeJob`;
    - understanding uses reviewer's choice;
    - each run records evidence;
    - a choice whose qualification is missing triggers `qualify` before launch and a failure surfaces as `RUNNER_QUALIFICATION_FAILED` without launching the model;
    - status reports `roles: {pm: {runner, model}, …}` in place of a single `model`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `live.ts`, replace `const job = (prompt) => codexJob(…)` with `jobFor(role, taskId, prompt)`. It resolves `runnerFor(role)`, then the install (discovered at startup and SHA re-checked at job time), then the qualification (`qualify` if missing), then `codexJob` or `claudeJob`. It records `RunnerEvidence`. Planning passes `packet.role`; implementation passes `packet.role`; understanding passes `"reviewer"`.
  - In `native-office.ts`, replace lines 150-156 with an `UPDATE … SET cli_provider='codex', cli_model=NULL, cli_reasoning_level=NULL WHERE id=? AND cli_provider NOT IN ('codex','claude')`. Construct `RunnerSettings` and `RunnerEvidence`, pass `role => settings.choice(role)` to `createLiveRuntime`, and expose the bridge methods `checkAgentMutation`, `cliStatus`, `cliModels`.
- [ ] **Step 4: Run.** Expected: PASS, including every existing case in the three files.
- [ ] **Step 5:** `git diff --stat`.

### Task 9: 서버 경로 (host)

**Files:**
- Modify: `vendor/claw-empire/server/pazmo/host.ts:7-29,94-151`
- Test: `tests/claw-host.test.mjs`

- [ ] **Step 1: Failing tests.** Under Pazmo:
  - `GET /api/cli-status` → the office `cliStatus()` payload. Upstream `detectAllCli` is not called.
  - `GET /api/cli-models` → `cliModels()`.
  - `PATCH /api/agents/:id` with valid fields → passes to the upstream handler (200).
  - Invalid → 409 with the code and message.
  - Other `PATCH /api/agents/:id` bodies (e.g. `name`) → still 423.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `checkAgentMutation`, `cliStatus`, `cliModels` to `NativeOfficeBridge`.
  - In the first `/api` middleware: handle the two GETs; on `PATCH /agents/:id` call `office.checkAgentMutation` and set `res.locals.pazmoAgentChecked = true`.
  - In the second middleware: `if (res.locals.pazmoAgentChecked) return next();`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5:** `git diff --stat`.

### Task 10: 화면

**Files:**
- Modify: `vendor/claw-empire/src/components/AgentDetail.tsx:35,213-221,431-520`, `vendor/claw-empire/src/components/settings/CliSettingsTab.tsx` (authHint/qualified 표시만)
- Test: `vendor/claw-empire/src/components/AgentDetail.runner.test.tsx`

- [ ] **Step 1: Failing vitest.**
  - When `getCliStatus` reports only codex/claude (pazmo shape), the provider select offers exactly those two.
  - Choosing claude shows its models and effort levels.
  - A 409 save shows the server message and keeps the editor open.
  - The settings CLI tab shows `hint` for a missing or not-logged-in runner, and "검사 전/통과/실패".
- [ ] **Step 2: Run** `pnpm --dir vendor/claw-empire exec vitest run src/components/AgentDetail.runner.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Filter `CLI_LABELS` by providers present in `/api/cli-status` when `settings.pazmoReadOnly`. Pass this through the existing props, or fetch status in the editor.
  - Generalize the reasoning select condition from `codex` to `codex|claude`, sending `cli_reasoning_level` for both.
  - Surface `error.message` in a small inline text.
- [ ] **Step 4: Run** the test, then `npm run build:office`. Expected: PASS, build exit 0.
- [ ] **Step 5:** `git diff --stat`.

### Task 11: 시작 조건

**Files:**
- Modify: `src/cli/launcher.ts:195-266`, `src/cli/index.ts:296-311`
- Test: `tests/launcher.test.mjs`

- [ ] **Step 1: Failing tests.**
  - With no `~/.codex/auth.json` but a ready and logged-in claude, start proceeds.
  - With neither ready, the start fails with `LOGIN_REQUIRED` and a message listing both hints.
  - `--codex-runtime pinned` passes `codexRuntime:"pinned"` and the pinned controller path.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `discoverRunners` in the launcher. `LiveConfig` becomes `{binary: executor, socket, codexRuntime, pinnedController}`. Remove the `authHome` field; codex auth home stays `~/.codex` inside the job, which does not read it.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5:** `git diff --stat`.

### Task 12: 검증·문서

- [ ] Full root suite `npm test` → report X/X. `npm run typecheck` exit. vendor vitest (affected) X/X. `npm run build:office` exit. `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` and `… task docs/tasks/U8-cli-runner-selection.md` exit 0.
- [ ] Real VM `scripts/qualify-runners.mjs --fixture-only` X/X per runner (Task 7 Step 4).
- [ ] Real subscription run (V9): `scripts/qualify-runners.mjs --live-approved --runner claude --model haiku` and the same for codex. Use a temporary Git project with a readonly PM-style prompt. Do not use the 61772 instance. Record runner, version, SHA, model and the schema-valid report. Each run calls the model once.
- [ ] Browser check on a separate preview instance (new port, temp project): select a runner/model in agent detail, restart, confirm it persists; the settings CLI tab shows status and hints.
- [ ] Docs: `docs/verification/2026-10-02-cli-runner-selection.md`, a new section at the top of `docs/STATUS.md`, a `docs/LOCAL-PREVIEW.md` login guidance update. Then simplification (`ce-simplify-code`), report-only review, and `/ce-compound`.
