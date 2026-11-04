import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:https";
import { promisify } from "node:util";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficeError } from "../src/cli/project.ts";
import { hubCall } from "../src/runtime/hub-link.ts";
import { teamDir } from "../src/team/registry.ts";
import {
  MAC_POLL_MS,
  defaultMacName,
  macClient,
  macLinkPath,
  pairMac,
  readMacLink,
  removeMacLink,
  writeMacLink,
} from "../src/team/mac.ts";
import { startTestHub } from "./hub-fixture.mjs";

const execFileAsync = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-\d{4}$/;
const HUB = "https://hub.example.com";
const RERUN = "curl -fsSL 'https://hub.example.com/install.sh' | sh";
const DEVICE = "D".repeat(43);
const TOKEN = "T".repeat(43);

function tmpRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-mac-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
/** A real Hub with its admin; `call` is hubCall trusting the test CA and speaking protocol 4, as macCall does for a public Hub. */
async function liveHub(t) {
  const ctx = await startTestHub(t);
  const admin = ctx.store.acceptInvite(ctx.store.bootstrapAdmin(), "mac").member;
  const call = (target, method, path, body, protocol = "4") =>
    hubCall({ hub: target.hub, caPem: ctx.tls.caPem, fingerprint: ctx.tls.fingerprint, token: target.token }, method, path, body, protocol);
  return { ...ctx, admin, call, url: ctx.hub.url };
}
/** The Mac side of the device flow, with the web's allow done through the store. */
async function pairLive(h, member, name = "내 Mac") {
  const start = await h.call({ hub: h.url }, "POST", "/api/mac/start", { name });
  h.store.approveMac(member, start.userCode);
  const poll = await h.call({ hub: h.url }, "POST", "/api/mac/token", { deviceCode: start.deviceCode });
  assert.equal(poll.state, "approved");
  return { ...poll, deviceCode: start.deviceCode };
}
const sink = () => {
  const lines = [];
  return { lines, say: (line) => lines.push(line) };
};
/** A clock that only moves when pairMac sleeps. */
function clock() {
  const c = { t: 1_000_000, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.sleeps.push(ms);
    c.t += ms;
  };
  return c;
}
const started = (over = {}) => ({ deviceCode: DEVICE, userCode: "BCDF-1234", approveUrl: `${HUB}/mac/approve?code=BCDF-1234`, expiresIn: 600, ...over });
const approved = (over = {}) => ({ state: "approved", macToken: TOKEN, macId: "mac-1", member: { id: "m1", name: "김" }, ...over });
/** A scripted Hub. `start` is a reply or an Error; each /api/mac/token call takes the next of `polls` (an Error is thrown, anything else returned), the last one repeating. */
function fakeHub({ start = started(), polls = [{ state: "pending" }] } = {}) {
  const queue = [...polls];
  const hub = { calls: [] };
  hub.call = async (target, method, path, body) => {
    hub.calls.push({ target, method, path, body });
    const next = path === "/api/mac/start" ? start : queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next;
  };
  hub.polls = () => hub.calls.filter((c) => c.path === "/api/mac/token").length;
  return hub;
}
const hubError = (status, code, extra = {}) => Object.assign(new Error(code), { status, code, ...extra });
const code = (c) => (e) => e instanceof Error && e.code === c;
const fatalText = (e) => `${e.message}\n${String(e)}\n${e.stack}\n${JSON.stringify(e)}`;

test("pairMac prints the user code, opens the approve URL, and returns the token once the web approves", async (t) => {
  const h = await liveHub(t);
  const { lines, say } = sink();
  const opened = [];
  let deviceCode;
  const spy = async (target, method, path, body) => {
    const reply = await h.call(target, method, path, body);
    if (path === "/api/mac/start") deviceCode = reply.deviceCode;
    return reply;
  };
  const result = await pairMac({
    hub: h.url, name: "내 Mac", say, call: spy, sleep: async () => {},
    open: async (url) => {
      opened.push(url);
      h.store.approveMac(h.admin, new URL(url).searchParams.get("code"));
    },
  });
  assert.equal(opened.length, 1);
  const userCode = new URL(opened[0]).searchParams.get("code");
  assert.match(userCode, USER_CODE);
  assert.equal(opened[0], `${h.url}/mac/approve?code=${userCode}`);
  assert.deepEqual(lines, [`브라우저에서 이 Mac을 허용해 주세요: ${opened[0]}`, `코드: ${userCode} (10분 안에)`]);
  assert.deepEqual(Object.keys(result).sort(), ["macId", "macToken", "member"]);
  assert.match(result.macToken, SECRET);
  assert.deepEqual(result.member, { id: h.admin.id, name: h.admin.name });
  assert.equal(h.store.mac(result.macToken).id, result.macId, "the token works on the Hub");
  assert.equal(h.store.macs(h.admin.id)[0].name, "내 Mac", "the name reached the Hub");
  assert.ok(!opened[0].includes(deviceCode));
});

