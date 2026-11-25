#!/usr/bin/env bash
# QA checks for docs/stories/hub-email-password-login.md (the script scenarios: Q1–Q10, Q12).
# Run from the repository root, Node 24 first on PATH, against two local Hubs (docs/qa.md):
#   BASE_URL=https://127.0.0.1:<port> ADMIN_INVITE=<adminInvite from that Hub's start output> DATA_DIR=<its --data-dir> \
#   COPY_URL=https://127.0.0.1:<port2> LEGACY_COOKIE=<session> bash qa/hub-email-password-login.sh
# BASE_URL is a Hub started on an EMPTY data folder (DATA_DIR) and not used yet. COPY_URL serves a VACUUM INTO copy of
# the check Hub; LEGACY_COOKIE is a `pazmo_hub` session made on the copy for its admin (who owns repos and has no
# password yet) with HubStore.createDeviceInvite + acceptInvite. The script changes both Hubs, so each run needs fresh ones.
# Prints PASS/FAIL per scenario id; exits 1 when any check fails.
set -u
BASE_URL="${BASE_URL:?set BASE_URL, e.g. BASE_URL=https://127.0.0.1:18621}"
ADMIN_INVITE="${ADMIN_INVITE:?set ADMIN_INVITE to the adminInvite of the empty Hub}"
DATA_DIR="${DATA_DIR:?set DATA_DIR to the --data-dir of the empty Hub}"
COPY_URL="${COPY_URL:?set COPY_URL}"
LEGACY_COOKIE="${LEGACY_COOKIE:?set LEGACY_COOKIE}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
failed=0
CODE=""

