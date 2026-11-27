import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { HubStore, MAC_OFFLINE_MS } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { PlanBoard } from "../src/hub/plan-store.ts";
import { startHubServer } from "../src/hub/server.ts";
import { linkApi } from "../src/hub/link-api.ts";
import { DEFAULT_OFFICE_REF, DEFAULT_OFFICE_REPO } from "../src/hub/installer.ts";
import { setupRows, runnerReason, PLUGIN_REVIEW_COMMAND } from "../src/hub/setup.ts";
import { FIXTURE_PASSWORD, linkForm, startTestHub } from "./hub-fixture.mjs";

// hub-setup-first: a member who has not passed the setup check sees only /mac and their sign-ins (E1–E12).
const PUBLIC = "https://pazmo-hub.apps.example.com";
const HOST = "pazmo-hub.apps.example.com";
const INSTALLER = { officeRepo: DEFAULT_OFFICE_REPO, officeRef: DEFAULT_OFFICE_REF };
const GATE_LINE = "설치가 확인되면 허브를 쓸 수 있습니다.";
const UUID = "00000000-0000-4000-8000-000000000000";

/** A hub behind the router with the installer, the Story board and plans; `skew` moves the member store's clock. */
async function hubWithInstaller(t, { installer = INSTALLER } = {}) {
  const clock = { skew: 0 };
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db, () => Date.now() + clock.skew);
  const board = new StoryBoard(db);
  const plans = new PlanBoard(db, board);
  const hub = await startHubServer(
    { store, board, plans, listen: { kind: "proxy", publicUrl: PUBLIC, host: "127.0.0.1", port: 0 }, ...(installer ? { installer } : {}) },
    linkApi(store, board, plans),
  );
  t.after(() => hub.close());
  const call = (method, path, { cookie, body, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: hub.port,
          method,
          path,
          headers: {
            host: HOST,
            ...(cookie ? { cookie } : {}),
            ...(body !== undefined ? { "content-type": "application/x-www-form-urlencoded" } : {}),
            ...headers,
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  /** Joins through the invite page; returns where it landed, the cookie, the CSRF token and the member. */
  async function enter(raw) {
    const res = await call("POST", `/invite/${raw}`, { body: linkForm("t"), headers: { origin: PUBLIC } });
    assert.equal(res.status, 303);
    const cookie = res.headers["set-cookie"][0].split(";")[0];
    const csrf = /name="csrf" value="([^"]+)"/.exec((await call("GET", "/account", { cookie })).text)[1];
    return { landed: res.headers.location, cookie, csrf, member: store.session(cookie.split("=")[1]).member };
  }
  const get = (path, who) => call("GET", path, { cookie: who?.cookie });
  const post = (path, who, fields = {}) =>
    call("POST", path, { cookie: who.cookie, body: new URLSearchParams({ csrf: who.csrf, ...fields }).toString(), headers: { origin: PUBLIC } });
  /** Pairs a Mac for `who` and returns its auth (what the Office's heartbeat and links use). */
  function pair(who, name = "내 Mac") {
    const started = store.startMac(name);
    store.approveMac(who, started.userCode);
    const polled = store.pollMac(started.deviceCode);
    return { ...polled, auth: store.mac(polled.macToken) };
  }
  const admin = await enter(store.bootstrapAdmin());
  return { store, board, plans, call, enter, get, post, pair, admin, clock, db };
}
/** The text of the setup row named `label` on a /mac page. */
function row(page, label) {
  const hit = new RegExp(`<li><p class="row"><b>${label}</b><span class="pill (\\w+)">([^<]+)</span></p><p>([^<]*)</p>`).exec(page);
  assert.ok(hit, `row ${label}`);
  return { tone: hit[1], state: hit[2], text: hit[3] };
}