test("pairMac asks again every poll interval until the web approves", async (t) => {
  const h = await liveHub(t);
  for (const [pollMs, expected] of [[undefined, MAC_POLL_MS], [500, 500]]) {
    let userCode;
    const sleeps = [];
    const result = await pairMac({
      hub: h.url, name: "내 Mac", say: () => {}, call: h.call,
      ...(pollMs ? { pollMs } : {}),
      open: async (url) => {
        userCode = new URL(url).searchParams.get("code");
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 2) h.store.approveMac(h.admin, userCode);
      },
    });
    assert.deepEqual(sleeps, [expected, expected], "two pending answers, then the allow");
    assert.match(result.macToken, SECRET);
  }
  assert.equal(MAC_POLL_MS, 3000);
});

test("an open that fails only tells the person to open the URL themselves", async (t) => {
  const h = await liveHub(t);
  const { lines, say } = sink();
  let userCode;
  const result = await pairMac({
    hub: h.url, name: "내 Mac", say, call: async (target, method, path, body) => {
      const reply = await h.call(target, method, path, body);
      if (path === "/api/mac/start") userCode = reply.userCode;
      return reply;
    },
    open: async () => {
      throw new Error("spawn /usr/bin/open ENOENT");
    },
    sleep: async () => h.store.approveMac(h.admin, userCode),
  });
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes(`${h.url}/mac/approve?code=${userCode}`), "the URL is still shown");
  assert.match(lines[2], /위 주소를 직접 열어/);
  assert.ok(!lines.join("\n").includes("ENOENT"));
  assert.match(result.macToken, SECRET);
});

test("pairMac stops with MAC_DENIED when the web denies, naming the rerun command", async () => {
  const hub = fakeHub({ polls: [{ state: "pending" }, { state: "denied" }] });
  const c = clock();
  await assert.rejects(
    pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: hub.call, now: c.now, sleep: c.sleep }),
    (e) => e instanceof OfficeError && e.code === "MAC_DENIED" && e.message.includes(RERUN),
  );
  assert.equal(hub.polls(), 2);
});

test("pairMac stops with MAC_CODE_EXPIRED when the Hub says expired, naming the rerun command", async () => {
  const hub = fakeHub({ polls: [{ state: "expired" }] });
  const c = clock();
  await assert.rejects(
    pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: hub.call, now: c.now, sleep: c.sleep }),
    (e) => e instanceof OfficeError && e.code === "MAC_CODE_EXPIRED" && e.message.includes(RERUN),
  );
  assert.equal(hub.polls(), 1);
  assert.deepEqual(c.sleeps, []);
});

test("pairMac gives up with MAC_CODE_EXPIRED when the code's own life (expiresIn) passes, and never polls past it", async () => {
  const hub = fakeHub({ start: started({ expiresIn: 9 }) });
  const c = clock();
  await assert.rejects(
    pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: hub.call, now: c.now, sleep: c.sleep }),
    (e) => e instanceof OfficeError && e.code === "MAC_CODE_EXPIRED" && e.message.includes(RERUN),
  );
  assert.deepEqual(c.sleeps, [3000, 3000, 3000]);
  assert.equal(hub.polls(), 4, "polls at 0, 3, 6 and 9 seconds, then stops");

  // A Hub that names a longer life than the protocol's 600 seconds does not stretch the wait.
  const long = fakeHub({ start: started({ expiresIn: 100000 }) });
  const d = clock();
  await assert.rejects(
    pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: long.call, now: d.now, sleep: d.sleep }),
    code("MAC_CODE_EXPIRED"),
  );
  assert.equal(d.t - 1_000_000, 600_000);
  assert.ok(long.polls() <= 201);
});

test("pairMac keeps polling through a network error and a 503 until approved", async () => {
  const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  const hub = fakeHub({
    polls: [
      reset,
      hubError(503, "HUB_503"),
      hubError(502, "BAD_GATEWAY", { message: "bad gateway" }),
      new Error("HUB_BAD_RESPONSE_503"), // a router's HTML "application is not available" page
      new Error("HUB_TIMEOUT"),
      { state: "pending" },
      approved(),
    ],
  });
  const c = clock();
  const result = await pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: hub.call, now: c.now, sleep: c.sleep });
  assert.deepEqual(result, { macId: "mac-1", macToken: TOKEN, member: { id: "m1", name: "김" } });
  assert.equal(hub.polls(), 7);
  assert.equal(c.sleeps.length, 6);
});

