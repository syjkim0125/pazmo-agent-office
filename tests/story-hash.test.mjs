import assert from "node:assert/strict";
import test from "node:test";
import { hashStory } from "../src/core/story-hash.ts";

const STORY = `# Story: Validate input\nStatus: Draft\nOwner: Human\n\n## Goal\nReject invalid input.\n## Domain\nPreserve existing records.\n## MUST\n- M1. Reject invalid input.\n## SHOULD\n- S1. Explain errors.\n## OUT\n- O1. Deployment.\n## Decisions\n- D1. Local only.\n## Verify\n- V1 [M1]. Check invalid input.\n`;
/** The value the removed workflow runtime's `storyContract(STORY).fingerprint` gave (commit f3d975d): Stories already
 * uploaded to a Hub are keyed `upload:<hash>`, so the hash may never change. */
const EXPECTED = "5858498905450b3a6c51a6591a5b09d298e876c8a152d10106e671b88bba5158";

test("hashStory gives the same hash as before for a fixed Story, ignoring its Status, gate and G4 lines and CRLF", () => {
  assert.equal(hashStory(STORY), EXPECTED);
  const approved = STORY.replace(
    "Status: Draft",
    "Status: Approved\nUnderstanding gate (G1): g1.json · 2026-11-03 · Check-in: accepted\nG4: accepted",
  );
  assert.equal(hashStory(approved), EXPECTED);
  assert.equal(hashStory(STORY.replace(/\n/g, "\r\n")), EXPECTED);
  assert.notEqual(hashStory(STORY.replace("M1. Reject", "M1. Accept")), EXPECTED);
});