test("E1: a new invitee lands on /mac, whose header has no board, team or switch, and says the hub opens once the setup is checked", async (t) => {
  const h = await hubWithInstaller(t);
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  assert.equal(b.landed, "/mac");
  assert.equal(h.admin.landed, "/mac", "the first admin too (H1)");
  const page = (await h.get("/mac", b)).text;
  assert.match(page, /<h1>이 Mac 연결<\/h1><p><b>설치가 확인되면 허브를 쓸 수 있습니다\.<\/b><\/p>/);
  assert.ok(page.includes(GATE_LINE));
  assert.doesNotMatch(page, /<nav>/, "no board or team menu");
  assert.doesNotMatch(page, /action="\/me\/auto-work"/, "no auto-work switch");
  assert.doesNotMatch(page, /href="\/me"/, "no link to the work page");
  assert.match(page, /<a class="acct" href="\/account">내 로그인<\/a>/);
  assert.match(page, /action="\/me\/theme"/, "the theme switch stays");
  // Unchanged: the install line, its copy button and what it does.
  assert.ok(page.includes(`<pre id="copy-value">curl -fsSL ${PUBLIC}/install.sh | sh</pre>`));
  assert.match(page, /data-copy-target="copy-value">복사/);
  assert.match(page, /이 명령이 하는 일/);
  assert.match(page, /<h2 id="setup-title">설치 확인<\/h2>/);
  assert.ok(page.includes('<script src="/live.js" defer></script>'), "the panel refreshes itself (E3)");
});

test("E2/H1/H3: a member who has not passed, admin included, is sent to /mac from every other page; /mac, the allow page and 내 로그인 answer", async (t) => {
  const h = await hubWithInstaller(t);
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  for (const who of [b, h.admin])
    for (const path of ["/", "/board", "/tasks", "/repos", "/team", "/me", "/members", "/start", "/requests", "/projects/new", `/stories/${UUID}`, `/plans/${UUID}`, `/tasks/${UUID}`]) {
      const res = await h.get(path, who);
      assert.deepEqual([res.status, res.headers.location], [303, "/mac"], `${who === b ? "B" : "admin"} ${path}`);
    }
  assert.equal((await h.get("/mac", b)).status, 200);
  assert.equal((await h.get("/account", b)).status, 200);
  assert.equal((await h.get("/mac/approve?code=BCDF-0000", b)).status, 410, "the allow page answers (no such code)");
  const code = h.store.startMac("새 Mac").userCode;
  assert.equal((await h.get(`/mac/approve?code=${code}`, b)).status, 200);
  // Unchanged: what Office and the Mac use needs no session and is not gated.
  assert.equal((await h.get("/install.sh")).status, 200);
  assert.equal((await h.call("POST", "/api/mac/start", { body: JSON.stringify({ name: "x" }), headers: { "content-type": "application/json", "x-pazmo-hub-protocol": "4" } })).status, 200);
});

