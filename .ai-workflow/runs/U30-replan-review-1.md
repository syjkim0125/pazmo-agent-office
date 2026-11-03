# U30 replan · workflow-review (round 1) — needs changes

Three independent report-only reviewers on bf3f31c..df48a79 (correctness/resume, isolation/integrity, tests/migration/docs). No Critical.

Important:
1. Git barrier bypass: GIT_CEILING_DIRECTORIES is compared against getcwd's on-disk case; a case-variant project path or a ':' in it lets kit snapshot the person's checkout (reviewer reproduced). Fix: also pass GIT_DIR to a nonexistent path so every git call fails and kit uses the declared inputs.
2. Two registered checks for the same V (allowed by contracts.ts) give duplicate profile ids; kit rejects the profile and the kit 5 run fails (kit 4 accepted it). Fix: unique profile check ids per registered check, keyed observations and relay by that id.
3. KIT_UPGRADE_REQUIRED is lost: beginEngineer throws after handoffs.prepare reserves a lease, so the next run reports PROCESS_LIVENESS_UNKNOWN; a round in checking stores DISPATCH_FAILED. Fix: detect kit 4 before prepare and store the code as the round reason; test the second run.
4. The executed() skip after a partial verify is unreachable (verify changes the revision token, so continuation() finds no dispatch receipt) and untested. Fix: remove it; a partial verify fails closed for a person.

Minor: relay code not a snapshot input; candidate.json not written atomically; CLI timeout 15 s < check timeout 20 s; PATH puts Node's bin before /usr/bin (could shadow git); completionProof reads a receipt before validating its path and misses history result.executions; plan doc stale in five places; STATUS claims verify records before they exist; THIRD_PARTY_NOTICES says hashes are checked before each kit command (only graph.mjs calls); typecheck's covers is nominal; relay negative cases (pass + timedOut/signal/error) untested; Office upgrades that change the relay stop in-flight kit 5 tasks (KIT_SOURCE_CHANGED).