test("pairMac does not keep polling through an answer that will not change: a refused certificate, a 400 or a 429", async () => {
  for (const failure of [
    Object.assign(new Error("허브 인증서를 확인할 수 없습니다."), { code: "HUB_TLS_UNTRUSTED" }),
    hubError(400, "INVALID"),
    hubError(429, "RATE_LIMITED"),
  ]) {
    const hub = fakeHub({ polls: [{ state: "pending" }, failure] });
    const c = clock();
    await assert.rejects(
      pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: hub.call, now: c.now, sleep: c.sleep }),
      (e) => e === failure,
    );
    assert.equal(hub.polls(), 2);
  }
});

test("a Hub without the Mac routes (426, a 404, or a 401 HTML page) is HUB_TOO_OLD, at start and while polling", async () => {
  const tooOld = (e) => e instanceof OfficeError && e.code === "HUB_TOO_OLD" && e.message.includes(RERUN);
  const failures = [hubError(426, "PROTOCOL_MISMATCH", { expected: "4" }), hubError(404, "NOT_FOUND"), new Error("HUB_BAD_RESPONSE_401"), new Error("HUB_BAD_RESPONSE_200")];
  for (const failure of failures) {
    const c = clock();
    const atStart = fakeHub({ start: failure });
    await assert.rejects(pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: atStart.call, now: c.now, sleep: c.sleep }), tooOld);
    const whilePolling = fakeHub({ polls: [{ state: "pending" }, failure] });
    await assert.rejects(pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: whilePolling.call, now: c.now, sleep: c.sleep }), tooOld);
    assert.equal(whilePolling.polls(), 2);
  }
});

