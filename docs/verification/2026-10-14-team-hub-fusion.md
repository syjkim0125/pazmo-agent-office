# 2026-10-14~15 팀 허브 Fusion 배포 (U12) 검증

Story: M11 · V13 · D19. 결정: [team-hub-fusion-decision.md](../understanding/team-hub-fusion-decision.md). 계획: [2026-10-14-1500-feat-team-hub-fusion-plan.md](../plans/2026-10-14-1500-feat-team-hub-fusion-plan.md).

## 구현 범위

- **허브 프록시 뒤 모드:**
  - 공개 주소 검증. `:443`, `?`, `#`, `@`는 거부한다.
  - 컨테이너 안에서는 HTTP로 듣는다.
  - Host 421 / Origin 403 검사
  - `/healthz`는 Host 검사 전에 응답하고 본문은 `ok`다.
  - 프록시 모드에서는 `/trust`·`/ca.pem`이 404다.
  - keep-alive 65s / headers 66s
  - SQLite busy timeout
  - 사내망 TLS 모드는 그대로다.
- **Office 연결:**
  - 지문이 없으면 시스템 신뢰를 쓴다(`rejectUnauthorized: true` 명시).
  - 지문 고정 연결은 그대로 동작한다.
  - 잘못된 조합은 `HUB_LINK_CONFIG_INVALID`다.
  - 빈 지문은 오류다.
  - 고정 연결과 시스템 연결의 `HUB_TLS_UNTRUSTED` 안내를 나눴다.
- **배포 묶음:**
  - 허브 전용 진입점 `bin/pazmo-hub.mjs`(Node 24)
  - `src/hub/main.ts`(환경 변수 설정)
  - `npm run hub:bundle`: import 그래프 기반 묶음이다. `--out` 보호를 강화했다.
- **배포 파일:** OpenShift Template `deploy/fusion/pazmo-hub.json`
  - 구성: ImageStream, BuildConfig(바이너리 Source, Node 24 빌더, `SKIP_BUILDING`), PVC 2Gi, Deployment(파드 1개, Recreate, `/healthz` 검사), Service, edge Route
  - 레포가 공개라서 클러스터 호스트와 빌더 이미지는 매개변수이고, 실제 값은 git이 무시하는 `deploy/fusion/local.env`에 둔다(2026-10-15 공개 전 정리).

## 자동 검증

| 검사 | 결과 |
|---|---|
| root `npm test` | 640/640(2026-10-15, 공개 정리 뒤 커밋 직전) |
| hub-* 테스트 | 149/149(최종 수정 뒤) |
| `npm run typecheck` | exit 0 |
| Story·Task 검사 | exit 0 |

## 리뷰

- **Task 1–4 리뷰(가장 강한 모델):** Critical 0
  - Task 4에서 Important 1건을 고쳤다. `--out` 보호가 좁아 레포 안 폴더가 지워질 수 있던 문제다.
  - 이 수정 중 사고가 있었다. 구현 에이전트가 보호를 고치기 전에 테스트를 돌려 `src/`가 지워졌다. 스냅샷 트리에서 복구했고, 의도한 파일만 다르고 추적 파일 74개가 모두 있음을 따로 확인했다.
- **최종 전체 리뷰: Critical 0, Important 1건**(테스트가 실제 `dist/`를 지우던 문제)과 사소한 항목들을 한 번에 고쳤고, 재검토에서 모두 해결됐다.
- **남긴 것:**
  - `HUB_FINGERPRINT_NOT_USED`가 CLI에서 `FAILED`로 보인다. 문구는 맞다.
  - NetworkPolicy는 두지 않았다.

## 실제 배포 (2026-10-15)

- 사용자가 `oc login`을 했다. 배포 명령도 사용자 세션에서 실행됐다.
- 서버 시험 적용에서 PVC 1Gi가 거부됐다. 프로젝트 최소가 2Gi라서 매니페스트·테스트·문서를 2Gi로 맞췄다.
- 두 번째 빌드에 `SKIP_BUILDING`·`PKG_MANAGER`를 넣었다. 빌더 Node는 v24.21.0이다.
- 결과:
  - 파드 Running 1/1, Route Admitted
  - 공개 주소에서 `/healthz` 200
  - Node 시스템 신뢰로 인증서 검증에 성공했다(공인 CA).
  - `/trust`는 404이고, HTTP는 HTTPS로 넘어간다.
- 관리자가 입장했다.
- eevee-be Office 한 대를 지문 없이 연결했다. 읽기 전용 확인에서 레포 목록이 보였다.

## 아직 하지 않은 것 (G4 전)

- 두 번째 팀원으로 실제 확인한다: 보내기 → 수락 → 취소, 파드 재시작 뒤 이어짐, 노트북 IP 변경 뒤 연결 유지. 같은 확인을 A(붙여넣기 연결)와 함께 한다.
- G4: 사용자 답변으로만 기록한다.
