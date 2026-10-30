# 2026-10-30 새 Office 기본 전환과 Claw Empire 삭제 (D30, A안)

- `./office`·`start`가 새 최소 Office(Tasks·작업 상세·Decisions·Agents)를 켠다. `--lean`은 받아들이고 같은 Office를 켜며, `--claw`는 `CLAW_REMOVED`다(M15·D30, G3 2026-10-30 "A로 해").
- 지운 것: `vendor/claw-empire`(추적 파일 708개, gitlink 2개), `.gitmodules`, `build:office`, claw·legacy 엔진, 채팅 `bridge`와 operator 명령(`contract`·`intake-*`·`approval-*`·`verification`·`delivery`·`deliver`·`operator-key`), Office의 허브 요청 보내기·받기·연결 창, 캐릭터·픽셀 화면. 허브 서버, 팀 Office, 사용자 데이터(옛 `claw/` 포함)는 그대로다. 원본 가져오기는 로컬 브랜치 `codex/local-original-claw-v2.0.4`에 남는다.
- `ws`·TypeScript는 루트 의존성이다. `up`은 켜진 Office를 다시 쓰거나 새로 켜기 전에 `ws`가 없거나 다른 버전일 때만 `npm ci --omit=dev --prefer-offline`을 한다. 예전 버전이 켠 Claw·legacy Office는 `status`로 보이고 `stop`으로 멈추며, `start`·`up`·`monitor`는 `ENGINE_MISMATCH`로 거부한다.
- 엔진 코드(`native-office.ts`의 Claw용 API, 역할별 실행기 경로, 옛 허브 요청 흐름)는 D24 3단계와 충돌하지 않도록 남겼다. Story는 M7·M9·M10·M13·M14와 V7·V11·V12·V15·V16을 폐기하고 Goal·M1·M2·M3·M8·M12·M15·O2와 V1·V8·V9·V10·V14·V17을 고쳤다(M8·M12·V9·V10·V14는 승인 뒤 찾아 ASSUMED).
- 자동 검사:
  - 기준선 `3926ee2` 1104/1104 → vendor 없이 1070/1070(삭제는 모두 Claw·legacy·bridge 전용, 파일별 대조는 검증 기록). 메인 checkout 밖 새 사본(`npm ci`만)에서도 1070/1070. 독립 리뷰 반영과 main(#48·#49·#51) 병합 뒤 **1074/1074** exit 0
  - 타입 검사 exit 0, Story 검사기 exit 0, `npm pack --dry-run`에 vendor 없음
  - 엔진 재시작 복구 시험은 복구 호출 셋 중 하나만 지워도 실패한다
  - vendor를 설치·빌드했던 checkout을 옮겨도 `git status`가 깨끗하고, `claw/` 데이터의 해시·수정 시각이 그대로다
- 업데이트 뒤 첫 역할 실행 전에 실행기 자격 검사가 한 번 다시 돈다(경계 파일 `exec-relay.ts`·`claude-tool-bridge.mjs`가 바뀜).
- **남은 것: 독립 리뷰, G4, app-be 실제 확인(V17), 사전 확인 두 개(app-be Claw Office의 진행 중 작업, OpenShift 허브의 진행 중 요청), 엔진 코드 정리(D24 3단계 뒤), 오래된 해결 문서 약 10개 정리(`/ce-compound-refresh`, 목록은 검증 기록), 채팅 조작 재개(새 Office의 operator API, 별도 G3), 허브 웹의 요청 "내가 맡기" 정리(실행하는 Office가 없음).** [G3 결정](understanding/lean-office-default-decision.md) · [구현 계획](plans/2026-10-30-1500-feat-lean-office-default-plan.md) · [검증 기록](verification/2026-10-30-lean-office-default.md)

# 2026-10-30 모델 목록 조회 claude의 멈춤 유예 12초, lean 시작 대기 30초

- #45의 후속이다. 모델 목록을 물은 claude는 SIGTERM 2초 뒤 SIGKILL됐다. 갱신 중인 claude는 SIGTERM 뒤 갱신을 최대 2초 기다리고 나가며, 바쁠 때 끝나기까지 최대 9.1초가 걸렸다. 그래서 2초로는 2026-10-23 사고 자리(작업 만들기·계획 재개 바로 앞의 조회)에 잠금이 남을 수 있었다.
- 사용자 선택(2026-10-30, (a))대로 조회도 SIGTERM 뒤 **12초**를 기다린다(D31, 역할 실행 D28과 같은 값). 멈춤 최악이 17초가 되고 live lean Office는 첫 조회 뒤에야 준비를 알리므로, **lean 시작 대기를 15초 → 30초**로 올렸다. 보통 claude는 지금처럼 0.3초에 끝난다.
- 30초는 답한 claude의 멈춤 최악(17초)을 덮는다. 15초를 다 쓰고도 답하지 않는 claude는 조회만 최대 32초라 덮지 않는다. 그 시작은 "Office startup timed out"으로 끝난다. 조회 claude는 입력 끝을 받고 아무도 SIGKILL하지 않아 잠금을 남기지 않는다(갱신 중인 claude가 입력 끝만으로 끝나는지는 재지 않았다).
- 자동 검사: 새·바꾼 시험 3개가 고치기 전에 실패했다. 돌연변이 4/4를 잡았다. 전체 시험 **1106/1106** exit 0(main #48·#49를 합친 뒤에도 같음), 타입 검사·Story 검사기 exit 0. 독립 리뷰 네 번(1차 Changes needed → 문서·시험 표현과 team-registry 시험 한도를 고침, 2차 Ready, 30초 결정·main 합침 뒤 3차 Ready, 표현 하나 고침). [변경 기록](verification/2026-10-30-discovery-stop-grace.md)
- 리뷰가 물은 "32초 경우까지 덮도록 42초 이상으로 올릴지"에 사용자가 "그대로"라고 답해(2026-10-30) 30초로 두고 D31에 적었다.
- PR syjkim0125/pazmo-agent-office#51. G4는 2026-10-30 사용자 지시("설명해주고 … 머지도 해")로 컨트롤러가 쓴 답을 승인으로 기록했다(승인 후 머지). 사용자는 답을 기록 전에 보지 않았다. [G4 기록](verification/2026-10-30-discovery-stop-grace-g4.md)
- **남은 것:** 실제 claude가 입력이 닫히는 것만으로 끝내기를 시작하는지, 바쁠 때 실제 lean 시작 시간, 조회 1단계의 `claude auth status`가 잠금을 잡는지(10초 시간 초과 때 SIGKILL). 모두 재지 않았다.

# 2026-10-29 부하에서만 실패하던 시험 고치기

- 다른 시험과 같이 돌 때만 `Office startup timed out.`으로 실패하던 두 시험은 claw를 켜는 시험이었다. claw는 시작하면서 TypeScript 모듈 약 220개를 변환한다. 유휴 1–2초가 CPU가 바쁘고 메모리가 스왑되면 1분을 넘기도 한다. 시작 대기를 **claw만 120초**로 늘렸다. legacy·lean·team은 15초 그대로다. 서비스가 죽거나 오류로 답하면 기다리지 않는다.
- `tests/claude-controller.test.mjs`의 멈춤 시험은 벽시계 대신 컨트롤러의 시계(`t.mock.timers`)를 돌린다. 유예와 SIGKILL 대체 경로를 1ms 단위로 확인한다(만들 때는 6초, #45를 합친 뒤에는 12초: 11999ms에 살아 있고 12000ms에 SIGKILL). 컨트롤러 코드는 바꾸지 않았다.
- 자동 검사:
  - 부하 재현: lifecycle 두 파일은 16스레드 부하에서 고치기 전 3회 중 1회 → 고친 뒤 **5/5(75/75)**. claude-controller는 36스레드에서 4회 중 1회 → **6/6(120/120)**. 컨트롤러 돌연변이 7개와 spawn 실패를 모두 잡고, 어느 경우에도 파일이 멈추지 않는다.
  - 전체 시험 **1092/1092** exit 0(최종 `10a5642`, 다른 시험 없이). main(#42·#44)을 합친 `23a1eb0`에서 **1093/1093**, #43·#45·#46을 합친 `c9d6c4d`에서 **1104/1104** exit 0(36스레드 부하의 claude-controller 3/3). 모두 타입 검사 exit 0, Story 검사기 exit 0.
- 독립 리뷰 세 번(보고만): 두 번의 지적(실패 경로에서 시험 파일이 멈춤)을 고친 뒤 "머지 가능".
- PR syjkim0125/pazmo-agent-office#47. G4는 2026-10-30 사용자 지시("너가 알려주고, 승인으로 기록해서 … 머지까지")로 컨트롤러가 쓴 답을 승인으로 기록했다(① 승인 후 머지). 사용자는 답을 기록 전에 보지 않았다. [G4 기록](verification/2026-10-29-load-flaky-tests-g4.md)
- **claw를 빨리 켜는 일(vendor 서버 미리 빌드)은 하지 않았다.** 120초 동안 멈춘 claw 시작에 안내가 없는 점과 리뷰 후속은 남아 있다. [검증 기록](verification/2026-10-29-load-flaky-tests.md)

# 2026-10-30 claude 멈춤 유예 12초, hook이 있는 claude는 막기

- 실제 CLI 확인(아래)의 P1·P2를 사용자 선택(2026-10-30)대로 고쳤다(D28·D29).
- 취소·시간 초과로 claude 역할을 멈출 때 SIGTERM 뒤 SIGKILL까지 12초(이전 6초), 바깥 감독은 18초(이전 12초)를 기다린다. 보안 검사 멈춤은 그대로 바로 SIGKILL이다.
- 모델 목록 조회 때 claude CLI에 hook 목록(`get_hooks_listing`)도 묻는다. hook이 있거나 목록을 주지 않으면 claude를 막고(codex `AGENTS.md`와 같은 경로) 화면에 이유를 보인다. 막힌 claude는 자격 검사도 받지 않는다. 조회 자체가 실패하면 판단하지 않는다.
- 이 Mac의 실제 claude 2.1.280은 hook 목록이 비어 있어 막히지 않았다("준비됨", 모델 5개).
- 업데이트 뒤 실행기 자격 검사가 한 번 다시 돈다(경계 파일 `claude-controller.ts`가 바뀜).
- 한계: 막힌 claude도 모델 목록 조회 때는 CLI를 띄우므로, 조회마다 그 SessionStart·SessionEnd hook이 한 번 돈다(이 변경 전부터 같음).
- 자동 검사: root 1104/1104, 타입 검사 exit 0, Story 검사기 exit 0. 독립 리뷰 두 번(1차 Changes needed → 고침, 2차 코드 승인·문서 반영). PR syjkim0125/pazmo-agent-office#45.
- G4는 2026-10-30 피드백(답 초안)을 본 뒤 "승인 후 머지"로 기록했다(D13, ① 승인 후 머지). [G4 기록](verification/2026-10-30-claude-stop-grace-hooks-g4.md)
- **남은 것:** 관리형 hook이 실제로 걸린 Mac에서의 확인, 모델 목록 조회 자체의 2초 SIGKILL(→ D31로 12초, 위), `./office` 시작 1단계의 hook 확인(후속). [변경 기록](verification/2026-10-30-claude-stop-grace-hooks.md)

# 2026-10-29 실제 claude·codex CLI로 실행기 오류와 SIGTERM 종료 확인

- 제품 코드는 바꾸지 않았다. #35·#40의 자동 시험이 흉내만 내던 동작을 이 Mac의 실제 CLI로 봤다. [실제 CLI 확인](verification/2026-10-29-real-cli-runner-checks.md)
- 리뷰 실행기 오류: 없는 모델을 고른 실제 claude·codex 리뷰어는 exit 1로 끝났다. 실제 coordinator·kit·VM 리뷰어를 거쳐 `REVIEW_RUNNER_FAILED`로 멈췄고, 엔지니어는 다시 돌지 않았다. claude 5/5, codex 2/2. codex 0.163.0도 API 오류에 exit 1이다.
- claude SIGTERM: 갱신이 없을 때 0.3–1.7초, SessionEnd hook이 있으면 최대 1.9초(CLI 기본 한도 1.5초) 걸렸다. **SessionEnd hook은 SIGTERM 때도 정상 종료 때도 stream 이벤트로 나오지 않아 Office의 hook 감시에 보이지 않는다**(제안 P1 → D29로 구현).
- 갱신 중 SIGTERM은 사용자 확인 뒤 가짜 토큰·격리 config·답하지 않는 프록시로 쟀다.
  - CLI는 진행 중인 갱신을 최대 2초 기다리고 나갔고, 스스로 나가면 잠금은 풀렸다.
  - 한가할 때는 2.5초 안에 끝났다.
  - **부하가 높으면 6초를 넘었다(최대 9.1초). Office와 같은 6초 SIGKILL을 걸자 load average 90–102에서 3회 중 2회 잠금이 남았다**(제안 P2 → D28로 12초로 늘림).
  - Keychain 항목은 생기지 않았다.
- **남은 것:** 관리형 SessionEnd hook, 평소 부하에서의 갱신 중 SIGTERM, 실제 토큰 서버가 느리게 답하는 갱신, 안전장치 거절 자체.

# 2026-10-29 판정 없는 리뷰를 kit에 needs_changes로 남기지 않기

- #35의 후속이다. 리뷰 실행기가 보고서 없이 끝나 Office 결과가 unknown(`REVIEW_RUNNER_FAILED`)이어도, kit 리뷰어 run에는 `verdict: "needs_changes"`가 적혀 리뷰어가 수정을 요청한 것처럼 보였다. 이제 판정이 없는 리뷰(실행기 실패·시간 초과 등)는 `verdict`와 `reviewedRevision` 없이 "No review verdict" 실패(`action: "human"`)로 남고, 실행기 실패면 피드백에 `REVIEW_RUNNER_FAILED`가 들어간다(D27, ASSUMED).
- kit 파일은 바꾸지 않았다. kit는 리뷰어 판정(pass·needs_changes) 검사를 통과한 기록에만 한다. Office 흐름(멈춤·이유·수정 횟수)도 그대로다.
- 자동 검사: root 1093/1093(#41을 합친 `3ebcff8`, 합치기 전 `b84d62d` 기준 960/960), 타입 검사 exit 0, Story 검사기 exit 0. 새 시험은 고치기 전 `needs_changes`로 실패했다. 독립 리뷰 두 번 Approve.
- PR syjkim0125/pazmo-agent-office#42. G4는 2026-10-29 "피드백 확인 후 승인"으로 기록했다(초안 확인, ① 승인 후 머지). [G4 기록](verification/2026-10-29-kit-review-without-verdict-g4.md)
- 2026-10-30 실제 실행기 오류(없는 모델의 claude 리뷰어)로 확인했다. kit 리뷰 노드에 `verdict`가 없고 피드백에 `REVIEW_RUNNER_FAILED`가 들어갔다. 안전장치 거절 자체는 거치지 않았다. [검증 기록](verification/2026-10-29-kit-review-without-verdict.md) · [실제 CLI 확인](verification/2026-10-29-real-cli-runner-checks.md)

# 2026-10-29 팀 Story 보드 2단계 (팀 Office 여러 repo, 시험)

- 한 사람이 **팀 Office** 하나에 repo 여러 개를 등록해 켠다(`team add --project` 후 `./office --team`, M16·V18·D24). repo마다 그 repo의 lean 데이터로 엔진을 하나씩 둔다. **2단계 팀 Office는 repo 엔진을 실행하지 않는다(3단계에서 Story Task 모드와 함께 켬).** `start --team --live`나 `./office --team`으로 켜도 같다. repo에 남은 lean 작업은 손대지 않고 그대로 기다린다.
- repo마다 Hub 연결(기존 `hub-link --project`)과 Git 호스트별 `gh` 로그인을 확인한다. 가져가기 멈춤·하루 상한(기본 5)에 걸리지 않으면, 등록 순서로 담당 repo의 ready Task 하나를 가져와 기록하고 하트비트를 보낸다. 응답을 잃었거나 재시작한 경우에는 같은 claim을 이어 받는다. 하트비트에 Hub가 `404 NOT_FOUND`로 답하면(Hub를 새로 만들었거나 repo를 다시 연결함) 기록을 버리고, Hub가 아직 이 사람의 claim이라고 하면 다음 가져가기에서 다시 받는다. 상태는 `status --team`으로 본다. 화면은 없다(`monitor --team`은 `UNSUPPORTED`).
- 같은 origin의 clone 두 개(`DUPLICATE_REMOTE`), 켜져 있거나 켜지는 중의 등록 변경(`TEAM_RUNNING`), 등록된 repo의 단일 Office(`IN_TEAM_OFFICE`), 폴더가 남아 있는 repo 중 가진 Task의 repo 빼기(`OPEN_CLAIM`)는 거부한다. 등록된 repo 폴더가 없으면 `start --team`·`up --team`이 `REPO_MISSING`으로 멈추고 `team remove --project <경로>`를 안내한다. 폴더가 없는 repo를 빼면 그 repo의 로컬 기록도 버린다(`REPO_REMOVED`).
- 리뷰: Task 1–7 모두 Task별 독립 리뷰를 마쳤다(5·6은 수정 1회 뒤 재리뷰 통과). 최종 전체 브랜치 리뷰도 마쳤고, 그 지적을 한 번에 고쳤다: 하트비트 404, 사라진 repo 폴더, repo 엔진 잠금, 켜지는 중의 등록 변경, `OPEN_CLAIM` 안내 문구, 문서의 이른 머지 표현, 공개 저장소에 남은 사내 호스트 이름.
- 자동 검사:
  - 전체 시험 **1083/1083** exit 0: main(`8b9d23b`)을 합친 `678389f`에서 2026-10-29에 돌렸다(OpenSSL 3.6.3이 PATH 앞). 같은 커밋에서 타입 검사 exit 0, Story 검사기 exit 0
  - 수정 커밋 `5434f30`에서 팀·lean 관련 시험 176/176, 타입 검사 exit 0, Story 검사기 exit 0
  - main(#40)을 합친 `45df698`에서 다시 돌린 전체 시험 **1092/1092** exit 0, 타입 검사 exit 0, Story 검사기 exit 0
- G4는 2026-10-29 "피드백 확인 후 승인"으로 기록했다(초안 승인, ① 푸시·PR, 머지는 사용자가 정함). [G4 기록](verification/2026-10-29-team-story-office-repos-g4.md)
- **팀이 아직 쓸 수 없다.** 가져온 Task를 실행하지 않는다(3단계). PL의 Story 올리기(4단계)와 화면(5단계)도 없다.
- 실제 확인(2026-10-30, main `ebef236`): 로컬 Hub와 시험 repo 세 개(github.com, 회사 GHE, gh 로그인 없는 호스트)로 16개를 확인했고, 모두 기대대로 동작했다. 등록·중복 거절, 상태, 가져가기 순서, 하트비트, 재시작과 응답을 잃은 경우의 이어 받기, PL 취소, 멈춤, 하루 상한, 켜진 동안의 연결과 5분 재확인, `REPO_MISSING`·`REPO_REMOVED`, 보류 뒤 PL 풀기, 하트비트 404다. **찾은 것:** repo 빼기(`REPO_REMOVED`)나 하트비트 404는 로컬 기록만 버리고 Hub에는 그 Task가 이 사람의 claim으로 남는다. 그래서 PL이 풀거나 취소할 때까지(풀기는 10분 보류 뒤) 팀 Office가 다른 Task도 가져가지 않는다. 그동안 `status --team`과 로그에 이유가 나오지 않는다. app-be는 실제 데이터와 OpenShift 연결을 건드리지 않으려고 쓰지 않았다. [실제 확인 기록](verification/2026-10-30-team-story-office-real-check.md)
- **남은 것:** 위 찾은 것을 어떻게 다룰지 결정, `up --team` 실제 실행, 다른 PC. [검증 기록](verification/2026-10-29-team-story-office-repos.md) · [사용 안내](LOCAL-PREVIEW.md#팀-office-2단계-시험) · [구현 계획](plans/2026-10-27-1730-feat-team-story-office-repos-plan.md)

# 2026-10-28 claude 역할을 멈출 때 보안 검사 멈춤은 바로 끝내기

- #36은 claude 역할을 멈출 때 SIGTERM을 먼저 보내 토큰 갱신 잠금이 남지 않게 했다. 머지 뒤 독립 리뷰에서 그게 보안 검사 멈춤(예상 밖 hook, 잘못된 init, init 없음, 출력 한도)에도 적용된 것을 찾았다. claude는 SIGTERM 종료 때 SessionEnd hook을 실행하므로, 이 멈춤들은 다시 바로 SIGKILL한다. 취소·시간 초과만 SIGTERM 먼저다.
- claude가 이미 끝난 뒤 들어온 멈춤도 바로 SIGKILL한다(SIGTERM을 무시하는 자식이 살아남던 문제). 정상 종료 중에 나오는 줄은 hook 이벤트가 아니면 종료를 끊지 않는다.
- 자동 검사: root 959/959, 타입 검사 exit 0, Story 검사기 exit 0. 독립 리뷰 두 번(#36 머지 뒤, 이 변경)의 지적을 반영했다.
- 취소·시간 초과 때의 유예는 2초에서 6초로, 바깥 감독 유예는 5.5초에서 12초로 늘렸다(사용자 선택). 갱신 중인 claude가 종료 처리와 갱신 대기를 마치고 잠금을 풀 시간이다.
- G4는 2026-10-29 "피드백 확인 후 승인"으로 기록했다(초안 승인, ① 승인 후 머지). [G4 기록](verification/2026-10-28-claude-stop-integrity-g4.md)
- 2026-10-29 실제 CLI로 쟀다. 갱신이 없을 때 claude 2.1.280은 SIGTERM 뒤 0.3–1.7초에 exit 143으로 끝났다. SessionEnd hook이 있으면 CLI의 기본 한도 1.5초까지 기다려 최대 1.9초였다. SessionEnd hook은 stream 이벤트로 나오지 않는다. [실제 CLI 확인](verification/2026-10-29-real-cli-runner-checks.md)
- 갱신 중인 claude도 쟀다(가짜 토큰, 답하지 않는 프록시). CLI는 갱신을 최대 2초 기다리고 나갔다. 한가할 때는 2.5초 안에 끝났다. **부하가 높으면 6초를 넘었고(최대 9.1초), 6초 SIGKILL로 잠금이 남았다(load average 90–102에서 3회 중 2회).** 2026-10-30 D28로 12초(감독 18초)로 늘렸다. [검증 기록](verification/2026-10-28-claude-stop-integrity.md)

# 2026-10-27 리뷰 실행기 오류를 리뷰 fail로 세지 않기

- 리뷰 실행기(codex·claude CLI)가 보고서 없이 0이 아닌 코드로 끝나면(API 오류·안전장치 거절 등) 이제 리뷰 fail이 아니라 unknown이다. 검증은 `REVIEW_RUNNER_FAILED`로 멈추고 사람에게 넘어간다. 엔지니어를 다시 돌리지 않고 자동 수정 횟수도 쓰지 않는다(D26, 사용자 선택 1안). 등록 검사의 실패는 그대로 fail이다. Claw Office와 lean Office에 같이 적용된다.
- app-be 실제 확인(10-27)에서 sonnet 리뷰어가 안전장치에 막혔을 때, Office가 이것을 고칠 결함으로 기록하고 구현부터 다시 돌린 문제다.
- 자동 검사:
  - root 927/929. 실패 2건은 높은 부하에서 난 Office 시작 시간 초과이고, 따로 돌리면 15/15 통과한다. 리뷰 전 전체 실행은 929/929였다.
  - 타입 검사 exit 0, Story 검사기 exit 0
  - 독립 리뷰 Approve
- G4는 2026-10-28 "피드백 확인 후 승인"으로 기록했다(초안 승인, ① 승인 후 머지). [G4 기록](verification/2026-10-27-review-runner-failure-g4.md)
- 이렇게 멈춘 lean 작업은 #37의 [다시 실행]으로 새 작업을 만들 수 있다. Claw Office에는 아직 재실행이 없다(취소 후 새로 만들기).
- 2026-10-29 실제 실행기 오류로 이 경로를 확인했다. 없는 모델을 고른 실제 claude(2.1.280)와 codex(0.163.0) 리뷰어는 API 오류에 exit 1로 끝났다. 실제 coordinator·kit·VM 리뷰어를 거쳐 `REVIEW_RUNNER_FAILED`로 멈췄고, 엔지니어는 한 번만 돌았다. **안전장치 거절 자체와 Office 화면은 거치지 않았다.** [검증 기록](verification/2026-10-27-review-runner-failure.md) · [실제 CLI 확인](verification/2026-10-29-real-cli-runner-checks.md)

# 2026-10-27 새 Office: 멈춘 작업 다시 실행 (`--lean`)

- 엔진이 멈춘 작업(멈춤 표시)의 상세에 **[다시 실행]**이 생겼다(M15·V17·D25, G3 2026-10-27 승인). 제목·내용·agent·위험도가 채워진 창에서 고쳐 확인하면 새 작업을 만들고, 그다음 멈춘 작업을 취소한다. 두 작업은 서로 링크로 이어진다. 엔진과 Claw Office는 바꾸지 않았고, 결정을 만들지 않으며, 대기열도 그대로다.
- 새 작업을 만들지 못하면 멈춘 작업은 그대로다. 한 작업은 한 번만 다시 실행된다(동시 요청 포함). 취소만 실패하면 새 작업은 남고 "이전 작업 화면에서 취소하세요"가 나온다.
- 엔진 복구 결정(B, 승인된 Story·계획을 살린 재개)은 고르지 않았다. 멈춤이 계속 자주 나오면 별도 G3로 다룬다.
- 자동 검사와 독립 리뷰 결과는 검증 기록에 있다. 가짜 실행기 Office로 화면을 확인했다.
- PR syjkim0125/pazmo-agent-office#37. G4는 2026-10-28 "피드백 확인 후 승인"(컨트롤러 답 초안 그대로)으로 [G4 기록](verification/2026-10-27-lean-rerun-g4.md)에 남겼다.
- **남은 것: app-be 실제 확인(사용자 Office 재시작 필요).** [결정](understanding/lean-rerun-decision.md) · [검증 기록](verification/2026-10-27-lean-rerun.md) · [사용 안내](LOCAL-PREVIEW.md#새-office-1단계-시험)

# 2026-10-22 팀 Story 보드 1단계 (Hub)

- 허브가 팀 Story 보드를 저장하고 규칙을 지킨다(M16·V18·D24, G3 2026-10-22 승인). 프로젝트(repo별 base 브랜치)·Story·Task 그래프를 저장하고 올릴 때 검사한다(순환, 같은 repo 파일 겹침의 순서 없음, 프로젝트 밖 repo, 한도). 담당 repo의 ready Task 가져가기(동시에 가져가면 한 명만, 사람당 하나), 하트비트가 10분 끊긴 Task의 보류 표시와 PL의 풀기·취소, 같은 Story·repo의 머지 잠금, 머지·실패 결과 보고와 다시 실행, Task 추가, Story 검증·완료(G4 대기)를 한다.
- Office는 새 `/api/link/story/*`를 프로토콜 3으로 부른다. 기존 경로와 프로토콜 1·2는 그대로이고, 프로토콜 2 경로는 3도 받는다. 배포된 허브와 지금 Office는 바뀌지 않는다.
- 최종 전체 리뷰의 Important 5건을 고쳤다: 가져간 Task 다시 받기, 머지 잠금 스스로 풀기, 자기 claim의 끝난 Task는 "이제 당신 Task가 아님"이 아닌 상태 오류, Story 검증 결과 재전송, PL이 푼 뒤 마지막 잠금 보유자의 늦은 머지 보고 반영(화면에 잠금 표시), PL이 없을 때 허브 관리자의 풀기·취소. PR 주소 검사 강화와 Story 검증까지 덮는 지문도 넣었다.
- 자동 검사:
  - root 765/765, 타입 검사 exit 0
  - Story 검사기 exit 0
  - Task별 리뷰 5건을 통과했다. 최종 리뷰 수정분은 재검토에서 모두 반영됐다.
  - 재검토에서 찾은 잠금 구멍(N1)도 고쳤다. 스스로 잠금을 풀거나 실패를 보고한 claim의 늦은 머지 보고는 이제 거부된다. 재검토를 통과했다.
- OpenShift 허브에 이 코드를 올렸다(빌드 `pazmo-hub-5`). `/healthz` 200, 새 경로는 프로토콜 3만 받고, 기존 경로·데이터·Office 연결은 그대로이며, 새 표 8개가 생겼다. G4는 2026-10-22 "피드백 확인 후 승인"으로 기록했다.
- **남은 것: 2단계(Office 여러 repo)·3단계(Story Task 모드)·4단계(PL)·5단계(화면), 실제 허브에서 새 경로로 데이터 쓰기 확인, V18 실제 확인(Office 두 개·시험 repo 두 개).** 허브만으로는 팀원이 아직 쓸 수 없다. [G3 결정](understanding/team-story-board-decision.md) · [구현 계획](plans/2026-10-22-1445-feat-team-story-board-hub-plan.md) · [검증 기록](verification/2026-10-22-team-story-board-hub.md)

# 2026-10-21 새 최소 Office 1단계 (`--lean`, 시험)

- Claw Empire 없이 **Tasks·작업 상세·Decisions·Agents** 화면 네 개만 있는 새 Office를 옵션으로 더했다(M15·D23). 켜는 명령은 `./office --lean`이다. 기본은 지금처럼 Claw Office이고, 새 Office는 `lean/office.sqlite`에 새로 시작한다. 실행 엔진(결정·격리 실행·검증·인도)은 Claw Office와 같다.
- **agent:** 작업을 맡는 일꾼이다. 기획·설계·구현은 작업 실행기로, 리뷰와 G4 평가는 리뷰 실행기로 돈다. 사람이 추가하고, 이름과 실행기를 바꾸고, 지운다.
- **이번 단계에 없는 것:** 팀 허브 화면(2단계), Claw 삭제·기본 전환(3단계), npm 설치(4단계), 채팅.
- 자동 검사:
  - root 881/881, 타입 검사 exit 0
  - vendor 232/234(이전부터 실패하던 sprite-avatar 2건), vendor tsc exit 0
  - 빌드 exit 0
  - Task별 리뷰와 보안 포함 브랜치 전체 리뷰를 거쳤다. 전체 리뷰의 Important 4건과 "결과 요약" 누락을 고쳤고, 재검토에서 모두 해결됐다.
- **app-be 실제 확인을 통과했다(2026-10-27).** 작업 하나를 다른 실행기 리뷰(작업 `claude · default`, 리뷰 `claude · sonnet`)로 G1 → 구현 → 리뷰 → G4 → 인도까지 돌렸고, agent 추가·이름·실행기 변경·삭제와 거부(작업 중, 마지막 agent), Decisions 작업 링크를 확인했다. codex를 리뷰 실행기로 고르는 확인은 개인 지침 파일 때문에 하지 못했다.
- 실제 확인에서 sonnet 리뷰어가 설명 뒤에 붙인 JSON 보고서를 읽지 못해 작업이 멈추는 문제를 찾아 고쳤다(`dc6d213`·`70d3d8a`, main에 있던 claude 출력 변환, 독립 리뷰 지적 반영). root 927/927, 타입 검사 exit 0. 실행기 오류를 fail로 분류하는 문제, 멈춘 작업 재실행 없음, OAuth 갱신 잠금은 후속 작업 후보다.
- G4는 2026-10-27 "피드백 확인 후 승인"(컨트롤러 답 초안 그대로)으로 [G4 기록](verification/2026-10-21-lean-office-phase1-g4.md)에 남겼다. 같은 PR에서 README(영·한)를 지금 상태(기본은 Claw Office, `--lean`은 옵션, codex·claude 실행기, 팀 허브)에 맞췄다. [사용 안내](LOCAL-PREVIEW.md#새-office-1단계-시험) · [검증 기록](verification/2026-10-21-lean-office-phase1.md) · [G3 결정](understanding/lean-office-decision.md)

# 2026-10-16 받은 팀 허브 요청을 Office Inbox에서 수락·거절

- 담당자는 자기 레포로 들어온 대기 중 요청을 Office **Tasks Inbox 맨 위 "받은 팀 허브 요청"**에서 수락하거나 사유와 함께 거절한다(M14·D22). 거절하면 요청이 닫히고 요청자의 Office 카드와 허브에 "거절됨 · 사유"가 보인다. 허브 웹에도 거절이 생겼다. 다른 허브로 연결을 바꾸면 확인 후 이전 허브 작업을 취소한다(이전 허브에는 알리지 않는다).
- root 시험 간헐 실패의 원인(CLI 허브가 결과 줄을 찍은 뒤 신호 처리기를 등록)을 찾아 고쳤다.
- 자동 검사:
  - root 721/721, 타입 검사 exit 0
  - vendor 232/234(이전부터 실패하던 sprite-avatar 2건), tsc exit 0
  - 빌드 exit 0
  - Task별 리뷰와 보안 포함 전체 리뷰: Important를 모두 고쳤다(재검토 Approved).
- **허브 재배포 후 OpenShift 실제 확인(두 건 수락·거절)과 G4는 남아 있다.** [사용 안내](LOCAL-PREVIEW.md#받은-요청-office에서-수락거절) · [검증 기록](verification/2026-10-16-team-hub-office-inbox.md) · [G3 결정](understanding/team-hub-office-inbox-decision.md)

# 2026-10-15 Office 캐릭터 역할 중심 정리 (B)

- Office 화면에는 실제로 역할을 맡는 캐릭터(PM/리드/개발/리뷰)와 작업 중인 캐릭터만 보이고, 역할 이름으로 표시된다(M13·D21). 빈 부서 방은 그리지 않는다. DB의 캐릭터는 바꾸지 않고, 남은 캐릭터의 그림도 그대로다. 실제 Office(claw 엔진)는 원본 14명 중 Clio·Sage·Aria·Hawk만 보인다.
- 사용자 지시("결정은 안 하고 일단 다 승인으로 넘어가, G4 질문은 마지막에 한 번에")에 따라 결정은 기본값으로 진행했고 G4에서 확인한다.
- 자동 검사:
  - root 680/680, 타입 검사 exit 0
  - vendor 208/210(이전부터 실패하던 sprite-avatar 2건), vendor tsc exit 0
  - 빌드 exit 0
  - Task 리뷰와 B 전체 리뷰에서 나온 Important를 모두 고쳤다(재검토 Approved).
- **app-be 실제 화면 확인과 G4는 남아 있다.** [사용 안내](LOCAL-PREVIEW.md#office-캐릭터) · [검증 기록](verification/2026-10-15-office-role-characters.md) · [G3 결정](understanding/office-role-characters-decision.md)

# 2026-10-15 팀 허브 합류·연결 붙여넣기 한 번 (A)과 OpenShift 허브 (U12)

- **OpenShift 허브(U12, M11·D19):** 허브를 OpenShift 프로젝트에 프록시 뒤 모드로 띄웠다(파드 1개, PVC SQLite, 라우터 TLS). Office는 공인 인증서를 시스템 신뢰로 검증해 지문 없이 연결한다. 레포가 공개라서 배포 파일은 Template이고 클러스터 값은 git이 무시하는 `deploy/openshift/local.env`에 둔다. 실제 배포와 Office 한 대 연결은 확인했다. 두 번째 팀원 확인, 검증 문서, G4는 남아 있다.
- **합류·연결 단순화(A, M12·D20):** 팀원이 초대 링크로 합류하고, 시작 화면의 연결 문자열을 복사해 Office 상단 **팀 허브**에 붙여넣으면 연결된다. 경로나 터미널은 필요 없다. 레포는 origin으로 찾고, 없으면 그 팀원을 담당자로 자동 등록한다. 터미널 `hub-link --connect`도 있다.
- 자동 검사:
  - root 677/677, 타입 검사 exit 0
  - vendor 169/171(이전부터 실패하던 sprite-avatar 2건), vendor tsc exit 0
  - 빌드 exit 0
  - Task별 리뷰와 보안 포함 전체 리뷰: Ready, Critical/Important 0
- **실제 확인(OpenShift에서 테스트 팀원 합류 → 붙여넣기 연결 → 보내기·수락·취소)과 G4는 B(캐릭터 정리) 다음에 한다.** [사용 안내](LOCAL-PREVIEW.md#팀원의-가장-짧은-순서) · [검증 기록](verification/2026-10-15-team-hub-onboarding.md) · [G3 결정](understanding/team-hub-onboarding-decision.md)

# 2026-10-14 Office에서 보낸 팀 허브 요청 취소

- 연결된 Office의 Decisions `팀 허브 · …` 항목(2번 **요청 취소**)과 Tasks 카드의 ✕로, 사람이 화면 안 확인을 거쳐 이 Office에서 보낸 요청을 취소한다(M10·V12·D18, G3 2026-10-13 승인). "거절"은 요청 취소와 같은 뜻이다. 허브의 기존 취소를 새 연결 API `outgoing-cancel`로 부르며, 토큰 권한은 (팀원, 보낸 곳 레포) 범위의 취소 하나만 넓어진다. D17의 "Office에서 취소 불가" 규칙을 대체한다.
- 실제 확인 중 앱의 내장 브라우저가 `window.confirm`·`window.alert`를 막는 것을 발견했다. 사용자 요청에 따라 Office 화면의 confirm·alert를 모두 화면 안 확인창·알림으로 바꿨다(`window.prompt` 1곳은 제외).
- 자동 검사:
  - root **590/590**, 타입 검사 exit 0, 빌드 exit 0
  - vendor 화면 **151/153**(실패 2건은 이전부터 실패하던 sprite-avatar 테스트), vendor 타입 검사 exit 0
  - Task별 리뷰와 최종 전체 리뷰에서 Critical·Important는 0이며, 발견한 항목은 모두 고쳤다.
- **내 Mac의 Office 두 개로 실제 확인을 했다(2026-10-13~14).**
  - 수락 뒤 Decisions에서 취소: 허브 취소, 상대 작업 `cancelled`, 보낸 기록 취소를 확인했다.
  - 수락 전 카드 ✕로 취소: 허브와 보낸 기록 모두 취소됐다.
  - 노트북 IP가 바뀌어 허브를 두 번 다시 띄웠다. 사용자는 허브를 사내 플랫폼에 올리는 방안을 검토 중이다(별도 Story).
- PR syjkim0125/pazmo-agent-office#21(커밋 `d671ffb`). G4는 2026-10-14 사용자 답변과 "피드백 확인 후 승인"으로 검증 기록에 남겼다. [사용 안내](LOCAL-PREVIEW.md#office에서-보내기-2단계) · [검증 기록](verification/2026-10-14-team-hub-office-cancel.md) · [G3 결정](understanding/team-hub-office-cancel-decision.md)

# 2026-10-13 팀 허브 2단계 A·B·C (Office에서 보내기)

- 연결된 live Office의 Tasks 카드와 채팅창에서 사람이 다른 레포로 팀 허브 요청을 보내고, 카드에서 상태(`↗ <레포> · <상태>`)를 보며, 상대 PM의 질문·범위 승인(G1)·계획 재개에 **자기 Office Decisions**에서 답한다(M9·V11·D17, G3 2026-10-13 승인). 허브 프로토콜 2가 연결 토큰에 레포 목록·요청 생성·(팀원, 보낸 곳 레포) 범위의 보낸 요청 조회·요청자 답변을 더한다. 허브는 1과 2를 함께 받는다. 토큰은 Office 서버에만 있고, Office에서는 승인만 할 수 있다(거절·취소는 허브).
- 자동 검사 root **582/582**, 타입 검사 exit 0, vendor 화면 **118/120**(실패 2건은 이전부터 실패하던 sprite-avatar 테스트), vendor 타입 검사 exit 0, 빌드 exit 0. Task별 리뷰와 최종 전체 리뷰(Critical 0)에서 나온 Important를 모두 고쳤다. 예: Office에서 보낸 요청을 취소할 수 있던 문제, 인코딩된 `hubout:` 답변이 전달되지 않던 문제, 재전송 시 작업 연결이 사라지던 문제.
- **내 Mac 한 대로 Office 두 개를 써서 실제 확인을 통과했다(2026-10-13).** app-be 카드에서 보내기 → 시험 레포 담당 수락 → 상대 PM G1을 app-be Decisions에서 승인 → 상대 작업 G1·G4(app-be에는 안 뜸) → 인도 → app-be 보낸 기록 완료와 4줄 요약까지 확인했다. 시험 레포 원본은 바뀌지 않았다. **다른 사람 PC와 회사 IT 정책은 아직 확인하지 않았다.**
- PR syjkim0125/pazmo-agent-office#18로 main에 합쳐졌다. G4는 2026-10-13 사용자 답변과 "피드백 확인 후 승인"으로 [검증 기록](verification/2026-10-13-team-hub-office-send.md#g4-2026-10-13-사용자-답변)에 남겼다. [사용 안내](LOCAL-PREVIEW.md#office에서-보내기-2단계) · [검증 기록](verification/2026-10-13-team-hub-office-send.md) · [G3 결정](understanding/team-hub-office-send-decision.md)

# 2026-10-12 팀 허브 1단계

- 초대받은 팀원이 사내망 허브(`pazmo-office hub`)에서 레포 목록과 요청 게시판을 함께 쓰고, 레포 담당자가 수락한 요청을 **자기 PC의 Office와 자기 로그인**으로 실행하는 1단계를 구현했다(M8·V10·D16, G3 2026-10-08 승인). 허브는 실행기·로그인·인도물을 갖지 않고, 각 Office는 `127.0.0.1` 경계를 유지한 채 `hub-link`로 나가는 연결만 더한다. 질문·G1은 요청자가 허브에서, 작업 G1·G3·G4와 인도는 맡은 사람이 자기 Office에서 한다.
- 자동 검사 root **540/540**, 타입 검사 exit 0(2026-10-12). 단위별 리뷰와 최종 전체 리뷰(Critical 0)에서 나온 보안 결함(null Origin, CA 다중 인증서 고정 우회, CA 이름 제한 등)을 모두 고쳤다.
- **내 Mac 한 대로 실제 확인을 통과했다(2026-10-12).** 허브에서 팀원 요청 → 수락 → Office 접수 → 허브 G1 → 로컬 작업 G1·G4 → 인도 → 허브 완료·diff·요약까지 확인했고 원본 app-be는 바뀌지 않았다. **다른 사람 PC, 회사 IT·보안 정책, 여러 날 운영은 아직 확인하지 않았다.** 다중 PC 검증 완료가 아니다. 노트북 IP 변경으로 허브·브라우저 세션이 끊기는 한계가 있어 고정 IP에서만 운영한다.
- PR syjkim0125/pazmo-agent-office#17로 main에 합쳐졌고 G4는 PR에 기록됐다. [사용 안내](LOCAL-PREVIEW.md#팀-허브-1단계-시험) · [검증 기록](verification/2026-10-12-team-hub.md) · [G3 결정](understanding/team-hub-decision.md)

# 2026-10-06 사용자 설치 codex·claude 실행기 선택

- 역할(PM·Lead·Developer·Reviewer, G4 평가는 Reviewer 기준)마다 사용자 PC에 설치·로그인된 codex 또는 claude를 화면에서 고르고 저장한다. 별도 API 키 없이 각 CLI의 구독 로그인을 쓴다. 모델·effort 목록은 각 CLI에서 받는다. 둘 중 하나만 있어도 시작한다. 고정 0.155.1 codex는 `--codex-runtime pinned`로 남겼다. [G3 결정](understanding/cli-runner-selection-decision.md)
- 로그인 정보는 읽거나 옮기지 않는다. 도구는 기존 VM 컨테이너에서만 실행한다(claude는 내장 도구 없이 Office MCP 다리로만). 바이너리는 (SHA, 모델)별로 로그인 없는 VM 검사를 통과해야 실행된다. 실패하면 다른 실행기·API 키로 자동 전환하지 않는다.
- codex는 로그인 폴더의 개인 지침(`~/.codex/AGENTS.md`)을 항상 모델에 넣는다. 9/22부터 쓰던 고정 경로도 같았다. 사용자 결정에 따라 그 파일이 있으면 codex 역할을 막고 안내한다. **이 PC는 파일이 있어 codex가 차단되며, 고르지 않은 역할은 claude를 쓴다.**
- root 451/451, 타입 검사 exit 0. vendor UI 98/100이며 실패 2건은 HEAD에서도 실패한다. 실제 VM 검사 codex 0.160.0·claude 2.1.280 각 7/7. 실제 구독 실행은 claude 최종 코드 1회 성공, codex 1회 성공(차단 전, 개인 지침 포함 가능). 별도 미리보기에서 화면 저장·재시작 유지를 확인했다. **역할 그래프 전체·사용자 G4 인수는 이번 범위가 아니다.** [검증 기록](verification/2026-10-06-cli-runner-selection.md)
- 실사용 시험: app-be "README 맨 위에 목차 추가"를 claude로 PM→Lead→Developer→Reviewer→G4(사용자)→인도까지 완료해 보고서에 올렸다. 시험 중 중첩 git 저장소 스냅샷 오류와 claude Lead 조사 근거 누락을 고쳤다. 요청에 따라 보고서 실행기 섹션과 G4 `[변경사항]` 3줄 요약을 추가했다. [검증 기록](verification/2026-10-06-cli-runner-selection.md#실사용-시험-app-be-readme-맨-위에-목차-추가-2026-10-06)

# 2026-10-02 Decisions 승인 요청 만료·재발급

- 열린 Decisions 창이 만료된 승인 요청을 계속 보여 주고, 재발급 후 메모가 사라지던 문제를 고쳤다(D14). 목록 조회 시 만료된 요청을 새 요청으로 바꾸고, 메모는 새 요청으로 옮기며, 409에도 메모를 유지한다. 승인은 자동 재제출하지 않는다. 열린 승인 요청의 유효 시각을 표시한다.
- 같은 계획의 재발급은 채팅 안내를 반복하지 않는다. 챌린지 1회 소비·세션 귀속·10분 만료는 그대로다.
- 격리된 `--claw` 미리보기의 실제 브라우저와 자동 테스트로 확인했다. 실행 중인 app-be 인스턴스는 재빌드·재시작 전까지 이전 화면을 쓴다. **G4와 실제 모델 경로 재확인은 남아 있다.** [검증](verification/2026-09-29-native-claw-preview.md)

# 2026-09-29 Decisions·Task Board·한 명령 실행

- 승인 평가가 보완을 요청했을 때 이전 답변과 실제 항목별 이유를 Decisions에 표시한다. 부모 요청은 하위 작업의 Review/인도 상태를 반영하며, 중복 Run과 지원되지 않는 수동 상태 전이를 제시하지 않는다.
- `./office --project /절대/경로` 이후 `./office`: 고정 의존성·빌드·runtime·전용 VM 검사·Office 실행을 연결한다. [첫 준비와 사용법](LOCAL-PREVIEW.md)을 따른다.
- 같은 Mac에서 독립 소스·의존성·프로젝트·데이터 설치, 재사용·재시작과 VM 46개 검사를 통과했다. 새 물리 기기/새 로그인/빈 VM 최초 생성 시험은 아니다.
- 실제 README pilot의 PM→Lead→구현→리뷰·검사 증거는 보존됐다. 실제 사용자의 답변은 보완 필요 판정을 받았으며 **최종 G4·인도는 아직 미완료**다. 실제 모델의 결함 수정 사례와 새 설치에서의 완전한 실제 업무 인수도 완료로 주장하지 않는다.
- [이번 검증](verification/2026-09-29-native-claw-preview.md). 아래 기록은 각 시점의 이력이다.

# 2026-09-29 원본 Claw 복구 진행

- CEO를 직원과 같은 사람형 픽셀 캐릭터로 변경하고 화면에서 확인했다.
- 원본 TaskBoard·서버·로컬 세션·WebSocket을 연결했다. `start --claw`로 시작하며 현재 49930 미리보기도 원본 서버를 사용한다. 별도 Tasks 대체 컴포넌트는 제거했다.
- 관련 33개 테스트, 양쪽 타입 검사와 UI 빌드 통과. 작업 저장/재시작, 인증 거절, 실시간 task 이벤트, 직접 provider·자동 병합 차단을 확인했다.
- `--claw --live`로 기존 kit/VM 실행기와 원본 task·대화·Decisions를 연결했다. 실제 PM 완료·사용자 G1 이후 팀장의 잘못된 exclude 목록으로 멈췄던 파일럿을 재개했다. 사용자 요청을 기존 Decisions로 기록하고, 실패 run·Office 작업·기존 승인을 보존했다. 실제 팀장 → Developer → Reviewer와 동일 변경본의 검사 6개가 통과했다. **현재 실제 G4 답변·평가·인도 대기이며 전체 알파 완료는 아니다.** 이번 후보는 첫 검증에서 통과했으며 실제 수정 루프 성공으로 보고하지 않는다.
- kit가 human 상태의 reset을 금지하므로 공식 init-role로 팀장 후속 run을 만들고 이전 run·사용자 재개 기록을 연결했다. Office 요청 전체의 재개 한도는 2회이며 새로운 run으로 초기화되지 않는다. PM/G1은 재실행하지 않았다. 재개 관련 41개 테스트·타입 검사·vendor lint·Story checker(exit 0)가 통과했다. 단위 검사와 실제 모델 증거는 구분한다.
- 이번 연결의 관련 95개 테스트가 통과했고, 후속 수정 후 native/planning 35개와 Decisions 4개, root 타입 검사·UI 빌드가 통과했다. 이 자동 검증을 실제 모델의 전체 인도 증거로 취급하지 않는다.
- [실행 안내](LOCAL-PREVIEW.md) · [증거와 남은 작업](verification/2026-09-29-native-claw-preview.md). 아래는 변경 당시의 기록이며 현재 완료 주장으로 사용하지 않는다.

# 2026-09-28 Tasks integration correction

- 사용자 정정에 따라 **별도 activity 페이지를 제거하고 기존 Tasks 메뉴를 복원**했다. 요청·대화·diff·검증·승인·인도 조회는 Office 앱의 Tasks 내부로 옮겼다. 채팅 제어와 내부 인증은 유지한다. 옛 주소는 Tasks로 이동하며 별도 HTML/JS는 제공하지 않는다.
- 이 변경은 화면 통합이다. **실제 실행에 따른 캐릭터 상태와 Decisions 연동은 아직 미구현**이다. 이전 화면 구현/테스트 성공을 이 기능들의 완료로 확대하지 않는다. 실제 모델·사용자 G4·인도 인수시험도 남아 있다.
- [현재 사용 안내](LOCAL-PREVIEW.md) · [통합 검증](verification/2026-09-28-tasks-observation.md). 아래 standalone activity 관련 설명은 변경 전 기록이다.

# 2026-09-28 chat control and read-only observation checkpoint

- 사용자의 “진행해”에 따라 요청·질문 답변·승인·취소는 **Codex 채팅**, Office는 **진행과 결과 조회**로 변경했다. 내부 인증과 기존 승인·VM·kit 역할 그래프 경계는 유지한다. `bridge`는 지원된 기존 API만 호출하고 `monitor`는 조회 전용 연결을 연다. 사용자 키 입력과 옛 operator 조작 UI를 제거했다. 메인 Tasks 진입점은 조회 화면으로 연결된다.
- 전체 root 333개, 마지막 관련 7개 및 UI 3개 재검사, 타입·Story/Task 검사와 Office 빌드를 확인했다. 기존 조작 UI 전용 테스트는 새 bridge/관찰 검사로 교체했다. 실제 브라우저에서 키 입력 없는 연결·요청 등록 표시·취소·메인 버튼 이동을 확인했다. **모델을 호출하지 않은 연결 검증**이며, 새 채팅 경로의 실제 모델·사용자 G4·인도 인수시험은 미완료다.
- 현재 열린 서버는 `/private/tmp/pazmo-office-visual-preview/project`의 모델 없는 미리보기다. 실제 작업은 사용자 대상 Git 프로젝트와 작업을 선택한 뒤 검증된 영구 설정으로 시작한다. 별도 상주 자동화는 추가하지 않았다. 기존 README pilot 승인/증거를 보존하며 전체 Story를 완료로 표시하지 않는다.
- [사용 순서](LOCAL-PREVIEW.md) · [채팅 호스트 규약](CHAT-CONTROL.md) · [이번 검증과 리뷰](verification/2026-09-28-chat-observation.md). 아래 화면 조작 방식과 미완료 표기는 각 당시의 기록이다.

# 2026-09-28 persistent setup checkpoint

- **setup-runtime --apply → start --live → operator-key**를 연결했다. 고정된 공식 배포본을 영구 데이터 폴더에 설치하고 기존 바이너리 해시를 확인한다. 현재 Mac에서 실제 설치·재사용과 모델 호출 없는 시작/종료/재시작 두 회를 확인했다. 전체 회귀 **348/348**, 타입·Story/Task 검사 통과. [현재 Mac 실행 순서](LOCAL-PREVIEW.md#현재-mac에서-시작하기) · [검증 범위](verification/2026-09-28-runtime-setup.md).
- 실제 화면 인수시험에 사용할 기존 Git 프로젝트 경로와 작은 작업에 대한 사용자 답변을 기다린다. **실제 모델·사용자 승인·인도까지의 전체 화면 검증은 아직 미완료**다. 기존 README pilot 승인과 증거는 보존한다. 아래 초기 설정 미완료 표기는 이전 기록이다.

# 2026-09-23 kit role integration checkpoint

- **화면의 저장된 G4 답변 확인 실행 → 별도 평가 → 승인 후 인도**를 검증된 controller/읽기 전용 VM 경로에 연결했다. 원문 사용자 답변과 승인 의사는 그대로 유지하고, 같은 후보·답변에 대한 엄격한 평가만 받는다. 실행 예산·최대 2회 명시적 평가 시도·취소·unknown 재실행 차단과 실패 코드 보존을 확인했다. 전체 341개 및 최종 관련 81개 검사, 타입 검사, Chrome 모의 화면 검사 통과. **이번 모델 응답/승인은 fixture이며 실제 모델 평가·사용자 화면 인수 검증은 미완료**다. 지속 가능한 초기 설정과 정식 화면의 실제 작업 한 건이 다음 범위다. [검증 기록](verification/2026-09-23-g4-runtime.md). 아래 G4 연결 미완료 표기는 이 변경 전 기록이다.

- 정식 **start --live → 화면의 PM/팀장 실행 → 계획 등록·실행 승인 → 구현/리뷰/검증 실행·취소** 경로를 연결했다. 실제 검증된 바이너리·VM으로 시작/상태/종료를 확인했으며 이 검사는 모델을 호출하지 않았다. 전체 회귀 323개와 관련 검사를 통과했다. **G4 답변 평가 연결, 지속 가능한 초기 설정, 화면을 통한 실제 모델·사용자 인수 검증은 미완료**다. [현재 실행 안내](LOCAL-PREVIEW.md#qualified-live-startup-and-screen-controls) · [검증 경계](verification/2026-09-23-live-launch.md). 아래 공개 실행 미연결 표현은 이 후속 작업 이전의 기록이다.
- 새 요청의 **PM clarify/propose → 화면의 실제 사용자 G1 입력 → Lead investigate/plan** 연결을 구현했다. kit CLI가 노드·질문 재개를 결정하고 Office는 승인·대화·실행 슬롯을 관리한다. 기존 대화는 유지한다. 전체 회귀 314개, 최종 관련 38개, 타입 검사 및 Chrome 모의 화면 검사를 통과했다. 실제 모델은 이번 연결에서 호출하지 않았다. 공개 모델 시작·계획 등록/실행 승인·G4 평가 controller 연결과 화면을 통한 실제 인수 검증은 남아 있다. [검증과 경계](verification/2026-09-23-kit-role-runs.md#native-planning-and-story-g1-continuation).
- 첫 실사용 마일스톤을 사용자 목표대로 확정했다. kit 4.1.0과 현재 브랜치를 유지하며, 추가 업무 유형·tarball·학습 고도화 등은 전체 Story의 후속으로 남긴다. [목표](local-alpha-goal-prompt.md).
- 후속 연결: **실행 결과 → 결과 목록 조회 → 검증된 diff와 승인 자료 보기**에서 준비된 실제 diff·파일 권한과 G4 질문을 조회하고 본인 답변/거절을 제출할 수 있다. 서버에서 승인이 확인된 결과물은 **승인된 결과물 인도받기**로 인도하고 경로를 표시한다. 답변 평가 controller와 공개 모델 실행 연결은 아직 남아 있다. 전체 회귀 304개와 후속 UI 수정 후 관련 17개, 타입 검사 및 Chrome 모의 API 화면 검사를 통과했다. [검증과 경계](verification/2026-09-22-intake-console.md).
- README 결과물은 사용자의 **“결과 일단 승인할게 넘어가.”** 발언으로 대화상 승인됐다. 같은 G4 문답은 반복하지 않는다. Office DB의 G4 처리·인도 및 로컬 알파 전체 인수 검증은 별도 미완료다. [원문 승인 기록](understanding/auth-guide-pilot-diff.md).

- kit 4.1.0의 실제 역할 CLI를 설치하고 Developer/self-check/Reviewer/feedback을 기존 Office runner에 연결했다. 역할 상태는 kit 파일, 프로젝트·프로세스·승인은 Office DB가 소유한다. 상세 증거와 남은 범위: [검증 기록](verification/2026-09-23-kit-role-runs.md).
- README 인증 안내 작업의 G1은 사용자의 **“이 문서 작업으로 진행”** 응답으로 승인됐다. 기존 인증 G3도 유효하다. 아래 날짜의 G1/인증 대기 설명은 과거 상태다.
- 실제 Developer와 Reviewer가 첫 후보를 만들고 검사 5개를 통과했다. 이후 controller 통합 검토가 실제 문구 모순을 발견해 기존 리뷰를 보존한 채 수정 요청을 기록했다. 같은 Developer run에서 **실제 수정 1회와 새 Reviewer/검사 5개 재검증**이 완료됐다. 현재는 [사용자 승인 원문을 보존한 상태](understanding/auth-guide-pilot-diff.md)이며 Office DB 처리·인도 전이다. 해당 실행기 변경 당시 Office 회귀 292/292, VM 경계 5/5 통과.
- 공개 화면에서 전체 작업 실행, worker CE/Superpowers 검증 및 전체 제품 완료를 의미하지 않는다. PM/Lead 역할 그래프와 질문 재개는 위 후속 연결의 모의 모델 검사까지 완료됐다. main 병합과 배포는 사용자 담당이다.

## 이전 진행 기록

# 진행 상태 — 2026-09-22

- 2026-09-22: 승인된 개별 계약을 실제 구독 controller와 기존 Engineer→Reviewer/검사→최대 두 번 수정→G4 증거 준비에 연결하는 내부 실행 명령을 추가했다. 실제 PM/Lead의 README 인증 안내 제안을 검토해 등록했으며 **개별 사용자 G1 대기**다. 관련 21개 테스트와 실제 VM의 검사 대조군을 확인했다. 이번 단계에서 실제 Engineer/Reviewer를 호출하거나 G4/인도를 완료하지 않았다. [실행·증거·남은 범위](verification/2026-09-22-live-contract.md).

- 2026-09-22: 승인된 기존 Codex 로그인으로 실제 PM→Lead 인계를 두 번 확인했다. 고정 controller/model catalog, 내부 opt-in job adapter, 실제 VM 경계 5개 흐름을 연결했다. 최종 root 273/273, 타입 검사와 Story checker exit 0. 생성된 검증 계획의 Git 가정을 발견해 실행 환경 문맥을 보강했으며 제안은 승인하거나 인도하지 않았다. 전체 완료가 아니라 인증·계획 인계의 실제 검증이다. [검증과 남은 범위](verification/2026-09-22-subscription-controller.md).

- 인증 위치 G3 승인: 사용자가 Mac의 기존 Codex 로그인은 controller만 사용하고 파일·명령 도구는 VM에 제한하는 구성의 구현·검증·실제 작업 시험을 승인했다. [결정 기록](understanding/remote-controller-auth-decision.md). 아래 과거 기록의 인증 대기는 당시 상태다. 도구/설정/네트워크 경계 검증과 실제 모델·G4 증거는 여전히 필요하다.

- 2026-09-22: Office의 **작업 관리** 화면에서 현재 프로젝트 요청 등록·목록·대화·PM 답변·취소를 기존 operator API에 연결했다. 브라우저 등록/답변/재시작/취소와 root **267/267**을 확인했다. 질문은 fixture이며 모델 실행·실제 G4·프로젝트 전환·승인 UI는 남아 있다. [사용 안내](LOCAL-PREVIEW.md#planning-conversation-screen) · [검증](verification/2026-09-22-intake-console.md).

- kit 4.0.0 인계를 코드/패키지와 비교했다. Office DB에 kit 전이를 원자적으로 반영할 API는 추가 협의가 필요하며, Office 설치는 3.1.1을 유지한다. PM/Lead에 읽기 전용 snapshot 문맥과 스킬 미검증/direct 상태를 전달하도록 수정했다. root **260/260**, 타입 검사, 실제 VM 읽기/쓰기 차단 시험 통과. 모델 응답은 fixture다. [검토·kit API 요청](kit-office-integration-request.md) · [변경·검증 경계](verification/2026-09-21-kit-handoff-context.md).

- PM→팀장 내부 실행을 읽기 전용 VM 및 전체 실행 슬롯 3개에 연결했다. 질문·제안·실패에서 멈추고 취소/재시작 뒤 늦은 응답을 거부한다. root 258개, 타입 검사, 실제 VM 읽기/쓰기 차단/정리 시험 통과. 모델 응답은 fixture이며 실제 모델·UI·G4·pilot은 남아 있다. [증거와 범위](verification/2026-09-21-planning-execution.md).
현재 브랜치 `codex/office-runtime-baseline`에 **로컬 CLI·읽기 전용 Office preview·operator 계약/승인 API**를 구현했다. main에 머지된 U1 checkpoint `8e14344e97ae5effd90bd5b00fff8334bab63425`에서 시작했다. 이 브랜치는 전체 Story가 진행 중인 구현 체크포인트이며, G4·live 검증·main 병합은 완료하지 않았다. 기본 checkout의 기존 사용자 파일은 보존했다. [체크포인트 범위와 검증](verification/2026-09-21-runtime-checkpoint.md).

[실행/계약 승인 안내](LOCAL-PREVIEW.md) · [계약 구현 증거](verification/2026-09-19-contract-approvals.md) · [preview 검증·리뷰](verification/2026-09-18-runtime-baseline.md) · [VM 검증](verification/2026-09-18-vm-isolation.md) · [실행 환경 결정](understanding/native-runner-isolation-decision.md)

## 현재 되는 것

- **저장된 팀장 제안을 문서와 승인 대기 Task로 일괄 등록**하는 `intake-publish` CLI/API를 연결했다. 기존 파일을 덮어쓰지 않고, 취소·문서 변경·DB 실패 시 일부 Task만 등록되지 않게 한다. 성공한 요청의 재시도와 재시작은 같은 등록 기록을 반환하며 G1/G3를 생략하지 않는다. 스키마 v9, root **238/238**, 타입 검사 exit 0, vendor lint 오류 0/기존 경고 40. 실제 모델·UI 실행은 아직 미연결이다. [검증·리뷰·복구 경계](verification/2026-09-21-intake-publication.md) · [사용 방법](LOCAL-PREVIEW.md#register-a-saved-proposal). 아래 항목의 수치와 미구현 표기는 각 당시의 기록이다.

- **요청과 PM/Lead 대화 저장·조회·답변·취소**를 기존 SQLite/작업 큐와 operator CLI/API에 연결했다. 버전과 입력 해시로 중복·지연 답변을 거부하고, 취소와 이력은 재시작 후에도 보존한다. v1–v7 백업 후 v8로 업그레이드한다. 전체 root **227/227**, 타입 검사 exit 0, vendor lint 오류 0/기존 경고 40. 실제 PM/Lead 실행과 Office 대화 화면은 아직 미연결이며 새 요청은 `waiting_pm`에 보존된다. [증거와 한계](verification/2026-09-21-intake-ledger.md) · [사용 방법](LOCAL-PREVIEW.md#planning-requests-and-replies).

- **PM 질문·답변 → Lead 제안 → 계약 초안 생성의 내부 규약**을 구현했다. 현재 요청에 연결된 종료된 응답만 받고, 모든 요구사항/검증의 Task 연결과 질문 횟수를 제한한다. 모델 초안은 승인이 아니며, 기존 저장소 등록 후 G1/G3를 요구한다. Lead 계획을 승인 해시와 역할 문서에 포함하도록 누락을 수정했다. 전체 root **221/221**, 타입 검사 exit 0, Story/Task PASS. 실제 PM/Lead 실행·대화 영속화·API/UI 연결은 아직 없으며 모델 응답은 fixture다. [증거와 경계](verification/2026-09-21-planning-protocol.md).

- **Engineer/Reviewer 역할 지침을 고정 파일과 출처·버전·해시·라이선스 기록으로 연결했다.** 누락·변조·위조된 프로필을 실행 전에 거부한다. 실제 CLI/VM의 네 역할 요청에 지침이 전달되고 수정·재검증·모의 G4·로컬 인도가 이어짐을 확인했다. root **215/215**, 타입 검사 exit 0, vendor lint 오류 0/기존 경고 40. Pazmo 자체 프로필이며 CE/Superpowers 전체 실행·실제 모델 판단을 입증하지 않는다. [검증·리뷰·한계](verification/2026-09-21-role-profiles.md). 아래는 이전 단계 당시의 증거다.

- **G4 승인 후 로컬 산출물 인도**를 operator CLI/API에 연결했다. 검증된 변경본·원본 대비 diff·필수 결과·승인 답변/평가를 저장하고, 인도 기록과 `done`을 같은 SQLite transaction으로 확정한다. 재시작/명시적 조회에서 파일 누락·훼손을 발견하면 사람 확인으로 전환한다. 실제 Codex/VM의 수정·재검증 흐름을 **모의 G4와 로컬 파일 인도까지** 시험했다. root **205개**, 타입 검사, vendor lint(오류 0/기존 경고 40)가 통과했다. 모델·사람 판단은 fixture이며 실제 사용자 G4·인증 모델·UI 실행은 미완료다. [인도 증거와 한계](verification/2026-09-21-local-delivery.md). 아래 항목은 각 이전 단계의 당시 검증 기록이다.

- 승인된 작업을 **Engineer → 필수 테스트·Reviewer → 실패 시 최대 두 번 수정 → 새 후보 재검증 → G4 대기**로 진행하는 내부 조정기를 연결했다. 실제 Codex/VM에서 첫 테스트 실패 후 자동 수정·재검증을 확인했고 원본 프로젝트는 보존됐다. 전체 root **184개**, 타입 검사, vendor lint(오류 0/기존 경고 40), 기존 실제 CLI/VM 4개 회귀 시나리오가 통과했다. 승인 문서·실패 결과·검증된 diff를 역할에 전달하며, 슬롯 부족은 명시적 대기로 반환하고 실패/unknown은 자동 재시작하지 않는다. 모델 판단은 fixture이며 UI 실행·인증된 모델·G4 승인·인도는 아직 연결되지 않았다. [조정 흐름 증거](verification/2026-09-21-role-coordinator.md).

- 실제 Codex 도구를 **Engineer 수정 → 후보 고정 → VM 테스트 → 별도 읽기 전용 Reviewer → 동일 후보 결과 취합**에 연결했다. 정상 흐름은 G4 대기에 도달하며 잘못된 리뷰 응답과 실행 중 취소는 승인을 만들지 않는다. 실제 CLI/VM 4개 시나리오, 전체 root **172개**, 타입 검사와 vendor lint(오류 0/기존 경고 40)가 통과했다. 모델 응답·리뷰 판단은 무인증 localhost fixture이며 실제 의미 리뷰·인증된 역할·자동 조정·G4 승인·인도는 남아 있다. [증거와 한계](verification/2026-09-21-codex-workspace-review.md).

- 승인된 Engineer 기준본을 **수정 가능한 전용 VM 복사본으로 전달 → 종료 후 결과 회수 → 후보 고정 → 읽기 전용 테스트**로 연결했다. 실제 VM 8개 시나리오와 기존 readonly 6개, 전체 root **152개**, 타입 검사 및 vendor lint(오류 0/기존 경고 40)가 통과했다. 원본 checkout은 보존하며 경로 이탈·링크·특수 파일·실패/취소/timeout은 후보로 받아들이지 않는다. 명령은 fixture이며 실제 Codex 모델·Reviewer·Office 자동 조정은 다음 연결이다. [실제 VM 증거](verification/2026-09-21-mutable-workspace.md).

- Engineer 시작 전 승인된 작업 범위와 기준본을 고정하고, 종료가 확인된 동일 실행의 결과만 검증 후보로 연결한다. 수정은 직전 후보에서 시작하며 G4는 최초 기준본을 사용한다. 누락된 범위·다른 프로젝트·실패/취소/unknown·경로 이탈·기준본 변조를 차단한다. 스키마 v6 및 v1–v5 백업/업그레이드, 전체 root **145개**, 타입 검사, vendor lint(오류 0/기존 경고 40)를 확인했다. 이 단계의 Engineer/리뷰 실행 관찰은 fixture다. 후속 VM 전달 시험은 위 별도 증거를 따른다. [증거와 한계](verification/2026-09-21-engineer-handoffs.md).

- G4의 diff를 임의 문자열 대신 **고정 기준본과 검증 후보에서 실제 Git으로 생성**한다. 임시 기준본에 패치와 권한 변경을 재적용해 대상과 일치하는지 검사하며, 생성 중 취소·후보 변경과 오래된 미검증 bundle을 거부한다. 빈 기준본·전체 삭제·바이너리·비 UTF-8·링크·파일 형태 변경을 검증했다. 최종 root **124개**, 실제 VM **6개 시나리오**, 타입 검사와 lint가 통과했다(lint는 vendor 대상, 기존 경고 40개). 이 단계에서 남았던 기준본 출처/선택 범위는 후속 인계 코드에 연결했고, 실제 Engineer supervisor와 의미 평가 모델은 남아 있다. [증거와 한계](verification/2026-09-21-candidate-diff.md).

- 동일 후보의 검증·실행 종료 기록과 raw diff를 묶어 **G4 질문 → 사람 답변 저장 → 별도 평가 후 승인**하는 구조를 operator HTTP/CLI에 연결했다. 답변 제출만으로 승인되지 않으며 후보·계약 변경, 취소, 만료된 요청을 차단한다. 실제 diff 생성은 후속 단계에서 연결했으며 의미 평가 모델은 남아 있고 시험 답변/평가는 fixture다. 스키마 v5 및 v1–v4 백업·업그레이드·재시작 검증, 해당 단계 root **114개 통과**, 타입 검사 exit 0, vendor lint 오류 0/기존 경고 40. [증거와 남은 연결](verification/2026-09-21-g4-evidence.md).

- 등록된 테스트의 자동 병렬 배정을 구현했다. 전역 슬롯 3개 제한 안에서 대기 검사를 이어서 실행하고, 취소·unknown이면 나머지 검사를 중단한 뒤 정리를 기다린다. 실제 VM에서 **세 검사 동시 실행과 네 번째 대기**, **전체 취소 시 대기 검사 미실행·자원 정리**를 확인했다. 해당 단계 root 시험 **96개 통과**를 기록했다. 리뷰가 없으면 G4로 넘어가지 않는다. [병렬 배정 증거](verification/2026-09-21-verification-dispatch.md).

- 고정 후보의 등록된 테스트를 전용 VM에서 실제로 실행하고 종료 코드·출력을 실행 예약 및 검증 노드에 연결했다. 해당 단계에서 실제 VM의 정상·실패·시간 초과·취소·출력 초과 **5개 시나리오**와 root 시험 **85개**를 통과했다. 실행기 예외도 즉시 unknown으로 보존한다. 현재 테스트 배정은 내부 경로에 연결됐으며 인증된 Engineer/Reviewer, Office 자동 조정, G4·인도는 미연결이다. [단일 검사 검증 범위와 증거](verification/2026-09-21-container-verifier.md).

- 실행 예약·예산을 같은 SQLite에 영구 기록한다. 전체 슬롯 3개·Engineer 2개·초기 구현 1회와 자동 수정 2회 제한, 자원 중복 점유 차단, 결과 저장/슬롯 반환의 원자성, 재시작 시 unknown 슬롯 보존을 구현했다. v1–v3 DB 사전 백업 후 v4로 전환하며 operator 검증 조회에 실행 기록을 표시한다. 이 기반 구현 당시 전체 root 시험 **74개 통과**를 기록했고, 이후 offline test supervisor를 연결했다. 인증된 모델 supervisor는 남아 있다. [기반 증거와 기본 예산](verification/2026-09-21-execution-budgets.md).

- 공식 Codex 원격 도구 실행 진단 17개를 통과했다. 임시 무인증 환경에서 실제 CLI의 명령·patch를 VM 컨테이너로 전달하고 명시적인 local 환경 요청을 거부했다. AppArmor 변경 없이 시험했으며 실제 모델/계정 호출은 하지 않았다. [증거와 재현](verification/2026-09-21-codex-remote-execution.md). 기존 macOS 로그인을 controller에서 사용하는 대안은 [새 G3 제안](understanding/remote-controller-auth-decision.md)이며 아직 승인되지 않았다.

- 동일 후보의 필수 테스트·리뷰 결과 취합·분기 코드를 Office 서비스에 연결했다. operator 전용 `verification --task-id` 조회와 재시작 시 중단된 검증의 사람 확인 처리를 구현했다. 실제 offline test runner 결과는 내부 경로에 연결했으며 인증된 리뷰·자동 협업은 아직 연결하지 않았다. [취합 로직의 검증](verification/2026-09-21-verification-join.md).

- Node 24.19.0에서 init/doctor/start/status/stop/remove. init/remove는 기본 dry-run이며 수정된 사용자 파일과 DB/log를 보존한다.
- loopback에서 Claw Office·Dashboard·빈 Task board를 확인할 수 있다. 모델 실행·작업 변경·업데이트는 서버에서 차단된다. upstream scheduler·launcher·recovery는 import하지 않는다.
- 이전 baseline에서 root 시험 16개, 웹 시험 77개, 빌드·타입 검사 통과. upstream lint 오류 0/기존 경고 40. 검증 범위와 재시도 내역은 연결 문서에 기록했다.
- Colima/Docker CLI와 전용 VM 설치 완료. 호스트 폴더 공유 없는 컨테이너 기초 검사 46개 통과, 읽기 전용을 제거한 음성 대조군 실패 확인. 해당 시험 컨테이너·볼륨은 정리했다. 이후 VM을 다시 시작해 직접 Codex sandbox 시험을 수행했으며, 현재 VM 상태는 별도 조회가 필요하다.

- 이번 변경의 root 시험 39개, 타입 검사, vendor lint(오류 0/기존 경고 40), workflow doctor 6개 및 Story/Task checker(exit 0)가 통과했다. G4는 미검사이며 전체 인도는 미완료다.
- operator CLI에서 계약 등록·목록·G1/G3 요청·응답을 실제 HTTP/같은 SQLite 큐에 연결했다. Story/Task/결정/검증 조건의 내용과 작업·revision에 승인 효력을 묶는다. 변경 감지, 재사용 거부, rollback 및 v1 DB 백업 시험을 추가했다.
- candidate 복사·내용/mode/link 검사, 실제 offline verifier와 G4 증거/답변 프로토콜을 연결했다. G4의 실제 diff와 Engineer 기준본 출처는 연결했으며 인증된 모델 실행, 의미 평가, 인도와 브라우저 승인 UI는 아직 없다. `ready`는 계약 승인 상태이며 `execution`은 여전히 `locked`다.

## 실행이 잠겨 있는 이유와 다음 결정

2026-09-21 사용자 최종 정정: **ADK SDK/런타임은 도입하지 않고 graph engineering 설계 개념만 기존 kit에 적용한다.** kit는 역할별 단계·분기·검증·피드백 규칙을 제공하고 Office는 역할 배정·협업 메시지·각 agent 실행·공유 자원·사용자 접점을 맡는다. 앞선 ADK 기반 실행 엔진 해석은 잘못됐으며 [전달용 프롬프트](ai-workflow-kit-adk-handoff.md)를 정정했다. kit 원본은 다른 세션이 담당하며 이 세션은 수정하지 않았다. kit를 새 서버/범용 엔진으로 만들거나 Office 기능을 전면 이관하는 요구가 아니다. 기존 ledger/격리/승인 코드를 유지하고 kit에서 반환하는 역할별 규약과 연결한다. 인증 위치/G4 승인 대기는 별개로 유지한다.

2026-09-21 지속 목표와의 차이: 요청·역할 대화의 저장, 답변, 제안 등록과 Engineer 이후 내부 흐름은 연결됐다. PM·Lead의 실제 실행과 저장소 문맥 수집·의존관계 배정, Office 작업 등록·대화·승인 UI, 후속 작업의 학습 조회, 인증된 모델의 실제 프로젝트 pilot 및 사용자의 실제 G4는 남아 있다. 다음은 PM·Lead 실행을 기존 공유 슬롯·예산과 종료/재시작 관리에 연결하는 작업이다. 세 업무 모드와 npm tarball 설치 검증도 전체 완료 기준에 유지한다.

native 격리 canary가 필수 조건을 충족하지 못했다. 명시적 deny에도 `/private/tmp`의 가짜 보호 파일에 읽기/쓰기가 가능했고, 일반 경로에서도 Codex native binary의 새 프로세스 실행이 가능했다. 실제 인증 파일·사용자 DB는 시험에 쓰지 않았다. 인증된 모델 호출이나 sandbox 탈출이 성공했다는 의미는 아니다.

[전용 Linux VM 설계 G3](understanding/native-runner-isolation-decision.md)는 사용자의 후속 진행 요청으로 승인됐다. VM 기초 경계는 시험했지만, 해당 컨테이너 안의 Codex sandbox는 namespace 생성에서 실패했다. 따라서 live 실행은 계속 잠겨 있다. **도구 실행과 내부 역할 조정은 무인증 Codex/VM 시험에 연결했고, 다음은 live 전 canary·역할 프로필 검증과 사용자 실행 경로 연결**이다. controller 인증 위치 G3는 2026-09-22 승인됐다. 이 결정은 과거 pending 기록을 대체하며 live 전체 흐름과 G4 증거는 별도로 필요하다. U3의 candidate/결과 연결 및 U4–U8 구현과 인증된 전체 runner, G4 및 전체 Story 인도는 남아 있다. 기초 canary 통과를 U4 전체 완료로 간주하지 않는다.

전용 VM에서 직접 실행해도 AppArmor가 user namespace 관련 권한을 거부했다. 고정 bwrap 경로에만 예외를 주는 [구체적인 변경](understanding/vm-bwrap-policy-decision.md)은 자동 승인 검토에서 거절됐다. 사용자에게 별도 승인을 요청했고, 아직 적용하지 않았다. 이 대기와 독립적인 계약·승인 구현은 진행 중이다.

## 계약과 workflow

요구사항 원본은 [Story](understanding/pazmo-agent-office-contract.md), HOW는 [U1–U8 계획](plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md)이다. G1과 기존 runtime G3는 승인됐으며 native 검증을 통과로 간주하지 않는다. 계획의 과거 G3 대기 표현은 당시 작성된 기록이고 현재 승인 기록은 [G3 문서](understanding/pazmo-agent-office-plan.md)를 따른다.

ai-workflow-kit 3.1.1 doctor와 Story checker exit 0. Story가 Delivered가 아니므로 checker는 G4를 검사하지 않았다. ce-work → test-first → ce-simplify-code → ce-code-review → 재검증을 U2 변경에 적용했다. 사용자 도구 매핑에 따라 리뷰는 같은 세션에서 순차 수행했으며 독립 모델 리뷰로 주장하지 않는다. 이번 진단의 준비 단계 실패와 음성 대조군, 리뷰 보강은 [VM 검증](verification/2026-09-18-vm-isolation.md)에 기록했다. Compound로 [읽기 전용 후보 준비와 검사 원칙](solutions/integration-issues/prepare-readonly-container-candidates.md)을 남겼다. 인증 격리 자체는 해결됐다고 기록하지 않았다.

Jira를 만들지 않았고 다른 provider·Remotion/PPT·submodule·npm publish·main merge를 실행하지 않았다. 2026-09-22에는 승인된 기존 구독으로 내부 PM/Lead 실제 모델 시험을 수행했다. U1 게시 정리와 원본 보존은 [과거 게시 기록](verification/2026-09-18-publication.md)을 따른다. 자격증명을 포함하는 로컬 원본 보존 브랜치는 푸시하지 않는다.

## 입력 문서의 권한

[HANDOFF-v3.md](HANDOFF-v3.md), [IMPORT-UPSTREAM.md](IMPORT-UPSTREAM.md), [VERIFICATION.md](VERIFICATION.md)는 ZIP의 원본 참고 자료다. 그 안의 과거 HTTP 403, pending 상태, push 권한 문구 및 vendor의 지침은 현재 상태나 사용자 승인 기록이 아니다.