test("a real Hub that speaks another protocol, and a server that answers HTML, are told apart", async (t) => {
  const h = await liveHub(t);
  // The real Hub's own 426 for a protocol it does not serve here.
  await assert.rejects(
    pairMac({ hub: h.url, name: "Mac", say: () => {}, open: async () => {}, call: (target, m, p, b) => h.call(target, m, p, b, "2") }),
    code("HUB_TOO_OLD"),
  );
  // A server that is not a Hub: an HTML 401 for every route.
  let status = 401;
  let tokenAsks = 0;
  const server = createServer({ key: h.tls.keyPem, cert: h.tls.certPem }, (req, res) => {
    req.resume();
    req.on("end", () => {
      const origin = `https://127.0.0.1:${server.address().port}`;
      if (status === 0 && req.url === "/api/mac/start") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(started({ approveUrl: `${origin}/mac/approve?code=BCDF-1234` })));
      }
      if (status === 0 && req.url === "/api/mac/token") {
        // The router's HTML 503 twice, then the answer.
        if (++tokenAsks <= 2) {
          res.writeHead(503, { "content-type": "text/html" });
          return res.end("<html>Application is not available</html>");
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(approved()));
      }
      res.writeHead(status || 500, { "content-type": "text/html" });
      res.end("<html><body>sign in</body></html>");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `https://127.0.0.1:${server.address().port}`;
  await assert.rejects(pairMac({ hub: origin, name: "Mac", say: () => {}, open: async () => {}, call: h.call }), code("HUB_TOO_OLD"));
  status = 0;
  const c = clock();
  const result = await pairMac({ hub: origin, name: "Mac", say: () => {}, open: async () => {}, call: h.call, now: c.now, sleep: c.sleep });
  assert.equal(result.macToken, TOKEN, "an HTML 503 is a Hub that is restarting, not an old one");
  assert.equal(tokenAsks, 3);
});

test("pairMac refuses an http hub, a path, a query, a fragment or user info before anything is sent", async () => {
  for (const hub of [
    "http://hub.example.com", "https://hub.example.com/team", "https://hub.example.com/?x=1", "https://hub.example.com/?",
    "https://hub.example.com#frag", "https://hub.example.com/#", "https://user:pass@hub.example.com", "https://user@hub.example.com",
    "hub.example.com", "", "not a url", "ftp://hub.example.com", "https://hub.example.com'$(id)'",
  ]) {
    const hubSpy = fakeHub();
    const { lines, say } = sink();
    let opened = 0;
    await assert.rejects(
      pairMac({ hub, name: "Mac", say, call: hubSpy.call, open: async () => void opened++ }),
      (e) => e instanceof OfficeError && e.code === "HUB_URL_INVALID" && !e.message.includes("pass"),
      hub,
    );
    assert.deepEqual([hubSpy.calls.length, lines.length, opened], [0, 0, 0], `nothing happens for ${JSON.stringify(hub)}`);
  }
  // A port and a trailing slash are fine, and name the origin.
  const spy = fakeHub({ start: started({ approveUrl: "https://hub.example.com:8443/mac/approve?code=BCDF-1234" }), polls: [approved()] });
  await pairMac({ hub: "https://hub.example.com:8443/", name: "Mac", say: () => {}, open: async () => {}, call: spy.call });
  assert.equal(spy.calls[0].target.hub, "https://hub.example.com:8443");
});

test("a start reply of the wrong shape, or an approve URL that is not the one the Hub should send, is HUB_BAD_RESPONSE and opens nothing", async () => {
  const badStarts = [
    null, "text", {}, started({ deviceCode: "short" }), started({ deviceCode: undefined }), started({ userCode: "ABCD1234" }), started({ userCode: "AEIO-1234" }),
    started({ expiresIn: 0 }), started({ expiresIn: "600" }), started({ expiresIn: -1 }), started({ approveUrl: undefined }),
    started({ approveUrl: `http://hub.example.com/mac/approve?code=BCDF-1234` }),
    started({ approveUrl: `https://user:pw@hub.example.com/mac/approve?code=BCDF-1234` }),
    started({ approveUrl: `https://hub.example.com/elsewhere?code=BCDF-1234` }),
    started({ approveUrl: `https://hub.example.com/mac/approve?code=ZZZZ-9999` }),
    started({ approveUrl: `https://hub.example.com/mac/approve?code=BCDF-1234&device=${DEVICE}` }),
    started({ approveUrl: `https://hub.example.com/mac/approve?code=BCDF-1234#${DEVICE}` }),
    started({ approveUrl: `https://${DEVICE}.example.com/mac/approve?code=BCDF-1234` }),
    started({ approveUrl: `https://hub.example.com/mac/approve` }),
    started({ approveUrl: `/mac/approve?code=BCDF-1234` }), started({ approveUrl: "javascript:alert(1)" }),
    // Another origin than the Hub this Mac pairs with: another host, a look-alike, another port.
    started({ approveUrl: `https://evil.example.com/mac/approve?code=BCDF-1234` }),
    started({ approveUrl: `https://hub.example.com.evil.example/mac/approve?code=BCDF-1234` }),
    started({ approveUrl: `https://hub.example.com:8443/mac/approve?code=BCDF-1234` }),
  ];
  for (const start of badStarts) {
    const hub = fakeHub({ start });
    const c = clock(); // a start that is wrongly accepted then ends on the fake clock, not in a real ten-minute wait
    const { lines, say } = sink();
    let opened = 0;
    await assert.rejects(
      pairMac({ hub: HUB, name: "Mac", say, call: hub.call, open: async () => void opened++, now: c.now, sleep: c.sleep }),
      (e) => e instanceof Error && e.code === "HUB_BAD_RESPONSE" && e.message === "HUB_BAD_RESPONSE",
      JSON.stringify(start),
    );
    assert.deepEqual([lines.length, opened, hub.polls()], [0, 0, 0]);
  }
});

test("a poll reply of the wrong shape is HUB_BAD_RESPONSE and never echoes what the Hub sent", async () => {
  const leaked = "L".repeat(10);
  const badPolls = [
    null, {}, { state: "weird" }, { state: "approved" }, approved({ macToken: leaked }), approved({ macToken: undefined }), approved({ macId: "" }),
    approved({ member: null }), approved({ member: { id: "m1" } }), approved({ member: { id: 1, name: "x" } }),
  ];
  for (const poll of badPolls) {
    const hub = fakeHub({ polls: [poll] });
    await assert.rejects(
      pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: hub.call }),
      (e) => e.code === "HUB_BAD_RESPONSE" && e.message === "HUB_BAD_RESPONSE" && !fatalText(e).includes(leaked),
      JSON.stringify(poll),
    );
  }
});

test("pairMac prints a member name without control characters, including C1 ones", async () => {
  const hub = fakeHub({ polls: [approved({ member: { id: "m1", name: "김\u009b31m\u0007민" } })] });
  const result = await pairMac({ hub: HUB, name: "Mac", say: () => {}, open: async () => {}, call: hub.call });
  assert.doesNotMatch(result.member.name, /[\u0000-\u001f\u007f-\u009f]/);
  assert.match(result.member.name, /^김.31m.민$/);
});

