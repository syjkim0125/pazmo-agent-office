<div align="center">

# Pazmo Agent Office

### 목표는 사람이. 실행은 AI 팀이. 완료는 증거로.

**기존 시스템 개선부터 새로운 제품 개발까지, 내가 지휘하는 AI 팀.**

![단계](https://img.shields.io/badge/stage-local_alpha-orange)
![Pazmo 신규 코드](https://img.shields.io/badge/Pazmo_originals-PolyForm_Shield_1.0.0-blue)
![포함된 제3자 파일](https://img.shields.io/badge/third--party_files-Apache--2.0-blue)
![설계 방향](https://img.shields.io/badge/workflow_design-Jira_optional-purple)

[English](README.md) · **한국어**

[제품 방향](#왜-pazmo인가) · [직원 구성](#직원-구성) · [현재 상태](#현재-상태) · [라이선스](#라이선스)

</div>

> **Apple Silicon Mac용 로컬 알파입니다.** Office는 kit 역할 그래프(PM·팀장·Developer·Reviewer)를 신뢰된 Mac controller와 전용 VM에서 돌리고, 사용자가 설치·로그인한 codex 또는 claude CLI를 씁니다. 화면은 Pazmo가 만든 최소 Office(Tasks·작업 상세·Decisions·Agents)입니다. 출발점이던 Claw Empire는 2026-10-30에 저장소에서 지웠습니다(D30). 실제 작업을 Mac 한 대에서 사용자 G4와 인도까지 마쳤습니다. 다른 사람 PC, 회사 IT 정책, npm 배포는 아직 확인하지 않았습니다. [현재 상태](docs/STATUS.md)를 확인하세요.

## 왜 Pazmo인가

AI Office는 바쁘게 움직이는 화면을 넘어, 맡긴 일을 검증 가능한 결과로 돌려줘야 합니다.

Pazmo는 [Claw-Empire](https://github.com/GreenSheep01201/claw-empire)의 사무실 화면에서 출발해 [AI Workflow Kit](https://github.com/syjkim0125/ai-workflow-kit)의 합의서·템플릿·사람 승인·검증 원칙을 결합하는 독립 프로젝트입니다. 실행 엔진(결정·격리 실행·검증·인도)과 지금의 최소 Office 화면은 Pazmo가 직접 만들었고, Claw-Empire 코드는 더 이상 들어 있지 않습니다. 기존 키트는 변경하지 않습니다.

| 원칙 | 만들고 있는 동작 |
|---|---|
| **합의서는 하나** | Story에 목표, 반드시 되는 것, 하지 않을 것, 검증 방법을 정리합니다. |
| **작업을 주고받는 직원** | 같은 작업·코드 버전의 산출물과 리뷰를 정확한 담당자에게 전달합니다. |
| **증거 없는 완료 금지** | 리뷰 실패·미검증 결과·병합 충돌을 완료로 처리하지 않습니다. |
| **적게 개입하되 방향 유지** | 범위, 중요한 위험, 결과 이해, 외부 반영을 사람이 결정합니다. |
| **Jira는 선택** | 로컬 서식과 Office 상태만으로 동작하도록 설계합니다. Jira 계정·키·연결을 기본 전제로 두지 않습니다. |

## 직원 구성

| 직원 | 책임 | 참여 |
|---|---|---|
| PM / Team Lead | 목표·범위·가정·작업 의존성·진행 조율 | 기본 |
| Software Engineer | 구현·테스트·단순화·수정 | 기본 |
| QA / Code Reviewer | 요구사항·코드·실패 경로·검증 결과 확인 | 기본 |
| Product Designer | 사용자 흐름·화면 상태·디자인 품질 | UI 작업 |
| DevOps / Release Engineer | 빌드·미리보기·배포 준비·복구 확인 | 환경·반영 변경 |

직원은 책임 단위이며 모두가 항상 실행되는 것은 아닙니다. 각 역할은 사용자가 설치·로그인한 codex 또는 claude CLI로 실행하며, Office는 로그인 정보를 읽거나 옮기지 않습니다. 구독 사용량에는 한도가 있고 API 키 과금은 별도입니다. 다른 유료 경로로 몰래 전환하지 않습니다.

## 작업 흐름

```text
목표 → Story → 사람의 범위 승인 → 계획
                                ↓
                         구현 → 검증 → 리뷰
                           ↑           │
                           └── 수정 ───┘
                                ↓
                            통합 검증
                                ↓
                    사람의 이해 확인 → 승인된 인도
```

CE는 제한된 구현·리뷰 절차를, Superpowers는 테스트·디버깅·완료 검증 규율을 제공합니다. 직원마다 또 다른 전체 워크플로우를 시작하지 않습니다.

대상은 기존 회사 시스템 변경, 신규 제품, 근거 있는 로컬 분석·보고서입니다. 비코드 업무에는 데이터·출처 검증을 사용합니다. 무인 운영 배포·고객 데이터 쓰기는 초기 범위가 아닙니다.

## 로컬 실행

Apple Silicon Mac에서 최초 로그인과 필수 도구 준비 후, Office 저장소에서 `./office --project /절대/프로젝트/경로`를 실행하세요. 다음부터는 `./office`로 같은 프로젝트를 열 수 있습니다. 설치 확인·VM 준비·Office 시작을 연결하며 자세한 조건과 한계는 [실행 안내](docs/LOCAL-PREVIEW.md)를 따릅니다.

화면은 Tasks·작업 상세·Decisions·Agents 네 개이고, agent마다 작업 실행기와 리뷰 실행기를 따로 고릅니다. 예전 명령의 `--lean`은 받아들이고 같은 Office를 켭니다. `--claw`는 지웠습니다. [Office 안내](docs/LOCAL-PREVIEW.md#새-office)를 참고하세요.

### Claw 버전에서 업데이트

1. 받기 전에: Claw Office의 진행 중인 작업과 수락한 팀 허브 요청을 끝내거나 취소하고, 그 Office를 멈춥니다(`node bin/pazmo-office.mjs stop --project /절대/프로젝트/경로`). 받은 뒤에도 같은 명령으로 멈출 수 있습니다.
2. 받은 뒤: `./office`(팀 Office는 `./office --team`)를 한 번 실행합니다. 첫 실행은 루트 의존성(`ws`)을 설치하느라 npm 레지스트리 접속이 필요하고, 첫 역할 실행 전에 실행기 자격 검사가 한 번 다시 돕니다. 이미 켜져 있던 새 Office도 이 실행으로 의존성을 받습니다.
3. 한 checkout에서 Office를 여러 개(프로젝트별, 팀 Office) 켜 두었다면 진행 중인 작업이 없을 때 업데이트합니다. 설치는 `node_modules`를 잠깐 지우므로, 그동안 다른 Office의 claude 작업이 실패할 수 있습니다.
4. 남은 `vendor/` 폴더(예전 설치물·빌드물)는 지워도 됩니다. 예전 작업 기록(`claw/`)은 지우지 않고 그대로 두며, 새 Office는 읽지 않습니다.

## 현재 상태

| 항목 | 상태 |
|---|---|
| 출발점 | Claw-Empire `v2.0.4`(commit `5c928b24ffa55b403fe7c5521d4ac3ac49516137`)에서 시작해 2026-10-30에 저장소에서 지움(D30) — [출처 기록](upstream/CHANGES.md) |
| Story·Task | kit 4.1.0 역할 그래프 연결; 배정·승인은 Office가 관리 |
| Jira 없는 팀 실행 | 기존 프로젝트의 실제 작업을 Mac 한 대에서 사용자 G4·인도까지 완료 — [검증 기록](docs/verification/2026-10-06-cli-runner-selection.md) |
| CLI 실행기 | 설치된 codex 또는 claude를 역할마다 선택; 구독 로그인, API 키 없음 |
| 로컬 실행기·Office 화면 | `./office`가 최소 Office(Tasks·작업 상세·Decisions·Agents)를 켬; 2026-10-30 기본 전환·Claw 삭제(D30), app-be 실제 확인은 남음 — [실행 안내](docs/LOCAL-PREVIEW.md#새-office) · [검증 기록](docs/verification/2026-10-30-lean-office-default.md) |
| 팀 허브·팀 Story 보드 | 허브 서버(초대·레포·담당자)와 팀 Story 보드 1·2단계(Hub, 팀 Office 여러 repo, 시험). Office에서 허브 요청을 보내고 받던 화면은 Claw와 함께 지웠고 팀 Story 보드가 대신함. 여러 PC는 미확인 — [실행 안내](docs/LOCAL-PREVIEW.md#팀-office-2단계-시험) |
| 결정·승인 | Office의 Decisions에서 G1·질문·G4에 답함. 터미널 계약·승인 명령과 채팅 bridge는 legacy 엔진과 함께 지움(D30) |
| 실행 격리·완료 guard | 전용 VM 검사·완료 guard 구현; 호스트 직접 실행은 계속 차단 |
| npm `@pazmo/agent-office` | 예정 이름; 게시·설치 시험 전 |

지금은 실행 가능한 Pazmo npx quickstart가 없습니다. [현재 상태와 다음 단계](docs/STATUS.md), [승인된 Story](docs/understanding/pazmo-agent-office-contract.md), [구현 계획](docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md)을 확인해 주세요. [v3 핸드오프](docs/HANDOFF-v3.md)와 [반입 절차](docs/IMPORT-UPSTREAM.md)는 과거 입력 자료이며 사용자 승인 기록이 아닙니다. 실행 경계 검증 전 회사 자격증명을 연결하지 마세요.

## 기여 방법

작은 변경을 요구사항과 실제 검증에 연결해 주세요. 원본 코드·출처·라이선스를 보존하고, source import·빌드·mock·실제 Codex·브라우저·npm 설치 시험을 구분해 보고합니다. 문자열 존재를 확인하는 테스트만으로 동작을 증명하지 않습니다.

## 라이선스

**Pazmo 독자 코드·문서는 [PolyForm Shield 1.0.0](LICENSE)**이고, 저장소에 들어 있는 제3자 파일(`assets/codex`의 Codex 모델 항목)은 **Apache-2.0**입니다. Pazmo 코드는 회사 안에서 쓰는 것을 포함해 어떤 목적으로든 쓰고 고치고 나눌 수 있지만, Pazmo와 경쟁하는 제품을 내놓는 데는 무료라도 쓸 수 없습니다. 2026-10-30(커밋 `610169e`)까지 공개된 버전은 MIT였습니다. Claw-Empire 코드(Apache-2.0)는 2026-10-30에 지우기 전 버전에만 들어 있으며, 그 출처와 고지 기록은 남겨 둡니다.

Pazmo는 소스 공개형이며 OSI 오픈소스가 아닙니다. 원본 프로젝트의 라이선스를 바꾸는 것도 아닙니다.

[범위별 라이선스](LICENSING.md) · [출처 및 제3자 고지](THIRD_PARTY_NOTICES.md)

Claw-Empire, AI Workflow Kit, Compound Engineering, Superpowers의 작업을 존중합니다. Open Office와 Pixel Agents는 문서·사용 경험의 참고 대상입니다. Pazmo는 독립 프로젝트이며 해당 프로젝트나 OpenAI의 공식 배포판이 아닙니다.