test("E6: a member who has not passed cannot do hub work by POST; sign-ins, Mac allow and own Mac revoke still work", async (t) => {
  const h = await hubWithInstaller(t);
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  // The admin passes (exempt) to set up something to act on.
  h.store.setSetupExempt(h.admin.member, h.admin.member.id, true);
  const repo = h.store.addRepo(h.admin.member, "app-be", "https://github.example.com/team/app-be.git");
  h.store.setSetupExempt(h.admin.member, h.admin.member.id, false);
  const autoWork = h.board.autoWork(b.member.id);
  const refused = [
    ["/projects", { name: "새 프로젝트", repo }],
    ["/repos", { name: "app-fe", remote: "https://github.example.com/team/app-fe.git" }],
    [`/repos/${repo}/owners`, { member: b.member.id }],
    ["/requests", { repo, body: "x", risk: "normal" }],
    ["/me/auto-work", { on: autoWork ? "0" : "1", back: "/" }],
    ["/start/connect-code", {}],
    [`/plans/${UUID}/approve`, { gate: "G1", revision: "1", hash: "x" }],
    [`/stories/${UUID}/approve`, { confirm: "yes", commits: "[]", fingerprint: "x" }],
  ];
  for (const who of [b, h.admin])
    for (const [path, fields] of refused) {
      const res = await h.post(path, who, fields);
      assert.deepEqual([res.status, res.headers.location], [303, "/mac"], path);
    }
  for (const [path, fields] of [["/invites", { name: "C", email: "c@example.com" }], [`/members/${b.member.id}/setup-exempt`, { on: "1" }], [`/members/${b.member.id}/revoke`, {}]]) {
    const res = await h.post(path, h.admin, fields);
    assert.deepEqual([res.status, res.headers.location], [303, "/mac"], `admin ${path}`);
  }
  assert.equal(h.board.projects({ member: h.admin.member }).length, 0, "no project was made");
  assert.deepEqual(h.store.repos(b.member.id).map((r) => r.name), ["app-be"], "no repo was added");
  assert.equal(h.store.repos(b.member.id)[0].owners.length, 1, "no owner was added");
  assert.equal(h.board.autoWork(b.member.id), autoWork, "the switch did not move");
  assert.equal(h.store.members().find((m) => m.id === b.member.id).setupExempt, false);
  assert.equal(h.store.members().find((m) => m.id === b.member.id).revoked, false);

  // What stays open.
  const theme = await h.post("/me/theme", b, { theme: "dark", back: "/mac" });
  assert.deepEqual([theme.status, theme.headers.location], [303, "/mac"]);
  const others = await h.post("/account/logout-others", b);
  assert.deepEqual([others.status, others.headers.location], [303, "/account"]);
  const code = h.store.startMac("B의 Mac").userCode;
  const allowed = await h.post("/mac/approve", b, { code });
  assert.deepEqual([allowed.status, allowed.headers.location], [303, "/mac?approved=1"]);
  const denied = await h.post("/mac/deny", b, { code: h.store.startMac("x").userCode });
  assert.deepEqual([denied.status, denied.headers.location], [303, "/mac"]);
  const bMac = h.pair(b.member);
  const aMac = h.pair(h.admin.member);
  const notMine = await h.post(`/macs/${bMac.macId}/revoke`, h.admin);
  assert.deepEqual([notMine.status, notMine.headers.location], [303, "/mac"], "a gated admin cannot end another member's Mac");
  assert.ok(h.store.mac(bMac.macToken), "B's Mac still runs");
  const mine = await h.post(`/macs/${aMac.macId}/revoke`, h.admin);
  assert.deepEqual([mine.status, mine.headers.location], [303, "/mac"]);
  assert.equal(h.store.mac(aMac.macToken), null, "the admin's own Mac ended");
  const out = await h.post("/logout", b);
  assert.deepEqual([out.status, out.headers.location], [303, "/"]);
  assert.equal((await h.get("/mac", b)).status, 401, "signed out");
});

