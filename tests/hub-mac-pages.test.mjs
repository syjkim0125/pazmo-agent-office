import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { HubStore, MAC_CODE_TTL } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { startHubServer } from "../src/hub/server.ts";
import { linkApi } from "../src/hub/link-api.ts";
import { DEFAULT_OFFICE_REF, DEFAULT_OFFICE_REPO } from "../src/hub/installer.ts";
import { startTestHub } from "./hub-fixture.mjs";

const PUBLIC = "https://pazmo-hub.apps.example.com";
const HOST = "pazmo-hub.apps.example.com";
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const EVIL = "https://evil.example.com";
const INSTALLER = { officeRepo: DEFAULT_OFFICE_REPO, officeRef: DEFAULT_OFFICE_REF };
const PILL = (label) => `<a class="pill" href="/mac">내 Mac: ${label}</a>`;

/** Browser-side helpers over one hub: `enter` joins through a real invite, `get`/`post` act as that browser. */
function harness({ store, origin, call, api }) {
  async function enter(raw) {
    const res = await call("POST", `/invite/${raw}`, { body: "label=t", headers: { origin } });
    assert.equal(res.status, 303);
    const cookie = res.headers["set-cookie"][0].split(";")[0];
    const csrf = /name="csrf" value="([^"]+)"/.exec((await call("GET", "/repos", { cookie })).text)[1];
    return { cookie, csrf, member: store.session(cookie.split("=")[1]).member };
  }
  const get = (path, who) => call("GET", path, { cookie: who?.cookie });
  /** `csrf: null` sends no token; `origin` overrides the Origin header. */
  const post = (path, who, fields = {}, { origin: from = origin, csrf = who.csrf } = {}) =>
    call("POST", path, {
      cookie: who.cookie,
      body: new URLSearchParams(csrf === null ? fields : { csrf, ...fields }).toString(),
      headers: { origin: from },
    });
  /** Starts a Mac, lets `by` allow it in the store, and takes its token: the Mac is then live for `by`. */
  function pair(by, name = "내 Mac") {
    const started = store.startMac(name);
    store.approveMac(by, started.userCode);
    const polled = store.pollMac(started.deviceCode);
    assert.equal(polled.state, "approved");
    return polled;
  }
  return { store, origin, call, api, enter, get, post, pair };
}

/** A hub on its own certificate (LAN mode): no installer. */
async function lan(t, options) {
  const h = await startTestHub(t, options);
  return harness({ store: h.store, origin: h.hub.url, call: h.call, api: h.api });
}
/** A hub behind the OpenShift router: plain HTTP on the public host, with the installer when given. */
async function openshift(t, installer) {
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db);
  const hub = await startHubServer(
    { store, listen: { kind: "proxy", publicUrl: PUBLIC, host: "127.0.0.1", port: 0 }, ...(installer ? { installer } : {}) },
    linkApi(store, new StoryBoard(db)),
  );
  t.after(() => hub.close());
  const call = (method, path, { cookie, body, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: hub.port, method, path, headers: { host: HOST, ...(cookie ? { cookie } : {}), ...(body !== undefined ? FORM : {}), ...headers } },
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
  return harness({ store, origin: PUBLIC, call });
}
/** The admin and a plain member B, both signed in. */
async function twoMembers(h) {
  const admin = await h.enter(h.store.bootstrapAdmin());
  const b = await h.enter(h.store.createInvite(admin.member, "B"));
  return { admin, b };
}

