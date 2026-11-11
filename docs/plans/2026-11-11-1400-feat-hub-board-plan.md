# 칸반 보드 Hub와 로컬 올리기 (D42) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hub 웹의 첫 화면을 프로젝트별 Story·Task 칸반으로 바꾸고(카드마다 맡은 사람·Mac 상태·칸에 머문 시간, 10초 저절로 업데이트), PL이 자기 Mac의 claude 대화에서 만든 kit Story와 Task 그래프를 `pazmo-office team upload` 한 번으로 검사·올리기·Story base·열기까지 하게 한다.

**Architecture:**
- **Hub:** `StoryBoard`에 칸 시각(`column_at`)과 보드 조회를, `HubStore`에 사람별 Mac 상태 조회와 연결의 Mac을, 새 표 `hub_story_uploads`와 연결 경로 `upload`·`upload-bases`를 더한다. 웹은 `/` 보드, `/me`(옛 내 할 일), `/team`, `/live.js`.
- **PL의 Mac:** 새 `src/team/upload.ts`가 kit Story·G1(·G3)·Task 파일을 검사하고 Hub에 올린 뒤, 기획 Office에서 꺼낸 `src/team/story-bases.ts`로 Story base를 만들고 연다. AI는 쓰지 않는다.
- **바뀌지 않는 것:** 웹 기획(`PlanBoard`, 묶음 3), Office의 Task 자동 실행, 연결 프로토콜 1–4의 기존 경로·필드, 웹 승인의 해시·revision 확인, 권한, 각 버튼이 하는 일.

**Tech Stack:** Node 24(`node:sqlite`, `node:test`, 타입 제거 실행), npm 의존성 0, 서버가 만드는 HTML과 작은 정적 스크립트 둘(`/copy.js`, 새 `/live.js`), 호스트 git은 `branch.ts`의 `git()`로만.

**Spec:** 설계 `docs/understanding/hub-board-local-upload-plan.md`(G3 2026-11-11, K1–K9와 "꼭 지킬 것"), Story `docs/understanding/pazmo-agent-office-contract.md`의 D42·V20·M16.

## Global Constraints

- **작업 위치:** worktree `.worktrees/hub-easy-flow`, 브랜치 `feat/hub-easy-flow`(시작 `0acd1d9` = origin/main). 부모 체크아웃으로 `cd`하지 않는다. push는 PR 때만. kit 실행 `.ai-workflow/runs/U39-hub-board.json`(머지 전에 main에서 U39·D42가 비었는지 다시 확인).
- **Node 24:** `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:$PATH"`. 시험 하나는 `node --experimental-vm-modules --test <파일>`. 전체 `npm test`는 한 번에 하나만(`pgrep -fl -- "--test"`로 확인). 새 npm 의존성 없음.
- **더하기만:** 기존 시험은 문구·메뉴·`/` 주소가 바뀐 곳만 고친다. 고친 시험마다 커밋 메시지에 "무엇이 바뀌어서"를 적는다.
- **화면:** 쉬운 한국어. 모든 값은 `esc()`. 새 POST는 지금의 Origin·CSRF 검사와 POST-redirect-GET(303). 스크립트는 `<script src="/live.js" defer></script>`(GET 화면에만)와 기존 `/copy.js`뿐. CSP는 `connect-src 'self'` 한 항목만 더한다.
- **공개 레포:** 사내 호스트·조직·repo 이름을 커밋하지 않는다. 시험 repo는 `app-be`·`app-fe`, 원격은 `github.example.com/team/<이름>`.
- **원격 쓰기:** `feature/story-<N>/base` 만들기 하나(지금 `branch.pushStoryBase`). 강제 push·다른 ref·지우기 없음.
- **값:**

  | 항목 | 값 |
  |---|---|
  | 저절로 업데이트 주기 | 10000 ms, 탭이 보일 때만 |
  | 로그인 전 주소 쿠키 | `pazmo_next`, `Max-Age=259200`(72시간), `HttpOnly; Secure; SameSite=Lax; Path=/`, 값 300자 이하 |
  | 기억할 수 있는 경로 | `/`, `/board`, `/me`, `/team`, `/mac`, `/stories/<id>`, `/tasks/<id>`, `/plans/<id>` (쿼리 없음) |
  | 완료 칸 | Story마다 최근 머지 5장, 나머지는 "N개 더"(Story 화면 링크) |
  | Hub 올리기 키 | `upload:<kit Story 해시>` (지금 `publishStory`의 PL·키 멱등) |
  | Story 글 | 지금 `storyBodyBytes`(32768바이트) 이하 |
  | Task 수 | 지금 Hub 그래프 한도(`LIMITS`) 그대로 |