test("E3/E11: an admin invites with a repo; the invitee owns it, and the four rows pass step by step until 설치 확인 완료 opens the board", async (t) => {
  const h = await hubWithInstaller(t);
  h.store.setSetupExempt(h.admin.member, h.admin.member.id, true);
  const be = h.store.addRepo(h.admin.member, "app-be", "https://github.example.com/team/app-be.git");
  h.store.addRepo(h.admin.member, "app-fe", "https://github.example.com/team/app-fe.git");
  const form = (await h.get("/members", h.admin)).text;
  assert.match(form, new RegExp(`<legend>담당 레포 <span class="muted">\\(선택\\)</span></legend><label><input type="checkbox" name="repo" value="${be}">app-be</label>`));
  assert.match(form, /name="repo" value="[0-9a-f-]{36}">app-fe<\/label>/);
  const made = await h.call("POST", "/invites", {
    cookie: h.admin.cookie,
    body: `csrf=${encodeURIComponent(h.admin.csrf)}&name=B&email=b%40example.com&repo=${be}`,
    headers: { origin: PUBLIC },
  });
  assert.equal(made.status, 200);
  const raw = /\/invite\/([A-Za-z0-9_-]{43})/.exec(made.text)[1];
  const b = await h.enter(raw);
  assert.equal(b.landed, "/mac");
  const repos = h.store.repos(b.member.id);
  assert.deepEqual(repos.filter((r) => r.isOwner).map((r) => r.name), ["app-be"], "B owns the chosen repo only");
  assert.deepEqual(repos.find((r) => r.name === "app-be").owners.map((o) => o.name).sort(), ["B", "관리자"].sort(), "the repo page lists B");

  let page = (await h.get("/mac", b)).text;
  assert.deepEqual(row(page, "Mac 연결됨"), { tone: "need", state: "아직", text: "아직: 연결된 Mac이 없습니다. 위의 한 줄을 Mac 터미널에서 실행하고 이 Mac을 허용하세요." });
  assert.equal(row(page, "Office 켜짐").text, "아직: Mac을 연결하면 확인합니다.");
  assert.equal(row(page, "담당 레포 연결됨").text, "아직: Mac을 연결하면 확인합니다. 담당 레포: app-be");
  assert.doesNotMatch(page, /설치 확인 완료/);

  const mac = h.pair(b.member, "B의 맥북");
  page = (await h.get("/mac", b)).text;
  assert.deepEqual(row(page, "Mac 연결됨"), { tone: "done", state: "통과", text: "Mac 연결됨: B의 맥북" });
  assert.deepEqual(row(page, "Office 켜짐"), { tone: "run", state: "확인 중", text: "확인 중: Office가 켜지기를 기다리는 중입니다." });
  assert.equal(row(page, "실행기 준비됨").state, "확인 중");

  assert.deepEqual(h.store.macRepos(mac.auth).map((r) => r.name), ["app-be"], "the Mac's sync clones the repo");
  h.store.macHeartbeat(mac.auth, "idle", null);
  page = (await h.get("/mac", b)).text;
  assert.equal(row(page, "Office 켜짐").state, "통과");
  assert.equal(row(page, "실행기 준비됨").text, "실행기 준비됨");
  assert.equal(row(page, "담당 레포 연결됨").text, "아직: 아직 연결되지 않은 레포: app-be. Office가 레포를 내려받는 중이면 곧 바뀝니다.");
  assert.deepEqual([(await h.get("/", b)).status], [303], "still held");

  h.store.macLink(mac.auth, be);
  page = (await h.get("/mac", b)).text;
  assert.deepEqual(row(page, "담당 레포 연결됨"), { tone: "done", state: "통과", text: "담당 레포 연결됨(app-be)" });
  assert.match(page, /<p role="status"><b>설치 확인 완료<\/b><\/p><p><a class="btn" href="\/">허브로 가기<\/a><\/p>/);
  assert.ok(!page.includes(GATE_LINE));
  const board = await h.get("/", b);
  assert.equal(board.status, 200, "the board opens");
  assert.match(board.text, /<nav><a href="\/" aria-current="page">보드<\/a><a href="\/team">팀<\/a><\/nav>/);
  assert.match(board.text, /action="\/me\/auto-work"/);
});

test("E11: an invite refuses a repo that is not registered, and skips a chosen repo deleted before the invite is used", async (t) => {
  const h = await hubWithInstaller(t);
  assert.throws(() => h.store.createInvite(h.admin.member, "B", "b@example.com", [UUID]), { code: "INVALID", status: 400 });
  assert.throws(() => h.store.createInvite(h.admin.member, "B", "b@example.com", ["not-an-id"]), { code: "INVALID" });
  const keep = h.store.addRepo(h.admin.member, "app-be", "https://github.example.com/team/app-be.git");
  const gone = h.store.addRepo(h.admin.member, "app-old", "https://github.example.com/team/app-old.git");
  const raw = h.store.createInvite(h.admin.member, "B", "b@example.com", [keep, gone, keep]);
  h.db.prepare("DELETE FROM hub_repo_owners WHERE repo_id=?").run(gone);
  h.db.prepare("DELETE FROM hub_repos WHERE id=?").run(gone);
  const b = h.store.acceptInvite(raw, "t", { password: FIXTURE_PASSWORD, again: FIXTURE_PASSWORD }).member;
  assert.deepEqual(h.store.repos(b.id).filter((r) => r.isOwner).map((r) => r.name), ["app-be"]);
  // A password reset link carries no repos and changes no owner.
  const reset = h.store.createPasswordReset(h.admin.member, b.id);
  h.store.acceptInvite(reset, "t", { password: FIXTURE_PASSWORD, again: FIXTURE_PASSWORD });
  assert.deepEqual(h.store.repos(b.id).filter((r) => r.isOwner).map((r) => r.name), ["app-be"]);
});

