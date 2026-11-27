# Story: 처음 들어온 팀원은 Mac 설치가 확인될 때까지 설치 화면만 본다

## Why
- Today: 초대받은 팀원이 비밀번호를 정하고 들어오면 바로 Story 보드가 열립니다. 설치 한 줄은 머리글의 "내 Mac"이나 안내 문구로만 닿습니다(`src/hub/server.ts:190`, `src/hub/pages.ts:398`). 그래서 Mac이 연결되지 않았거나 실행기가 막힌 채로 기획을 만들게 되고, 기획은 PL의 Mac을 기다리거나 바로 멈춥니다. 2026-11-26에 실제 팀원 두 명이 이렇게 막혔습니다.
- Outcome: 설치가 확인되지 않은 팀원은 허브에서 설치 화면만 보고, 다른 메뉴로 갈 수 없습니다. Mac이 연결되고 상태 확인을 통과한 뒤에야 보드로 들어갑니다.

## What the person will see
- E1. 새로 초대받은 팀원 · 초대 링크에서 비밀번호를 정하고 들어옴 → `/mac` "이 Mac 연결" 화면이 열린다. 머리글에 보드·Task·팀·레포 메뉴가 없고, "설치가 확인되면 허브를 쓸 수 있습니다" 한 줄이 보인다.
- E2. 설치가 확인되지 않은 팀원 · 주소창에 `/`, `/board`, `/tasks`, `/repos`, `/stories/<id>`, `/plans/<id>`를 직접 입력 → `/mac`으로 돌아온다.
- E3. 설치가 확인되지 않은 팀원 · 설치 한 줄을 실행하고 "이 Mac 허용"을 누름 → `/mac`의 "설치 확인" 칸이 몇 초 안에 단계별로 바뀐다: "Mac 연결됨", "Office 켜짐", "실행기 준비됨", "담당 레포 연결됨(app-be)". 모두 통과하면 "설치 확인 완료" 와 [허브로 가기] 버튼이 보이고, 누르면 Story 보드가 열린다.
- E4. (edge) Mac은 연결됐지만 실행기가 준비되지 않음(예: claude 로그인 안 됨) → "실행기 준비됨" 칸이 "아직: claude 로그인이 필요합니다"처럼 무엇이 안 됐는지 보이고, 다른 메뉴는 계속 막혀 있다.
- E5. (edge) 담당 레포가 하나도 없는 팀원 → "담당 레포 연결됨" 칸이 "담당 레포 없음"으로 통과하고, 나머지 세 칸이 통과하면 허브로 들어간다.
- E6. (must not happen) 설치가 확인되지 않은 팀원이 화면을 거치지 않고 POST로 허브 일을 하는 것(새 프로젝트·새 Story·기획 답·승인 등). 이 요청은 거절되고 `/mac`으로 돌아온다. 로그아웃과 "내 로그인"(비밀번호·브라우저 관리)은 된다.
- E7. (S1) 회사 플러그인이 허용되지 않은 Mac · 설치 확인 → "실행기 준비됨" 칸이 "아직: 회사 플러그인 team-plugin이 허용되지 않았습니다"와 허용 명령을 보이고 통과하지 않는다. 허용 명령을 실행하면 몇 분 안에 통과한다.
- E8. (S2) 관리자 · 팀 화면에서 팀원 줄의 [설치 확인 없이 허용] → 그 팀원은 Mac 없이 보드와 모든 화면을 쓴다. 팀 화면에 "설치 확인 면제"가 보이고 [면제 해제]로 되돌린다.
- E9. (S2, H1) 설치가 확인되지 않은 관리자 · `/mac`에서 관리자에게만 보이는 [설치 확인 없이 허용] → 관리자 자신이 면제되어 보드로 들어간다. 관리자가 아닌 팀원의 `/mac`에는 이 버튼이 없다.
- E10. (S3a) 이 변경 전에 들어와 있던 팀원 · 다음에 허브를 엶 → 그 팀원의 Mac이 지금 네 칸을 모두 통과하면 바로 보드가 열리고(확인 기록이 남음), 아니면 `/mac`만 보인다.
- E11. (S4a) 관리자 · 팀 화면에서 이름·메일과 함께 담당 레포(예: app-be)를 체크해 초대 → 초대받은 사람이 설치 한 줄을 마치면 그 레포가 clone·연결되고, "담당 레포 연결됨(app-be)" 칸이 통과한다. 레포 화면의 담당자 목록에도 그 사람이 보인다.
- E12. (H2) 확인된 팀원 · Mac이 꺼지거나 잠듦 → 허브는 그대로 쓴다. "내 Mac"에서 연결을 해제하거나 새 Mac을 연결함 → 다시 `/mac`만 보이고 새 Mac으로 네 칸을 통과해야 한다.
- QA reaches these states by: 확인용 허브 사본(`docs/qa.md`)에서 관리자가 시험 팀원을 초대하고, 시험 팀원으로 로그인합니다. "Mac 연결·Office 켜짐·실행기 준비" 상태는 사본 허브에 시험용 Mac을 짝지은 뒤, 그 Mac 토큰으로 상태 보고(heartbeat)를 보내 만듭니다. 실제 사용자는 볼 수 없는 시험 데이터입니다.

