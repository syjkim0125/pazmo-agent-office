# 2026-10-30 claude 멈춤 유예 12초, hook이 있는 claude는 막기

Story: M3 · M4 · D28 · D29. 근거: [실제 CLI 확인](2026-10-29-real-cli-runner-checks.md)의 4번과 제안 P1·P2. 설명 페이지: "OAuth 갱신 잠금 사고" 4부. kit graph: `.ai-workflow/runs/U24-claude-stop-grace-hooks.json`.

## 왜 바꿨나

- **P2 → D28.** 실제 claude 2.1.280은 로그인 갱신 중에 SIGTERM을 받으면 갱신을 최대 2초 기다리고 나간다. 나갈 때 갱신 잠금(`~/.claude/.oauth_refresh.lock`)을 푼다. 한가할 때는 2.5초 안에 끝났다. 바쁠 때(load average 58–172)는 25회 중 4회가 6초를 넘었고, 가장 느린 것은 9.1초였다. Office와 같이 6초 뒤 SIGKILL하면 load average 90–102에서 3회 중 2회 잠금이 남았다. 잠금이 남으면 뒤의 claude가 로그인 갱신에 실패한다(2026-10-23 사고).
- **P1 → D29.** 실제 claude는 SessionEnd hook을 stream-json 출력에 내지 않는다. SIGTERM 때도, 정상 종료 때도 그렇다. 그래서 실행 중 hook 감시(`isHookEvent` → `CLAUDE_HOOK_UNEXPECTED`)는 SessionEnd hook을 막을 수 없다. Office의 실행 설정(`--setting-sources ""`)에서 남는 hook은 관리형 설정(회사 IT)의 것이다.
- 사용자 선택(2026-10-30): P2는 (a) 유예 늘리기(12초·18초), P1은 (a) 실행 전 검사.

## 바뀐 동작

