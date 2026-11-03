# U30 replan · workflow-review (round 3) — pass, one record sentence to correct after delivery

Reviewer (tests/migration/docs lens) on 25d3df7 (delta 23d554d..25d3df7): the code passes (Office's Node first on PATH; GIT_DIR still blocks git in kit folders; PM/Lead runs neither snapshot nor run checks). Decision and plan text match the code.

One overclaim remains in two records (no code or behavior):
- docs/verification/2026-11-03-kit5-upgrade.md says "Important 4건은 모두 고쳤다(리뷰 2차에서 같은 리뷰어들이 Fixed로 확인)".
- docs/STATUS.md says the round-1 Important 4 and Minor items were fixed.
The round-2 reviews marked three Important findings Fixed and one Partly (KIT_UPGRADE_REQUIRED: not stored when there is no round; a kit 4 round awaiting G4 without a receipt keeps refusing G4). The remaining part is listed under the accepted items. Correct wording: "Important 3건 Fixed, 1건 Partly(남은 부분은 받아들인 것에 적음)".

This is the review node's third and last attempt, and editing tracked docs now would make the review stale. The sentence is corrected in the post-delivery records commit, together with the kit outputs, and the user is told before G4.
The "reviewer reproduced the ceiling-only bypass" claim is from the isolation reviewer (rounds 1 and 2: case-variant ceiling and a ':' path both let rev-parse find the parent repo; with GIT_DIR all three git calls exit 128).
