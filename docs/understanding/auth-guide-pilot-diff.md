# README 인증 안내 — 사용자 G4 확인 자료

상태: 답변 대기. 이 파일은 승인 기록이 아니다.

- 승인 범위: [원본 Story](../pilots/auth-guide/story.md) M1–M6 / V1–V5. 파일의 과거 G1 pending 표시는 Office DB의 실제 사용자 승인으로 대체됐다.
- 대상: round 2, candidate `0f97c1493cb5c8c7b675808ebb4675b745ceff999760ed5f7734a96ca929399d`.
- 실제 모델 Developer 2회, Reviewer 2회. 최초 후보에 대한 controller 통합 검토 피드백 1회 뒤 수정·재검증.
- 최종 V1–V5: 모두 pass / exit 0. Reviewer: pass, findings 0. 모든 실행 lease released, 종료 오류 없음.
- [관측 결과](../verification/2026-09-23-live-kit-pilot.json). 검사는 문서 범위·문자열·링크·변경 금지를 확인하며, 의미 검토는 실제 Reviewer와 controller가 수행했다.
- 미확인: 실제 사용자 G4와 인도, 공개 화면의 전체 작업 실행, PM/Lead kit 역할 그래프, worker CE/Superpowers 실행, 전체 제품 완료.

## 원본에서 최종 후보로의 기계적 diff

표시용으로 빈 문맥 행의 공백 마커만 생략했다. 원문은 위 관측 결과 JSON의 diff.rawDiff에 보존한다.

```diff
diff --git a/README_ko.md b/README_ko.md
index d849d18..752950c 100644
--- a/README_ko.md
+++ b/README_ko.md
@@ -19,6 +19,8 @@

 > **읽기 전용 개발 미리보기입니다.** 로컬 CLI와 Claw 화면을 신규 Office DB로 실행할 수 있습니다. AI 작업 실행은 서버에서 잠겨 있습니다. macOS native 격리 canary가 필수 조건을 통과하지 못해 실제 Codex 팀 실행은 제공하지 않습니다. npm 게시·설치 시험 및 전체 업무 흐름은 아직 미완료입니다. [검증 기록](docs/verification/2026-09-18-runtime-baseline.md)을 확인하세요.

+로컬 미리보기의 Operator 인증키는 Office 화면 또는 로컬 Operator 흐름을 조작하기 위한 키이며, 실제 Codex 모델 호출 권한이나 구독 로그인이 아닙니다. 실제 Codex 모델 호출은 Operator 키와 구분되는 인증 경계에 있고, 승인된 구조에서는 Mac controller가 사용자의 기존 Codex 구독 로그인을 사용하며 파일 및 명령 도구 실행은 전용 VM에서 이루어집니다. 작업 관리와 Operator 절차는 [로컬 미리보기 안내](docs/LOCAL-PREVIEW.md#planning-conversation-screen)를 따르세요.
+
 <p align="center">
   <img src="https://raw.githubusercontent.com/GreenSheep01201/claw-empire/5c928b24ffa55b403fe7c5521d4ac3ac49516137/Sample_Img/Office.png" alt="Claw-Empire 원본 사무실 화면. 완성된 Pazmo 기능 화면이 아닌 출처가 표시된 참고 이미지" width="100%" />
   <br /><sub>Claw-Empire 원본 화면입니다. 아직 구현하지 않은 Pazmo 기능의 증거로 사용하지 않습니다.</sub>
```

## 사용자에게 제시할 질문

이 변경 뒤에 사용자가 겪는 일이 어떻게 달라질까요? 꼭 지켜야 할 규칙과 실패했을 때의 동작은 무엇인가요? 어떤 테스트가 그걸 확인했고, 아직 확인하지 못한 것은 무엇인가요?

사용자 답변: pending
평가: pending
G4: pending