- **새 오류 코드:** Hub `NOT_YOUR_MAC` 403, `NOT_OWNER` 403, `BASES_CHANGED` 409(기존 이름 재사용), `UPLOAD_CANCELLED` 409. 명령 `UPLOAD_G1`, `UPLOAD_G3`, `UPLOAD_STORY`, `UPLOAD_TASKS`, `UPLOAD_COVERAGE`, `UPLOAD_REPO`, `UPLOAD_LINK`. 메시지는 쉬운 한국어 한 문장 + 고칠 방법.
- **kit·검증:** 변경 기록 `docs/verification/2026-11-11-hub-board.md`와 `docs/STATUS.md`는 kit 노드 증거로 적지 않는다. 변경 기록은 kit 리뷰 전에 끝내고 그 뒤 고치지 않는다. STATUS는 G4와 `graph.mjs delivery` 뒤에 컨트롤러가 쓴다. kit 프로필(`.ai-workflow/verification.json`)은 이미 V20과 `requiresG3`를 담았다. 설계 문서는 G3에 묶여 있어 고치지 않는다.

## Review Focus

1. **열린 화면이 사라진 경우:** Story가 취소되거나 권한이 바뀌어 다시 읽기가 404·403·500을 받으면, 화면을 바꾸지 않고 그 탭의 저절로 업데이트를 멈춘다(오류 페이지로 갈아 끼우지 않음). → Task 3 시험 `stops on non-200 non-304 without touching main`.
2. **이상한 글자:** 카드 제목·Mac 이름·사람 이름에 `<img onerror>`·아주 긴 글·이모지가 있어도 이스케이프되고 카드 밖으로 넘치지 않는다. → Task 2 시험 `board escapes card text`(CSS `overflow-wrap:anywhere`).
3. **CRLF Story:** Windows 줄끝이나 끝 공백이 있는 Story 파일도, kit이 같은 파일로 계산한 해시와 명령의 해시가 같다. → Task 7 시험 `kit hash matches kit storyContract on CRLF`(같은 바이트를 `.ai-workflow/graph/workflow.mjs`의 `storyContract`와 `kitStoryHash`에 넣어 비교).
4. **Mac을 바꾼 PL:** 새 Mac을 연결해 옛 Mac이 해제됐는데 옛 Mac에서 올리면 `NOT_YOUR_MAC`과 "지금 연결된 Mac에서 다시 실행하세요". → Task 6 시험.
5. **웹에서 취소한 뒤 다시 올리기:** 같은 글이면 `UPLOAD_CANCELLED`("이 Story는 취소됐습니다. Story 글을 고쳐 새 승인을 받은 뒤 올리세요"), 새 Story를 몰래 만들지 않는다. → Task 6 시험.

---

### Task 1: 보드 데이터 (칸, 칸 시각, 일정한 조회)

**Files:**
- Create: `src/hub/board.ts`
- Modify: `src/hub/story-store.ts`(스키마 이동·스탬프·조회), `src/hub/store.ts`(`macBadges`)
- Test: `tests/hub-board-store.test.mjs`

**Interfaces:**
- Produces:
  - `type BoardColumn = "backlog" | "todo" | "doing" | "review" | "done" | "hidden"` (`board.ts`)
  - `taskColumn(state: TaskViewState, stage: string | null): BoardColumn` (`board.ts`): waiting→backlog, ready→todo, claimed·held·failed는 stage가 `review|verify|merge`면 review 아니면 doing, merged·passed→done, cancelled→hidden.
  - `StoryBoard.board(a: Actor, o: { mine: boolean; cancelled: boolean }): BoardProject[]`
  - `type BoardCard = { taskId: string; storyId: string; number: number; title: string; kind: "work" | "verify"; repo: { id: string; name: string } | null; state: TaskViewState; stage: string | null; column: BoardColumn; columnAt: number; assignee: { id: string; name: string } | null; failure: string | null; heartbeatAt: number | null }`
  - `type BoardStory = { id: string; number: number; title: string; state: StoryState; risk: "normal" | "high"; pl: { id: string; name: string }; cards: BoardCard[]; doneMore: number }`
  - `type BoardProject = { project: ProjectView; stories: BoardStory[] }`
  - `StoryBoard.currentTasks(): Map<string, { taskId: string; storyNumber: number; number: number; title: string }>` (사람 id → 지금 맡은 Task)
  - `HubStore.macBadges(): Map<string, MacBadge>` (`#macRows(null)` 한 번, 사람마다 가장 새 Mac)