# req <base> <jar|-> <METHOD> <path> [curl data args...]: body in $T/body, headers in $T/hdr, status in $CODE.
req() {
  local base=$1 jar=$2 method=$3 path=$4
  shift 4
  local args=(-sSk --max-time 20 -o "$T/body" -D "$T/hdr" -w '%{http_code}' -X "$method" -H "Origin: $base")
  [ "$jar" != "-" ] && args+=(-b "$T/$jar" -c "$T/$jar")
  CODE=$(curl "${args[@]}" "$@" "$base$path") || CODE="ERR"
}
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; failed=1; }
# check <id> <what> <expected status> [text that must appear] — against the last req.
check() {
  if [ "$CODE" != "$3" ]; then fail "$1" "$2: status $CODE, expected $3"; return; fi
  if [ $# -ge 4 ] && ! grep -qF -- "$4" "$T/body"; then fail "$1" "$2: missing \"$4\""; return; fi
  local seen="${4-}"
  pass "$1" "$2 [$CODE] $seen"
}
# lacks <id> <what> <text that must not appear in the last body>
lacks() { if grep -qF -- "$3" "$T/body"; then fail "$1" "$2: shows \"$3\""; else pass "$1" "$2: no \"$3\""; fi; }
cookie_set() { grep -qi '^set-cookie: pazmo_hub=[A-Za-z0-9_-]' "$T/hdr"; }
sets_cookie() { if cookie_set; then pass "$1" "$2 sets pazmo_hub"; else fail "$1" "$2: no pazmo_hub cookie"; fi; }
no_cookie() { if cookie_set; then fail "$1" "$2: set a pazmo_hub cookie"; else pass "$1" "$2: no pazmo_hub cookie"; fi; }
csrf() { grep -o 'name="csrf" value="[^"]*"' "$T/body" | head -1 | sed 's/.*value="//;s/"$//'; }
invite_path() { grep -o '/invite/[A-Za-z0-9_-]\{43\}' "$T/body" | head -1; }
# id_near <email> <route regex with (ID)>: the first id in the member row (or page) that shows the email.
id_near() {
  python3 -c '
import re, sys
html = open(sys.argv[1]).read(); email, route = sys.argv[2], sys.argv[3]
parts = html.split("<li") if email else [html]
for p in parts:
    if not email or email in p:
        m = re.search(route, p)
        if m: print(m.group(1)); break
' "$T/body" "$1" "$2"
}
json_field() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$T/body" "$1" 2>/dev/null; }
login() { req "$BASE_URL" "$1" POST /login --data-urlencode "email=$2" --data-urlencode "password=$3"; }
GENERIC="메일 또는 비밀번호가 맞지 않습니다."
ID='([0-9a-f-]{36})'

# Q1 [M1] the first admin link asks for a mail and a password, and entering signs the admin in.
req "$BASE_URL" - GET "${ADMIN_INVITE#"$BASE_URL"}"
check Q1 "first admin link" 200 'name="email"'
check Q1 "first admin link" 200 "비밀번호 확인"
req "$BASE_URL" admin POST "${ADMIN_INVITE#"$BASE_URL"}" --data-urlencode "email=admin@example.com" --data-urlencode "password=AdminPass123" --data-urlencode "password2=AdminPass123" --data-urlencode "label=QA admin"
check Q1 "enter as first admin" 303
sets_cookie Q1 "enter as first admin"
req "$BASE_URL" admin GET /members
check Q1 "admin opens /members" 200 "admin@example.com"

# Q2 [M2, M7] an invite carries the mail the admin wrote; the member sets a password; the mail is listed; a taken mail is refused.
C=$(csrf)
req "$BASE_URL" admin POST /invites --data-urlencode "name=QA 팀원" --data-urlencode "email=qa.member@example.com" --data-urlencode "csrf=$C"
check Q2 "invite with mail" 200 "/invite/"
INV=$(invite_path)
req "$BASE_URL" - GET "$INV"
check Q2 "invite page shows the mail" 200 "qa.member@example.com"
req "$BASE_URL" m1 POST "$INV" --data-urlencode "password=MemberPass1" --data-urlencode "password2=MemberPass1"
check Q2 "accept invite" 303
sets_cookie Q2 "accept invite"
req "$BASE_URL" admin GET /members
check Q2 "members page lists the mail" 200 "qa.member@example.com"
C=$(csrf)
req "$BASE_URL" admin POST /invites --data-urlencode "name=다른 사람" --data-urlencode "email=QA.member@example.com" --data-urlencode "csrf=$C"
check Q2 "same mail again" 409 "이미 다른 팀원이 쓰는 메일입니다"

# Q3 [M3] a signed-out browser sees the form; the right mail (any case, spaces) and password sign in.
req "$BASE_URL" - GET /
check Q3 "signed-out page" 401 'name="email"'
check Q3 "signed-out page" 401 'name="password"'
login m2 " QA.Member@Example.com " MemberPass1
check Q3 "login" 303
sets_cookie Q3 "login"
req "$BASE_URL" m2 GET /
check Q3 "signed in" 200

# Q4 [not shown] a wrong password, an unknown mail and an empty password all get the same answer and no session.
login - qa.member@example.com WrongPass99
check Q4 "wrong password" 401 "$GENERIC"
no_cookie Q4 "wrong password"
login - nobody@example.com WhateverPass1
check Q4 "unknown mail" 401 "$GENERIC"
no_cookie Q4 "unknown mail"
login - qa.member@example.com ""
check Q4 "empty password" 401 "$GENERIC"
no_cookie Q4 "empty password"

# Q5 [M3] five wrong tries for one mail hold back even the right password.
req "$BASE_URL" admin GET /members
C=$(csrf)
req "$BASE_URL" admin POST /invites --data-urlencode "name=QA 둘째" --data-urlencode "email=qa.second@example.com" --data-urlencode "csrf=$C"
INV2=$(invite_path)
req "$BASE_URL" - POST "$INV2" --data-urlencode "password=SecondPass1" --data-urlencode "password2=SecondPass1"
check Q5 "second member joins" 303
req "$BASE_URL" admin GET /members
C=$(csrf)
req "$BASE_URL" admin POST /invites --data-urlencode "name=QA 셋째" --data-urlencode "email=qa.third@example.com" --data-urlencode "csrf=$C"
INV3=$(invite_path)
req "$BASE_URL" - POST "$INV3" --data-urlencode "password=ThirdPass12" --data-urlencode "password2=ThirdPass12"
for i in 1 2 3 4 5; do login - qa.third@example.com "Wrong$i-pass"; done
check Q5 "fifth wrong try" 401 "$GENERIC"
login - qa.third@example.com ThirdPass12
check Q5 "right password after five wrong" 429 "잠시 뒤에 다시 시도해주세요"
no_cookie Q5 "right password after five wrong"

# Q6 [M4] the admin's reset link sets a new password; the old one stops working and the member's other browsers end.
req "$BASE_URL" admin GET /members
check Q6 "members page has the reset button" 200 "비밀번호 재설정 링크"
lacks Q6 "members page" "새 기기 링크"
C=$(csrf)
MID=$(id_near qa.member@example.com "/members/$ID/password-reset")
req "$BASE_URL" admin POST "/members/$MID/password-reset" --data-urlencode "csrf=$C"
check Q6 "reset link" 200 "/invite/"
RST=$(invite_path)
req "$BASE_URL" m3 POST "$RST" --data-urlencode "password=NewMember12" --data-urlencode "password2=NewMember12"
check Q6 "set new password" 303
sets_cookie Q6 "set new password"
login - qa.member@example.com MemberPass1
check Q6 "old password" 401 "$GENERIC"
login m4 qa.member@example.com NewMember12
check Q6 "new password" 303
req "$BASE_URL" m1 GET /
check Q6 "browser from the invite" 401
req "$BASE_URL" m2 GET /
check Q6 "browser from the login" 401
req "$BASE_URL" m3 GET /
check Q6 "browser that set the password" 200

# Q7 [M5] recover-admin prints an admin reset link while the Hub runs; with no members it points to the first admin link.
OUT=$(node bin/pazmo-office.mjs hub recover-admin --data-dir "$DATA_DIR" --url "$BASE_URL" 2>&1)
if grep -qF '"adminReset"' <<<"$OUT" && grep -qF "/invite/" <<<"$OUT"; then pass Q7 "recover-admin prints adminReset"; else fail Q7 "recover-admin: $OUT"; fi
REC=$(grep -o '/invite/[A-Za-z0-9_-]\{43\}' <<<"$OUT" | head -1)
req "$BASE_URL" admin2 POST "$REC" --data-urlencode "password=AdminPass456" --data-urlencode "password2=AdminPass456"
check Q7 "set admin password from the recovery link" 303
req "$BASE_URL" admin2 GET /members
check Q7 "admin back in" 200 "팀원"
EMPTY="$T/empty-hub"
mkdir -p "$EMPTY"
OUT=$(node bin/pazmo-office.mjs hub recover-admin --data-dir "$EMPTY" 2>&1)
RC=$?
if [ "$RC" = 1 ] && grep -qF "첫 관리자 링크" <<<"$OUT"; then pass Q7 "no members: exit 1, 첫 관리자 링크"; else fail Q7 "no members: exit $RC, $OUT"; fi

# Q10 [M8] logging out ends only this browser.
login s1 qa.second@example.com SecondPass1
login s2 qa.second@example.com SecondPass1
req "$BASE_URL" s1 GET /
C=$(csrf)
req "$BASE_URL" s1 POST /logout --data-urlencode "csrf=$C"
check Q10 "logout" 303
req "$BASE_URL" s1 GET /
check Q10 "logged-out browser" 401
req "$BASE_URL" s2 GET /
check Q10 "other browser" 200

# Q12 [M9] my sign-ins: list, end one other browser, never another member's, end all others.
login sb qa.second@example.com SecondPass1
req "$BASE_URL" s2 GET /account
check Q12 "account page" 200 "qa.second@example.com"
check Q12 "account page" 200 "이 브라우저"
check Q12 "account page" 200 "다른 브라우저 모두 로그아웃"
C=$(csrf)
BID=$(id_near "" "/account/devices/$ID/logout")
req "$BASE_URL" s2 POST "/account/devices/$BID/logout" --data-urlencode "csrf=$C"
check Q12 "log out the other browser" 303
req "$BASE_URL" sb GET /
check Q12 "that browser" 401
req "$BASE_URL" s2 GET /
check Q12 "this browser" 200
req "$BASE_URL" admin2 GET /members
AID=$(id_near admin@example.com "/devices/$ID/revoke")
req "$BASE_URL" s2 GET /account
C=$(csrf)
req "$BASE_URL" s2 POST "/account/devices/$AID/logout" --data-urlencode "csrf=$C"
check Q12 "another member's browser" 404
req "$BASE_URL" admin2 GET /members
check Q12 "admin still in" 200
login sc qa.second@example.com SecondPass1
login sd qa.second@example.com SecondPass1
req "$BASE_URL" s2 GET /account
C=$(csrf)
req "$BASE_URL" s2 POST /account/logout-others --data-urlencode "csrf=$C"
check Q12 "log out all other browsers" 303
req "$BASE_URL" sc GET /
check Q12 "other browser 1" 401
req "$BASE_URL" sd GET /
check Q12 "other browser 2" 401
req "$BASE_URL" s2 GET /
check Q12 "this browser" 200

# Q8 [M6] on the copy, a member without a password must set mail and password first.
printf '%s\tFALSE\t/\tTRUE\t0\tpazmo_hub\t%s\n' "${COPY_URL#https://}" "$LEGACY_COOKIE" | sed 's/:[0-9]*\t/\t/' >"$T/legacy"
req "$COPY_URL" legacy GET /
check Q8 "legacy member opens the board" 200 "메일과 비밀번호를 정해주세요"
C=$(csrf)
req "$COPY_URL" legacy POST /account/setup --data-urlencode "email=legacy.admin@example.com" --data-urlencode "password=LegacyPass1" --data-urlencode "password2=LegacyPass1" --data-urlencode "csrf=$C"
check Q8 "set mail and password" 303
req "$COPY_URL" legacy GET /
check Q8 "board after setup" 200
lacks Q8 "board after setup" "메일과 비밀번호를 정해주세요"

# Q9 [Unchanged] Mac and Office tokens are Bearer tokens and live through a password reset.
curl -sSk --max-time 20 -o "$T/body" -H "X-Pazmo-Hub-Protocol: 4" -H "Content-Type: application/json" -d '{"name":"QA Mac"}' "$COPY_URL/api/mac/start"
DEV=$(json_field deviceCode)
USR=$(json_field userCode)
req "$COPY_URL" legacy GET "/mac/approve?code=$USR"
C=$(csrf)
req "$COPY_URL" legacy POST /mac/approve --data-urlencode "code=$USR" --data-urlencode "csrf=$C"
check Q9 "approve the Mac" 303
curl -sSk --max-time 20 -o "$T/body" -H "X-Pazmo-Hub-Protocol: 4" -H "Content-Type: application/json" -d "{\"deviceCode\":\"$DEV\"}" "$COPY_URL/api/mac/token"
MAC=$(json_field macToken)
# The Mac API speaks protocol 4, the Office link API protocol 2 (src/hub/protocol.ts).
bearer() { local p=2; case $1 in /api/mac/*) p=4 ;; esac
  CODE=$(curl -sSk --max-time 20 -o "$T/body" -w '%{http_code}' -H "X-Pazmo-Hub-Protocol: $p" -H "Authorization: Bearer $2" ${3:+-H "Content-Type: application/json" -d "$3"} "$COPY_URL$1") || CODE=ERR; }
bearer /api/mac/repos "$MAC"
check Q9 "Mac Bearer /api/mac/repos" 200 '"repos"'
REPO=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["repos"][0]["repoId"])' "$T/body" 2>/dev/null)
CODE=$(curl -sSk --max-time 20 -o "$T/body" -w '%{http_code}' -H "X-Pazmo-Hub-Protocol: 4" "$COPY_URL/api/mac/repos") || CODE=ERR
check Q9 "no Bearer" 401
bearer /api/mac/link "$MAC" "{\"repoId\":\"$REPO\"}"
LINK=$(json_field token)
bearer /api/link/repos "$LINK"
check Q9 "Office link Bearer /api/link/repos" 200
req "$COPY_URL" legacy GET /members
C=$(csrf)
SELF=$(id_near legacy.admin@example.com "/members/$ID/password-reset")
req "$COPY_URL" legacy POST "/members/$SELF/password-reset" --data-urlencode "csrf=$C"
RST=$(invite_path)
req "$COPY_URL" legacy2 POST "$RST" --data-urlencode "password=LegacyPass2" --data-urlencode "password2=LegacyPass2"
check Q9 "reset the member's password" 303
bearer /api/mac/repos "$MAC"
check Q9 "Mac Bearer after reset" 200 '"repos"'
bearer /api/link/repos "$LINK"
check Q9 "Office link Bearer after reset" 200

exit $failed