test("an approve link opened without signing in is 401, says to open the invite or device link first and to refresh, and leaves the code pending; after entering, the same URL approves it", async (t) => {
  const h = await lan(t);
  const started = (await h.api("POST", "/api/mac/start", { body: { name: "내 Mac" }, protocol: "4" })).json;
  const link = new URL(started.approveUrl);
  const path = link.pathname + link.search;
  assert.equal(path, `/mac/approve?code=${started.userCode}`, "the URL carries only the user code");

  const signedOut = await h.get(path);
  assert.equal(signedOut.status, 401);
  assert.match(signedOut.text, /초대 링크/);
  assert.match(signedOut.text, /새 기기 링크/);
  assert.match(signedOut.text, /이 주소를 다시/);
  assert.match(signedOut.text, /새로 고/);
  assert.ok(!signedOut.text.includes(started.userCode), "the page does not echo the code to a stranger");
  assert.doesNotMatch(signedOut.text, /<script/i);
  assert.equal(h.store.macCode(started.userCode).state, "pending", "looking at the link decided nothing");
  assert.match((await h.get("/mac")).text, /초대받은 사람만/, "every other page keeps the general signed-out page");
  assert.equal((await h.get("/mac", { cookie: "pazmo_hub=forged" })).status, 401);

  const admin = await h.enter(h.store.bootstrapAdmin());
  const page = await h.get(path, admin);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(started.userCode));
  const done = await h.post("/mac/approve", admin, { code: started.userCode });
  assert.deepEqual([done.status, done.headers.location], [303, "/mac?approved=1"]);
  const poll = (await h.api("POST", "/api/mac/token", { body: { deviceCode: started.deviceCode }, protocol: "4" })).json;
  assert.equal(poll.state, "approved");
  assert.equal(poll.member.id, admin.member.id);
});

test("the approve page shows the Mac, its code and when it asked, with the warning and an allow and a deny form", async (t) => {
  const h = await lan(t);
  const { admin } = await twoMembers(h);
  const started = h.store.startMac("회사 맥북");
  const lower = started.userCode.toLowerCase().replace("-", " ");
  const res = await h.get(`/mac/approve?code=${encodeURIComponent(lower)}`, admin);
  assert.equal(res.status, 200, "a code is read the way it is typed");
  assert.match(res.text, /회사 맥북/);
  assert.ok(res.text.includes(started.userCode), "the code is shown in its canonical form");
  assert.match(res.text, /터미널의 코드와 같고 지금 내 앞의 Mac일 때만 허용/);
  assert.match(res.text, new RegExp(`<form class="inline" method="post" action="/mac/approve"><input type="hidden" name="csrf" value="${admin.csrf}"><input type="hidden" name="code" value="${started.userCode}"><button>이 Mac 허용</button></form>`));
  assert.match(res.text, new RegExp(`action="/mac/deny"><input type="hidden" name="csrf" value="${admin.csrf}"><input type="hidden" name="code" value="${started.userCode}"><button class="danger">거절</button>`));
  assert.doesNotMatch(res.text, /<script/i);
  assert.ok(res.text.includes(PILL("연결된 Mac 없음")), "the header is there on a signed-in page");

  // A code nobody can answer: unknown, malformed, missing and run out are all the same 410 page.
  for (const bad of ["BCDF-0000", "nope", ""]) {
    const gone = await h.get(`/mac/approve?code=${encodeURIComponent(bad)}`, admin);
    assert.equal(gone.status, 410, JSON.stringify(bad));
    assert.match(gone.text, /설치 명령을 다시 실행/);
    assert.doesNotMatch(gone.text, /<script/i);
  }
  assert.equal((await h.get("/mac/approve", admin)).status, 410, "no code at all");
});