- [ ] **Step 1: 실패하는 시험 쓰기** — `tests/hub-board-store.test.mjs`(`tests/hub-story-fixture.mjs` 사용):
  - `taskColumn maps every state and stage`: 위 표의 모든 조합을 `assert.equal`로.
  - `column_at changes only when the column changes`: 가짜 시계로 claim(t=1000) → heartbeat build(t=2000, columnAt 1000 그대로) → heartbeat review(t=3000, 3000) → heartbeat review(t=4000, 3000 그대로) → reportMerged(t=5000, 5000).
  - `migrated rows fall back to claimed or created time`: `column_at` 칸이 없는 옛 스키마 DB를 만든 뒤 `StoryBoard`를 열면 칸이 생기고, 옛 Task의 `columnAt`이 `claimed_at ?? created_at`.
  - `board caps done at five and counts the rest`: 머지 7개 → cards의 done 5, `doneMore` 2, 가장 최근 머지 순.
  - `board hides cancelled unless asked`: `cancelled:false`면 없음, `true`면 `column: "hidden"`으로 있음.
  - `mine keeps my Stories and Stories with my cards`: PL·맡은 사람·남의 것 세 경우.
  - `board query count does not grow with projects`: 프로젝트 1개와 5개(각 Story 3, Task 4)에서 `db.prepare` 호출 수를 세어 같음(감싼 db 객체로 셈).
  - `macBadges returns the newest Mac per member`: Mac 둘인 사람, 꺼진 Mac(180000 ms 넘음) → `off`.
- [ ] **Step 2: 실패 확인** — `node --experimental-vm-modules --test tests/hub-board-store.test.mjs` → FAIL(`board.ts` 없음).
- [ ] **Step 3: 구현** — `hub_story_tasks`에 `column_at INTEGER`와 `column_key TEXT`를 `HubStore#migrate`(`store.ts:226-238`)처럼 `PRAGMA table_info` 뒤 `ALTER TABLE … ADD COLUMN`으로 더한다. 저장된 상태·단계가 바뀌는 모든 쓰기(`#insertTask`, `#recompute`, `#claim`, `heartbeat`, `releaseTask`, `cancelStory`·Task 취소, `reportMerged`, `reportVerify`, `addTasks`의 검증 되돌리기, 다시 시도, 작업하기) 뒤에 한 private `#touchColumn(taskId)`가 `taskColumn(저장 상태, stage)`(held는 저장 상태가 아니므로 claimed로 계산)과 `column_key`를 비교해 다를 때만 `column_at=now`. `board()`는 Story들 한 번, Task들 한 번(`CARD_SELECT`처럼 join, 프로젝트 id·Story 상태 포함), 프로젝트 한 번으로 만든다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. 그리고 `tests/hub-story-store*.test.mjs`·`tests/hub-plan*.test.mjs` 전부 PASS.
- [ ] **Step 5: 커밋** — `feat: record when a Task changes board column and read the board in fixed queries`

### Task 2: 보드 화면, 메뉴, `/me`, `/team`

**Files:**
- Create: `src/hub/paths.ts`, `src/hub/board-pages.ts`
- Modify: `src/hub/pages.ts`(`layout` 메뉴·CSS·`team`), `src/hub/server.ts`(라우트), `src/hub/story-pages.ts`(옛 `workBoard` 지우기, `home`은 `/me`용)
- Test: `tests/hub-board-page.test.mjs`, 그리고 `/`·메뉴를 쓰는 기존 시험(`tests/hub-story-pages.test.mjs`, `tests/hub-plan-pages.test.mjs`, `tests/hub-mac-pages.test.mjs`, `tests/hub-start-page.test.mjs`)

