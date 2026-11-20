# 변경 기록: 웹 결과 승인 (U56, D49)

kit 실행은 `.ai-workflow/runs/U56-web-approve.json`입니다. 이 기록은 kit 증거가 아니라 변경 기록입니다.

D48까지는 결과 승인을 PL Mac의 claude 대화(`team finish`)에서만 했습니다. 사용자는 설명 페이지 43판 "결과 승인은 어디서?"에서 "웹 단추로"를 골랐고, PL이 무엇을 확인할지(QA 목록, 직접 실행 방법, AI에 붙여 넣을 프롬프트)를 더해 달라고 했습니다. 46판 "AI가 QA까지?"에서는 AI가 QA를 쓰고 실행하는 단추를 다음 묶음으로 미루고, 프롬프트에 Playwright 줄만 더하기로 했습니다("D49 끝내고 다음 묶음").

## 바뀐 것

- **결과 승인 칸 (`src/hub/story-pages.ts`, `src/hub/story-approve.ts`)**
  - Story가 승인 대기이고 승인이 아직 없을 때, 그 Story의 PL에게만 보입니다. 다른 사람에게는 "PL이 결과를 승인하면 레포마다 main에 머지됩니다"가 보입니다.
  - Story 검증 결과(PL에게는 이 칸 안에서만), Task별 요약 첫 3줄과 AI가 정한 것.
  - 레포별 비교 링크 `https://<host>/<owner>/<repo>/compare/<기준 브랜치>...<검증 커밋>`. 호스트 이름에 github가 있는 owner/repo 주소일 때만.
  - 확인할 것: Story의 `## MUST` 줄마다 "동작하는지", `## Verify` 줄마다 "이 장면 그대로인지", Task의 ASSUMED 줄마다 "이대로 괜찮은지"(종류마다 30개까지, 나머지는 개수). 자유 글 Story는 "Story 글의 목표대로 동작하는지" 한 줄. Task가 맡은 파일(계획)도 함께 보입니다.
  - 직접 실행해 보기: 레포마다 `git fetch origin`, `git worktree add --detach ../<레포>-story-<N>-<커밋 12자> <커밋> && (cd … && <Story 검사>)`, `git worktree remove --force …`. 새 폴더에 의존성이 없다는 안내가 함께 보입니다.
  - AI에게 맡기기: 같은 내용을 claude 같은 AI에 붙여 넣는 프롬프트. 코드는 고치지 말 것, 항목마다 통과/실패/확인 못 함과 근거, 웹 화면이면 Playwright로 브라우저를 띄워 보여 주고 스크린샷, 목록은 데이터로 묶고(한 줄씩) 확인 밖의 일은 하지 말 것, 끝나면 폴더 정리, "승인은 사람이 합니다".
  - 복사 단추는 `copy.js`가 페이지에 `copy` 표시를 했을 때만 보입니다. 스크립트가 없으면 프롬프트는 고를 수 있는 글 상자입니다. `copy.js`는 PL의 진행 중인 Story 화면에서만 `<main>` 밖에 실립니다.
  - 확인 상자("검사 결과, 바뀐 코드, AI가 정한 것을 확인했습니다")와 "승인하고 main에 머지".
  - 검증 커밋이 없는 Story(D48 전에 검증됨)에는 같은 칸에 "다시 검증".
- **승인 (`src/hub/story-store.ts`, `src/hub/server.ts`)**
  - `POST /stories/:id/approve`: 확인 상자가 없으면 400. 화면이 실은 Story 지문과 검증 커밋이 지금 것과 다르면 409(STALE)이고 아무것도 기록하지 않습니다. PL이 아니면(허브 관리자 포함) 403. Origin·CSRF는 다른 POST와 같습니다.
  - 기록은 `via: "web"`, `by: PL 이름`, 기록 해시는 (web, Story, 지문, 커밋, PL)의 sha256. 같은 승인을 다시 누르면 그대로, 다른 승인이 먼저 있으면 Story 화면으로 돌려보냅니다.
  - PL Office의 머지(D48)는 로컬 승인과 똑같이 웹 승인을 가져갑니다.
  - `POST /stories/:id/recheck`: D48의 다시 검증과 같습니다. 두 번 누름은 Story 화면으로 돌려보냅니다.
- **`team finish` (`src/team/finish.ts`)**
  - 허브에 이미 승인이 있으면 기록 경로에 남은 기록을 모두 치워 둡니다. 이 승인의 기록이면 `….approved.json`, 아니면(예: 웹 승인에 짐) `….superseded.json`, 64KB를 넘으면 시각 이름.
  - 자기 승인 요청이 STATE로 거절되고 허브에 승인이 생겼으면, 그 기록도 `superseded`로 치우고 "approved"로 답합니다.
  - 그래서 사람이 PR을 머지 없이 닫아 승인이 끝난 뒤, 옛 기록이 PL에게 묻지 않고 다시 승인하지 않습니다.
