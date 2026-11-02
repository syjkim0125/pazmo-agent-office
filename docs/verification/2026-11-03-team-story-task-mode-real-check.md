# 2026-11-02–03 팀 Story 보드 3단계 실제 확인 1차 (로컬 Hub, GitHub 시험 repo, VM)

Story: M16 · V18 · D24 · D34. 3단계 검증 기록: [2026-11-02-team-story-task-mode.md](2026-11-02-team-story-task-mode.md)의 "실제 확인 계획". 대상 코드: PR syjkim0125/pazmo-agent-office#59의 `9c6b6ad`(같은 트리의 로컬 브랜치에서 실행).

1차는 계획의 정상 흐름(2·3·4·8·9)이다. 실패 흐름(5·6·7·10)은 2차로 남겼다.

## 어떻게 했나

- **Hub:** 이 PC에서 `pazmo-office hub --host 127.0.0.1 --port 18444`(LAN 모드, 자체 CA)로 새로 띄웠다. 공유 Hub는 쓰지 않았다.
- **Hub 준비:** 2단계 실제 확인과 같다. 관리자·팀원 A(팀 Office 주인)·PL, repo 두 개와 소유자(A와 PL), A의 연결 코드(1회용), PL의 링크 토큰을 Hub의 저장소 코드(`HubStore`)로 Hub DB에 바로 만들었다.
- **PL:** 실제 Hub Story API(프로토콜 3, PL의 링크 토큰)로 했다. 프로젝트 만들기, Story 올리기·열기, Task 추가, Task 취소다. Story #1: Task #2 greet(be), #3 farewell(be, #2 다음), #4 title(fe), #5 Story 검증. 검증 명령은 모두 `npm test`(120000 ms)다.
- **repo:** GitHub에 private repo 두 개(`syjkim0125/pazmo-story-test-be`, `-fe`)를 새로 만들었다. 의존성 없는 Node 프로젝트(`npm test` = `node --test`)이고, `main`과 손으로 만든 Story base `feature/story-1/base`가 있다. 머지 커밋은 GitHub 기본값대로 허용돼 있다. origin은 https다.
- **팀 Office:** 실제 CLI로 했다(`team add`, `hub-link --connect`, `up --team --no-open`, `status --team`, `stop --team`, `start --team`). 데이터는 시험용 `--data-dir`에만 썼다. 검증된 실행 파일(`qualified-runtime`)은 기본 데이터 폴더에서 복사했다. VM은 기본 전용 VM(colima `pazmo-office`)이다.
- **실행기:** claude 2.1.280(codex는 `~/.codex/AGENTS.md` 때문에 막힘). 첫날은 이 PC의 claude 로그인 계정이 사용 한도에 걸려 있었다. 다음 날 같은 사람의 다른 조직 좌석으로 로그인을 바꿔 이어서 했다.

## 결과

| # | 확인 | 결과 |
|---|---|---|
| 1 | `up --team`으로 켜기(VM 시작 포함) | 24초에 `running`, `execution: ready`, 두 repo `ready`, `gh` 통과 |
| 2 | `gh` 로그인 찾기(계획 4) | `HOME`·`PATH`·`LANG`·`GH_PROMPT_DISABLED`만으로 github.com 로그인을 찾음(`XDG_CONFIG_HOME`·`GH_CONFIG_DIR` 없음) |
| 3 | 체크아웃 | repo마다 `<repo 데이터 폴더>/story-checkout`이 detached worktree로 생김(`git worktree list`에 보임) |
| 4 | 사용자 폴더 | 켜기 전, Task마다, 끝난 뒤 두 repo 폴더의 HEAD·브랜치(`main`)·`git status --porcelain`(빈 값) 그대로 |
| 5 | 첫 가져가기 | 켠 직후 Task #2를 가져가 `building` |
| 6 | 한도에 걸린 claude | Engineer가 바로 exit 1. 시도 1·2가 몇 초 만에 `ENGINEER_FAILED`로 실패(아래 찾은 것 1·2) |
| 7 | 엔진이 쉬는 동안 `stop --team` | 바로 멈춤. 기록은 `claimed`, `attempts` 2로 남음 |
| 8 | 하트비트가 끊긴 동안 | Hub에서 Task #2가 `held` |
| 9 | 다음 날 다시 켜기 | 12초에 켜짐. 기록의 단계부터 시도 3으로 이어 감. 08:35:17에 하트비트가 다시 갔고, `held`였던 그 Task의 머지 잠금과 머지 보고를 Hub가 받았다 |
| 10 | Task #2 끝까지(계획 3) | building → push(`7905ca1`) → PR be#1(`feature/story-1/task-2` → `feature/story-1/base`, 08:35:10) → 머지 커밋 `9514aee`(08:35:24) → Hub `merged`(PR 주소·머지 커밋·3줄 요약·`ASSUMED:` 2줄). 다시 켠 뒤 약 70초 |
| 11 | 의존 Task | Hub가 #3을 `ready`로 바꿨고 팀 Office가 바로 가져감. PR be#2 → `34aa2e9`(08:36:54), 그다음 #4 PR fe#1 → `bed598e`(08:38:33). Task마다 약 1.5분 |
| 12 | 원격 ref(계획 3) | 새로 생긴 ref는 `feature/story-1/task-2`·`-3`(be), `feature/story-1/task-4`(fe)뿐. Story base에는 PR마다 머지 커밋 하나("Merge pull request #N …") |
| 13 | 커밋 작성자 | 그 사람의 git 설정 그대로(작성자 이름·주소) |
| 14 | `gh pr create -R`·머지 커밋 모양(계획 4) | Office의 작업 폴더에서 `-R <host>/<owner>/<repo>`로 PR이 열림. `mergeCommit`을 `{oid}`로 읽어 Hub에 40자 sha로 보고 |
| 15 | Story 검증 Task #5 | 팀 Office는 가져가지 않음(PL 전용) |
| 16 | 할 일 없는 live Office의 실행기 확인(계획 9) | 11분 표본(1초 간격)에 claude·codex 실행이 08:44:47과 08:50:18 두 번. 약 5.5분 간격(300000 ms + 가져가기 30초 주기). 1초 안에 끝나는 짧은 실행은 표본이 놓쳤을 수 있다 |
| 17 | 잠긴 시작(계획 8) | `start --team`(`--live` 없음) 뒤 PL이 추가한 ready Task #6을 75초 동안 가져가지 않음. Office 아래 git·`gh` 프로세스 0개, 체크아웃 reflog 그대로, `execution: locked` |
| 18 | 정리 | PL이 #6을 취소. Hub·팀 Office를 멈추고 VM을 시작 전처럼 껐다. GitHub 시험 repo와 시험 데이터는 남겼다 |