test("E4/E7: a Mac whose runners or company plugins are not ready shows why on 실행기 준비됨 and stays held; once ready it passes", async (t) => {
  const h = await hubWithInstaller(t);
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  const mac = h.pair(b.member);
  const runners = async () => row((await h.get("/mac", b)).text, "실행기 준비됨");
  h.store.macHeartbeat(mac.auth, "limited", "claude: not_ready");
  assert.deepEqual(await runners(), { tone: "need", state: "아직", text: "아직: claude 로그인이 필요합니다. Mac 터미널에서 claude를 실행해 설치와 로그인을 확인하세요." });
  assert.equal((await h.get("/board", b)).headers.location, "/mac", "E4: the other pages stay closed");

  h.store.macHeartbeat(mac.auth, "limited", "claude: plugin-unlisted example-plugin@example-market");
  const page = (await h.get("/mac", b)).text;
  assert.equal(row(page, "실행기 준비됨").text, "아직: 회사 플러그인 example-plugin이 허용되지 않았습니다. Mac 터미널에서 아래 명령으로 허용하세요.");
  assert.ok(page.includes(`<pre class="mono">${PLUGIN_REVIEW_COMMAND}</pre>`), "the allow command is shown");
  assert.equal(PLUGIN_REVIEW_COMMAND, "pazmo-office runner plugins --review");
  assert.equal((await h.get("/", b)).status, 303);

  h.store.macHeartbeat(mac.auth, "limited", "claude: plugin-refused example-plugin@example-market");
  const refused = (await h.get("/mac", b)).text;
  assert.equal(row(refused, "실행기 준비됨").text, "아직: 회사 플러그인 example-plugin은 허용할 수 없습니다. 조직 관리자에게 문의하세요.");
  assert.doesNotMatch(refused, /runner plugins --review/, "no command that cannot help");

  h.store.macHeartbeat(mac.auth, "locked", null);
  assert.equal((await runners()).text, "아직: Office가 일을 받지 않는 상태로 켜져 있습니다. Mac 터미널에서 설치 명령을 다시 실행하세요.");

  // E5 as well: B owns no repo.
  h.store.macHeartbeat(mac.auth, "idle", null);
  const done = (await h.get("/mac", b)).text;
  assert.deepEqual(row(done, "담당 레포 연결됨"), { tone: "done", state: "통과", text: "담당 레포 없음" });
  assert.match(done, /설치 확인 완료/);
  assert.equal((await h.get("/", b)).status, 200);
});

test("a repo linked with a connection string (which the Mac cannot replace) passes 담당 레포 연결됨; a revoked one does not", async (t) => {
  const h = await hubWithInstaller(t);
  h.store.setSetupExempt(h.admin.member, h.admin.member.id, true);
  const remote = "https://github.example.com/team/app-be.git";
  const repo = h.store.addRepo(h.admin.member, "app-be", remote);
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  h.store.addOwner(h.admin.member, repo, b.member.id);
  h.store.connect(h.store.createConnectCode(b.member), remote);
  const mac = h.pair(b.member);
  assert.throws(() => h.store.macLink(mac.auth, repo), { code: "LINKED_ELSEWHERE" });
  h.store.macHeartbeat(mac.auth, "idle", null);
  const page = (await h.get("/mac", b)).text;
  assert.deepEqual(row(page, "담당 레포 연결됨"), { tone: "done", state: "통과", text: "담당 레포 연결됨(app-be)" });
  assert.equal((await h.get("/", b)).status, 200);
  // Revoked, the connection-string link no longer counts (a fresh check, on a newly paired Mac).
  const link = h.store.repos(b.member.id)[0].links.find((l) => l.mac === null);
  h.store.revokeLink(b.member, link.id);
  const again = h.pair(b.member);
  h.store.macHeartbeat(again.auth, "idle", null);
  assert.equal(h.store.setupCheck(b.member.id).rows[3].state, "wait");
  assert.equal((await h.get("/", b)).headers.location, "/mac");
});

