# 채팅으로 Office에 일 맡기기 (폐기)

2026-10-30 D30으로 폐기했다. 채팅 host가 `bridge` 명령으로 Office에 요청·답·승인을 전달하던 방식과 Claw Office의 캐릭터 채팅은 legacy·Claw 엔진과 함께 지웠다. `bridge`, `contract`, `contracts`, `intake-*`, `approval-*`, `verification`, `delivery`, `deliver`, `operator-key` 명령도 없다.

지금은 사람이 Office 화면에서 일한다.

- `./office --project /절대/프로젝트/경로`로 켜고, Tasks의 [새 작업]으로 작업을 만든다.
- 질문·범위 승인(G1)·최종 승인(G4)은 Decisions나 작업 상세에서 답한다.
- 자세한 동작은 [실행 안내](LOCAL-PREVIEW.md#새-office)에 있다.

새 Office에 operator API를 붙여 채팅 조작을 다시 여는 일은 별도 G3 후보다([결정](understanding/lean-office-default-decision.md)). 이 문서의 이전 내용은 git 이력에 있다.