test("approving binds the Mac to the signed-in member; a second approve is 409 and the token still names the first member; an approve after 600000 ms is 410", async (t) => {
  let at = Date.now();
  const h = await lan(t, { storeNow: () => at });
  const { admin, b } = await twoMembers(h);
  const first = h.store.startMac("첫 Mac");

  const approved = await h.post("/mac/approve", b, { code: first.userCode });
  assert.deepEqual([approved.status, approved.headers.location], [303, "/mac?approved=1"]);
  assert.equal((await h.get(`/mac/approve?code=${first.userCode}`, admin)).status, 409, "the page of a decided code is an error");
  const second = await h.post("/mac/approve", admin, { code: first.userCode });
  assert.equal(second.status, 409);
  assert.match(second.text, /이미 허용하거나 거절한 코드/);
  assert.equal((await h.post("/mac/deny", admin, { code: first.userCode })).status, 409, "a deny cannot undo an allow");
  assert.equal((await h.post("/mac/approve", b, { code: first.userCode })).status, 409, "nor can the same member allow twice");

  const poll = await h.api("POST", "/api/mac/token", { body: { deviceCode: first.deviceCode }, protocol: "4" });
  assert.equal(poll.json.state, "approved");
  assert.equal(poll.json.member.id, b.member.id, "the first member to decide owns the Mac");
  assert.equal(h.store.mac(poll.json.macToken).member.id, b.member.id);
  assert.deepEqual(h.store.macs(admin.member.id), []);
  assert.equal(h.store.macs(b.member.id).length, 1);

  const late = h.store.startMac("늦은 Mac");
  at += MAC_CODE_TTL;
  const expired = await h.post("/mac/approve", b, { code: late.userCode });
  assert.equal(expired.status, 410);
  assert.match(expired.text, /설치 명령을 다시 실행/);
  assert.equal((await h.get(`/mac/approve?code=${late.userCode}`, b)).status, 410);
  assert.equal((await h.api("POST", "/api/mac/token", { body: { deviceCode: late.deviceCode }, protocol: "4" })).json.state, "expired");

  const edge = h.store.startMac("막판 Mac");
  at += MAC_CODE_TTL - 1;
  assert.equal((await h.post("/mac/approve", b, { code: edge.userCode })).status, 303, "one millisecond before it runs out still works");
});

test("deny makes the Office's poll answer denied", async (t) => {
  const h = await lan(t);
  const { b } = await twoMembers(h);
  const started = (await h.api("POST", "/api/mac/start", { body: { name: "내 Mac" }, protocol: "4" })).json;
  const res = await h.post("/mac/deny", b, { code: started.userCode });
  assert.deepEqual([res.status, res.headers.location], [303, "/mac"]);
  const poll = await h.api("POST", "/api/mac/token", { body: { deviceCode: started.deviceCode }, protocol: "4" });
  assert.deepEqual(poll.json, { state: "denied" });
  assert.deepEqual(h.store.macs(b.member.id), [], "no Mac was made");
  assert.equal((await h.post("/mac/approve", b, { code: started.userCode })).status, 409, "a denied code cannot be allowed afterwards");
});

test("approve and deny need this hub's Origin and the CSRF token", async (t) => {
  const h = await lan(t);
  const { admin, b } = await twoMembers(h);
  const started = h.store.startMac("내 Mac");
  const fields = { code: started.userCode };
  for (const path of ["/mac/approve", "/mac/deny"]) {
    assert.equal((await h.post(path, b, fields, { origin: EVIL })).status, 403, `${path} from another site`);
    assert.equal((await h.post(path, b, fields, { origin: "null" })).status, 403, `${path} from an opaque origin`);
    assert.equal((await h.post(path, b, fields, { origin: "" })).status, 403, `${path} without an Origin`);
    assert.equal((await h.post(path, b, fields, { csrf: null })).status, 403, `${path} without a token`);
    assert.equal((await h.post(path, b, fields, { csrf: "wrong" })).status, 403, `${path} with another token`);
    assert.equal((await h.post(path, b, fields, { csrf: admin.csrf })).status, 403, `${path} with another member's token`);
    assert.equal((await h.call("POST", path, { body: `csrf=${b.csrf}&code=${started.userCode}`, headers: { origin: h.origin } })).status, 401, `${path} without a session`);
  }
  assert.equal(h.store.macCode(started.userCode).state, "pending", "none of them decided anything");
  assert.equal((await h.post("/mac/approve", b, fields)).status, 303);
});