- 취소·시간 초과로 claude 역할을 멈출 때 SIGTERM 뒤 SIGKILL까지 **12초**를 기다린다(이전 6초). 바깥 감독 `superviseRemote`는 멈춘 뒤 **18초**(12초 + relay 정리 최대 5초)를 기다린 다음에야 "정리 확인 못 함"으로 기록한다(이전 12초).
  - 보안 검사 멈춤(예상 밖 hook, 잘못된 init, init 없음, 출력 한도)과 이미 끝난 claude의 멈춤은 그대로 바로 SIGKILL이다.
  - 정상 claude의 취소는 지금처럼 0.3–2.5초에 끝난다. 늦어지는 것은 SIGTERM을 무시하는 CLI가 죽기까지(최악 12초)와, 정리가 정말 멈췄을 때 격리까지(최악 18초)다.
  - 경계: 예약 마감 직전의 취소에서 정리가 마감을 넘길 수 있는 구간은 최대 12초에서 최대 18초로 넓어진다. 마감을 넘긴 실행은 기록 전에 `DEADLINE_EXCEEDED`로 격리된다(#40과 같은 성질).
- Office가 claude의 모델 목록을 물을 때(`claudeModels`), `initialize`와 함께 CLI의 `get_hooks_listing` 제어 요청도 보낸다. 결과는 `{ models, hooks }`다. `hooks`는 `[{ event, source }]`이고, 다음 경우에는 `null`(모름)이다. 명령 내용은 보관하지 않는다.
  - CLI가 오류로 답한 경우
  - 항목의 모양이 다른 경우
  - 모델은 답했지만 목록을 주지 않고 끝나거나 15초 안에 주지 않은 경우
- `loadRunnerCatalog`(lean Office와 Claw Office가 같이 씀)는 hook이 하나라도 있거나 `null`이면 claude를 `blocked`로 둔다. 같은 종류의 hook은 한 번만 적는다. codex의 `~/.codex/AGENTS.md` 막힘과 같은 경로다. 고를 수 없고, 역할 실행은 프로세스를 띄우기 전에 `RUNNER_NOT_READY`로 거부된다.
- 막힌 실행기는 자격 검사(`qualify`)도 받지 않는다. 앞서 통과한 기록이 있어도 `RUNNER_NOT_READY`로 거부한다. Claw Office가 켜질 때와 agent를 저장할 때 미리 하는 자격 검사(`prequalify`)도 막힌 실행기를 건너뛴다. 자격 검사의 fixture도 사용자의 claude를 이 Mac에서 띄우기 때문이다(리뷰 지적).
- 화면 안내는 다음과 같다.
  - hook 있음: "claude에 SessionEnd hook (policySettings)이 걸려 있습니다. hook은 Office 역할 실행 중 Office가 볼 수 없게 이 Mac에서 돌 수 있어 claude를 쓰지 않습니다. 그 hook을 빼거나(회사 IT의 관리형 설정이면 IT에 문의) codex를 고르세요."
  - 목록 없음: "claude가 hook 목록을 알려 주지 않아 Office 역할 실행에 hook이 끼는지 확인할 수 없습니다. Claude Code를 업데이트하거나 codex를 고르세요."
- **한계:** 막힌 claude도 모델 목록 조회 때는 다시 묻기 위해 CLI를 띄운다. 그래서 조회할 때마다(시작, agent 저장, 작업 만들기, 계획 재시도, 실행기 창 등) CLI의 SessionStart·SessionEnd hook이 한 번 돈다. 빈 임시 폴더에서 프롬프트·도구 없이 돈다. 이 변경 전부터 같았고(모델 목록 조회), CLI에게 묻는 방식에서는 피할 수 없다. 재리뷰어가 실제 CLI(격리 config, `--settings` hook)로 두 hook이 모두 도는 것을 확인했다.
- 모델 목록 조회 자체가 실패하면(15초 시간 초과, 시작 실패 등) 판단하지 않는다. claude를 막지 않고 실행 중 감시에 맡긴다. 이 경우 모델 목록이 비는 것은 전과 같다.
- 오류 코드는 바뀌지 않는다.

## 시험

| 시험 | 고치기 전 | 고친 뒤 |
|---|---|---|
| `tests/claude-controller.test.mjs` "a claude that takes 9 s to release the lock after SIGTERM still releases it" (기존 2.5초 시험을 실측 9초로 바꿈) | 실패: 잠금이 남았다(7.2초에 SIGKILL) | 통과 |
| `tests/remote-job.test.mjs` "a controller that reaps its process within the stop budget is confirmed closed" (정리 7초 → 13초, 리뷰 뒤 17초) | 실패: `closed: false`(12.0초, 13초 정리) | 통과 |
| `tests/runner-models.test.mjs` "claude discovery also reports the hooks the CLI would run, by event and source" | 실패: hook 목록 요청이 없어 조회가 15초 시간 초과 | 통과 |
| `tests/runner-models.test.mjs` "a claude that cannot list its hooks reports them as unknown" | 실패: 같음 | 통과 |
| `tests/runner-settings.test.mjs` "a claude whose CLI would run a hook is blocked with the hook and where it comes from" | 실패: `blocked` 없음 | 통과 |
| `tests/runner-settings.test.mjs` "a claude that cannot list its hooks is blocked too" | 실패: `blocked` 없음 | 통과 |
| `tests/runner-settings.test.mjs` "a claude with no hooks stays usable" | 실패: 조회 시간 초과로 모델 목록이 빔 | 통과 |

- 기존 runner-models 시험 4개는 가짜 claude가 hook 목록 요청에도 답하도록 고쳤다. 반환값이 `{ models, hooks }`가 되어 단언도 `.models`로 바꿨다. 고치기 전에는 4개 모두 시간 초과로 실패했다.
- 기존 "a claude that ignores SIGTERM is still killed soon after a cancel"의 시간 한도를 8초에서 14초로 바꿨다(12초 유예 뒤 SIGKILL). `remote-job`의 "unresponsive controller cleanup" 시험은 18초 유예를 기다리므로 그만큼 길어졌다.
- `runner-settings` 시험은 PATH에 가짜 native claude·codex를 두고 실제 `discoverRunners`·`claudeModels`를 그대로 거친다.

리뷰 반영(2회차 구현)에서 더한 시험:

| 시험 | 고치기 전 | 고친 뒤 |
|---|---|---|
| `tests/runner-qualification.test.mjs` "a blocked runner is never qualified, even with an earlier pass on record" | 실패: 막힌 실행기도 자격 검사를 받음 | 통과 |
| `tests/runner-models.test.mjs` "a claude that answers the models and then exits without a hook listing reports them as unknown" | 실패: 조회 전체가 실패(막지 않음) | 통과 |
| `tests/runner-models.test.mjs` "a claude that answers the models and never lists its hooks reports them as unknown" | 실패: 같음(15초 시간 초과) | 통과 |
| `tests/runner-settings.test.mjs` "a claude whose CLI would run a hook is blocked…" (같은 hook 두 개) | 실패: 같은 hook이 두 번 적힘 | 통과 |
| `tests/runner-models.test.mjs` "the hook listing may arrive before the models" | 처음부터 통과(빠진 시험을 메움) | 통과 |
| `tests/runner-models.test.mjs` "a hook listing with an entry of the wrong shape counts as unknown" | 처음부터 통과(빠진 시험을 메움) | 통과 |
| `tests/runner-settings.test.mjs` "a claude whose model discovery fails is not judged and stays usable" | 처음부터 통과(D29의 "판단하지 않음"을 고정) | 통과 |

- `remote-job`의 "within the stop budget" 시험은 정리를 13초가 아니라 17초에 하도록 바꿨다. 18초 유예 바로 안쪽이라, 유예를 14초로 줄이면 실패한다(리뷰 지적).

## 실제 확인

- 이 Mac의 claude 2.1.280로 `loadRunnerCatalog()`를 돌렸다(2026-10-30). hook 목록은 `[]`이었고, claude는 막히지 않았다(`hint: "준비됨"`). 모델 5개를 받았다. `claudeModels`는 1.2초, 전체 발견은 1.8초 걸렸다. 앞뒤로 `~/.claude/.oauth_refresh.lock`은 없었다.
- 이 Mac의 claude는 관리형 출처 `policySettings`를 하나 보고한다(`get_settings`). 내용은 `env`뿐이고 hook은 없다. 값은 읽지 않았다.
- hook이 있는 경우는 실제 CLI로 `--settings`의 SessionEnd hook을 걸고 `get_hooks_listing`을 보냈다. 답은 `{ event: "SessionEnd", source: "flagSettings" }`였다. Office의 조회는 `--settings`를 쓰지 않으므로, 이 응답을 Office 코드에 넣는 부분은 가짜 CLI 시험으로만 확인했다. 관리형 설정 hook은 시스템 폴더에 써야 해서 시험하지 않았다.
- 12초 유예로 갱신 잠금이 남지 않는지 실제 부하에서 다시 재지는 않았다. 근거는 [실제 CLI 확인](2026-10-29-real-cli-runner-checks.md)의 측정(최대 9.1초)이다.

## 자동 검증

| 검사 | 결과 |
|---|---|
| root `npm test` (`codex/real-cli-check` `5bbcb18` 위에 이 변경, 2회 리뷰 반영 뒤, 2026-10-30 09:56–09:57, load average 4–7) | 1104/1104, exit 0 |
| 같은 변경, 1회 리뷰 반영 직후(09:49–09:50) | 1104/1104, exit 0 |
| 영향 파일 5개(`runner-qualification`·`runner-models`·`runner-settings`·`claude-controller`·`remote-job`) | 66/66 |
| `npm run typecheck` | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | exit 0 |

kit 그래프: `.ai-workflow/runs/U24-claude-stop-grace-hooks-replan.json`.

- 처음 연 run `U24-claude-stop-grace-hooks.json`에는 구현 1·2회차와 1차 리뷰가 남아 있다.
- 2차 리뷰 반영 때 D29에 한계 문장을 더해 Story 지문이 바뀌었다. 그래서 그래프 규칙대로 새 run을 열고, 같은 증거로 구현·리뷰·검증을 다시 기록했다.

## 리뷰 (독립, 보고만)

1회차 판정은 Changes needed였고 Critical은 없었다.

- 리뷰어가 돌린 것: 4개 시험 파일 53/53, 타입 검사 exit 0.
- 리뷰어의 RED 확인: HEAD `5bbcb18`의 `src`에 새 시험을 붙이자 11개가 실패했다.
- 리뷰어의 실제 claude 2.1.280 확인(격리 config, 자격 증명 없음):
  - 두 응답은 보낸 순서와 관계없이 온다.
  - 모르는 요청에는 `subtype: "error"`로 답한다.
  - `--settings` hook은 `{event, source: "flagSettings", …}`로 나온다.

Important 2건과 Minor:

- **Important 1(고침):** Claw의 `prequalify`와 `qualify`가 `blocked`를 보지 않았다. 그래서 막힌 claude도 자격 검사 fixture로 이 Mac에서 띄워져 SessionEnd hook이 돌 수 있었다.
- **Important 2(고침):** 모델은 답하고 hook 목록은 주지 않는 CLI는 조회 전체가 실패로 처리되어 막히지 않았다.
- **Minor(고침):**
  - 오래된 문서: solutions 문서, STATUS, `claude-profile.ts` 주석
  - 빠진 시험: 목록이 먼저 오는 순서, 모양이 잘못된 항목, 조회 실패 시 막지 않음
  - `remote-job` 시험의 정리 시각
  - 같은 hook의 중복 표시
- **Minor(후속으로 둠):**
  - 모델 목록 조회 자체의 멈춤(stdin 닫기 → 3초 → SIGTERM → 2초 → SIGKILL)도 바쁠 때 갱신 잠금을 남길 수 있다. #34부터 있던 것이고, D28은 역할 실행만 다룬다.
  - `./office` 시작 1단계(`discoverRunners`)는 hook을 묻지 않는다. 그래서 claude만 쓰는 사용자에게 hook이 있으면 VM 준비 뒤 `LOGIN_REQUIRED`로 멈춘다. 오류 문구에 claude의 안내(hook)가 함께 나온다.
  - 설계 메모: 일시적인 조회 실패는 막혔던 claude를 다시 고를 수 있게 만든다(D29대로 "판단하지 않음"). 사용자 확인이 필요하다.

2회차(같은 리뷰어, 반영분 확인) 판정은 "Changes needed, docs only"였다. 코드 수정은 그대로 승인했다.

- 리뷰어가 돌린 것: 5개 시험 파일 66/66, 타입 검사 exit 0.
- 두 응답의 순서, 두 번 resolve/reject되는 경우, close와 data의 순서에는 문제가 없다고 확인했다.
- **Important(문서, 고침):** 모델 목록 조회 자체가 막힌 claude를 띄워 그 SessionStart·SessionEnd hook을 돌린다. 실제 CLI로 확인했다. 그런데 `qualify` 주석("never started")과 문서가 이를 말하지 않았다. 주석을 좁히고, D29와 이 기록에 한계로 적었다.
- **Minor(고침):**
  - 시험 표의 remote-job 숫자
  - solutions 문서의 추론 표현과 오래된 줄 번호
  - STATUS의 후속 항목
  - 조회 실패 시험에 가짜 codex 두기
- 후속 2건(모델 목록 조회의 2초 SIGKILL, 시작 1단계 hook 확인)은 미뤄도 된다고 했다.

## 아직 하지 않은 것

- 모델 목록 조회가 막힌 claude를 띄워 그 hook을 한 번씩 돌리는 것(위 "한계"). 막으려면 CLI를 띄우지 않고 관리형 설정을 직접 읽어야 하는데, MDM·서버 설정까지 같은 방식으로 볼 수 있는지는 확인하지 않았다.
- `./office` 시작 1단계(`discoverRunners`)는 hook을 묻지 않는다(후속). 막힘은 Office를 켜는 단계(`live.ts`)와 역할 실행 전에 지켜진다.
- 모델 목록 조회 자체의 멈춤(stdin 닫기 → 3초 → SIGTERM → 2초 → SIGKILL)은 바쁠 때 갱신 잠금을 남길 수 있다(후속, D28은 역할 실행만). → 2026-10-30 D31로 12초, lean 시작 대기 30초. [변경 기록](2026-10-30-discovery-stop-grace.md)

- 관리형 설정(회사 IT)의 hook을 실제로 건 Mac에서의 막힘 확인.
- 실제 부하에서 12초 유예로 잠금이 남지 않는지 다시 재기. 9.1초보다 더 느린 경우는 보지 못했다.
- 원격 관리 설정(조직 서버가 내려주는 설정)이 모델 목록 조회 시점에 이미 반영되는지. 조회는 로그인으로 원격 설정을 받기 전에 답할 수 있다.
- **G4:** 사용자 답변으로만 기록한다.
