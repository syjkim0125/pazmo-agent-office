# 원본 반입 게시 전 결정 — 승인됨

Status: Approved
Understanding gate (G3, publication-only): accepted · 2026-09-18
Date: 2026-09-18

## 관측
사용자가 요청한 checkpoint 푸시를 실행했지만 GitHub GH013 push protection이 원본 import commit `8e25d7c5ea42d03e202d1599338f3a76d61d05fe`의 `vendor/claw-empire/server/oauth/helpers.ts`에서 Google OAuth Client ID와 Client Secret을 탐지해 거부했다. 탐지 값과 예외 허용 URL은 문서에 복사하지 않는다.

원본 기준 커밋과 후속 문서 커밋 `54e41c7`은 로컬에 있다. 승인 전 vendor는 고정 원본과 동일했다. 아래 승인 범위에 따라 게시본에서만 내장 기본값을 제거한다. 푸시 결과는 실제 원격 확인 뒤 보고한다.

## 제안하는 정확한 변경
- Google OAuth 내장 fallback 두 개를 제거하고 다음과 같이 환경 변수만 사용한다. 기존 GitHub 설정 및 다른 코드의 변경은 이 수정에 포함하지 않는다.

```ts
export const BUILTIN_GOOGLE_CLIENT_ID = process.env.OAUTH_GOOGLE_CLIENT_ID ?? "";
export const BUILTIN_GOOGLE_CLIENT_SECRET = process.env.OAUTH_GOOGLE_CLIENT_SECRET ?? "";
```

- 수정 파일에 Apache 변경 고지를 추가하고 `upstream/CHANGES.md`에 원본 대비 변경을 기록한다.
- 원본 tree의 로컬 기준 커밋은 별도 로컬 참조에 보존한다. 아직 원격에 수용되지 않은 이번 checkpoint commit들은 게시용 이력으로 다시 구성하여 credential이 포함된 과거 commit도 전송하지 않는다. main·사용자 기존 commit·원격 이력은 변경하지 않는다.
- 게시본 lock에는 원본 tree와 자격증명 제거 후 실제 tree를 구분하여 적고, 원격 소스가 원본 그대로라고 주장하지 않는다.
- 실제 모듈의 미설정/명시적 환경 변수 동작과 최종 게시 이력의 제거를 검증하고 재푸시한다. 원격 예외 허용으로 보호 규칙을 우회하지 않는다.

## 승인 이유와 대안
M1의 원본 보존과 게시본의 변경 경계를 명확히 하고, OAuth fallback 동작을 바꾸는 결정을 사람에게 확인한다. workflow execution의 고위험 설계 게이트는 인증·권한 변경에 G3를 요구한다. 대안은 원본을 로컬에만 보존하고 현 시점 푸시를 보류하는 것이다.

이 결정은 제품 runtime 격리 설계의 G3 및 G4를 승인하는 것으로 확대하지 않는다. 사용자는 내장 기본값의 용도와 제거 영향을 설명받은 뒤 “아하 오케이 그렇게 해.”라고 승인했다. 이 응답은 위 자격증명 제거·게시 이력 정리·재푸시 범위의 승인으로 기록한다.
