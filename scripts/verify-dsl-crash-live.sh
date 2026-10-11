#!/usr/bin/env bash
# Zeus — live end-to-end check of the DSL Drive crash fix (b271 v1.7.245).
#
# Needs a session cookie jar at /tmp/zsess.txt, created by the OPERATOR:
#   curl -sk -X POST https://localhost/api/auth/login \
#        -H 'Content-Type: application/json' -H 'X-Zeus-Request: 1' \
#        -d '{"email":"...","password":"..."}' -c /tmp/zsess.txt -o /dev/null
#
# The password never passes through this script and the script never reads it.
#
# DEMO ONLY. It opens ONE demo position deliberately WITHOUT a stop loss —
# which is the exact shape that crashed the panel, and the shape 303 of 3367
# stored positions have — then reads it back, screenshots the live app, and
# CLOSES the position it opened. It touches nothing it did not create, and it
# never places a real-money order: mode is hardcoded to demo below.
set -uo pipefail

JAR=/tmp/zsess.txt
BASE=https://localhost
OUT=/tmp/zeus-dsl-live
mkdir -p "$OUT"
SYM=${SYM:-XRPUSDT}

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

[ -s "$JAR" ] || { bad "no session at $JAR — run the login command first"; exit 1; }

say "1. Session"
curl -sk -b "$JAR" "$BASE/api/auth/me" | grep -q 'email\|"ok"' \
  && ok "session valid" || { bad "session rejected"; exit 1; }

say "2. Price for $SYM"
PX=$(curl -sk -b "$JAR" "$BASE/api/market/markprice?symbols=$SYM" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print((d[0] if isinstance(d,list) else list(d.values())[0]).get('markPrice') or (d[0] if isinstance(d,list) else list(d.values())[0]).get('price'))" 2>/dev/null)
[ -n "$PX" ] && ok "mark price $PX" || { bad "no price"; exit 1; }

say "3. Open ONE demo position with NO stop loss (the crash shape)"
# sl and tp deliberately omitted -> server stores sl: null (server.js:759)
OPENED=$(curl -sk -b "$JAR" -X POST "$BASE/api/at/register-manual" \
  -H 'Content-Type: application/json' -H 'X-Zeus-Request: 1' \
  -d "{\"symbol\":\"$SYM\",\"side\":\"LONG\",\"entryPrice\":$PX,\"qty\":1,\"leverage\":1,\"mode\":\"demo\",\"source\":\"manual\"}")
echo "    $OPENED"
SEQ=$(printf '%s' "$OPENED" | python3 -c "
import json,sys
d=json.load(sys.stdin)
p=d.get('position') or d.get('pos') or d
print(p.get('seq') or d.get('seq') or '')" 2>/dev/null)
[ -n "$SEQ" ] && ok "opened demo position seq=$SEQ" || { bad "could not open (see response above)"; exit 1; }

cleanup() {
  say "6. Closing the position this script opened"
  R=$(curl -sk -b "$JAR" -X POST "$BASE/api/at/close" \
    -H 'Content-Type: application/json' -H 'X-Zeus-Request: 1' -d "{\"seq\":$SEQ}")
  echo "    $R"
  printf '%s' "$R" | grep -q '"ok":true\|closed' && ok "closed seq=$SEQ" || bad "CLOSE FAILED — close seq=$SEQ by hand"
}
trap cleanup EXIT

say "4. Read it back through the panel's own endpoint"
curl -sk -b "$JAR" "$BASE/api/dsldrive/state" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for p in d.get('positions',[]):
    if str(p.get('seq'))=='$SEQ':
        print('    seq',p['seq'],p['symbol'],p['side'])
        print('    entry =',repr(p.get('entry')),' sl =',repr(p.get('sl')),'  <-- null is the crash shape')
        break
else:
    print('    position not in dsldrive state (DSL may not track it yet)')
" 2>/dev/null

say "5. Screenshot the live app with that position open"
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
  --hide-scrollbars --window-size=1500,1400 --virtual-time-budget=14000 \
  --screenshot="$OUT/dsl-live.png" "$BASE/app/" >/dev/null 2>&1
[ -s "$OUT/dsl-live.png" ] && ok "$OUT/dsl-live.png ($(stat -c%s "$OUT/dsl-live.png") bytes)" || bad "screenshot failed"

say "Checking the server logged no new client crash"
tail -200 /opt/zeus-terminal/data/logs/zeus.log 2>/dev/null \
  | grep "CLIENT_ERR" | grep "toFixed" | tail -3 \
  && bad "a toFixed crash WAS reported — read the componentStack above" \
  || ok "no toFixed crash reported"
