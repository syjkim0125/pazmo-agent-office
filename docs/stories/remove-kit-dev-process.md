# Story: 이 저장소의 개발 방식을 ai-workflow-kit에서 story-qa로 바꾼다

## Goal
1. As-is
   - 이 저장소를 고칠 때 kit 절차를 따른다. `AGENTS.md`의 kit 블록, `.agents/skills/workflow`, `.ai-workflow` 그래프 실행과 G1·G4 기록이 그 절차다.
   - 사용자는 이 절차가 무겁고 느리고, 순정 Opus보다 결과가 낫지 않다고 판단했다.
   - 지난 실행 기록 16MB(`runs` 708개, `approvals` 58개, `evidence`)가 트리에 있다.
2. To-be
   - 이 저장소의 변경은 pazmo-story-to-dev의 story-qa 흐름으로 한다: Story와 QA 목록 → 사람 승인 → 구현 → 독립 리뷰 → 로컬 QA → 보고.
   - kit의 개발 지침과 지난 기록은 트리에서 빠진다.
   - 이 저장소의 QA 환경 문서 `docs/qa.md`가 생긴다.
3. Unchanged
   - 제품 Office가 실행 중에 쓰는 kit 부분은 그대로다: `.ai-workflow/bin`, `.ai-workflow/graph`, `templates/ai-workflow`.
   - 이 부분은 Office가 작업 단계·기획·Story 형식 검사에 쓰며, 3·4단계(엔진·양식 교체)에서 다룬다.
   - 제품 동작, 허브·Office 화면, 시험은 바뀌지 않는다.

## Decisions
- D1. 지난 기록으로 가는 문서 링크(문서 30여 개에 208곳)
  - Options: 링크를 모두 고침 / 링크는 두고 기록이 있는 git 커밋을 한 곳에 적음
  - Pick: 링크는 두고 한 곳에 적는다.
    - 링크는 계획·리뷰·변경 기록의 근거다. `git show <커밋>^:<경로>`로 그대로 읽을 수 있다.
    - 208곳을 고치면 지난 문서의 내용이 바뀐다.
    - 적는 곳: `docs/STATUS.md` 맨 위와 `AGENTS.md`.
- D2. kit 형식의 정본 Story `docs/understanding/pazmo-agent-office-contract.md`(D1~D50)
  - Options: 그대로 둠 / 보관 폴더로 옮김 / 지움
  - Pick: 그대로 두고 머리에 한 줄을 더한다. "kit 시절의 제품 결정 기록이다. 게이트 기록 파일은 git 이력에 있고, 새 변경은 `docs/stories/`에 쓴다."
  - D1~D50은 지금 제품이 따르는 결정이고, 많은 문서가 그 번호를 가리킨다(`AGENTS.md:19`, `CONCEPTS.md`).
- D3. story-qa skill을 어디서 읽나
  - Options: 플러그인 설치를 안내함 / skill을 이 저장소에 복사함
  - Pick: `AGENTS.md`가 플러그인(`syjkim0125/pazmo-story-to-dev`) 설치와 `/story-qa`를 안내한다.
  - 복사본은 원본과 갈라진다. 이 Mac의 Claude Code에는 아직 설치돼 있지 않다(`~/.claude/plugins/cache`에 없음). 설치는 Human decides에 둔다.
- D4. 지우는 것
  - `.ai-workflow/config.json`(kit 설치 목록)과 `.ai-workflow/verification.json`(이 저장소의 kit 검증 설정)도 개발 쪽이라 지운다.
  - 제품 코드는 둘 다 읽지 않는다.
    - Office는 작업 폴더의 `.ai-workflow/verification.json`을 만든다(`src/core/kit-role-runs.ts:130`).
    - 올리기 검사는 PL 계획 폴더의 같은 이름 파일을 읽는다(`src/team/upload.ts:134`).
- Copies: 개발 지침은 `AGENTS.md` 하나다. 이 저장소에는 `CLAUDE.md`가 없다.