test("the 11th approve attempt by one member in 600000 ms is 429", async (t) => {
  const h = await lan(t);
  const { admin, b } = await twoMembers(h);
  const real = h.store.startMac("진짜 Mac");
  // Approve and deny draw on the same allowance, and a wrong code counts like any other.
  for (let i = 0; i < 10; i++) {
    const res = await h.post(i % 2 ? "/mac/deny" : "/mac/approve", b, { code: "BCDF-0000" });
    assert.equal(res.status, 410, `attempt ${i + 1} reaches the store`);
  }
  const eleventh = await h.post("/mac/approve", b, { code: real.userCode });
  assert.equal(eleventh.status, 429);
  assert.match(eleventh.text, /너무 많/);
  assert.equal(h.store.macCode(real.userCode).state, "pending", "a refused attempt decided nothing");
  assert.equal((await h.post("/mac/deny", b, { code: real.userCode })).status, 429, "still refused inside the window");
  assert.equal((await h.post("/mac/approve", b, { code: real.userCode }, { csrf: "wrong" })).status, 403, "a bad token is refused before it is counted");
  assert.equal((await h.post("/mac/approve", admin, { code: real.userCode })).status, 303, "another member has an allowance of their own");
});

test("the header names my newest Mac's state: 일하는 중, 대기 중, 쉬는 중(한도), 잠김, 꺼짐(, and 연결된 Mac 없음 with a link to /mac", async (t) => {
  let skew = 0;
  const h = await lan(t, { storeNow: () => Date.now() + skew });
  const { admin, b } = await twoMembers(h);
  const header = async (path = "/", who = admin) => /<nav>.*<\/nav>/.exec((await h.get(path, who)).text)[0];

  assert.ok((await header()).endsWith(`${PILL("연결된 Mac 없음")}</nav>`), "the pill closes the menu; no Mac yet");
  const mac = h.pair(admin.member, "내 Mac");
  assert.ok((await header()).includes(PILL("꺼짐(아직 연락 없음)")), "a Mac that has not reported is not shown as running");
  for (const [state, label] of [["working", "일하는 중"], ["idle", "대기 중"], ["limited", "쉬는 중(한도)"], ["locked", "잠김"]]) {
    h.store.macHeartbeat(h.store.mac(mac.macToken), state, null);
    assert.ok((await header()).includes(PILL(label)), state);
  }
  for (const path of ["/start", "/repos", "/members", "/mac"]) assert.ok((await header(path)).includes(PILL("잠김")), `${path} carries the header`);
  assert.ok(!(await header("/", b)).includes("잠김"), "another member's Mac is not mine");
  assert.ok((await header("/", b)).includes(PILL("연결된 Mac 없음")));

  skew = -200_000; // this beat is 200 s old by the time the clock is back
  h.store.macHeartbeat(h.store.mac(mac.macToken), "working", null);
  skew = 0;
  assert.ok((await header()).includes(PILL("꺼짐(3분 전)")), "older than 180000 ms is off, however it last reported");

  assert.doesNotMatch((await h.get("/")).text, /내 Mac:/, "a signed-out page has no menu");
});

test("/mac in OpenShift mode shows curl -fsSL <origin>/install.sh | sh with a copy button and loads copy.js; in self-CA mode it shows the /start note and no command", async (t) => {
  const os = await openshift(t, INSTALLER);
  const admin = await os.enter(os.store.bootstrapAdmin());
  const res = await os.get("/mac", admin);
  assert.equal(res.status, 200);
  const pre = /<pre id="copy-value">([^<]*)<\/pre>/.exec(res.text);
  assert.ok(pre, "the command is inside <pre id=copy-value>");
  assert.equal(pre[1], `curl -fsSL ${PUBLIC}/install.sh | sh`);
  assert.match(res.text, /<button type="button" data-copy-target="copy-value">복사<\/button>/);
  assert.ok(res.text.includes('<script src="/copy.js" defer></script>'));
  assert.equal((res.text.match(/<script/g) ?? []).length, 1);
  for (const part of [/Homebrew/, /브라우저/, /코드/, /clone/, /로그인할 때마다/, /이전.*해제/])
    assert.match(res.text, part, String(part));
  assert.doesNotMatch(res.text, /이 허브는 사내 인증서/);
  assert.equal((await os.get("/mac")).status, 401, "needs a session");
  assert.equal((await os.get("/copy.js")).status, 200, "the page's script is served");

  for (const [label, h] of [["self-CA", await lan(t)], ["router without an installer", await openshift(t)]]) {
    const who = await h.enter(h.store.bootstrapAdmin());
    const page = await h.get("/mac", who);
    assert.equal(page.status, 200, label);
    assert.match(page.text, /이 허브는 사내 인증서를 써서 설치 한 줄을 쓸 수 없습니다/, label);
    assert.match(page.text, /<a href="\/start">내 Office 연결<\/a>/, label);
    assert.doesNotMatch(page.text, /curl|install\.sh|copy-value|<script/i, `${label}: no command and no script`);
  }
});