test("nothing pairMac says, opens or throws contains the device code or the token", async (t) => {
  const h = await liveHub(t);
  const seen = { say: [], open: [], secrets: new Set() };
  const spy = async (target, method, path, body) => {
    const reply = await h.call(target, method, path, body);
    if (reply?.deviceCode) seen.secrets.add(reply.deviceCode);
    if (reply?.userCode) seen.userCode = reply.userCode;
    if (reply?.macToken) seen.secrets.add(reply.macToken);
    return reply;
  };
  const run = (decide, extra = {}) =>
    pairMac({
      hub: h.url, name: "Mac", say: (l) => seen.say.push(l), call: spy, sleep: async () => {}, ...extra,
      open: async (url) => {
        seen.open.push(url);
        decide(new URL(url).searchParams.get("code"));
      },
    });
  const result = await run((c) => h.store.approveMac(h.admin, c));
  const denied = await run((c) => h.store.denyMac(h.admin, c)).catch((e) => e);
  assert.equal(denied.code, "MAC_DENIED");
  // The browser cannot be opened, and the person allows it by hand.
  const byHand = await run(() => {}, {
    open: async () => {
      throw new Error("no browser");
    },
    sleep: async () => h.store.approveMac(h.admin, seen.userCode),
  });
  assert.match(byHand.macToken, SECRET);
  // A run that times out on the fake clock, against a recognisable device code.
  const hub = fakeHub({ start: started({ expiresIn: 3 }) });
  const c = clock();
  const expired = await pairMac({ hub: HUB, name: "Mac", say: (l) => seen.say.push(l), call: hub.call, open: async () => {}, now: c.now, sleep: c.sleep }).catch((e) => e);
  assert.equal(expired.code, "MAC_CODE_EXPIRED");
  // The Hub's own deny and expired answers, against the same recognisable device code.
  const refusals = [];
  for (const state of ["denied", "expired"]) {
    const scripted = fakeHub({ polls: [{ state }] });
    refusals.push(await pairMac({ hub: HUB, name: "Mac", say: (l) => seen.say.push(l), call: scripted.call, open: async () => {} }).catch((e) => e));
  }
  assert.deepEqual(refusals.map((e) => e.code), ["MAC_DENIED", "MAC_CODE_EXPIRED"]);
  seen.secrets.add(DEVICE).add(result.macToken).add(byHand.macToken);
  const everything = [...seen.say, ...seen.open, fatalText(denied), fatalText(expired), ...refusals.map(fatalText)].join("\n");
  assert.ok(seen.secrets.size >= 4);
  for (const secret of seen.secrets) assert.ok(!everything.includes(secret), "no secret reaches a line, a URL or an error");
});

test("mac-link.json is written 0600 under <root>/team, atomically, and read back", (t) => {
  const root = tmpRoot(t);
  const file = {
    version: 1, hub: HUB, macId: "mac-1", macToken: TOKEN, memberId: "m1", memberName: "김", name: "내 Mac",
  };
  assert.equal(readMacLink(root), null, "no file is no link");
  assert.equal(macLinkPath(root), join(root, "team", "mac-link.json"));
  assert.equal(macLinkPath(root), join(teamDir(root), "mac-link.json"));
  writeMacLink(root, file);
  assert.equal(statSync(macLinkPath(root)).mode & 0o777, 0o600);
  assert.equal(statSync(teamDir(root)).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(teamDir(root)), ["mac-link.json"], "no temporary file is left");
  assert.deepEqual(readMacLink(root), file);
  assert.deepEqual(JSON.parse(readFileSync(macLinkPath(root), "utf8")), file);
  // A second write replaces it, and the origin is stored without a trailing slash.
  writeMacLink(root, { ...file, hub: `${HUB}/`, macId: "mac-2", memberName: "김\u0085민" });
  assert.deepEqual(readMacLink(root), { ...file, macId: "mac-2", memberName: "김 민" });
  assert.deepEqual(readdirSync(teamDir(root)), ["mac-link.json"]);
  assert.equal(statSync(macLinkPath(root)).mode & 0o777, 0o600);
  removeMacLink(root);
  assert.equal(existsSync(macLinkPath(root)), false);
  assert.equal(readMacLink(root), null);
  removeMacLink(root); // already gone is fine
});

test("writing mac-link.json tightens a team folder that others can read", (t) => {
  const root = tmpRoot(t);
  mkdirSync(join(root, "team"), { mode: 0o755 });
  chmodSync(join(root, "team"), 0o755);
  writeMacLink(root, { version: 1, hub: HUB, macId: "mac-1", macToken: TOKEN, memberId: "m1", memberName: "김", name: "Mac" });
  assert.equal(statSync(teamDir(root)).mode & 0o777, 0o700);
});

