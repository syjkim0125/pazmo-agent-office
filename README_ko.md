<div align="center">

# Pazmo Agent Office

### 목표는 사람이. 실행은 AI 팀이. 완료는 증거로.

**기존 시스템 개선부터 새로운 제품 개발까지, 내가 지휘하는 AI 팀.**

![단계](https://img.shields.io/badge/stage-local_alpha-orange)
![Pazmo 신규 코드](https://img.shields.io/badge/Pazmo_originals-MIT-blue)
![원본 라이선스](https://img.shields.io/badge/Claw--Empire-Apache--2.0-blue)
![설계 방향](https://img.shields.io/badge/workflow_design-Jira_optional-purple)

[English](README.md) · **한국어**

[제품 방향](#왜-pazmo인가) · [직원 구성](#직원-구성) · [현재 상태](#현재-상태) · [라이선스](#라이선스)

</div>

> **Apple Silicon Mac용 로컬 알파입니다.** 원본 Claw Tasks·Decisions와 kit 4.1.0 역할 그래프를 신뢰된 Mac controller·전용 VM으로 연결했습니다. README 파일럿은 실제 PM·팀장·Developer·Reviewer와 검사 6개를 마쳤으며 최종 사용자 G4·인도는 대기 중입니다. npm 배포와 일반 프로젝트 전체 인수 검증은 미완료입니다. [검증 기록](docs/verification/2026-09-29-native-claw-preview.md)을 확인하세요.

<p align="center">
  <img src="https://raw.githubusercontent.com/GreenSheep01201/claw-empire/5c928b24ffa55b403fe7c5521d4ac3ac49516137/Sample_Img/Office.png" alt="Claw-Empire 원본 사무실 화면. 완성된 Pazmo 기능 화면이 아닌 출처가 표시된 참고 이미지" width="100%" />
  <br /><sub>Claw-Empire 원본 화면입니다. 아직 구현하지 않은 Pazmo 기능의 증거로 사용하지 않습니다.</sub>
</p>

## 왜 Pazmo인가

AI Office는 바쁘게 움직이는 화면을 넘어, 맡긴 일을 검증 가능한 결과로 돌려줘야 합니다.

Pazmo는 [Claw-Empire](https://github.com/GreenSheep01201/claw-empire)의 사무실·작업 실행 기반에 [AI Workflow Kit](https://github.com/syjkim0125/ai-workflow-kit)의 합의서·템플릿·사람 승인·검증 원칙을 결합하는 독립 프로젝트입니다. 기존 키트는 변경하지 않습니다.

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

직원은 책임 단위이며 모두가 항상 실행되는 것은 아닙니다. 각 역할은 사용자의 공식 Codex CLI 로그인으로 실행하는 방향입니다. 구독 사용량에는 한도가 있고 API 키 과금은 별도입니다. 다른 유료 경로로 몰래 전환하지 않습니다.

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

## 현재 상태

| 항목 | 상태 |
|---|---|
| 선택한 기반 | Claw-Empire `v2.0.4` — 2026-09-17 확인 |
| 고정 commit | `5c928b24ffa55b403fe7c5521d4ac3ac49516137` |
| 새 저장소 source import | **원본 로컬 검증·게시본 자격증명 제거** — [검증 기록](docs/verification/2026-09-18-publication.md) |
| Story·Task | kit 4.1.0 역할 그래프 연결; 배정·승인은 Office가 관리 |
| Jira 없는 팀 실행 | 실제 README 작업 리뷰까지 완료; 최종 사용자 G4·인도 대기 |
| 로컬 실행기·원본 Office UI | `./office` 구현; 현재 Mac의 별도 소스 설치 시험 통과, [실행 안내](docs/LOCAL-PREVIEW.md) |
| 계약 등록·G1/G3 승인 CLI | 실제 HTTP/SQLite 시험 통과; live에서는 원본 Decisions 사용 — [검증 기록](docs/verification/2026-09-19-contract-approvals.md) |
| 실행 격리·완료 guard | 전용 VM 검사·완료 guard 구현; 호스트 직접 실행은 계속 차단 |
| npm `@pazmo/agent-office` | 예정 이름; 게시·설치 시험 전 |

지금은 실행 가능한 Pazmo npx quickstart가 없습니다. [현재 상태와 다음 단계](docs/STATUS.md), [승인된 Story](docs/understanding/pazmo-agent-office-contract.md), [구현 계획](docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md)을 확인해 주세요. [v3 핸드오프](docs/HANDOFF-v3.md)와 [반입 절차](docs/IMPORT-UPSTREAM.md)는 과거 입력 자료이며 사용자 승인 기록이 아닙니다. 실행 경계 검증 전 회사 자격증명을 연결하지 마세요.

## 기여 방법

작은 변경을 요구사항과 실제 검증에 연결해 주세요. 원본 코드·출처·라이선스를 보존하고, source import·빌드·mock·실제 Codex·브라우저·npm 설치 시험을 구분해 보고합니다. 문자열 존재를 확인하는 테스트만으로 동작을 증명하지 않습니다.

## 라이선스

**Pazmo 독자 코드·문서는 [MIT](LICENSE)**, 기존 Claw-Empire 코드에는 **Apache-2.0**이 적용됩니다. 원 저작권·NOTICE·변경 고지와 제3자 권리를 보존합니다. 원본 전체가 MIT로 바뀌었다는 의미가 아닙니다.

[범위별 라이선스](LICENSING.md) · [출처 및 제3자 고지](THIRD_PARTY_NOTICES.md)

Claw-Empire, AI Workflow Kit, Compound Engineering, Superpowers의 작업을 존중합니다. Open Office와 Pixel Agents는 문서·사용 경험의 참고 대상입니다. Pazmo는 독립 프로젝트이며 해당 프로젝트나 OpenAI의 공식 배포판이 아닙니다.