## Scope
- Smallest reading: 설치가 확인되지 않은 팀원은 `/mac`과 로그인 관련 화면만 쓸 수 있고, Mac 연결·Office 켜짐·실행기 준비·담당 레포 연결이 모두 통과한 첫 순간 이후로는 보통 화면을 씁니다.
- A fuller reading adds:
  - [x] S1. 회사 플러그인까지 확인: 지금 Office의 상태 보고는 실행기 로그인만 보고 플러그인 거절은 실제 실행 때에야 드러납니다(`src/team/office.ts:539`, `src/runners/claude-controller.ts:128`) → would add: `/mac` · "실행기 준비됨" 칸 → 회사 플러그인이 막혀 있으면 "아직: 회사 플러그인 team-plugin이 허용되지 않음 + 허용 명령"으로 보이고 통과하지 않는다.
  - [x] S2. 관리자가 특정 팀원을 설치 확인에서 빼기: 지금 없음 → would add: `/members` · [설치 확인 없이 허용] → 그 팀원은 Mac 없이 보드·기획 화면을 쓴다(보기·답·승인만 하는 사람용).
  - [x] S3a / [ ] S3b. 이미 들어와 있는 팀원: (S3a) 지금 Mac이 확인되지 않은 기존 팀원도 다음에 열 때 설치 화면만 본다 / (S3b) 이 변경 뒤에 새로 초대받은 팀원만 막는다.
  - [x] S4a / [ ] S4b. 담당 레포를 정하는 사람: 지금은 레포의 담당자나 관리자만 담당자를 더할 수 있고(`src/hub/store.ts:594` `addOwner` → `#manage`), 초대받은 사람은 스스로 고를 수 없습니다. (S4a) 관리자가 초대할 때 담당 레포를 함께 지정한다 / (S4b) 초대받은 사람이 설치 화면에서 허브에 등록된 레포 중 직접 고른다.
- Chosen by JongKun Kim on 2026-11-27: S1, S2(E8·E9), S3a(E10), S4a(E11)
- Examples become: S1 → E7, S2 → E8·E9, S3a → E10, S4a → E11; H2 → E12
- Out of scope:
  - O1. 설치 한 줄 자체(설치 단계, 질문)의 변경: 2026-11-26 PR #112~#114로 고쳤고 이 Story는 허브 화면 동선만 바꿉니다.
  - O2. 회사 계정 SSO: 메일·비밀번호 로그인(PR #111)을 그대로 씁니다.
  - O3. 초대받은 사람이 담당 레포를 직접 고르기(S4b): declined by JongKun Kim (2026-11-27).
  - O4. 이미 들어와 있는 팀원은 막지 않기(S3b): declined by JongKun Kim (2026-11-27).
- Unchanged:
  - Office와 Mac이 쓰는 경로(`/install.sh`, `/api/mac/*`, `/api/link/*`)와 그 응답: 설치 한 줄과 Office는 지금처럼 동작한다.
  - 로그인 화면, "메일과 비밀번호를 정해주세요" 화면, 초대·재설정 링크 화면의 문구.
  - `/mac` 화면의 설치 한 줄 `curl -fsSL https://<허브>/install.sh | sh`와 [복사] 버튼, "이 명령이 하는 일" 목록.

## Human decides
- H1. 관리자도 설치 확인을 거치나요? → 관리자도 거친다. 관리자는 `/mac`에서 자기 자신을 면제할 수 있다(E9) (JongKun Kim, 2026-11-27).
- H2. 한 번 확인된 팀원의 Mac이 나중에 꺼지거나 끊기면? → 잠깐 꺼진 것은 그대로 두고, Mac 연결을 해제하거나 새 Mac을 연결했을 때만 다시 확인한다(E12) (JongKun Kim, 2026-11-27).
- H3. 확인 전에 열어 둘 화면 → 설치·로그인 화면만: `/mac`, `/mac/approve`·`/mac/deny`, 로그아웃, "내 로그인"(`/account`). 결과 승인 같은 일도 그동안 막힌다(E2, E6) (JongKun Kim, 2026-11-27).

## Quality bars
| Area | Bar | Checked by | Tag |
|---|---|---|---|
| Accessibility rule scan | `/mac`(확인 전·후)과 막힌 화면에서 돌아온 `/mac`: WCAG 2.2 A·AA 위반 0 | script | `[quality: a11y-scan]` |
| Keyboard and focus | 설치 확인 흐름: 모든 컨트롤에 Tab으로 닿고 초점이 보인다. 오버레이 없음(not applicable: Esc) | agent | `[quality: keyboard]` |
| Narrow screen and large text | 320px 폭, 글자 200%에서 `/mac` 가로 스크롤·잘림 없음 | agent | `[quality: narrow]` |
| Empty, loading and error states | "설치 확인" 칸: 아직 아무것도 없을 때, 확인 중, 실패 이유가 각각 보인다 | agent | `[quality: states]` |
| Code health | 이 브랜치가 바꾼 줄에서 저장소의 타입 검사·시험 경고 없음 | code-reading check (a) | none |
| Screen reader on the core flow | 초대 → 설치 화면 → 허브로 가기를 화면 낭독기로 끝낼 수 있다 | person at the final review | none |

## Done when
- Every E# passes on the running app, on checks the builder cannot edit
- Every quality bar passes, or is listed as not verified with the reason
- Security review: no confirmed finding open
- Every Human decides item is answered
- The person has done the final review

---
Size: medium
Status: Approved (2026-11-27, "이대로 승인")
Owner: JongKun Kim