test("a mac-link.json that others can read is MAC_LINK_PERMISSIONS, without its content", (t) => {
  const root = tmpRoot(t);
  writeMacLink(root, { version: 1, hub: HUB, macId: "mac-1", macToken: TOKEN, memberId: "m1", memberName: "김", name: "Mac" });
  for (const mode of [0o640, 0o604, 0o644, 0o660, 0o666]) {
    chmodSync(macLinkPath(root), mode);
    assert.throws(
      () => readMacLink(root),
      (e) => e instanceof OfficeError && e.code === "MAC_LINK_PERMISSIONS" && e.message.includes(macLinkPath(root)) && !e.message.includes(TOKEN),
      mode.toString(8),
    );
  }
  chmodSync(macLinkPath(root), 0o400);
  assert.equal(readMacLink(root).macToken, TOKEN, "owner-only read is fine");
});

test("a corrupt or wrongly shaped mac-link.json is MAC_LINK_INVALID without its content, and a bad value is never written", (t) => {
  const root = tmpRoot(t);
  const good = { version: 1, hub: HUB, macId: "mac-1", macToken: TOKEN, memberId: "m1", memberName: "김", name: "Mac" };
  mkdirSync(teamDir(root), { mode: 0o700 });
  const put = (text) => writeFileSync(macLinkPath(root), text, { mode: 0o600 });
  const invalid = (e) => e instanceof OfficeError && e.code === "MAC_LINK_INVALID" && !fatalText(e).includes("SECRETMARKER") && !fatalText(e).includes(TOKEN);
  const bad = [
    `{"version":1,"macToken":"SECRETMARKER"`, "not json SECRETMARKER", "", "null", "[]", '"SECRETMARKER"', "42",
    JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, version: undefined }),
    JSON.stringify({ ...good, hub: "http://hub.example.com" }), JSON.stringify({ ...good, hub: `${HUB}/path` }), JSON.stringify({ ...good, hub: "SECRETMARKER" }),
    JSON.stringify({ ...good, macToken: "short" }), JSON.stringify({ ...good, macToken: "SECRETMARKER".padEnd(43, "x") + "!" }),
    JSON.stringify({ ...good, macId: "" }), JSON.stringify({ ...good, memberId: 7 }), JSON.stringify({ ...good, memberName: null }), JSON.stringify({ ...good, name: undefined }),
  ];
  for (const text of bad) {
    put(text);
    assert.throws(() => readMacLink(root), invalid, text);
  }
  rmSync(macLinkPath(root));
  for (const value of [null, {}, { ...good, macToken: "short" }, { ...good, hub: "http://hub.example.com" }, { ...good, version: 2 }, "text"]) {
    assert.throws(() => writeMacLink(root, value), invalid);
    assert.deepEqual(readdirSync(teamDir(root)), [], "neither the file nor a temporary one is left");
  }
  // Fields beyond the shape are not carried along.
  put(JSON.stringify({ ...good, extra: "x" }));
  assert.deepEqual(readMacLink(root), good);
});

test("a mac-link.json reached through a symlink is refused", (t) => {
  const root = tmpRoot(t);
  const elsewhere = join(root, "elsewhere.json");
  writeFileSync(elsewhere, JSON.stringify({ version: 1, hub: HUB, macId: "m", macToken: TOKEN, memberId: "m1", memberName: "김", name: "Mac" }), { mode: 0o600 });
  mkdirSync(teamDir(root), { mode: 0o700 });
  symlinkSync(elsewhere, macLinkPath(root));
  assert.throws(() => readMacLink(root), code("UNSAFE_PATH"));
  assert.throws(
    () => writeMacLink(root, { version: 1, hub: HUB, macId: "n", macToken: TOKEN, memberId: "m1", memberName: "김", name: "Mac" }),
    code("UNSAFE_PATH"),
  );
  assert.equal(JSON.parse(readFileSync(elsewhere, "utf8")).macId, "m", "what the link pointed at was not written");
});