test("E5: a member with no repo passes with 담당 레포 없음 once the other three rows pass; a working Mac passes as well", async (t) => {
  const h = await hubWithInstaller(t);
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  const mac = h.pair(b.member);
  h.store.macHeartbeat(mac.auth, "working", null);
  assert.equal(h.store.setupPassed(b.member.id), true);
  const check = h.store.setupCheck(b.member.id);
  assert.deepEqual(check.rows.map((r) => r.state), ["pass", "pass", "pass", "pass"]);
  assert.equal(check.rows[3].text, "담당 레포 없음");
  assert.equal((await h.get("/team", b)).status, 200);
});

test("E8: an admin lets a member in without the setup check from /members and takes it back with 면제 해제", async (t) => {
  const h = await hubWithInstaller(t);
  h.store.setSetupExempt(h.admin.member, h.admin.member.id, true);
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  let members = (await h.get("/members", h.admin)).text;
  assert.match(members, new RegExp(`action="/members/${b.member.id}/setup-exempt"><input type="hidden" name="csrf" value="${h.admin.csrf}"><input type="hidden" name="on" value="1"><button class="secondary">설치 확인 없이 허용</button>`));
  const on = await h.post(`/members/${b.member.id}/setup-exempt`, h.admin, { on: "1" });
  assert.deepEqual([on.status, on.headers.location], [303, "/members"]);
  for (const path of ["/", "/board", "/team", "/repos", "/me"]) assert.equal((await h.get(path, b)).status, 200, path);
  members = (await h.get("/members", h.admin)).text;
  assert.match(members, /B<\/span><span class="pill">설치 확인 면제<\/span>/);
  assert.match(members, new RegExp(`action="/members/${b.member.id}/setup-exempt"><input type="hidden" name="csrf" value="[^"]+"><input type="hidden" name="on" value="0"><button class="secondary">면제 해제</button>`));
  assert.match((await h.get("/mac", b)).text, /<b>설치 확인 면제<\/b>/);
  // A member who is not an admin cannot exempt anyone.
  assert.equal((await h.post(`/members/${h.admin.member.id}/setup-exempt`, b, { on: "0" })).status, 403);
  assert.equal((await h.post(`/members/${b.member.id}/setup-exempt`, h.admin, { on: "maybe" })).status, 400);
  const off = await h.post(`/members/${b.member.id}/setup-exempt`, h.admin, { on: "0" });
  assert.deepEqual([off.status, off.headers.location], [303, "/members"]);
  assert.equal((await h.get("/", b)).headers.location, "/mac", "held again");
  assert.throws(() => h.store.setSetupExempt(b.member, b.member.id, true), { code: "FORBIDDEN" });
});

test("E9: an admin who has not passed sees [설치 확인 없이 허용] on /mac and exempts themself; a member who is not an admin never sees it", async (t) => {
  const h = await hubWithInstaller(t);
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  const mine = (await h.get("/mac", h.admin)).text;
  assert.match(mine, new RegExp(`action="/mac/exempt"><input type="hidden" name="csrf" value="${h.admin.csrf}"><input type="hidden" name="on" value="1"><button class="secondary">설치 확인 없이 허용</button>`));
  const theirs = (await h.get("/mac", b)).text;
  assert.doesNotMatch(theirs, /설치 확인 없이 허용|\/mac\/exempt/);
  assert.equal((await h.post("/mac/exempt", b)).status, 403, "refused for a member who is not an admin");
  assert.equal(h.store.setupPassed(b.member.id), false);
  const self = await h.post("/mac/exempt", h.admin);
  assert.deepEqual([self.status, self.headers.location], [303, "/"]);
  assert.equal((await h.get("/", h.admin)).status, 200, "the admin is in");
  assert.doesNotMatch((await h.get("/mac", h.admin)).text, /action="\/mac\/exempt"/, "no button once passed");
});

