# Proposed implementation plan

Request: 35cf74d7-8dc2-4700-a8b8-48601759d882
Input digest: fa17c17db9cc47900987b2919ab4b8c6acfd13a0501bce138eece9ec6a71df5e

읽기 전용 snapshot에서 README_ko.md와 docs/LOCAL-PREVIEW.md를 확인했으며, 구현 제안은 README_ko.md에 짧은 인증 경계 문단과 LOCAL-PREVIEW 링크만 추가하고 파일 변경 여부와 표현의 과장 여부는 Office baseline diff와 Reviewer 의미 검토로 확인하는 범위다.

This is a model proposal. No repository inspection or approval is established by this document.

## Controller review before G1

Source: docs/verification/2026-09-22-live-planning.json, second actual PM/Lead run. The source proposal remains unchanged in that receipt. This review changes verification HOW only; the PM Story remains a draft. Parent scope: docs/understanding/pazmo-agent-office-contract.md, M2/M3/M5 and V2/V3/V5.

The generated JavaScript regexes contained overescaped metacharacters, and its forbidden-word approach could reject correct negative warnings. Use bounded Node checks for file inventory, unchanged LOCAL-PREVIEW hash, relevant terminology, the existing preview warning and the requested documentation link. Reviewer must independently inspect the exact baseline diff for semantic accuracy, short Korean wording, absence of overclaims and README-only modification. Keyword checks alone do not prove these requirements.

Engineer may edit only README_ko.md. docs/LOCAL-PREVIEW.md is context and must remain byte-identical; its digest is checked. Do not change registered verification documents or manufacture approvals. Add the link to docs/LOCAL-PREVIEW.md#planning-conversation-screen in the new authentication explanation.

Office uses its existing Engineer → same-candidate tests/Reviewer → up to two fixes → G4 flow. Genuine findings trigger fixes; a forced defect or scripted review is not acceptable evidence. If the first candidate passes, report honestly that feedback/fix proof remains outstanding.

The controller uses the previously approved login/VM boundary. This pilot's G1 and G4 must come from the actual user. Do not infer them from this file or a successful model run. Delivery creates an inspectable local artifact and does not merge main.
