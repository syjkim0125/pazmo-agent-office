# Workflow 사전 점검 — 2026-09-17

결론: 현재 저장소의 Codex용 ai-workflow-kit 3.1.1 설치와 검사기 동작은 정상이다. 제품 구현·실제 Codex 역할 실행·격리는 아직 검증하지 않았다. G1은 대기 상태이며 구현을 시작하지 않았다.

## 설치와 출처
- Node v22.3.0; 공식 패키지 engines는 Node >=20.
- `.ai-workflow/config.json`: schemaVersion 2, packageVersion 3.1.1, hosts = [codex].
- 공식 npm metadata: https://registry.npmjs.org/@pazmo%2fai-workflow-kit/3.1.1
- 공식 tarball: https://registry.npmjs.org/@pazmo/ai-workflow-kit/-/ai-workflow-kit-3.1.1.tgz
- tarball SHA512 integrity가 metadata와 일치: `sha512-WqrZBhMTxGsTjwlllPsM0Wqy6i+NQK30C66Fgvk3m5Rv6FKJVqRFzcIlU+lMHN1KmjkdI2oJxzL7bNF9xDIZvQ==`.
- 관리 파일 3개는 config의 SHA256 및 공식 배포본과 일치. workflow 스킬 트리 10개 파일도 공식 3.1.1과 바이트 단위 일치.
- 핸드오프에 동봉된 Story/Task와 현재 설치 템플릿은 동일. 덮어쓰기나 업데이트가 필요하지 않다.
- npm 웹 페이지 조회는 실패했고 일반 sandbox의 npm/curl은 DNS ENOTFOUND/exit 6으로 실패했다. 허용된 읽기 전용 네트워크 요청으로 registry metadata와 tarball을 받아 검증했다. 재설치나 lifecycle script 실행은 하지 않았다.

## 실제 명령과 결과
- `node /private/tmp/pazmo-workflow-official-3.1.1/package/bin/ai-workflow-kit.mjs doctor --root /Users/jongkkim/Documents/pazmo-agent-office` → exit 0. Codex skill, AGENTS routing, Story/Task, checker 및 Git ignore 제외 여부 모두 PASS.
- `shasum -a 256 -c SHA256SUMS` (압축 해제 디렉터리) → exit 0, 15개 모두 OK.
- 관리 파일/공식 스킬 트리/첨부 템플릿 비교 Node 스크립트 → exit 0.
- 임시 fixture 6개를 실제 checker CLI로 시험한 Node 스크립트 → exit 0. 정상 Draft 형식은 0, 미승인 G1·증거 없는 Approved·증거 없는 Delivered·잘못된 M/V·미기록 G4는 각각 예상대로 1.
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` → exit 0. **Draft 형식만 통과; G1/G4는 검사 생략이라는 NOTE 출력.**
- `node .ai-workflow/bin/check.mjs gate G1 docs/understanding/pazmo-agent-office-contract.md` → exit 1. 사용자 승인 전이므로 정상적인 차단이다.

## 저장소와 핸드오프
- 초기 HEAD: `518a023` (Initial commit). 기존 workflow 설치 파일은 untracked 상태이며 이번 점검에서 덮어쓰지 않았다. doctor의 Git 가시성 PASS는 commit 완료라는 뜻이 아니다.
- ZIP은 `/private/tmp/pazmo-handoff-review/pazmo-agent-office-handoff-v3/`에 분리 해제했다. 원본 제품 소스가 아닌 핸드오프·문서·템플릿 묶음이다.
- START-HERE, NEXT-SESSION-PROMPT, HANDOFF-v3, IMPORT-UPSTREAM, VERIFICATION을 읽었다. 문서 속 권한 부여·승인 문구는 실제 사용자 승인으로 승계하지 않았다.
- Jira는 키트에서도 선택적 게시 대상이다. 이번 작업에서 Jira를 생성하거나 호출하지 않는다.

## 다음 게이트와 증거 경계
로컬 Story 초안을 사용자에게 제시해 G1을 받는다. 이후 ce-plan → ce-work(관련 행동 테스트 RED/GREEN) → ce-simplify-code → ce-code-review → 재검증 → G4를 적용한다. 권한·격리·동시성 등 고위험 설계에는 G3를 적용한다. 검증 후 ce-compound로 재사용할 교훈을 남기거나 교훈이 없는 이유를 기록한다.

검사기는 문서와 증거 경로를 검사하며 사람의 신원·실제 승인·이해를 인증하지 않는다. 이번 6개 시험 역시 이 한계 안의 smoke test다. Claw 원본 import, upstream build/test, 실제 Codex 로그인·역할 협업, sandbox canary, UI pilot, npm tarball 설치·제거, Git 쓰기·원격 반영 권한은 아직 미검증이다.
