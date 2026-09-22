# Story: README_ko 인증 구분 보강
Status: Draft
Owner: Human
Understanding gate (G1): pending
Understanding gate (G4): pending

## Goal
한국어 README에서 Office 조작용 Operator 키와 실제 Codex 모델 호출용 구독 로그인을 짧게 구분해 사용자가 현재 미리보기의 인증 경계를 오해하지 않게 한다.

## Domain
Agent Office 문서

## MUST
- M1. README_ko.md 한 파일만 변경하고 기존 LOCAL-PREVIEW 문서의 작업 관리 안내를 중복 구현하거나 새 문서로 복제하지 않는다.
- M2. 한국어로 Operator 키가 Office 화면 또는 로컬 Operator 흐름을 조작하기 위한 키이며 실제 Codex 모델 호출 권한이나 구독 로그인이 아니라고 간단히 설명한다.
- M3. 실제 Codex 모델 호출은 사용자의 기존 Codex 구독 로그인 방향과 별개의 인증 경계라고 설명한다.
- M4. Mac controller가 기존 로그인을 사용하고 파일 및 명령 도구 실행은 전용 VM에서 이루어지는 승인된 구조를 설명한다.
- M5. 현재 공개 모델 실행, 전체 실제 사용 검증, 승인 생성, 배포 또는 계정 변경이 완료된 것처럼 읽히는 표현을 추가하지 않는다.
- M6. 추가 문구에서 docs/LOCAL-PREVIEW.md의 작업 관리 또는 Operator 안내로 연결해 자세한 로컬 미리보기 절차를 따르도록 한다.

## SHOULD
- S1. 기존 README_ko.md의 현재 상태 및 읽기 전용 미리보기 톤과 일관되게 짧은 문단 또는 문장으로 추가한다.
- S2. 이미 README_ko.md에 있는 AI 실행 잠금, 구독 사용량, API 키 과금 별도 안내와 충돌하지 않게 배치한다.

## OUT
- O1. 배포, 계정 변경, 사용자 승인 생성은 범위 밖이다.
- O2. docs/LOCAL-PREVIEW.md 또는 다른 문서 변경은 범위 밖이다.
- O3. 모델 실행 기능, 승인 UI, VM 실행 구조 구현은 범위 밖이다.
- O4. 공개 모델 실행이나 전체 실제 사용 검증이 완료되었다는 마케팅성 표현은 범위 밖이다.

## Decisions
- D1. ASSUMED: 읽기 전용 snapshot 기준 README_ko.md는 현재 로컬 CLI와 읽기 전용 Office가 구현 및 시험되었지만 AI 실행은 잠겨 있다고 설명한다.
- D2. ASSUMED: 읽기 전용 snapshot 기준 docs/LOCAL-PREVIEW.md는 작업 관리, Operator 인증키, Codex 계정 로그인 분리, 실행 잠금, 모델 실행 미연결 상태를 이미 자세히 설명한다.
- D3. ASSUMED: 이 제안은 사전 G1 문서 개선 초안이며 승인이나 구현 시작을 의미하지 않는다.

## Verify
- V1 [M1]. 변경 후 diff를 검토해 README_ko.md 외 파일의 추가, 삭제, 수정이 없고 LOCAL-PREVIEW 내용을 길게 복제한 새 섹션이나 새 문서가 없는지 확인한다.
- V2 [M2, M3]. README_ko.md의 추가 문구를 읽어 Operator 키가 Office 조작용이고 실제 Codex 모델 호출에는 별도의 기존 구독 로그인이 필요하다는 두 인증의 차이가 한국어로 명확한지 확인한다.
- V3 [M4]. README_ko.md의 추가 문구를 읽어 Mac controller는 기존 로그인을 사용하고 파일 및 명령 도구는 전용 VM에서 실행된다는 구조가 구현 완료 과장 없이 설명되는지 확인한다.
- V4 [M5]. README_ko.md의 추가 문구를 읽어 공개 모델 실행 가능, 전체 실제 사용 검증 완료, 자동 승인 생성, 배포 완료, 계정 변경 완료로 해석될 수 있는 표현이 없는지 확인한다.
- V5 [M6]. README_ko.md의 추가 문구에 docs/LOCAL-PREVIEW.md로 향하는 링크가 있고 링크 문맥이 작업 관리 또는 Operator 안내를 더 자세히 보라는 방향인지 확인한다.