**Interfaces:**
- Consumes: Task 1의 `board`, `currentTasks`, `macBadges`, `taskColumn`.
- Produces:
  - `safePath(raw: string | null | undefined): string | null` (`paths.ts`): `/`로 시작, `//`·`\`·제어 문자·`%2f`(대소문자) 없음, 300자 이하, 아래 허용 정규식 중 하나에 맞을 때만 그대로, 아니면 null. 허용: `^/$`, `^/board$`, `^/me$`, `^/team$`, `^/mac$`, `^/(stories|tasks|plans)/[0-9a-f-]{36}$`.
  - `boardPage(me: Member, csrf: string, v: { projects: BoardProject[]; plans: PlanCard[]; badges: Map<string, MacBadge>; mine: boolean; cancelled: boolean; canCreateProject: boolean; canPlan: Set<string> }, chrome: Chrome): string` (`board-pages.ts`)
  - `teamPage(me: Member, rows: { id: string; name: string; admin: boolean; mac: MacBadge; autoWork: boolean; task: { taskId: string; label: string } | null }[], o: { trust: boolean }, chrome: Chrome): string` (`pages.ts`)
  - `Chrome`에 `path?: string`(스위치가 돌아올 곳)과 Task 3이 쓸 `live?: boolean`.

- [ ] **Step 1: 실패하는 시험 쓰기** — `tests/hub-board-page.test.mjs`(`startTestHub`·`team()` 패턴):
  - `slash is the board with five columns per Story`: Story 하나에 Task 다섯 상태 → `/` HTML에 칸 머리 `백로그`·`할 일`·`진행 중`·`리뷰`·`완료`와 각 카드가 맞는 칸 안에.
  - `card shows assignee, Mac state and time in column`: 맡은 Task 카드에 `A`, `일하는 중`, `6분째`(가짜 시계로 360000 ms). Mac이 꺼지면 `꺼짐 · 마지막 확인 4분 전`.
  - `story card shows state, PL and who works now`: Story 카드에 `진행 중`(open)·`Story 검증`(verifying)·`승인 대기`(awaiting_g4)·`완료`(done) 중 맞는 말, PL 이름, 지금 맡은 Task가 있는 사람들 이름(중복 없이), 웹 기획 프로젝트에는 지금처럼 [새 Story] 링크(`canPlan`).
  - `stopped card stays in its column with a plain reason`: 실패한 리뷰 단계 Task → 리뷰 칸에 `멈춤`과 `plainFailure` 문장.
  - `planning lanes`: 웹 기획 중(`PlanCard`)과 열리기 전 Story가 `기획 중` 레인, 링크는 각각 `/plans/<id>`·`/stories/<id>`.
  - `mine and cancelled toggles are links`: `/?mine=1`, `/?cancelled=1`이 결과를 바꾸고 화면에 켜짐 표시.
  - `board escapes card text`: 제목·Mac 이름·사람 이름에 `<img src=x onerror=alert(1)>`와 300자 글 → `&#60;img`, 원문 `<img` 없음.
  - `menu is board and team`: `<nav>` 안에 `href="/"`(보드)와 `href="/team"`(팀)만 주 링크, 요청 게시판·내 Office 연결 링크 없음. 오른쪽에 자동으로 일하기 스위치 폼과 `내 Mac:` 알약.
  - `auto-work switch returns to the page it was pressed on`: `/team`에서 누르면 303 `Location: /team`, `back=https://evil.example/` → `/`.
  - `old home lives at /me`: `/me`에 `지금 맡은 일`·`받을 수 있는 일`·[작업하기] 그대로.
  - `team page for everyone`: 팀원(관리자 아님)이 `/team`에서 모든 사람의 Mac 상태·지금 하는 Task 링크·자동으로 일하기를 봄, 팀원·초대 링크는 관리자에게만.
  - `old addresses still answer`: `/requests`, `/start`, `/repos`, `/board`가 200.
  - `hub without a board is unchanged`: 보드 없는 Hub의 `/`는 요청 게시판, 메뉴도 지금 그대로.
- [ ] **Step 2: 실패 확인** — 새 시험 파일 → FAIL.
- [ ] **Step 3: 구현** — `/`(보드가 있을 때)와 `/board`는 `boardPage`, `/me`는 지금의 `home`, `/team`은 `teamPage`(`members()`에서 회수 안 된 사람, `macBadges`, `autoWork`, `currentTasks`). `layout`은 보드가 있는 Hub에서 메뉴를 보드·팀으로, 오른쪽에 스위치 폼(`back`=`chrome.path`)과 Mac 알약. `/me/auto-work`는 `safePath(f("back")) ?? "/"`로 303. 보드 CSS: Story 레인마다 다섯 칸 grid, 좁은 화면에서는 칸이 세로로, `overflow-wrap:anywhere`. 옛 `workBoard`는 지운다. 기존 시험은 `/`를 `/me`로, 메뉴 정규식을 새 메뉴로 고친다.
- [ ] **Step 4: 통과 확인** — 새 시험과 `tests/hub-*.test.mjs` 전부 PASS.
- [ ] **Step 5: 커밋** — `feat: make the Hub's first page a board of Story lanes and Task cards`

### Task 3: 저절로 업데이트 (`/live.js`, ETag, CSP)

**Files:**
- Create: `src/hub/live-script.ts`
- Modify: `src/hub/server.ts`(`/live.js`, CSP, ETag/304), `src/hub/pages.ts`(`layout`이 `chrome.live`면 스크립트, 새로 고침 링크에 `class="refresh"`, `.live` CSS), 화면 함수들(보드·`/me`·`/team`·Story·Task·기획·`/mac` GET에서 `live: true`)
- Test: `tests/hub-live.test.mjs`, 그리고 CSP·스크립트 없음을 단정하는 기존 시험(`tests/hub-server.test.mjs:56-93`, `tests/hub-story-pages.test.mjs:496-508`, `tests/hub-mac-pages.test.mjs:99-135,366-367,519-528`)

