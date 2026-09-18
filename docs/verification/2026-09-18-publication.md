# Google OAuth 기본값 제거와 게시 검증 — 2026-09-18

Scope: 승인된 자격증명 기본값 두 개 제거와 미게시 checkpoint 이력 재구성. 전체 제품 runtime G3/G4 또는 Delivered를 뜻하지 않는다.

## 변경과 출처
- 원본 import commit `8e25d7c5ea42d03e202d1599338f3a76d61d05fe`는 로컬 `codex/local-original-claw-v2.0.4` 이력에 보존한다. 이 보존 브랜치는 푸시하지 않는다.
- 원본 vendor tree: `3ca77ccbebc879fa80997a374288285531aa6b26`.
- 자격증명 제거 후 vendor tree: `d1263143c625cf5270a9cf5eaa1c70d3d7025bcd`.
- 두 tree의 유일한 변경 파일은 `server/oauth/helpers.ts`다. Google 내장 기본값 두 개 제거, 설정 설명 및 파일 변경 고지를 포함한다. GitHub 기본값·암호화·redirect·token 갱신 코드는 변경하지 않았다.
- root LICENSE와 원본 gitlinks는 보존했다. 출처 lock과 양언어 README는 로컬 원본과 게시본을 구분한다.

## 테스트
실행 명령: `node --experimental-vm-modules --test tests/oauth-client-defaults.test.mjs` (Node 24.19.0).

- RED: 수정 전 3개 중 1개 실패, exit 1. 환경 변수가 없는데 내장 기본값을 반환했다. 실패 출력에 자격증명을 노출하지 않았다.
- GREEN: 수정 후 3개 모두 통과, exit 0. 미설정 시 빈 값, 명시적 Google/GitHub 값 유지, 명시적 빈 값 유지.
- 재검증: 같은 3개 다시 통과. Story·G1·U1 Task checker 각각 exit 0. Story가 Delivered가 아니므로 G4는 검사하지 않는다.
- 실제 TypeScript helper 모듈을 Node로 타입 제거 후 VM에서 평가했다. runtime config만 대체해 사용자 .env와 실제 provider에 접근하지 않았다. 테스트는 로그인·토큰 갱신의 통합 동작을 증명하지 않는다. Node의 타입 제거·VM API에는 experimental warning이 있다.

## 단순화·리뷰·게시 경계
단순화 검토 결과 두 환경 변수 선언 외에 추가 abstraction이나 호환 분기가 필요하지 않아 변경하지 않았다. 같은 세션에서 correctness/security 렌즈로 미설정·빈 값·설정된 값과 호출 경로를 확인했다. 설정 없는 Google 연동은 더 이상 기본 자격증명으로 동작하지 않는 것이 승인된 결과다. 독립 reviewer 또는 전체 upstream 보안 감사로 주장하지 않는다.

첫 게시 후보의 698개 Git blob에서 원본 credential 두 개의 Base64 및 디코딩 표현 총 4개 패턴을 검사했다. 일치 0건, exit 0. 값은 출력하거나 별도 파일로 저장하지 않았다. 최종 commit 뒤에는 게시 브랜치의 모든 조상 commit에 같은 검사를 반복하고, 원본 credential commit이 조상에 포함되지 않은 상태에서 명시한 브랜치만 push한다. 로컬 원본 보존 branch를 포함하는 `--all` push는 사용하지 않는다.

전체 upstream build/lint/typecheck·실제 Google/Codex 인증·sandbox canary·npm 설치 시험은 실행하지 않았다. 의존성 설치 없이 focused module 시험만 수행했다. GitHub의 재푸시 결과와 최종 HEAD 일치는 실제 명령 결과로 별도 보고한다.