test("E10: a member from before the change is checked on their next visit: a Mac that passes now opens the board and is recorded; otherwise /mac", async (t) => {
  const h = await hubWithInstaller(t);
  h.store.setSetupExempt(h.admin.member, h.admin.member.id, true);
  const repo = h.store.addRepo(h.admin.member, "app-be", "https://github.example.com/team/app-be.git");
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  const c = await h.enter(h.store.createInvite(h.admin.member, "C", "c@example.com"));
  h.store.addOwner(h.admin.member, repo, b.member.id);
  const mac = h.pair(b.member);
  h.store.macLink(mac.auth, repo);
  h.store.macHeartbeat(mac.auth, "idle", null);
  // The hub's database as an older version left it: no setup columns. Opening it adds them, with nobody exempt or recorded.
  for (const column of ["setup_exempt", "setup_mac_id", "setup_at"]) h.db.exec(`ALTER TABLE hub_members DROP COLUMN ${column}`);
  h.db.exec("ALTER TABLE hub_invites DROP COLUMN repo_ids");
  const again = new HubStore(h.db);
  assert.ok(again.members().every((m) => m.setupExempt === false));
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM hub_members WHERE setup_mac_id IS NOT NULL").get().n, 0);
  const home = await h.get("/", b);
  assert.equal(home.status, 200, "B's Mac passes the four rows now");
  assert.equal(h.db.prepare("SELECT setup_mac_id FROM hub_members WHERE id=?").get(b.member.id).setup_mac_id, mac.macId, "the check is recorded");
  assert.equal((await h.get("/", c)).headers.location, "/mac", "C has no Mac");
  // Sign-in lands where the check says.
  const signIn = (email) =>
    h.call("POST", "/login", { body: new URLSearchParams({ email, password: FIXTURE_PASSWORD }).toString(), headers: { origin: PUBLIC } });
  assert.equal((await signIn(h.store.account(c.member.id).email)).headers.location, "/mac");
  assert.equal((await signIn(h.store.account(b.member.id).email)).headers.location, "/");
});

test("E12/H2: a checked member keeps the hub while their Mac is off; revoking it or pairing a new Mac holds them at /mac until the new Mac passes", async (t) => {
  const h = await hubWithInstaller(t);
  const b = await h.enter(h.store.createInvite(h.admin.member, "B", "b@example.com"));
  const first = h.pair(b.member, "첫 Mac");
  h.store.macHeartbeat(first.auth, "idle", null);
  assert.equal((await h.get("/", b)).status, 200);
  h.clock.skew = MAC_OFFLINE_MS + 60_000;
  assert.equal(h.store.macs(b.member.id)[0].state, "off");
  assert.equal((await h.get("/", b)).status, 200, "an off Mac keeps the record");
  const page = (await h.get("/mac", b)).text;
  assert.match(page, /설치 확인 완료/);
  assert.equal(row(page, "Office 켜짐").text, "아직: Office가 꺼져 있습니다. Mac 터미널에서 설치 명령을 다시 실행하세요.");
  h.store.macHeartbeat(first.auth, "limited", "claude: login");
  assert.equal((await h.get("/", b)).status, 200, "a resting Mac keeps it too");

  // A new Mac: held until it passes.
  const second = h.pair(b.member, "새 Mac");
  assert.equal((await h.get("/", b)).headers.location, "/mac");
  h.store.macHeartbeat(second.auth, "idle", null);
  assert.equal((await h.get("/", b)).status, 200, "the new Mac passed");

  // Revoked: held, with no Mac to pass with.
  const revoke = await h.post(`/macs/${second.macId}/revoke`, b);
  assert.deepEqual([revoke.status, revoke.headers.location], [303, "/mac"]);
  assert.equal((await h.get("/", b)).headers.location, "/mac");
  assert.equal(h.store.setupCheck(b.member.id).verified, false);
});