**Interfaces:**
- Produces: `LIVE_SCRIPT: string`(`live-script.ts`). 동작: 시작하면 `document.documentElement.classList.add("live")`. 10000 ms마다 `document.hidden`이면 쉼, 폼 안 입력 칸 중 `value !== defaultValue`·`checked !== defaultChecked`·`selected !== defaultSelected`가 하나라도 있거나 `document.activeElement`가 input·textarea·select면 쉼. 아니면 `fetch(location.href, { headers: { "If-None-Match": etag }, cache: "no-store", credentials: "same-origin" })`. 304면 그대로, 200이면 `ETag`를 기억하고 `DOMParser`로 새 `<main>` 안쪽과 `document.title`만 바꿈, 그 밖의 상태(401 포함)면 멈춤.

- [ ] **Step 1: 실패하는 시험 쓰기** — `tests/hub-live.test.mjs`:
  - `serves live.js without a session`: 200, `text/javascript`.
  - `CSP adds only connect-src self`: 모든 응답의 CSP가 지금 값 + `; connect-src 'self'`.
  - `GET pages carry an ETag and answer 304`: 보드를 두 번 읽어 두 번째에 `If-None-Match` → 304, 본문 없음. Task가 바뀐 뒤에는 200.
  - `script only on live GET pages`: 보드·`/me`·`/team`·Story·Task·기획·`/mac`에 `<script src="/live.js" defer></script>` 하나. 일회용 값 화면, 오류 화면, 400으로 다시 그린 폼, `/mac/approve`에는 없음.
  - vm으로 `LIVE_SCRIPT` 실행(가짜 `document`·`fetch`·`setInterval`·`DOMParser`): `replaces main and title on 200`, `keeps the page on 304`, `skips while an input is dirty`, `skips while an input has focus`, `skips while hidden`, `stops on non-200 non-304 without touching main`(401·404·500).
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — `/live.js`는 `/copy.js`처럼 세션 확인 전에 준다. GET HTML 응답은 본문 sha256 앞 16자를 `ETag: "<값>"`로 달고, 요청의 `If-None-Match`가 같으면 304. 기존 시험의 "스크립트 없음" 단정은 "`/live.js`(와 기존 `/copy.js`) 말고 스크립트 없음"으로, CSP 단정은 새 값으로 고친다.
- [ ] **Step 4: 통과 확인** — PASS, `tests/hub-*.test.mjs` 전부 PASS.
- [ ] **Step 5: 커밋** — `feat: refresh open Hub pages when they change, never while typing`

### Task 4: 들어오기 (로그인 전 주소, 초대 뒤 보드, 옛 안내 문구)

**Files:**
- Modify: `src/hub/server.ts`(401 응답에 쿠키, 초대 POST의 행선지, `cookieOf`), `src/hub/pages.ts`(`start`, `connectHelp`, `signedOut` 문구)
- Test: `tests/hub-landing.test.mjs`, `tests/hub-start-page.test.mjs`

**Interfaces:**
- Consumes: Task 2의 `safePath`.

- [ ] **Step 1: 실패하는 시험 쓰기** — `tests/hub-landing.test.mjs`:
  - `invite lands on the board`: 초대 POST → 303 `Location: /`.
  - `invite returns to the page opened before sign-in`: 세션 없이 `GET /stories/<id>` → 401과 `Set-Cookie: pazmo_next=…; Max-Age=259200; HttpOnly; Secure; SameSite=Lax; Path=/`, 그 쿠키로 초대 POST → 303 `Location: /stories/<id>`와 `pazmo_next=; Max-Age=0`.
  - `outside or odd paths are not remembered`: `/favicon.ico`, `/install.sh`, `//evil.example`, `/%2F%2Fevil`, `/requests`(목록 밖)는 쿠키를 만들지 않음. 손으로 넣은 `pazmo_next=https://evil.example/` → 초대 뒤 `/`.
  - `start page tells today's way`: `/start`에 `pazmo-office hub-link --project`와 `--connect`, `Office 상단의 팀 허브 버튼`·`팀 허브로 보내기` 없음. `/connect`도 같은 방법.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — 세션 없는 GET이 `safePath`를 통과하면 401 응답에 `pazmo_next`를 붙인다(`/mac/approve`는 지금 흐름 그대로). 초대 POST는 `safePath(cookieOf(req, "pazmo_next")) ?? "/"`로 가고 쿠키를 지운다. 보드 없는 Hub는 지금처럼 `/start`로 간다. `start`·`connectHelp` 문구는 Mac 한 줄 설치를 못 쓰는 Hub에서 레포 폴더마다 `pazmo-office hub-link --project <레포 폴더> --connect '<연결 문자열>'`을 실행한다고 쓴다. `tests/hub-start-page.test.mjs:51-58`의 `/start` 착지는 새 동작으로 고친다.
