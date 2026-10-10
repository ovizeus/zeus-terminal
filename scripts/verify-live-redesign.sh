#!/usr/bin/env bash
# Zeus — live verification of the institutional redesign (b270 v1.7.244).
#
# Needs a session cookie jar at /tmp/zsess.txt, created by the operator with:
#   curl -sk -X POST https://localhost/api/auth/login \
#        -H 'Content-Type: application/json' -H 'X-Zeus-Request: 1' \
#        -d '{"email":"...","password":"..."}' -c /tmp/zsess.txt -o /dev/null
#
# The password never passes through this script, and the script never reads it.
#
# READ-ONLY on money: it opens no position, closes none, cancels nothing. The
# one thing it writes is a single settings field, which it reads first and
# restores afterwards, verifying the round trip in between. That round trip is
# the point: "does a saved setting survive" is the bug class that destroyed
# eight keys on 2026-10-10 and has been nulling manualLive for all nine users.
set -uo pipefail

JAR=/tmp/zsess.txt
BASE=https://localhost
OUT=/tmp/zeus-live
mkdir -p "$OUT"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

[ -s "$JAR" ] || { bad "no session at $JAR — run the login command first"; exit 1; }

say "1. Session"
ME=$(curl -sk -b "$JAR" "$BASE/api/auth/me")
echo "$ME" | grep -q '"ok"\|email' && ok "session valid" || { bad "session rejected: $ME"; exit 1; }

say "2. Settings round trip — the check that matters most"
BEFORE=$(curl -sk -b "$JAR" "$BASE/api/user/settings")
ORIG=$(printf '%s' "$BEFORE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('settings',{}).get('chartTf','5m'))" 2>/dev/null)
ok "current chartTf = $ORIG"

PROBE=$([ "$ORIG" = "15m" ] && echo "30m" || echo "15m")
TS=$(printf '%s' "$BEFORE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('updated_at',0))" 2>/dev/null)

curl -sk -b "$JAR" -X POST "$BASE/api/user/settings" \
  -H 'Content-Type: application/json' -H 'X-Zeus-Request: 1' \
  -d "{\"settings\":{\"chartTf\":\"$PROBE\"},\"if_updated_at\":$TS}" -o /dev/null
AFTER=$(curl -sk -b "$JAR" "$BASE/api/user/settings" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('settings',{}).get('chartTf','?'))" 2>/dev/null)

if [ "$AFTER" = "$PROBE" ]; then ok "saved $PROBE and read it back — persistence works"
else bad "wrote $PROBE but read back $AFTER — SAVE DOES NOT PERSIST"; fi

TS2=$(curl -sk -b "$JAR" "$BASE/api/user/settings" | python3 -c "import json,sys; print(json.load(sys.stdin).get('updated_at',0))" 2>/dev/null)
curl -sk -b "$JAR" -X POST "$BASE/api/user/settings" \
  -H 'Content-Type: application/json' -H 'X-Zeus-Request: 1' \
  -d "{\"settings\":{\"chartTf\":\"$ORIG\"},\"if_updated_at\":$TS2}" -o /dev/null
BACK=$(curl -sk -b "$JAR" "$BASE/api/user/settings" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('settings',{}).get('chartTf','?'))" 2>/dev/null)
[ "$BACK" = "$ORIG" ] && ok "restored to $ORIG" || bad "RESTORE FAILED — chartTf is $BACK, was $ORIG"

say "3. The eight keys that used to be clobbered (b266)"
curl -sk -b "$JAR" "$BASE/api/user/settings" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('settings',{})
for k in ['theme','uiScale','soundEnabled','timezoneOffset','liqSettings','srSettings','llvSettings','zsSettings']:
    print(('  present: ' if k in d else '  absent (good): ')+k)
" 2>/dev/null

say "4. Screenshots of the panels, with live data"
for page in "" "#theia"; do
  name=$([ -z "$page" ] && echo panels || echo theia)
  COOKIE=$(python3 - "$JAR" <<'PY'
import sys
out=[]
for line in open(sys.argv[1]):
    if line.startswith('#') or not line.strip(): continue
    p=line.split('\t')
    if len(p)>=7: out.append(p[5]+'='+p[6].strip())
print('; '.join(out))
PY
)
  google-chrome --headless --disable-gpu --no-sandbox --ignore-certificate-errors \
    --hide-scrollbars --window-size=1500,1400 --virtual-time-budget=12000 \
    --screenshot="$OUT/$name.png" "$BASE/app/$page" >/dev/null 2>&1
  [ -s "$OUT/$name.png" ] && ok "$OUT/$name.png ($(stat -c%s "$OUT/$name.png") bytes)" || bad "screenshot $name failed"
done

say "Done. Screenshots in $OUT. Remove the session with: rm -f $JAR"