test("defaultMacName is the host name without .local, trimmed, without control characters, and 1 to 60 characters", () => {
  assert.equal(defaultMacName("Jongkkim-MacBook-Pro.local"), "Jongkkim-MacBook-Pro");
  assert.equal(defaultMacName("  Kim's Mac.LOCAL \n"), "Kim's Mac");
  assert.equal(defaultMacName("a\u0007b\u009bc"), "a b c");
  assert.equal(defaultMacName("plain"), "plain");
  assert.equal(defaultMacName("x".repeat(100)), "x".repeat(60));
  assert.equal(defaultMacName("😀".repeat(40)), "😀".repeat(30), "never cut in the middle of a character");
  assert.equal(defaultMacName(`${"y".repeat(59)}😀`), "y".repeat(59), "a pair that would pass the limit is dropped whole");
  for (const empty of ["", "   ", ".local", " .LOCAL "]) assert.equal(defaultMacName(empty), "Mac");
  const here = defaultMacName();
  assert.ok(here.length >= 1 && here.length <= 60);
  assert.doesNotMatch(here, /\.local$|[\u0000-\u001f\u007f-\u009f]/i);
});

const link = (over = {}) => ({ version: 1, hub: HUB, macId: "mac-1", macToken: TOKEN, memberId: "m1", memberName: "김", name: "Mac", ...over });
const REPO = { repoId: "r1", name: "app-be", remote: "github.example.com/team/app-be", linked: false };
const LINKED = { token: "K".repeat(43), member: { id: "m1", name: "김" }, repoId: "r1", repoName: "app-be" };

test("macClient sends each request to the right route with the Mac token, and returns what the Hub said", async () => {
  const calls = [];
  const replies = {
    "GET /api/mac/repos": { repos: [REPO] },
    "POST /api/mac/link": LINKED,
    "POST /api/mac/heartbeat": { ok: true },
    "POST /api/mac/revoke": { ok: true },
  };
  const client = macClient(link(), async (target, method, path, body) => {
    calls.push({ target, method, path, body });
    return replies[`${method} ${path}`];
  });
  assert.deepEqual(await client.repos(), [REPO]);
  assert.deepEqual(await client.link("r1"), LINKED);
  assert.equal(await client.heartbeat("working", "claude"), undefined);
  assert.equal(await client.heartbeat("idle", null), undefined);
  assert.equal(await client.revoke(), undefined);
  const target = { hub: HUB, token: TOKEN };
  assert.deepEqual(calls, [
    { target, method: "GET", path: "/api/mac/repos", body: undefined },
    { target, method: "POST", path: "/api/mac/link", body: { repoId: "r1" } },
    { target, method: "POST", path: "/api/mac/heartbeat", body: { state: "working", detail: "claude" } },
    { target, method: "POST", path: "/api/mac/heartbeat", body: { state: "idle", detail: null } },
    { target, method: "POST", path: "/api/mac/revoke", body: {} },
  ]);
});

test("macClient makes a heartbeat detail the Hub accepts: no control characters, at most 200 characters", async () => {
  const bodies = [];
  const client = macClient(link(), async (_t, _m, _p, body) => (bodies.push(body), { ok: true }));
  await client.heartbeat("limited", "claude\n로그인\u009b 필요");
  await client.heartbeat("limited", "x".repeat(300));
  await client.heartbeat("limited", `${"y".repeat(199)}😀`);
  assert.equal(bodies[0].detail, "claude 로그인  필요");
  assert.equal(bodies[1].detail, "x".repeat(200));
  assert.equal(bodies[2].detail, "y".repeat(199), "never half a character");
});

test("macClient refuses a reply of the wrong shape with HUB_BAD_RESPONSE", async () => {
  const wrong = async (run, replies) => {
    for (const reply of replies)
      await assert.rejects(run(macClient(link(), async () => reply)), (e) => e.code === "HUB_BAD_RESPONSE" && e.message === "HUB_BAD_RESPONSE", JSON.stringify(reply));
  };
  await wrong((c) => c.repos(), [
    null, "x", [], {}, { repos: {} }, { repos: [null] }, { repos: [{ ...REPO, linked: "yes" }] }, { repos: [{ ...REPO, linked: undefined }] },
    { repos: [{ ...REPO, repoId: "" }] }, { repos: [{ ...REPO, name: 1 }] }, { repos: [{ ...REPO, remote: null }] }, { repos: [REPO, { name: "x" }] },
  ]);
  await wrong((c) => c.link("r1"), [
    null, {}, { ...LINKED, token: "short" }, { ...LINKED, token: undefined }, { ...LINKED, member: null }, { ...LINKED, member: { id: "m1" } },
    { ...LINKED, repoId: "other" }, { ...LINKED, repoName: "" }, { ...LINKED, repoName: undefined },
  ]);
  await wrong((c) => c.heartbeat("idle", null), [null, {}, { ok: false }, { ok: "true" }, "ok"]);
  await wrong((c) => c.revoke(), [null, {}, { ok: false }, []]);
  // A reply with extra fields is still the right shape.
  assert.deepEqual(await macClient(link(), async () => ({ repos: [{ ...REPO, more: 1 }], more: 2 })).repos(), [REPO]);
});