- **문구:** PL에게 "모든 Task가 끝났습니다. 아래 결과 승인 칸에서 확인하고 승인하세요.", 보드의 기다리는 일에 "… Story 화면에서 결과를 확인하고 승인하세요.". 승인 줄은 "웹 승인 · PL 이름 · 시각" 또는 "결과 승인 · Mac 이름 · 시각".
- `skills/pazmo-hub-finish`와 `docs/LOCAL-PREVIEW.md`가 웹 길을 설명합니다.

## 그림 (확인용 허브의 사본, 직접 확인)

- 사본 허브(18576)에 PL Mac을 페어링하고 be·fe를 연결한 사본 PL Office를 띄웠습니다. 브라우저는 헤드리스 Chromium(Playwright)에 PL 세션.
- #1 "인사말 도구": 다시 검증 → VM 검증 통과 → 결과 승인 칸 → 웹 승인 → 머지 → 완료.
  - fe: [PR #2](https://github.com/syjkim0125/pazmo-story-test-fe/pull/2)의 head는 검증한 `bed598e4…`.
  - be: [PR #5](https://github.com/syjkim0125/pazmo-story-test-be/pull/5)의 head는 be main을 합친 `2d761eab…`(부모 `34aa2e9c…` 검증 커밋, `95ec0bf6…` be main). U55 때 #7이 be main에 먼저 들어가 기준 브랜치가 앞서 있었고, D48대로 합친 뒤 VM에서 다시 검사하고 머지했습니다.
- 복사 단추는 화면의 프롬프트와 똑같은 글을 복사했고, 스크립트를 끄면 숨었습니다. 칸에 나온 be 명령은 사본 clone에서 그대로 돌아 검사 3/3, 폴더는 지워지고 clone의 main은 그대로였습니다.
- 확인용 허브(18444)는 건드리지 않았습니다.

  ![다시 검증](2026-11-20-web-approve/1-recheck.jpg)
  ![결과 승인 칸](2026-11-20-web-approve/2-card.jpg)
  ![결과 승인 칸, 폰](2026-11-20-web-approve/2-card-phone.jpg)
  ![웹 승인](2026-11-20-web-approve/3-approved.jpg)
  ![완료](2026-11-20-web-approve/4-done.jpg)

## 확인

- **구현:** 3번 했습니다.
  - 1차: RED 137/147, GREEN 151/151, 전체 2044/2044.
  - 2차: RED 43/51, GREEN 215/215, 전체 2046/2046.
  - 3차: RED 49/54, GREEN 234/234, 전체 2049/2049.
- **리뷰:** 같은 독립 리뷰어가 세 번 봤습니다.
  - 1차: Important 2개(진 `team finish` 기록이 남음, 실행 방법이 PL의 레포 폴더를 바꿈)와 Minor 6개.
  - 2차: Important 1개(확인 폴더 받기가 실패해도 검사가 이어짐)와 Minor 6개. 실제 git으로 재현했습니다.
  - 3차: 검증 가능. 실제 git(bash·zsh)으로 다섯 경우를 다시 확인했습니다.
- **kit 검증(`26931c0`):** 738/738 + 608/608 + 703/703 = **2049/2049**, 타입 검사와 Story 검사 exit 0.
- **G4(2026-11-20):** 사용자는 설명 페이지 48판의 직접 확인 결과를 본 뒤 "승인 후 머지"를 골랐습니다. [G4 기록](../../.ai-workflow/approvals/web-approve-g4.md)

## 확인하지 못한 것 · 남긴 것

- 승인 요청이 네트워크로 실패한 뒤 웹 승인 → 그사이 `team finish`를 다시 돌리지 않음 → PR이 머지 없이 닫힘, 이 순서에서는 남은 기록이 다음 승인으로 쓰일 수 있습니다(나중에: 기록을 승인 회차에 묶기).
- 다른 커밋의 옛 확인 폴더는 저절로 지워지지 않습니다.
- 레포 이름은 프롬프트에서 한 줄로 펴지지 않습니다(레포 담당자만 바꿀 수 있음).
- 기준 브랜치를 합친 뒤의 재검사가 통과하면 Office 로그에 줄이 없습니다.
- QA 목록과 프롬프트는 글에서 그대로 만듭니다. AI가 QA를 써 주고 실행하는 "QA 시작"은 D41과 함께 다음 묶음입니다.
- 확인용 허브(18444)의 #1은 아직 승인 대기이고, 내용은 이미 be·fe main에 있습니다(이미 main에 있는 Story base 한계).
- 실제 사내 허브, 여러 사람의 Mac, 헤드리스가 아닌 브라우저로는 확인하지 않았습니다.