## 찾은 것

1. **사용 한도에 걸린 실행기도 가져가기를 막지 못하고, 시도를 몇 초 만에 다 쓴다.** 실행기 준비 확인(로그인·자격 검사)은 통과한다. 그래서 Task를 가져가고, Engineer가 시작하자마자 끝나 시도 하나로 센다. 1분 안에 시도 두 개를 썼고, 켜 두었으면 세 번째로 Task가 실패 보고됐을 것이다.
2. **그 실패 이유가 사람에게 보이지 않는다.** Office 로그와 기록(`last_failure_json`)에는 `구현이 멈췄습니다: ENGINEER_FAILED`만 남는다. claude의 실제 메시지("org's monthly spend limit … weekly limit resets …")는 Story 엔진 DB의 `pazmo_handoffs.receipt_json`에만 있다.
3. **새 파일만 바뀐 Task의 3줄 요약이 "변경 파일: 변경 없음"이다.** Task #2(새 파일 2개)와 #4(새 파일 2개)가 그랬고, 기존 파일을 고친 #3은 맞게 나왔다. 엔진의 diff 증거는 `git diff --no-index --no-prefix -- a b`라서 새 파일은 `diff --git b/<경로> b/<경로>`, 지운 파일은 `diff --git a/<경로> a/<경로>`로 시작한다. 요약을 만드는 `changeSummary`(`src/runtime/decision-summary.ts`)는 `^diff --git a\/.+ b\/(.+)$`만 센다. 3단계 전부터 main에 있던 공용 코드라서 단일 Office의 G4 요약도 같다.
4. (3단계 밖, 기존 동작) `hub-link --connect`에 `--hub … --code … --fingerprint …` 꼴의 문자열을 값으로 주면 CLI가 `Missing value: --connect`로 거부한다(값이 `--`로 시작해서). URL 꼴(`https://<hub>/connect#c=…&fp=…`)은 된다.
5. (관찰) Task #2의 `ASSUMED:` 줄 하나는 "`npm test`를 돌리려고 자기 셸에서 PATH를 바꿨다"고 적었다. VM 안 Engineer 셸의 PATH에 node 이미지의 `/usr/local/bin`이 없는 것으로 보인다. 검증 명령(`npm test`)은 검증기에서 정상으로 돌았다.

## 확인하지 않은 것

- 계획의 2차 항목 전부: 충돌·재검증 실패(5), 단계 사이 끄고 켜기(6), ssh push·커밋 서명(7), 최종 리뷰 수정의 실제 확인(10: "Commit suggestion", 닫은 PR, 재검증 중 PL 취소, 머지 커밋을 막은 repo).
- 잠긴 시작에서 열린 기록의 하트비트, `verified`·`merging` 기록에 하트비트를 보내지 않는 것(열린 기록 없이 확인했다. 자동 시험이 본다).
- 같은 head 이름의 포크 PR, 회사 GitHub Enterprise, ssh origin, 다른 사람 PC.