test("/mac lists my Macs with name, state, last check and a revoke button, and says how to turn an off Mac on; ?approved=1 says to go back to the terminal", async (t) => {
  let skew = 0;
  const h = await lan(t, { storeNow: () => Date.now() + skew });
  const { b } = await twoMembers(h);
  assert.match((await h.get("/mac", b)).text, /연결된 Mac이 없습니다/);
  assert.doesNotMatch((await h.get("/mac", b)).text, /허용했습니다/);

  const mac = h.pair(b.member, "회사 맥북");
  const waiting = (await h.get("/mac", b)).text;
  assert.match(waiting, /<td>회사 맥북<\/td>/);
  assert.match(waiting, /꺼짐/);
  assert.match(waiting, /아직 없음/, "no heartbeat yet");
  assert.match(waiting, /Mac에서 설치 명령을 다시 실행하면 켜집니다/);

  h.store.macHeartbeat(h.store.mac(mac.macToken), "limited", "claude 로그인이 필요합니다");
  const running = (await h.get("/mac?approved=1", b)).text;
  assert.match(running, /쉬는 중\(한도\)/);
  assert.match(running, /claude 로그인이 필요합니다/);
  assert.match(running, /방금/);
  assert.doesNotMatch(running, /Mac에서 설치 명령을 다시 실행하면 켜집니다/, "only an off Mac needs it");
  assert.match(running, /허용했습니다\. 터미널로 돌아가세요/);
  assert.match(running, new RegExp(`action="/macs/${mac.macId}/revoke"><input type="hidden" name="csrf" value="${b.csrf}"><button class="secondary">해제</button>`));
  assert.doesNotMatch((await h.get("/mac?approved=2", b)).text, /허용했습니다/, "only approved=1 says it");
});

test("/start nudges a member without a Mac to /mac in OpenShift mode only", async (t) => {
  const NUDGE = /이 Mac 연결 — 처음 한 번, 명령 한 줄/;
  const os = await openshift(t, INSTALLER);
  const admin = await os.enter(os.store.bootstrapAdmin());
  const nudged = (await os.get("/start", admin)).text;
  assert.match(nudged, NUDGE);
  assert.match(nudged, /<a href="\/mac">/);
  assert.ok(nudged.indexOf("이 Mac 연결 — 처음 한 번") < nudged.indexOf("<h1>내 Office 연결"), "it comes first");
  assert.match(nudged, /<h2>1\. Office 켜기/, "the existing steps are still there");
  os.pair(admin.member);
  assert.doesNotMatch((await os.get("/start", admin)).text, NUDGE, "a member with a Mac is not nudged");

  for (const [label, h] of [["self-CA", await lan(t)], ["router without an installer", await openshift(t)]]) {
    const who = await h.enter(h.store.bootstrapAdmin());
    assert.doesNotMatch((await h.get("/start", who)).text, NUDGE, label);
  }
});

