#!/usr/bin/env bash
# QA checks for docs/stories/board-header-hierarchy.md (the script scenarios: Q1, Q2, Q3, Q5, Q6).
# Run from the repository root against a Hub serving a COPY of the check Hub's data (docs/qa.md):
#   BASE_URL=https://127.0.0.1:<port> PL_COOKIE=<session> NOREPO_COOKIE=<session> bash qa/board-header-hierarchy.sh
# PL_COOKIE: a member who owns every repo of project PROJECT (default the copy's realcheck); NOREPO_COOKIE: a member
# who owns no repo. Both are `pazmo_hub` sessions made on the copy (HubStore.createInvite/createDeviceInvite +
# acceptInvite). OTHER is a second project's id (the copy's test 11111). Prints PASS/FAIL per scenario id; exits 1 when
# any check fails.
set -u
BASE_URL="${BASE_URL:?set BASE_URL, e.g. BASE_URL=https://127.0.0.1:18611}"
PL_COOKIE="${PL_COOKIE:?set PL_COOKIE}"
NOREPO_COOKIE="${NOREPO_COOKIE:?set NOREPO_COOKIE}"
PROJECT="${PROJECT:-1dafb04f-d6dc-4766-ab83-7d8010036879}"
PROJECT_NAME="${PROJECT_NAME:-realcheck}"
OTHER="${OTHER:-022e75f3-f944-44fe-a0e6-16c035929596}"
failed=0

fetch() { curl -sSk --max-time 15 -b "pazmo_hub=$2" -w '\n%{http_code}' "$BASE_URL$1"; }

# expect <id> <path> <cookie> <status> <text that must appear>
expect() {
  local out code body
  out=$(fetch "$2" "$3") || { echo "FAIL $1 $2: request failed"; failed=1; return; }
  code=${out##*$'\n'}; body=${out%$'\n'*}
  if [ "$code" != "$4" ]; then echo "FAIL $1 $2: status $code, expected $4"; failed=1
  elif ! grep -qF -- "$5" <<<"$body"; then echo "FAIL $1 $2: missing \"$5\""; failed=1
  else echo "PASS $1 $2: $(grep -oF -- "$5" <<<"$body" | head -1)"; fi
}

# reject <id> <path> <cookie> <status> <text that must not appear>
reject() {
  local out code body
  out=$(fetch "$2" "$3") || { echo "FAIL $1 $2: request failed"; failed=1; return; }
  code=${out##*$'\n'}; body=${out%$'\n'*}
  if [ "$code" != "$4" ]; then echo "FAIL $1 $2: status $code, expected $4"; failed=1
  elif grep -qF -- "$5" <<<"$body"; then echo "FAIL $1 $2: shows \"$5\""; failed=1
  else echo "PASS $1 $2: no \"$5\""; fi
}

for board in / /tasks; do
  # Q1: both actions are filled primary buttons (with the + mark), not ghost buttons.
  expect Q1 "$board" "$PL_COOKIE" 200 '<a class="btn add" href="/projects/new">새 프로젝트</a>'
  expect Q1 "$board" "$PL_COOKIE" 200 "<a class=\"btn add\" href=\"/projects/$PROJECT/new-story\">새 Story</a>"
  reject Q1 "$board" "$PL_COOKIE" 200 '<a class="btn ghost" href="/projects/new">'
  reject Q1 "$board" "$PL_COOKIE" 200 "<a class=\"btn ghost\" href=\"/projects/$PROJECT/new-story\">"
  # Q2: the project's name has a 프로젝트 label right above it.
  expect Q2 "$board" "$PL_COOKIE" 200 "<p class=\"kind\">프로젝트</p><div class=\"row\"><h2>$PROJECT_NAME</h2>"
  # Q3: the view tabs and 새 프로젝트 share the top line; the 프로젝트 chips and the toggles come after it.
  expect Q3 "$board" "$PL_COOKIE" 200 '</nav><a class="btn add" href="/projects/new">새 프로젝트</a></div><div class="toggles"><div class="chiprow"><span class="flabel" aria-hidden="true">프로젝트</span><nav class="chips" aria-label="프로젝트">'
done
expect Q3 "/" "$PL_COOKIE" 200 '<div class="viewbar"><h1>Story 보드</h1><nav class="tabs" aria-label="보드 보기">'
expect Q3 "/tasks" "$PL_COOKIE" 200 '<div class="viewbar"><h1>모든 Task</h1><nav class="tabs" aria-label="보드 보기">'

# Q5 (Unchanged): the tabs keep the filters, 전체 keeps 내 Story만, and 확인할 것 is still there.
q5="/?mine=1&project=$OTHER"
expect Q5 "$q5" "$PL_COOKIE" 200 "<nav class=\"tabs\" aria-label=\"보드 보기\"><a href=\"/?mine=1&project=$OTHER\" aria-current=\"page\">Story 보드</a><a href=\"/tasks?mine=1&project=$OTHER\">모든 Task</a></nav>"
expect Q5 "$q5" "$PL_COOKIE" 200 '<a href="/?mine=1">전체 <span class="count">'
expect Q5 "$q5" "$PL_COOKIE" 200 '<h2 id="needs">확인할 것 <span class="count">'

# Q6 (not shown): a member who owns no repo gets no 새 Story; 새 프로젝트 stays (a Hub with web plans).
reject Q6 "/" "$NOREPO_COOKIE" 200 '/new-story">'
expect Q6 "/" "$NOREPO_COOKIE" 200 'href="/projects/new">새 프로젝트</a>'

exit $failed