## Human decides
- story-qa 플러그인을 이 Mac의 Claude Code에 설치할지: `claude plugin marketplace add syjkim0125/pazmo-story-to-dev` 다음 `claude plugin install pazmo-story-to-dev@pazmo-story-to-dev`. 사용자 설정을 바꾸는 일이라 사람이 하거나 허락한다.

## MUST
- M1. `AGENTS.md`의 kit 블록(`<!-- BEGIN ai-workflow-kit -->` … `END`)을 story-qa 안내로 바꾼다.
  1. 변경은 story-qa로 한다: Story(`docs/stories/<slug>.md`)와 QA 목록을 먼저 승인받는다.
  2. QA 환경은 `docs/qa.md`를 따른다.
  3. "Bootstrap status"에서 kit 게이트(G3·G4 대기) 문장을 지우고, 지난 기록이 있는 커밋을 적는다.
  4. Office의 Decision(G1·G3·G4)은 제품 기능이라 대리 승인 금지 문단을 그대로 둔다.
- M2. 트리에서 지운다: `.agents/skills/workflow`, `.ai-workflow/runs`, `.ai-workflow/approvals`, `.ai-workflow/evidence`, `.ai-workflow/config.json`, `.ai-workflow/verification.json`.
- M3. 남긴다: `.ai-workflow/bin`, `.ai-workflow/graph`, `templates/ai-workflow`. 제품이 쓰는 것이 그대로 동작한다.
- M4. `docs/qa.md`를 QA-ENV 양식으로 만든다.
  - 로컬 시험(Node 24), 확인용 허브 사본과 Office 띄우기, 테스트 계정, 테스트 레포, 사람이 할 일(로그인, 사내 배포).
  - `Auto-merge: off`, 통합 브랜치 없음, 운영 브랜치 `main`.
- M5. `docs/STATUS.md` 맨 위와 정본 Story 머리에 D1·D2의 한 줄을 적는다.

## OUT
- O1. Office 엔진(작업 단계·기획)을 kit에서 바꾸기: 3단계. `.ai-workflow/bin`·`graph`를 지우는 것도 그때 한다.
- O2. Story 양식(MUST/Verify → story-qa 양식)과 허브의 읽기: 4단계.
- O3. "QA 시작": 5단계.
- O4. 지난 문서 208곳의 링크 고치기: D1.
- O5. `docs/solutions/`의 kit 관련 지식 문서: 지난 해결 기록이라 그대로 둔다. 낡은 것은 나중에 `/ce-compound-refresh`로 정리한다.
- O6. 사용자 메모리(저장소 밖)의 kit 메모: 이 변경이 머지된 뒤 따로 정리한다.

## QA
Environment: local (docs/qa.md)
- Q1 [M3]. 이 저장소 · Node 24 · `npm test`, `npm run typecheck` → 모두 통과한다. 개수는 지금 main과 같다(2087).
- Q2 [M3]. 이 저장소 · Node 24 · Office를 화면 미리보기로 켠다(`node bin/pazmo-office.mjs start --project <임시 git 프로젝트> --port 0 --no-open`) → status가 running이고, 화면이 200으로 열리고, stop으로 꺼진다.
- Q3 [M2]. 이 저장소 · `git ls-files .ai-workflow .agents` → `.ai-workflow/bin`·`graph`의 파일만 나온다.
- Q4 [M1]. 이 저장소 · `AGENTS.md`를 읽는다 → kit 블록이 없고, story-qa·`docs/qa.md`·지난 기록 커밋을 안내하며, Office Decision 대리 승인 금지 문단이 그대로 있다.
- Q5 [M4]. `docs/qa.md`의 허브 띄우기 명령 · 임시 데이터 폴더 · 그대로 실행한다 → 허브가 응답하고(로그인 전 401), 문서의 멈추는 명령으로 꺼진다.
- Q6 [Unchanged]. 정본 Story의 D1~D50과 `CONCEPTS.md` → 내용이 그대로이고 머리 한 줄만 더해졌다.
- Q7 [not shown]. `git grep -n "ai-workflow-kit" -- AGENTS.md` → 아무것도 나오지 않는다.

---
Status: Approved
Owner: JongKun Kim