test("a hub on its own certificate (no installer) gates nobody and shows no setup panel", async (t) => {
  const h = await startTestHub(t);
  const admin = await h.enter(h.store.bootstrapAdmin());
  assert.equal(admin.res.headers.location, "/");
  const mac = await h.call("GET", "/mac", { cookie: admin.cookie });
  assert.doesNotMatch(mac.text, /설치 확인|설치가 확인되면/);
  assert.equal((await h.call("GET", "/board", { cookie: admin.cookie })).status, 200);
  const proxied = await hubWithInstaller(t, { installer: null });
  assert.equal(proxied.admin.landed, "/");
  assert.equal((await proxied.get("/board", proxied.admin)).status, 200);
});

test("setupRows: each row's state and words, from no Mac to every reason a resting Mac gives", () => {
  const mac = (state, detail = null, lastSeen = 1) => ({ id: "k", name: "맥", state, detail, lastSeen, createdAt: 0 });
  const texts = (facts) => setupRows(facts).map((r) => [r.state, r.text]);
  assert.deepEqual(texts({ mac: null, repos: [], starting: false }), [
    ["wait", "연결된 Mac이 없습니다. 위의 한 줄을 Mac 터미널에서 실행하고 이 Mac을 허용하세요."],
    ["wait", "Mac을 연결하면 확인합니다."],
    ["wait", "Mac을 연결하면 확인합니다."],
    ["pass", "담당 레포 없음"],
  ]);
  assert.deepEqual(texts({ mac: mac("off", null, null), repos: [{ name: "a", linked: false }], starting: true }).slice(1), [
    ["checking", "Office가 켜지기를 기다리는 중입니다."],
    ["checking", "Office가 켜지면 확인합니다."],
    ["checking", "Office가 켜지면 확인합니다. 담당 레포: a"],
  ]);
  assert.deepEqual(texts({ mac: mac("off", null, null), repos: [], starting: false })[1], ["wait", "Office가 꺼져 있습니다. Mac 터미널에서 설치 명령을 다시 실행하세요."]);
  assert.deepEqual(texts({ mac: mac("idle"), repos: [{ name: "a", linked: true }, { name: "b", linked: false }], starting: false })[3], ["wait", "아직 연결되지 않은 레포: b. Office가 레포를 내려받는 중이면 곧 바뀝니다."]);
  assert.deepEqual(texts({ mac: mac("working"), repos: [{ name: "a", linked: true }, { name: "b", linked: true }], starting: false })[3], ["pass", "담당 레포 연결됨(a, b)"]);
  assert.deepEqual(runnerReason("limited", "claude, codex: not_ready"), { text: "claude, codex 로그인이 필요합니다. Mac 터미널에서 claude를 실행해 설치와 로그인을 확인하세요." });
  assert.deepEqual(runnerReason("limited", "not_ready"), { text: "claude 로그인이 필요합니다. Mac 터미널에서 claude를 실행해 설치와 로그인을 확인하세요." });
  assert.deepEqual(runnerReason("limited", "codex: login"), { text: "codex 로그인이 필요합니다. Mac 터미널에서 codex를 실행해 설치와 로그인을 확인하세요." });
  assert.deepEqual(runnerReason("limited", "claude: limit"), { text: "claude 사용 한도에 걸렸습니다. 한도가 풀리면 통과합니다." });
  assert.deepEqual(runnerReason("limited", "claude: billing"), { text: "claude 결제나 요금제 확인이 필요합니다." });
  assert.deepEqual(runnerReason("limited", "something else"), { text: "실행기가 준비되지 않았습니다: something else" });
  assert.deepEqual(runnerReason("limited", null), { text: "실행기가 준비되지 않았습니다." });
  assert.deepEqual(runnerReason("limited", "claude: plugin-unlisted solo-plugin"), {
    text: "회사 플러그인 solo-plugin이 허용되지 않았습니다. Mac 터미널에서 아래 명령으로 허용하세요.",
    command: PLUGIN_REVIEW_COMMAND,
  });
});
