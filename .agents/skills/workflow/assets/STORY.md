# Story: <observable outcome>
Status: Draft
Owner: <human owner>
Understanding gate (G1): <pending>
Understanding gate (G4): <pending>

## Goal
<In a few plain-language sentences: what goes wrong today, what the person can do after the change, what must remain safe, and how we will check it. Put technical detail below; label assumptions.>

## Domain
- Terms: <term = meaning>
- Invariant: <must always / never happen>

## MUST
- M1. <observable success behavior>
- M2. <observable failure/negative behavior>

## SHOULD
- S1. <useful, non-blocking behavior>

## OUT
- O1. <explicit exclusion>

## Decisions
- D1. <human decision or ASSUMED: safe default>
- OPEN BLOCKING: <remove before approval, or omit>

## Verify
- V1 [M1]. <input/action → observable result>
- V2 [M2]. <failure/retry → state remains valid>