- [ ] **Step 4: 통과 확인** — PASS, `tests/hub-*.test.mjs` 전부 PASS.
- [ ] **Step 5: 커밋** — `feat: land on the board after an invite and return to the page opened before sign-in`

### Task 5: 사람 말과 상태 색

**Files:**
- Modify: `src/hub/story-pages.ts`(Story·Task 화면), `src/hub/plan-pages.ts`(승인 기록 이름), `src/hub/pages.ts`(CSS 토큰·글자 크기·`tone()`)
- Test: `tests/hub-plain-words.test.mjs`, 그리고 `tests/hub-story-pages.test.mjs:233-246,417,490`, `tests/hub-plan-pages.test.mjs:369`

**Interfaces:**
- Produces: `tone(state: TaskViewState | StoryState | PlanState): "need" | "run" | "stop" | "done"`(`pages.ts`), 알약은 `<span class="pill need">`처럼.

- [ ] **Step 1: 실패하는 시험 쓰기** — `tests/hub-plain-words.test.mjs`:
  - `story page folds developer details`: 첫 화면 부분에 `feature/story-`·PR 주소가 없고 `<details class="dev"><summary>개발 정보</summary>` 안에 있음. Task 목록은 상태 알약 색 클래스와 함께.
  - `task page folds PR, merge commit, files and checks`: 같은 방식, `요약`은 바깥.
  - `assumed lines read as decided by AI`: `ASSUMED: X` 줄 → `AI가 정한 것: X`(원문 X 그대로, 이스케이프).
  - `approval records use plain names`: 기획 화면 기록이 `초안 승인(G1)`·`설계 승인(G3)`.
  - `pills carry tone classes`: 실패 → `stop`, 맡음 → `run`, 질문·초안·설계 승인 대기 → `need`, 머지·열림 끝 → `done`.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — 알약 색은 지금 `--accent`·`--bad`에 `--need`(밝은 주황)·`--done`(녹색) 토큰을 더해 다크 모드에도 둔다. 글자 크기 13·15·19·26px. 기존 시험의 정확한 표·`<b>ASSUMED` 단정은 새 모양으로 고친다.
- [ ] **Step 4: 통과 확인** — PASS, `tests/hub-*.test.mjs` 전부 PASS.
- [ ] **Step 5: 커밋** — `feat: speak plainly on Story, Task and plan pages and color states`

### Task 6: Hub 올리기 경로

**Files:**
- Modify: `src/hub/store.ts`(`link()`에 `macId`, `currentMac`), `src/hub/story-store.ts`(표 `hub_story_uploads`, `uploadStory`, `uploadBases`, `storyUpload`), `src/hub/link-api.ts`(두 경로), `src/hub/story-pages.ts`·`src/hub/server.ts`(Story 화면의 로컬 승인 줄, 열리기 전 [취소])
- Test: `tests/hub-story-upload.test.mjs`

**Interfaces:**
- Produces:
  - `Link`에 `macId: string | null`, `HubStore.currentMac(memberId: string): { id: string; name: string } | null`(회수 안 된 가장 새 Mac).
  - `POST /api/link/story/upload`(프로토콜 3) 몸: `{ projectId, title, body, risk, storyHash, graph, storyVerify }` → `{ storyId, number, state, already, bases: Record<string, string> }`. 
  - `POST /api/link/story/upload-bases` 몸: `{ storyId, bases: Record<string, string> }` → `{ bases }`.
  - `StoryBoard.storyUpload(storyId: string): { macName: string; at: number; storyHash: string } | null`

- [ ] **Step 1: 실패하는 시험 쓰기** — `tests/hub-story-upload.test.mjs`(실제 TLS Hub, Mac 연결로 만든 링크와 연결 문자열 링크 둘):
  - `upload publishes a draft Story and records the local approval`: 200, Story `draft`, 표에 Mac 이름·해시·시각, Story 화면에 `로컬 승인 · <Mac 이름>`.
  - `same text uploads once`: 두 번째는 같은 storyId와 `already: true`.
  - `refuses a link without a Mac`(연결 문자열) → 403 `NOT_YOUR_MAC`, `refuses an old Mac` → 403 `NOT_YOUR_MAC`, `refuses a non-owner` → 403 `NOT_OWNER`, `refuses a bad graph` → 400 지금 `GRAPH_*`. 넷 모두 Story 없음(`storyByKey` null).
  - `cancelled Story is not uploaded again` → 409 `UPLOAD_CANCELLED`.
  - `bases are written once`: 같은 값은 그대로, 다른 커밋 → 409 `BASES_CHANGED`.
  - `PL cancels an unopened upload on the web`: Story 화면의 [취소] POST → 303, Story `cancelled`. 열린 Story에는 버튼 없음.
  - 옛 경로·응답이 그대로인지: `tests/hub-link-api*.test.mjs` 전부 PASS.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — `link()`가 `l.mac_id`를 돌려준다(기존 호출부는 무시). `upload`: `macId === currentMac(member)?.id`가 아니면 `NOT_YOUR_MAC`, `ownsProject`가 아니면 `NOT_OWNER`, 같은 키의 Story가 취소됐으면 `UPLOAD_CANCELLED`, 그다음 `publishStory(link, { …, key: "upload:" + storyHash })`와 같은 트랜잭션에서 업로드 행을 처음 한 번만 넣는다. `upload-bases`는 묶음 3의 `#storeBases`(`plan-store.ts:622-639`)와 같은 규칙. [취소]는 기존 `cancelStory`를 부르는 `POST /stories/<id>/cancel`(PL·관리자, `draft`일 때만 보임).
