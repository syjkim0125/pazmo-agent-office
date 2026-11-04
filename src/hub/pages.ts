import { HUB_ANSWERABLE } from "./protocol.ts";
import type { MacBadge, MacView, Member, MemberView, RepoView, RequestRow, RequestView } from "./store.ts";

export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const STYLE = `:root{--bg:#f6f7f5;--fg:#1c2320;--muted:#5e6964;--line:#d6dcd8;--panel:#fff;--accent:#2b5d8a;--bad:#a8332b;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#141917;--fg:#e3eae6;--muted:#9aa59f;--line:#2b3430;--panel:#1b211e;--accent:#7fb0dc;--bad:#ec7a70;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel)}
nav{display:flex;flex-wrap:wrap;gap:14px;align-items:center}nav span{color:var(--muted)}
main{max-width:980px;margin:0 auto;padding:20px 16px 48px;display:grid;gap:20px}
a{color:var(--accent)}h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;margin:0 0 8px}h3{font-size:15px;margin:12px 0 6px}
section{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;min-width:0}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.scroll{overflow-x:auto}pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);padding:10px;border-radius:6px;margin:0;max-height:480px;overflow:auto}
form{display:grid;gap:8px}form.inline{display:inline-block;margin:2px}label{display:grid;gap:4px}
textarea,input,select{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--fg)}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:var(--panel);cursor:pointer}
button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.secondary{background:transparent;color:var(--accent)}button.danger{border-color:var(--bad);background:transparent;color:var(--bad)}
.muted{color:var(--muted)}.pill{display:inline-block;padding:0 8px;border-radius:999px;border:1px solid var(--line);font-size:13px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.code{font:600 24px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em}`;
const csrfField = (csrf: string) => `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
const button = (action: string, csrf: string, label: string, cls = "") =>
  `<form class="inline" method="post" action="${esc(action)}">${csrfField(csrf)}<button class="${cls}">${esc(label)}</button></form>`;
const stateLabel = (state: string, declined: boolean) => (declined && state === "cancelled" ? "거절됨" : STATE[state] ?? state);
const STATE: Record<string, string> = { open: "맡을 사람 대기", accepted: "진행 중", done: "완료", cancelled: "취소됨" };
const STATUS: Record<string, string> = { running: "실행 중", waiting: "답변·승인 대기", done: "완료", cancelled: "취소됨" };
const KIND: Record<string, string> = { story: "범위 승인 (G1)", questions: "PM 질문", "planning-retry": "계획 재개", G4: "최종 결과 승인 (G4)" };
const MAC_LABEL: Record<string, string> = { working: "일하는 중", idle: "대기 중", limited: "쉬는 중(한도)", locked: "잠김", off: "꺼짐" };
function ago(at: number | null) {
  if (!at) return "아직 없음";
  const minutes = Math.floor((Date.now() - at) / 60000);
  return minutes < 1 ? "방금" : minutes < 60 ? `${minutes}분 전` : `${Math.floor(minutes / 60)}시간 전`;
}
/** What the layout needs beyond the page itself: `trust` hides the certificate menu behind the router, and `mac` is the header's state. */
export type Chrome = { trust?: boolean; mac?: MacBadge | null };
/** The newest Mac's state in the header; a Mac whose last beat is older than the store's limit arrives as "off". */
const macBadge = (b: MacBadge) =>
  b.state === "none" ? "연결된 Mac 없음" : b.state === "off" ? `꺼짐(${b.lastSeen === null ? "아직 연락 없음" : ago(b.lastSeen)})` : MAC_LABEL[b.state] ?? b.state;
/** A Mac's state with the reason it gave, for the tables. */
const macState = (m: MacView) => `${MAC_LABEL[m.state] ?? m.state}${m.detail ? ` — ${m.detail}` : ""}`;

export function layout(title: string, me: Member | null, body: string, chrome: Chrome = {}) {
  const nav = me
    ? `<nav><a href="/">요청 게시판</a><a href="/start">내 Office 연결</a><a href="/repos">레포</a>${me.admin ? '<a href="/members">팀원·초대</a>' : ""}${chrome.trust === false ? "" : '<a href="/trust">인증서</a>'}<span>${esc(me.name)}</span>${chrome.mac ? `<a class="pill" href="/mac">내 Mac: ${esc(macBadge(chrome.mac))}</a>` : ""}</nav>`
    : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Pazmo 팀 허브</title><style>${STYLE}</style></head><body><header><b>Pazmo 팀 허브</b>${nav}</header><main>${body}</main></body></html>`;
}
export function error(message: string) {
  return layout("오류", null, `<section><h1>요청을 처리하지 못했습니다</h1><p>${esc(message)}</p><p><a href="/">처음으로</a></p></section>`);
}
export function signedOut() {
  return layout("초대 필요", null, `<section><h1>초대받은 사람만 들어올 수 있습니다</h1><p>관리자에게 초대 링크를 받아 열어주세요. 이미 등록한 브라우저라면 회수됐거나 30일 동안 쓰지 않아 만료된 것입니다.</p><p class="muted">메신저나 메일 같은 다른 앱에서 링크를 열었다면 이 페이지를 한 번 새로 고쳐주세요.</p></section>`);
}
export function invite(name: string | null) {
  if (!name)
    return layout("초대 링크", null, `<section><h1>쓸 수 없는 초대 링크입니다</h1><p>만료됐거나 이미 사용됐습니다. 관리자에게 새 링크를 받아주세요.</p></section>`);
  return layout("초대", null, `<section><h1>${esc(name)}님, Pazmo 팀 허브에 초대됐습니다</h1><p>입장하면 이 브라우저가 등록되고, 쓰는 동안 30일씩 로그인이 유지됩니다. 링크는 한 번만 쓸 수 있습니다.</p><form method="post"><label>이 기기 이름 (선택)<input name="label" maxlength="60" placeholder="예: 회사 맥북"></label><button>입장하기</button></form></section>`);
}
export function trust(fingerprint: string) {
  return layout("인증서 신뢰", null, `<section><h1>허브 인증서를 한 번 신뢰해주세요</h1><ol><li><a href="/ca.pem">허브 인증 기관 파일</a>을 받습니다.</li><li>파일을 열어 키체인 접근에 추가하고, 항목을 두 번 눌러 <b>신뢰 → 이 인증서 사용 시: 항상 신뢰</b>로 바꿉니다.</li><li>키체인에 보이는 SHA-256 지문이 아래와 같은지 확인합니다. 다르면 신뢰하지 말고 관리자에게 알려주세요.</li></ol><pre>${esc(fingerprint)}</pre></section>`);
}
/** `macNudge`: the hub can install a Mac in one line and this member has none yet. */
export function start(me: Member, csrf: string, o: { macNudge: boolean }, chrome: Chrome = {}) {
  const nudge = o.macNudge
    ? `<section><h2>이 Mac 연결 — 처음 한 번, 명령 한 줄</h2><p>Mac 터미널에서 명령 한 줄이면 필요한 프로그램 설치, 로그인, 담당 레포 내려받기, 자동 실행까지 끝납니다. <a href="/mac">이 Mac 연결</a>에서 명령을 복사하세요.</p></section>`
    : "";
  return layout("내 Office 연결", me, `${nudge}<section><h1>내 Office 연결</h1><p class="muted">세 단계면 이 허브로 일을 주고받을 수 있습니다.</p></section><section><h2>1. Office 켜기</h2><p>이 레포를 클론해 둔 내 PC에서 Office를 켭니다. 처음이면 관리자에게 설치 방법을 받으세요.</p></section><section><h2>2. 연결 문자열</h2><p>아래 버튼으로 연결 문자열을 만든 뒤 복사해, Office 상단의 팀 허브 버튼을 누르고 붙여넣어 연결하세요. 10분 안에 한 번만 쓸 수 있습니다.</p><form method="post" action="/start/connect-code">${csrfField(csrf)}<div><button>연결 문자열 만들기</button></div></form></section><section><h2>3. 일 보내기</h2><p>Office의 작업 카드나 채팅에서 '팀 허브로 보내기'로 다른 레포 담당자에게 일을 보냅니다.</p></section>`, chrome);
}
export function connectHelp() {
  return layout("Office에 붙여넣기", null, `<section><h1>Office에 붙여넣기</h1><p>이 주소는 Office에 붙여넣는 연결 문자열입니다. Office 상단의 팀 허브 버튼을 누르고 붙여넣은 뒤 연결을 누르세요.</p><p class="muted">연결 문자열은 허브의 <a href="/start">내 Office 연결</a>에서 만들 수 있습니다.</p></section>`);
}
export function created(me: Member, title: string, note: string, value: string, chrome: Chrome = {}) {
  return layout(title, me, `<section><h1>${esc(title)}</h1><p>${esc(note)}</p><pre id="copy-value">${esc(value)}</pre><p><span aria-live="polite"><button type="button" data-copy-target="copy-value">복사</button></span></p><p class="muted">이 값은 다시 보여 주지 않습니다.</p><p><a href="/">돌아가기</a></p></section><script src="/copy.js" defer></script>`, chrome);
}
export function board(me: Member, csrf: string, rows: RequestRow[], repos: RepoView[], view: string, chrome: Chrome = {}) {
  const tabs = [["all", "전체"], ["mine", "내 요청·맡은 일"], ["repos", "내 레포"]]
    .map(([v, label]) => (v === view ? `<b>${label}</b>` : `<a href="/?view=${v}">${label}</a>`))
    .join(" · ");
  const form = repos.length
    ? `<form method="post" action="/requests">${csrfField(csrf)}<label>레포<select name="repo" required>${repos.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select></label><label>요청 내용 <span class="muted">(최대 16384바이트, 한글 약 5400자)</span><textarea name="body" rows="4" maxlength="16384" required placeholder="무엇을 바꾸고, 어떻게 확인하면 되는지 적어주세요."></textarea></label><label>위험도<select name="risk"><option value="normal">보통</option><option value="high">높음 (추가 승인 필요)</option></select></label><button>요청 올리기</button></form>`
    : `<p>먼저 <a href="/repos">레포를 등록</a>해주세요.</p>`;
  const table = rows.length
    ? `<div class="scroll"><table><thead><tr><th>레포</th><th>요청</th><th>요청자</th><th>맡은 사람</th><th>상태</th><th>갱신</th></tr></thead><tbody>${rows
        .map((r) => {
          const label = r.state === "accepted" && r.status ? STATUS[r.status] ?? r.status : stateLabel(r.state, r.declined);
          return `<tr><td>${esc(r.repoName)}</td><td><a href="/requests/${esc(r.id)}">${esc(r.body.slice(0, 80))}</a></td><td>${esc(r.requesterName)}</td><td>${esc(r.assigneeName ?? "-")}</td><td><span class="pill">${esc(label)}</span></td><td>${ago(r.updatedAt)}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : `<p class="muted">아직 요청이 없습니다.</p>`;
  return layout("요청 게시판", me, `<section><h1>새 요청</h1>${form}</section><section><h2>요청 게시판</h2><p>${tabs}</p>${table}</section>`, chrome);
}
export function request(me: Member, csrf: string, v: RequestView, chrome: Chrome = {}) {
  const s = v.snapshot;
  const answerable = new Set<string>(HUB_ANSWERABLE);
  const actions = [
    v.canAccept ? button(`/requests/${v.id}/accept`, csrf, "내가 맡기") : "",
    v.isAssignee ? button(`/requests/${v.id}/release`, csrf, "반납하기", "secondary") : "",
    v.canDecline
      ? `<form method="post" action="/requests/${esc(v.id)}/decline">${csrfField(csrf)}<label>거절 사유 <span class="muted">(선택, 500자까지)</span><textarea name="reason" rows="2" maxlength="500"></textarea></label><div class="row"><button class="danger">거절</button></div></form>`
      : "",
    (v.isRequester || v.isAssignee) && (v.state === "open" || v.state === "accepted")
      ? button(`/requests/${v.id}/cancel`, csrf, "요청 취소", "danger")
      : "",
  ].join("");
  const decisions =
    s && v.state === "accepted"
      ? s.decisions
          .map((d) => {
            const pending = v.answers.some((a) => a.decisionId === d.id && a.state === "pending");
            const ask = !answerable.has(d.kind)
              ? `<p class="muted">이 결정은 맡은 사람(${esc(v.assignee?.name)})이 자기 Office에서 처리합니다.</p>`
              : !v.isRequester
                ? `<p class="muted">요청한 사람(${esc(v.requester.name)})이 답합니다.</p>`
                : pending
                  ? `<p>보낸 답변이 Office 전달을 기다리고 있습니다.</p>`
                  : `<form method="post" action="/requests/${esc(v.id)}/answer">${csrfField(csrf)}<input type="hidden" name="decision" value="${esc(d.id)}"><label>답변<textarea name="note" rows="4" maxlength="16000" placeholder="질문이 여러 개면 1. 2. 형식으로 번호별로 답해주세요."></textarea></label><div class="row"><button name="option" value="1">${esc(d.options.find((o) => o.number === 1)?.label ?? "답변 제출")}</button><button class="danger" name="option" value="2">요청 취소</button></div></form>`;
            return `<article><h3>${esc(KIND[d.kind] ?? d.kind)}</h3><pre>${esc(d.summary)}</pre>${ask}</article>`;
          })
          .join("")
      : "";
  const answers = v.answers.length
    ? `<h3>보낸 답변</h3><ul>${v.answers
        .map((a) => {
          const state = a.state === "applied" ? "전달됨" : a.state === "rejected" ? "전달 실패" : "전달 대기";
          const why = a.state === "rejected" ? (a.result?.startsWith("STALE_APPROVAL") ? " — 질문이 바뀌었어요. 새 질문에 다시 답해주세요." : ` — ${esc(a.result)}`) : "";
          return `<li>${state} · ${esc(a.note.slice(0, 120))}${why}</li>`;
        })
        .join("")}</ul>`
    : "";
  const progress = s
    ? `<section><h2>진행</h2><p><span class="pill">${esc(STATUS[s.status] ?? s.status)}</span> ${esc(s.message)}</p><p class="muted">마지막 소식 ${ago(v.snapshotAt)} · Office 연결 확인 ${ago(v.officeSeen)} · <a href="/requests/${esc(v.id)}">새로 고침</a></p>${s.summary ? `<pre>${esc(s.summary)}</pre>` : ""}</section>`
    : v.state === "accepted"
      ? `<section><h2>진행</h2><p>맡은 사람의 Office가 아직 작업을 받지 않았습니다. Office 연결 확인 ${ago(v.officeSeen)}.</p></section>`
      : "";
  return layout("요청", me, [
    `<section><p class="muted">${esc(v.repo.name)} · 요청자 ${esc(v.requester.name)} · 위험도 ${v.risk === "high" ? "높음" : "보통"}</p>${v.source ? `<p class="muted">출처: ${esc(v.source)}${v.parentId ? ` · <a href="/requests/${esc(v.parentId)}">상위 요청</a>` : ""}</p>` : ""}<h1>${esc(s?.title ?? v.body.slice(0, 80))}</h1><pre>${esc(v.body)}</pre><p><span class="pill">${esc(stateLabel(v.state, v.declined))}</span> 맡은 사람: ${esc(v.assignee?.name ?? "없음")}</p>${v.declined ? `${v.declineNote ? `<p>거절 사유: ${esc(v.declineNote)}</p>` : ""}${v.declinedBy ? `<p class="muted">거절한 사람: ${esc(v.declinedBy)}</p>` : ""}` : ""}<div class="row">${actions}</div></section>`,
    progress,
    decisions || answers ? `<section><h2>질문·승인</h2>${decisions}${answers}</section>` : "",
    s?.diff ? `<section><h2>변경 내용</h2>${s.diff.truncated ? '<p class="muted">길어서 앞부분만 보여 줍니다.</p>' : ""}<pre>${esc(s.diff.text)}</pre></section>` : "",
    s?.conversation.length
      ? `<section><h2>역할 대화</h2><div class="scroll"><table><tbody>${s.conversation.map((m) => `<tr><td class="muted">${esc(new Date(m.at).toLocaleString("ko-KR"))}</td><td>${esc(m.who)}</td><td><pre>${esc(m.text)}</pre></td></tr>`).join("")}</tbody></table></div></section>`
      : "",
    s?.runners.length ? `<section><h2>실행기</h2><ul>${s.runners.map((r) => `<li>${esc(r.role)} · ${esc(r.runner)} ${esc(r.version)} · ${esc(r.model)}</li>`).join("")}</ul></section>` : "",
  ].join(""), chrome);
}
export function repos(me: Member, csrf: string, list: RepoView[], members: MemberView[], chrome: Chrome = {}) {
  const active = members.filter((m) => !m.revoked);
  const rows = list
    .map((r) => {
      const manage = r.isOwner || me.admin;
      const owners = r.owners
        .map((o) => `${esc(o.name)}${manage && r.owners.length > 1 ? button(`/repos/${r.id}/owners/${o.id}/remove`, csrf, "빼기", "secondary") : ""}`)
        .join(", ");
      const candidates = active.filter((m) => !r.owners.some((o) => o.id === m.id));
      const add = manage && candidates.length
        ? `<form class="row" method="post" action="/repos/${esc(r.id)}/owners">${csrfField(csrf)}<select name="member" aria-label="담당자로 추가할 팀원">${candidates.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select><button class="secondary">담당자 추가</button></form>`
        : "";
      const links = r.links.length
        ? r.links
            .map((l) => `${esc(l.memberName)} (확인 ${ago(l.lastSeen)})${l.memberId === me.id || me.admin ? button(`/links/${l.id}/revoke`, csrf, "연결 해제", "secondary") : ""}`)
            .join("<br>")
        : '<span class="muted">연결된 Office 없음</span>';
      const link = r.isOwner ? '<a href="/start">내 Office 연결</a>' : "";
      return `<tr><td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.remote)}</span></td><td>${owners}${add}</td><td>${links}<br>${link}</td></tr>`;
    })
    .join("");
  return layout("레포", me, `<section><h1>레포 등록</h1><form method="post" action="/repos">${csrfField(csrf)}<label>이름<input name="name" required maxlength="80" placeholder="app-be"></label><label>git 원격 주소 (origin)<input name="remote" required placeholder="https://github.example.com/team/app-be.git"></label><button>등록 (내가 첫 담당자)</button></form></section><section><h2>팀 레포</h2>${list.length ? `<div class="scroll"><table><thead><tr><th>레포</th><th>담당자</th><th>연결된 Office</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">아직 등록된 레포가 없습니다.</p>'}</section>`, chrome);
}
export function members(me: Member, csrf: string, list: MemberView[], chrome: Chrome = {}) {
  const rows = list
    .map((m) => {
      const devices = m.devices
        .map((d) => `${esc(d.label)}${d.revoked ? " (끊김)" : ` (만료 ${esc(new Date(d.expiresAt).toLocaleDateString("ko-KR"))}) ${button(`/devices/${d.id}/revoke`, csrf, "기기 회수", "secondary")}`}`)
        .join("<br>");
      const macs = m.macs.map((k) => `${esc(k.name)} (${esc(macState(k))}) ${button(`/macs/${k.id}/revoke`, csrf, "Mac 해제", "secondary")}`).join("<br>");
      const actions = m.revoked
        ? ""
        : button(`/members/${m.id}/device-invite`, csrf, "새 기기 링크", "secondary") +
          (m.id === me.id ? "" : button(`/members/${m.id}/revoke`, csrf, "팀원 회수", "danger"));
      return `<tr><td>${esc(m.name)}${m.admin ? ' <span class="pill">관리자</span>' : ""}${m.revoked ? ' <span class="pill">회수됨</span>' : ""}</td><td>${devices}</td><td>${macs}</td><td>${actions}</td></tr>`;
    })
    .join("");
  return layout("팀원·초대", me, `<section><h1>팀원 초대</h1><form method="post" action="/invites">${csrfField(csrf)}<label>받는 사람 이름<input name="name" required maxlength="40"></label><button>초대 링크 만들기</button></form></section><section><h2>팀원</h2><div class="scroll"><table><thead><tr><th>이름</th><th>등록한 브라우저</th><th>Mac</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`, chrome);
}
export function mac(me: Member, csrf: string, o: { macs: MacView[]; install: string | null; approved: boolean }, chrome: Chrome = {}) {
  const done = o.approved ? `<section role="status"><h2>허용했습니다. 터미널로 돌아가세요</h2><p>설치가 끝나고 Office가 켜지면 아래 표에서 내 Mac의 상태를 볼 수 있습니다.</p></section>` : "";
  const connect = o.install
    ? `<section><h1>이 Mac 연결</h1><p>Apple Silicon Mac의 터미널에서 아래 한 줄을 실행하세요. 처음 한 번이면 되고, 관리자 암호는 필요 없습니다.</p><pre id="copy-value">${esc(o.install)}</pre><p><span aria-live="polite"><button type="button" data-copy-target="copy-value">복사</button></span></p><h3>이 명령이 하는 일</h3><ol><li>필요한 프로그램(Node, git, GitHub CLI, Colima, Docker, Claude Code)을 설치합니다. 이미 있으면 건너뛰고, Homebrew가 먼저 있어야 합니다.</li><li>브라우저가 열리면 GitHub와 Claude에 로그인합니다.</li><li>터미널에 코드가 나오고 이 허브의 허용 화면이 열립니다. 터미널의 코드와 같은지 확인하고 허용하세요.</li><li>내가 담당하는 레포를 이 Mac에 clone합니다.</li><li>이 Mac에 로그인할 때마다 Office가 자동으로 켜집니다.</li></ol><p class="muted">연결된 Mac은 한 사람에 하나입니다. 새 Mac을 연결하면 이전 Mac 연결은 해제됩니다.</p></section><script src="/copy.js" defer></script>`
    : `<section><h1>이 Mac 연결</h1><p>이 허브는 사내 인증서를 써서 설치 한 줄을 쓸 수 없습니다. 지금처럼 <a href="/start">내 Office 연결</a>(/start)로 레포마다 연결하세요.</p></section>`;
  const off = o.macs.some((k) => k.state === "off");
  const table = o.macs.length
    ? `<div class="scroll"><table><thead><tr><th>이름</th><th>상태</th><th>마지막 확인</th><th></th></tr></thead><tbody>${o.macs
        .map((k) => `<tr><td>${esc(k.name)}</td><td><span class="pill">${esc(macState(k))}</span></td><td>${ago(k.lastSeen)}</td><td>${button(`/macs/${k.id}/revoke`, csrf, "해제", "secondary")}</td></tr>`)
        .join("")}</tbody></table></div>${off ? '<p class="muted">Mac에서 설치 명령을 다시 실행하면 켜집니다.</p>' : ""}`
    : '<p class="muted">연결된 Mac이 없습니다.</p>';
  return layout("내 Mac", me, `${done}${connect}<section><h2>내 Mac</h2>${table}</section>`, chrome);
}
const macForm = (action: string, csrf: string, code: string, label: string, cls = "") =>
  `<form class="inline" method="post" action="${action}">${csrfField(csrf)}<input type="hidden" name="code" value="${esc(code)}"><button${cls ? ` class="${cls}"` : ""}>${label}</button></form>`;
export function macApprove(me: Member, csrf: string, code: string, info: { name: string; createdAt: number }, chrome: Chrome = {}) {
  return layout("Mac 허용", me, `<section><h1>이 Mac을 허용할까요?</h1><p>Mac 이름: <b>${esc(info.name)}</b></p><p>코드 <span class="code">${esc(code)}</span></p><p class="muted">요청한 때 ${esc(new Date(info.createdAt).toLocaleString("ko-KR"))} (${ago(info.createdAt)})</p><p>Mac 터미널의 코드와 같고 지금 내 앞의 Mac일 때만 허용하세요. 허용하면 이 Mac이 내 이름으로 이 허브에 연결되고, 이전에 연결한 내 Mac은 해제됩니다.</p><div class="row">${macForm("/mac/approve", csrf, code, "이 Mac 허용")}${macForm("/mac/deny", csrf, code, "거절", "danger")}</div></section>`, chrome);
}
export function macCodeGone(me: Member, chrome: Chrome = {}) {
  return layout("코드 만료", me, `<section><h1>이 코드는 쓸 수 없습니다</h1><p>코드가 만료됐거나 이미 쓰였거나 잘못된 코드입니다. Mac 터미널에서 설치 명령을 다시 실행하면 새 코드가 나옵니다.</p><p><a href="/mac">내 Mac</a></p></section>`, chrome);
}
export function macSignedOut() {
  return layout("로그인 필요", null, `<section><h1>먼저 이 브라우저로 허브에 들어와야 합니다</h1><p>이 브라우저에서 관리자에게 받은 <b>초대 링크</b>를 먼저 열어주세요. 이미 등록한 팀원이라면 <b>새 기기 링크</b>를 받아 열면 됩니다. 입장한 뒤 이 주소를 다시 열어주세요. 터미널에 나온 허용 주소입니다.</p><p>Mac 터미널의 코드는 10분 동안 그대로 유지됩니다.</p><p class="muted">메신저나 메일 같은 다른 앱에서 링크를 열었다면 이 페이지를 한 번 새로 고쳐주세요.</p></section>`);
}
