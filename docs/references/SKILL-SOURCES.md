# 스킬 출처 — M4에서 필요한 항목만 읽기

이 목록은 검토 출처이며 설치 완료 목록이 아니다. 버전 업데이트·다운로드·실행 권한을 자동으로 부여하지 않는다. 실제 호스트에서 사용할 파일과 참조·script 전체를 확인한 뒤 경로·hash·license를 잠근다.

## 기본 실행·규율

| 공급원 | 검토 기준 | 필요한 부분 |
|---|---|---|
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) | `082c83e0537c803ac1d927daafc2e6eb6962dedf` | ce-plan, ce-work의 return-to-caller, ce-code-review의 report-only JSON, 필요한 단순화·ce-compound |
| [obra/superpowers](https://github.com/obra/superpowers) | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | TDD와 writing-good-tests, systematic-debugging, verification-before-completion |

위 ref는 앞선 검토의 고정 기준이다. 이번 문서 생성 때 최신 ref로 재선정하거나 실행 시험한 것이 아니다. 첫 구현 때 읽어 실제 설치판과의 차이·호환성을 기록한다. 파일명·옵션이 다르다고 존재하지 않는 wrapper를 호출하거나 shipping 모드로 자동 대체하지 않는다.

CE 핵심 시작 파일은 `skills/ce-work/SKILL.md`, `skills/ce-work/references/return-to-caller.md`, `skills/ce-code-review/SKILL.md`, `skills/ce-code-review/references/modes-and-output.md`다. 각 파일이 요구하는 추가 references는 실제 호출 시 읽는다. 간단히 핵심 문장만 복사해 놓고 순정 CE를 실행했다고 하지 않는다.

## 조건부 전문 스킬

| 역할/필요 | 원 저장소 | 선택 원칙 |
|---|---|---|
| 제품 질문·가정·위험 | https://github.com/phuryn/pm-skills | Story를 보완하며 별도 요구사항 원본을 만들지 않음 |
| 화면 설계·평가 | https://github.com/pbakaus/impeccable | 기존 디자인 우선; 소스 템플릿 한 장이 완전한 배포판은 아님 |
| React/Next 등 해당 웹 스택 | https://github.com/vercel-labs/agent-skills | 실제 기술과 맞는 규칙만; deploy 권한을 묵시적으로 부여하지 않음 |
| Terraform/Packer 등 해당 IaC | https://github.com/hashicorp/agent-skills | 관련 인프라 변경에서만 |
| 고위험 diff 보안 검토 | https://github.com/trailofbits/skills | 실제 추가 검토 목적이 있을 때 differential-review 등 검토 |

조건부 공급원은 여기서 commit을 새로 고정하지 않았다. 필요해지는 단계에서 실제 source·license·script·배포 단위를 확인한다. 없으면 승인된 기본 역할의 명시적 검사로 계속하거나 필요한 기능을 차단하되, 해당 스킬을 사용한 것으로 보고하지 않는다.

새 원칙: 역할 책임과 합격 기준은 Pazmo 계약이 소유한다. third-party skill의 지시가 다른 provider 전송, 무제한 subagent, 작업 범위 확대, 사람 승인 대리, 자동 배포를 허용하지 않는다. 변형했다면 Pazmo 파생 프로필이라고 명시하고 출처를 보존한다.