- [ ] **Step 4: 통과 확인** — PASS, `tests/hub-*.test.mjs` 전부 PASS.
- [ ] **Step 5: 커밋** — `feat: let the PL's current Mac upload an approved Story to the Hub`

### Task 7: 올리기 명령 `team upload`

**Files:**
- Create: `src/team/upload.ts`, `src/team/story-bases.ts`, `skills/pazmo-hub-upload/SKILL.md`
- Modify: `src/team/planner.ts`(`basesAndOpen`·`baseCommits`를 `story-bases.ts`로 옮겨 씀), `src/team/plan-link.ts` 또는 새 링크 함수(`upload`, `uploadBases`), `src/cli/team.ts`·`src/cli/index.ts`(`upload` 행동, `--story`·`--tasks`·`--project`·`--guide`)
- Test: `tests/team-upload.test.mjs`, `tests/hub-upload-office.test.mjs`

**Interfaces:**
- Consumes: Task 6의 두 경로, 기존 `/api/link/story/projects`·`open`, `kitStoryHash`(`src/core/kit-role-runs.ts:26`), `coverageOf`(`src/runners/planning.ts:730`), `validateGraph`·`validateStoryVerify`(`src/hub/story-protocol.ts`), `branch.pushStoryBase`, `planGitOps().fetchBaseTip`.
- Produces:
  - Task 파일(JSON) 모양 — SKILL.md에 그대로 적는다:
    ```json
    { "project": "<프로젝트 이름 또는 id>", "risk": "normal",
      "repos": [{ "name": "app-be", "baseBranch": "main" }],
      "tasks": [{ "id": "be-pay", "repo": "app-be", "title": "…", "spec": "…", "files": ["src/pay.ts"],
                  "covers": ["M1", "V1"], "after": [], "checks": [{ "id": "V1", "argv": ["npm", "test"], "timeoutMs": 120000 }] }],
      "storyChecks": [{ "repo": "app-be", "checks": [{ "id": "V1", "argv": ["npm", "test"], "timeoutMs": 300000 }] }] }
    ```
  - `checkUpload(storyPath: string, tasksPath: string, project: ProjectView): UploadInput` (Hub를 부르지 않는 모든 검사, 실패는 위 `UPLOAD_*` 코드의 오류)
  - `kitStoryRefs(text: string): { must: number[]; verify: { n: number; must: number[] }[] }` (kit 틀의 `- M1.`·`- V1 [M1, M2].` 줄)
  - `runUpload(o: { root: string; story: string; tasks: string; project?: string }): Promise<{ storyId: string; number: number; opened: true; already: boolean }>`
  - `openWithBases(o: { story: { id: string; number: number }; repos: { id: string; name: string; baseBranch: string; checkout: string }[]; recorded: Record<string, string>; record: (b: Record<string, string>) => Promise<Record<string, string>>; git: { fetchBaseTip; pushStoryBase }; open: () => Promise<void> }): Promise<void>` (`story-bases.ts`, 기획 Office도 이것을 씀)