test("a member revokes their own Mac; another member's revoke is 403; an admin revokes from /members", async (t) => {
  const h = await lan(t);
  const { admin, b } = await twoMembers(h);
  const c = await h.enter(h.store.createInvite(admin.member, "C"));
  const bMac = h.pair(b.member, "B의 Mac");
  const cMac = h.pair(c.member, "C의 Mac");

  const own = await h.post(`/macs/${bMac.macId}/revoke`, b);
  assert.deepEqual([own.status, own.headers.location], [303, "/mac"]);
  assert.equal(h.store.mac(bMac.macToken), null, "the token stopped");
  assert.deepEqual(h.store.macs(b.member.id), []);
  assert.match((await h.get("/mac", b)).text, /연결된 Mac이 없습니다/);

  const other = await h.post(`/macs/${cMac.macId}/revoke`, b);
  assert.equal(other.status, 403);
  assert.ok(h.store.mac(cMac.macToken), "C's Mac still runs");
  assert.equal((await h.post(`/macs/${cMac.macId}/revoke`, c, {}, { csrf: "wrong" })).status, 403, "a revoke needs the token");
  assert.equal((await h.post(`/macs/${cMac.macId}/revoke`, c, {}, { origin: EVIL })).status, 403, "and this hub's Origin");
  assert.equal((await h.post(`/macs/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/revoke`, admin)).status, 404, "a Mac that does not exist");
  assert.ok(h.store.mac(cMac.macToken), "nothing of that revoked it");

  const members = (await h.get("/members", admin)).text;
  assert.match(members, /<th>Mac<\/th>/);
  assert.match(members, /C의 Mac/);
  assert.match(members, new RegExp(`action="/macs/${cMac.macId}/revoke"><input type="hidden" name="csrf" value="${admin.csrf}"><button class="secondary">Mac 해제</button>`));
  assert.doesNotMatch(members, /B의 Mac/, "a revoked Mac is not listed");
  const byAdmin = await h.post(`/macs/${cMac.macId}/revoke`, admin);
  assert.deepEqual([byAdmin.status, byAdmin.headers.location], [303, "/members"], "back to the list the admin came from");
  assert.equal(h.store.mac(cMac.macToken), null);

  const mine = h.pair(admin.member, "관리자 Mac");
  const adminOwn = await h.post(`/macs/${mine.macId}/revoke`, admin);
  assert.deepEqual([adminOwn.status, adminOwn.headers.location], [303, "/mac"], "an admin's own Mac goes back to /mac");
  assert.equal((await h.get("/members", c)).status, 404, "a plain member has no /members");
});

test("a Mac name with <script> is escaped on the approve page, /mac and /members", async (t) => {
  const h = await lan(t);
  const { admin, b } = await twoMembers(h);
  const evil = `<script>alert("x")</script>`;
  const started = h.store.startMac(evil);
  const approve = (await h.get(`/mac/approve?code=${started.userCode}`, b)).text;
  assert.doesNotMatch(approve, /<script/i);
  assert.ok(approve.includes("&#60;script&#62;"), "the approve page shows the escaped name");
  h.store.approveMac(b.member, started.userCode);
  const mac = h.store.pollMac(started.deviceCode);
  h.store.macHeartbeat(h.store.mac(mac.macToken), "limited", `<script>detail</script>`);
  for (const [path, who] of [["/mac", b], ["/members", admin]]) {
    const text = (await h.get(path, who)).text;
    assert.doesNotMatch(text, /<script/i, path);
    assert.ok(text.includes("&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;"), `${path} shows the escaped name`);
    assert.ok(text.includes("&#60;script&#62;detail"), `${path} shows the escaped detail`);
  }
});

test("pages other than /mac still load no script, with or without a Mac", async (t) => {
  const os = await openshift(t, INSTALLER);
  const admin = await os.enter(os.store.bootstrapAdmin());
  const check = async () => {
    for (const path of ["/", "/repos", "/start", "/members", "/mac/approve?code=BCDF-0000", `/mac/approve?code=${os.store.startMac("x").userCode}`])
      assert.doesNotMatch((await os.get(path, admin)).text, /<script/i, path);
  };
  await check();
  os.pair(admin.member);
  await check();
});