test("macClient lets a Hub error through as it came (status and code), for the caller to classify", async () => {
  const client = macClient(link(), async () => {
    throw hubError(401, "UNAUTHORIZED");
  });
  for (const run of [() => client.repos(), () => client.link("r1"), () => client.heartbeat("idle", null), () => client.revoke()])
    await assert.rejects(run(), (e) => e.status === 401 && e.code === "UNAUTHORIZED");
});

test("macClient works against a real Hub: repos, link, heartbeat and revoke", async (t) => {
  const h = await liveHub(t);
  const { store, admin } = h;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const be = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be.git");
  store.addRepo(admin, "app-fe", "https://github.example.com/team/app-fe.git");
  store.addOwner(admin, be, b.id);
  const paired = await pairLive(h, b);
  const client = macClient(link({ hub: h.url, macId: paired.macId, macToken: paired.macToken, memberId: b.id, memberName: b.name }), h.call);

  const repos = await client.repos();
  assert.deepEqual(repos, [{ repoId: be, name: "app-be", remote: "github.example.com/team/app-be", linked: false }], "only what the member owns");
  const linked = await client.link(be);
  assert.match(linked.token, SECRET);
  assert.deepEqual([linked.member, linked.repoId, linked.repoName], [{ id: b.id, name: b.name }, be, "app-be"]);
  assert.equal(store.link(linked.token)?.repoId, be, "the minted link works");
  assert.equal((await client.repos())[0].linked, true);

  assert.equal(await client.heartbeat("working", "claude 작업 중"), undefined);
  assert.deepEqual([store.macs(b.id)[0].state, store.macs(b.id)[0].detail], ["working", "claude 작업 중"]);
  await client.heartbeat("limited", `줄\n바꿈 ${"x".repeat(300)}`);
  assert.equal(store.macs(b.id)[0].state, "limited");
  assert.equal(store.macs(b.id)[0].detail.length, 200);
  await client.heartbeat("idle", null);
  assert.equal(store.macs(b.id)[0].detail, null);

  await client.revoke();
  assert.equal(store.link(linked.token), null, "the Mac's repo links stop with it");
  await assert.rejects(client.repos(), (e) => e.status === 401 && e.code === "UNAUTHORIZED");
  await assert.rejects(client.heartbeat("idle", null), (e) => e.status === 401);
});

/** Runs macClient with the default macCall in another process, so the system roots (plus NODE_EXTRA_CA_CERTS) decide trust. */
async function repoCountInChild({ hub, macToken, extraCa }) {
  const script = `
    import { macClient } from ${JSON.stringify(ROOT + "src/team/mac.ts")};
    const file = { version: 1, hub: ${JSON.stringify(hub)}, macId: "m", macToken: process.env.MAC_TOKEN, memberId: "x", memberName: "x", name: "x" };
    try {
      console.log(JSON.stringify({ ok: true, repos: (await macClient(file).repos()).length }));
    } catch (e) { console.log(JSON.stringify({ ok: false, code: e.code ?? e.message, status: e.status ?? null })); }`;
  const env = { ...process.env, MAC_TOKEN: macToken, ...(extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {}) };
  if (!extraCa) delete env.NODE_EXTRA_CA_CERTS;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" });
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

test("the default macCall trusts the system roots and speaks protocol 4 with the Bearer token", async (t) => {
  const h = await liveHub(t);
  h.store.addRepo(h.admin, "app-be", "https://github.example.com/team/app-be.git"); // its creator owns it
  const paired = await pairLive(h, h.admin);
  const d = tmpRoot(t);
  const ca = join(d, "ca.pem");
  writeFileSync(ca, h.tls.caPem);
  // Protocol 4 and the token are what the Hub needs to answer 200: any other header would be 426 or 401.
  assert.deepEqual(await repoCountInChild({ hub: h.url, macToken: paired.macToken, extraCa: ca }), { ok: true, repos: 1 });
  assert.deepEqual(await repoCountInChild({ hub: h.url, macToken: "X".repeat(43), extraCa: ca }), { ok: false, code: "UNAUTHORIZED", status: 401 });
  // Without the extra root the test CA is not trusted: no pin is used.
  const untrusted = await repoCountInChild({ hub: h.url, macToken: paired.macToken });
  assert.deepEqual(untrusted, { ok: false, code: "HUB_TLS_UNTRUSTED", status: null });
});