- [ ] **Step 1: 실패하는 시험 쓰기** — `tests/team-upload.test.mjs`(Hub 없이 `checkUpload`):
  - `refuses a Story without a bound G1`: G1 줄 없음 / JSON 없음 / `storyHash` 다름 → `UPLOAD_G1`.
  - `kit hash matches kit storyContract on CRLF`: 같은 바이트(CRLF·끝 공백)를 kit `storyContract().fingerprint`와 `kitStoryHash`에 넣어 같음, 그 해시로 만든 G1이면 통과.
  - `high risk needs a bound G3`: `risk: "high"`인데 G3 줄·`decisionHash` 맞는 설계 파일이 없으면 `UPLOAD_G3`.
  - `refuses uncovered MUST or Verify`: M3이 어느 Task `covers`에도 없음 → `UPLOAD_COVERAGE`이고 메시지에 `M3`.
  - `refuses a covered V without its check`: `covers`에 V2인데 `checks`에 `V2` 없음 → `UPLOAD_TASKS`.
  - `refuses repos or base branches that differ from the project`: 프로젝트에 없는 repo, `baseBranch` 다름 → `UPLOAD_REPO`.
  - `refuses a bad graph before the Hub`: 순환 → `UPLOAD_TASKS`(Hub의 `validateGraph` 메시지 포함).
  - `tests/hub-upload-office.test.mjs`(`tests/hub-plan-office.test.mjs`의 `world()`처럼 실제 TLS Hub·bare origin 둘·가짜 `gh`):
    - `upload publishes, makes bases and opens`: `runUpload` → Story `open`, 두 origin에 `feature/story-<N>/base`, 팀원 A의 스케줄러가 할 일 Task를 가져감, 보드 `/`에 카드.
    - `upload again after a push failure resumes`: 첫 push를 거절시킨 뒤 다시 → 같은 Story, Hub에 적힌 base 커밋으로 push, 열림.
    - `upload again after success changes nothing`: `already: true`, Story 하나.
    - `guide prints the file format`: `pazmo-office team upload --guide` 출력이 `skills/pazmo-hub-upload/SKILL.md`와 같음.
  - 기획 Office의 base·열기가 그대로인지: `tests/team-planner.test.mjs`, `tests/hub-plan-office.test.mjs` 전부 PASS.
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — 링크 고르기는 `src/cli/mac.ts:203-209`의 `linkOf`처럼 `readTeam(root).repos` → `readLinkConfig`에서 `macId === readMacLink(root).macId`인 첫 링크(없으면 `UPLOAD_LINK`: "이 Mac이 Hub에 연결돼 있지 않습니다. `pazmo-office mac connect`로 먼저 연결하세요"). Task 파일의 repo 이름을 프로젝트의 repo id로 바꾸고, Task `spec` 끝에 `Covers: M1, V1` 줄을 더해 `GraphInput`(`after` → edges)으로 만든다. 순서: 검사 → `upload` → `openWithBases`(이미 열렸으면 건너뜀) → 결과 JSON. SKILL.md는 언제 부르는지, kit workflow로 Story와 G1을 먼저 만들 것, 파일 모양, 오류 코드마다 고칠 방법을 쓴다.
- [ ] **Step 4: 통과 확인** — PASS, `tests/team-*.test.mjs`·`tests/hub-*.test.mjs` 전부 PASS.
- [ ] **Step 5: 커밋** — `feat: upload a locally approved Story with one command`

### Task 8: claude 안내 복사, 문서

**Files:**
- Modify: `src/cli/mac.ts`(`mac connect`가 끝날 때 안내 복사), `docs/LOCAL-PREVIEW.md`
- Create: `docs/verification/2026-11-11-hub-board.md`
- Test: `tests/mac-skill-copy.test.mjs`

**Interfaces:**
- Consumes: Task 7의 `skills/pazmo-hub-upload/SKILL.md`.
- Produces: `installUploadGuide(home: string): "written" | "kept-user-edit" | "same"`(`src/cli/mac.ts` 또는 새 작은 파일). 쓴 파일 첫 줄은 `<!-- pazmo-office managed: sha256=<본문 해시> -->`.

- [ ] **Step 1: 실패하는 시험 쓰기** — `tests/mac-skill-copy.test.mjs`(임시 HOME):
  - `writes the guide when missing` → `written`, 파일 = 머리 줄 + SKILL.md.
  - `replaces our own older copy` → 머리 줄 해시가 본문과 맞는 옛 파일 → `written`.
  - `keeps a user-edited guide` → 본문을 고쳐 해시가 안 맞음 → `kept-user-edit`, 파일 그대로, `mac connect` 출력에 "고친 안내가 있어 그대로 둡니다".
- [ ] **Step 2: 실패 확인** — FAIL.
- [ ] **Step 3: 구현** — `mac connect`의 마지막 단계에서 `installUploadGuide(os.homedir())`. LOCAL-PREVIEW에 "칸반 보드와 로컬 올리기" 절(보드 읽는 법, PL이 claude에게 말할 문장 예, 명령, 오류와 고칠 방법, 한계). 변경 기록은 D42 항목별로 무엇을 어떻게 시험했는지와 "확인하지 않은 것".
- [ ] **Step 4: 통과 확인** — PASS. 그다음 전체 `npm test`와 `npm run typecheck` → 실패 0, 카운트를 X/X로 적는다.
- [ ] **Step 5: 커밋** — `docs: guide the PL's claude to the upload command and record the board change`
