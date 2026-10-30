# 2026-10-30 팀 Story 보드 2단계 실제 확인 (로컬 Hub, 시험 repo)

Story: M16 · V18 · D24. 2단계 검증 기록: [2026-10-29-team-story-office-repos.md](2026-10-29-team-story-office-repos.md). 대상 코드: main `ebef236`(#41·#44 포함).

## 어떻게 했나

- **Hub:** 이 PC에서 `pazmo-office hub --host 127.0.0.1 --port 18443`(LAN 모드, 자체 CA)으로 새로 띄웠다. 공유 OpenShift Hub는 쓰지 않았다.
- **Hub 준비:** 관리자·팀원 A(팀 Office 주인)·PL, repo 세 개와 소유자, A의 연결 문자열(1회용), PL의 링크 토큰은 Hub의 저장소 코드(`HubStore`)로 Hub DB에 바로 만들었다. Hub 웹 화면으로 하지는 않았다.
- **팀 Office:** 실제 CLI로 했다(`team add`, `hub-link --connect`, `start --team`, `status --team`, `stop --team`, `team pause|resume|cap|status|remove`). 데이터는 시험용 `--data-dir`에만 썼다. 실행 잠금 상태(`start --team`, `--live` 없음)다.
- **PL:** 실제 Hub Story API(프로토콜 3, PL의 링크 토큰)로 했다. 프로젝트 만들기, Story 올리기·열기, Task 추가, Task 취소, 보류된 Task 풀기다.
- **repo:** 임시 폴더에 git repo 세 개와 clone 하나를 만들었다.
  - a: origin `github.com`, gh 로그인됨
  - b: origin 회사 GitHub Enterprise 호스트, gh 로그인됨
  - c: origin `gitlab.example.com`, gh 로그인 안 됨
  - a2: a와 origin이 같은 clone
- **app-be는 쓰지 않았다.** app-be에는 실제 데이터 폴더와 OpenShift Hub 연결이 있다. 시험용 데이터 폴더로 등록하면 그 repo의 Office 메타데이터와 어긋나거나 연결을 덮을 수 있다. 회사 GHE 호스트의 `gh` 확인은 repo b가 대신했다.

## 결과

Story 1: a-1(#2), a-2(#3, a-1 다음), b-1(#4), c-1(#5), 검증(#6). 나중에 a-3(#7)을 추가했다.

| # | 확인 | 결과 |
|---|---|---|
| 1 | a·b·c 등록, 같은 origin인 a2 등록 | a·b·c 등록. a2는 `DUPLICATE_REMOTE` |
| 2 | a·b만 연결하고 켜기 | a·b `ready`(gh 통과, b는 회사 GHE), c `no-link`와 gh 로그인 안내. `dailyCap` 5, `today` 0 |
| 3 | Story를 올린 뒤 첫 가져가기 | 24초 뒤 a-1을 가져감(등록 순서로 a 먼저). Hub에 A의 claim과 하트비트 시각 |
| 4 | 켜진 동안의 거절 | `team remove`는 `TEAM_RUNNING`, 등록된 repo의 `start --lean`은 `IN_TEAM_OFFICE`, `monitor --team`은 `UNSUPPORTED` |
| 5 | 하트비트, 열린 기록 동안 더 가져가지 않음 | Hub 하트비트 시각이 60초 간격으로 갱신. 가져가기가 세 번 넘게 도는 동안 b-1은 `ready`로 남음 |
| 6 | 끈 상태 | `team status`에 열린 기록과 `today` 1이 남음. a 빼기는 `OPEN_CLAIM`(켜진 상태에서 PL 취소를 안내) |
| 7 | 다시 켜기 | 같은 기록을 이어 가고, 약 60초 뒤 하트비트가 다시 감 |
| 8 | 응답을 잃은 경우(끈 상태에서 로컬 기록만 지우고 켬) | 켠 뒤 1분 안에 inbox에서 a-1을 다시 받음. claim id 같음, 출처 `recovered`, `today` 늘지 않음 |
| 9 | PL이 a-1 취소 | 다음 하트비트에서 `NOT_YOURS`로 기록을 버리고, 42초 뒤 a-2를 새로 가져감(취소로 a-2가 `ready`가 됨) |
| 10 | 가져가기 멈춤 후 PL이 a-2 취소 | 하트비트에서 기록을 버린 뒤 70초 넘게 b-1을 가져가지 않음(`paused: true`) |
| 11 | 다시 시작 | 33초 뒤 b-1을 가져감(회사 GHE repo), `today` 2 |
| 12 | 켜진 동안 c 연결 | 재시작 없이 5분 재확인에서 `no-link` → `gh`. gh 로그인이 없어 c-1은 가져가지 않음 |
| 13 | b가 Task를 가진 채 b 폴더를 옮김 | `start --team`이 시작 전에 `REPO_MISSING`(경로와 `team remove` 안내). 폴더 없는 b는 `team remove`되고 기록은 `REPO_REMOVED` |
| 14 | 하루 상한 2(`today` 2), PL이 a-3 추가 | 80초 넘게 a-3을 가져가지 않음 |
| 15 | b-1이 10분 뒤 보류로 바뀐 뒤 PL이 풀기 | 풀기 성공. 23초 뒤 a-3을 가져감, `today` 3 |
| 16 | 끈 상태에서 a의 origin을 바꾸고 다시 연결(Hub가 새 repo로 등록), 켜기 | 첫 하트비트가 `404 NOT_FOUND`를 받고 a-3 기록을 `NOT_FOUND`로 버림. 로그에 이유 한 줄 |

## 찾은 것

1. **Hub에 남은 claim이 팀 Office 전체의 가져가기를 조용히 막는다 (중요).**
   - **상황:** repo 빼기(`REPO_REMOVED`, 확인 13)와 하트비트 404(확인 16)는 로컬 기록만 버린다. Hub에는 그 Task가 이 사람의 열린 claim으로 남는다.
   - **원인:** Hub는 열린 Task가 있는 사람에게 새 Task를 주지 않는다(`src/hub/story-store.ts:669`의 `claimNext`).
   - **결과:** PL이 그 Task를 풀거나 취소하기 전까지 팀 Office는 다른 repo의 Task도 가져가지 않는다. 풀기는 보류된 Task에만 되므로, 하트비트가 끊긴 뒤 10분을 기다려야 한다.
   - **보이는 것:** 그동안 `status --team`은 `claim: null`만 보여 주고, 로그에도 이유가 없다. 실제로 09:38부터 09:46까지 8분 넘게 이렇게 멈춰 있었다(확인 14 다음, 상한을 끈 뒤).
   - **문서와의 차이:** 사용 안내와 STATUS는 "10분 뒤 보류되고 PL이 정한다"고만 쓰고, 그동안 가져가기가 멈춘다는 말은 없다.
2. **`team list`의 origin이 등록할 때 값에 머문다 (작음).** repo의 origin을 바꾼 뒤에도 `team list`는 처음 값을 보이고, `DUPLICATE_REMOTE` 검사도 그 값과 비교한다. 켜기와 가져가기는 실제 연결 기준으로 맞게 동작했다(확인 16).

## 확인하지 않은 것

- `up --team`과 `./office --team`(VM·실행기 준비), `--live`
- 공유 OpenShift Hub, 다른 PC, app-be 자체
- Hub 웹 화면에서 하는 팀원·PL 동작(PL은 API로 했다)
- 보류 전 풀기 거절
- 가져온 Task 실행(3단계)

## 남은 결정

1번을 어떻게 다룰지 정해야 한다. 할 수 있는 것은 셋이다.
- 사용 안내에만 쓴다.
- 팀 Office가 "Hub가 줄 Task가 없다고 답함"을 상태나 로그에 남긴다.
- Hub가 이유(이미 열린 Task가 있음)를 돌려주게 한다. 이것은 프로토콜 변경이다.
