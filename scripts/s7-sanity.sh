#!/usr/bin/env bash
# Zeus S7 Shadow Parity Soak — T+24h / T+48h / T+72h sanity check
# Usage: bash scripts/s7-sanity.sh
# Read-only DB queries + PM2 introspection. NO mutations.

set -u
cd /root/zeus-terminal

# ─── Color codes ───────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

T0_FILE="/tmp/zeus_soak72h_t0"
DB="data/zeus.db"

# ─── Section 1: Header ─────────────────────────────────────────
printf "${BOLD}${CYAN}=== Zeus S7 Shadow Parity Soak — Sanity Check ===${NC}\n"
printf "Generated: %s\n" "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

if [ ! -f "$T0_FILE" ]; then
  printf "${RED}ERROR: T0 reference file %s not found.${NC}\n" "$T0_FILE"
  printf "Cannot compute elapsed soak time. Aborting.\n"
  exit 2
fi

T0_MS=$(head -1 "$T0_FILE" 2>/dev/null || echo "")
if ! [[ "$T0_MS" =~ ^[0-9]+$ ]]; then
  printf "${RED}ERROR: T0 ms invalid in %s (got: %s)${NC}\n" "$T0_FILE" "$T0_MS"
  exit 2
fi

# Pull rows_t0 if present (form: rows_t0=NNNN)
ROWS_T0=$(grep -E '^rows_t0=' "$T0_FILE" 2>/dev/null | head -1 | cut -d= -f2)
ROWS_T0=${ROWS_T0:-0}

# Pull restarts_t0 if present (form: pid=... restarts=NNN ...)
RESTARTS_T0=$(grep -Eo 'restarts=[0-9]+' "$T0_FILE" 2>/dev/null | head -1 | cut -d= -f2)
RESTARTS_T0=${RESTARTS_T0:-0}

NOW_MS=$(date +%s%3N)
ELAPSED_MS=$((NOW_MS - T0_MS))
ELAPSED_H=$((ELAPSED_MS / 3600000))
ELAPSED_M=$(( (ELAPSED_MS / 60000) % 60 ))
ELAPSED_HOURS_FLOAT=$(awk "BEGIN { printf \"%.3f\", $ELAPSED_MS / 3600000 }")

printf "T0:      %s (ms=%s)\n" "2026-05-10 10:26:12 UTC" "$T0_MS"
printf "Elapsed: ${BOLD}T+%dh %dm${NC} (%.3f h)\n" "$ELAPSED_H" "$ELAPSED_M" "$ELAPSED_HOURS_FLOAT" 2>/dev/null || \
  printf "Elapsed: ${BOLD}T+%dh %dm${NC}\n" "$ELAPSED_H" "$ELAPSED_M"
printf "Rows T0: %s | Restarts T0: %s\n" "$ROWS_T0" "$RESTARTS_T0"
echo

# ─── Section 2: PM2 health ────────────────────────────────────
printf "${BOLD}── 2. PM2 health ──${NC}\n"
PM2_OUT=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json, time
try:
    d = json.loads(sys.stdin.read())
except Exception as e:
    print('ERROR_PARSE')
    sys.exit(0)
zeus = [p for p in d if p.get('name') == 'zeus']
if not zeus:
    print('ERROR_NOT_FOUND')
    sys.exit(0)
a = zeus[0]
e = a.get('pm2_env', {})
pid = a.get('pid', '?')
restarts = e.get('restart_time', '?')
unstable = e.get('unstable_restarts', '?')
status = e.get('status', '?')
pm_uptime_ms = e.get('pm_uptime', 0)
now_ms = int(time.time() * 1000)
up_ms = now_ms - pm_uptime_ms if pm_uptime_ms else 0
up_h = up_ms // 3600000
up_m = (up_ms // 60000) % 60
print(f'{pid}|{restarts}|{unstable}|{status}|{up_h}h{up_m}m')
" 2>/dev/null)

if [ "$PM2_OUT" = "ERROR_PARSE" ] || [ "$PM2_OUT" = "ERROR_NOT_FOUND" ] || [ -z "$PM2_OUT" ]; then
  printf "${RED}PM2 query failed (%s)${NC}\n" "${PM2_OUT:-empty}"
  PM2_RESTARTS_NOW=-1
  PM2_UNSTABLE_NOW=-1
  PM2_STATUS_NOW="unknown"
else
  IFS='|' read -r PM2_PID PM2_RESTARTS_NOW PM2_UNSTABLE_NOW PM2_STATUS_NOW PM2_UPTIME <<< "$PM2_OUT"
  printf "pid=%s restarts=%s unstable=%s status=%s uptime=%s\n" \
    "$PM2_PID" "$PM2_RESTARTS_NOW" "$PM2_UNSTABLE_NOW" "$PM2_STATUS_NOW" "$PM2_UPTIME"
  if [[ "$PM2_RESTARTS_NOW" =~ ^[0-9]+$ ]] && [[ "$RESTARTS_T0" =~ ^[0-9]+$ ]]; then
    DELTA_RESTARTS=$((PM2_RESTARTS_NOW - RESTARTS_T0))
    if [ "$DELTA_RESTARTS" -gt 0 ]; then
      printf "${YELLOW}⚠️  restarts increased by %d since T0 (T0=%s → now=%s)${NC}\n" \
        "$DELTA_RESTARTS" "$RESTARTS_T0" "$PM2_RESTARTS_NOW"
    else
      printf "  restarts delta vs T0: 0 (stable)\n"
    fi
  fi
  if [[ "$PM2_UNSTABLE_NOW" =~ ^[0-9]+$ ]] && [ "$PM2_UNSTABLE_NOW" -gt 0 ]; then
    printf "${RED}⚠️  unstable_restarts=%s (non-zero!)${NC}\n" "$PM2_UNSTABLE_NOW"
  fi
fi
echo

# ─── Section 3: DB row breakdown ──────────────────────────────
printf "${BOLD}── 3. DB row breakdown ──${NC}\n"
if [ ! -f "$DB" ]; then
  printf "${RED}ERROR: DB %s not found${NC}\n" "$DB"
  ROWS_NOW=0
  SERVER_ROWS=0
  CLIENT_ROWS=0
else
  SERVER_ROWS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM dsl_parity_log WHERE source='server'" 2>/dev/null || echo 0)
  CLIENT_ROWS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM dsl_parity_log WHERE source='client'" 2>/dev/null || echo 0)
  ROWS_NOW=$((SERVER_ROWS + CLIENT_ROWS))
  printf "server=%s  client=%s  total=%s\n" "$SERVER_ROWS" "$CLIENT_ROWS" "$ROWS_NOW"

  if [[ "$ROWS_T0" =~ ^[0-9]+$ ]] && [ "$ROWS_T0" -gt 0 ]; then
    DELTA_ROWS=$((ROWS_NOW - ROWS_T0))
    printf "delta vs T0: +%s rows\n" "$DELTA_ROWS"

    if [ "$ELAPSED_MS" -gt 0 ]; then
      RATE_PER_HOUR=$(awk "BEGIN { printf \"%.0f\", $DELTA_ROWS * 3600000 / $ELAPSED_MS }")
      printf "rate ≈ %s rows/h (expected ≈3,400/h server + ≈720/h client = ≈4,120/h total)\n" "$RATE_PER_HOUR"
    fi
  fi
fi
echo

# ─── Section 4: Pair correlation post-T0 ──────────────────────
printf "${BOLD}── 4. Pair correlation (post-T0, ±2s window) ──${NC}\n"
PAIRED_COUNT=$(sqlite3 "$DB" "
SELECT COUNT(*)
FROM dsl_parity_log s
JOIN dsl_parity_log c
  ON c.user_id = s.user_id
  AND c.pos_id = s.pos_id
  AND c.source = 'client'
  AND ABS(c.created_at - s.created_at) <= 2000
WHERE s.source = 'server'
  AND s.created_at >= ${T0_MS};
" 2>/dev/null || echo 0)
PAIRED_COUNT=${PAIRED_COUNT:-0}
printf "paired_count = %s\n" "$PAIRED_COUNT"
echo

# ─── Section 5: ACTIVE-phase pairs (CRITIC) ───────────────────
printf "${BOLD}── 5. ACTIVE-phase pairs (CRITIC — gate ≥500) ──${NC}\n"
DIVS_LEN=$(sqlite3 "$DB" "
SELECT COUNT(*)
FROM dsl_parity_log s
JOIN dsl_parity_log c
  ON c.user_id = s.user_id
  AND c.pos_id = s.pos_id
  AND c.source = 'client'
  AND ABS(c.created_at - s.created_at) <= 2000
WHERE s.source = 'server'
  AND s.created_at >= ${T0_MS}
  AND s.phase != 'NONE'
  AND c.phase != 'NONE'
  AND s.current_sl > 0
  AND c.current_sl > 0
  AND s.entry_price > 0;
" 2>/dev/null || echo 0)
DIVS_LEN=${DIVS_LEN:-0}
printf "divs.length = %s\n" "$DIVS_LEN"
if [ "$DIVS_LEN" -eq 0 ]; then
  printf "${YELLOW}⚠️  positions not yet activated DSL — sample sufficiency NOT met${NC}\n"
elif [ "$DIVS_LEN" -lt 500 ]; then
  printf "${YELLOW}⚠️  divs.length < 500 (gate threshold)${NC}\n"
else
  printf "${GREEN}  divs.length ≥ 500 (gate satisfied)${NC}\n"
fi
echo

# ─── Section 6: phaseValidPairs + phaseMatchPct ──────────────
printf "${BOLD}── 6. phaseValidPairs + phaseMatchPct (gate ≥100 + ≥95%%) ──${NC}\n"
PHASE_OUT=$(sqlite3 "$DB" "
SELECT
  COUNT(*) AS phase_valid_pairs,
  SUM(CASE WHEN s.phase = c.phase THEN 1 ELSE 0 END) AS phase_matched
FROM dsl_parity_log s
JOIN dsl_parity_log c
  ON c.user_id = s.user_id AND c.pos_id = s.pos_id
  AND c.source = 'client'
  AND ABS(c.created_at - s.created_at) <= 2000
WHERE s.source = 'server'
  AND s.created_at >= ${T0_MS}
  AND s.phase IS NOT NULL AND s.phase != ''
  AND c.phase IS NOT NULL AND c.phase != '';
" 2>/dev/null || echo "0|0")
PHASE_VALID=$(echo "$PHASE_OUT" | cut -d'|' -f1)
PHASE_MATCHED=$(echo "$PHASE_OUT" | cut -d'|' -f2)
PHASE_VALID=${PHASE_VALID:-0}
PHASE_MATCHED=${PHASE_MATCHED:-0}

printf "phaseValidPairs = %s\n" "$PHASE_VALID"
printf "phaseMatched    = %s\n" "$PHASE_MATCHED"

if [ "$PHASE_VALID" -gt 0 ]; then
  PHASE_PCT=$(awk "BEGIN { printf \"%.2f\", $PHASE_MATCHED * 100.0 / $PHASE_VALID }")
  printf "phaseMatchPct   = %s%%\n" "$PHASE_PCT"
  PHASE_PCT_INT=$(awk "BEGIN { printf \"%d\", $PHASE_MATCHED * 100 / $PHASE_VALID }")
  if [ "$PHASE_VALID" -ge 100 ] && [ "$PHASE_PCT_INT" -ge 95 ]; then
    printf "${GREEN}  gate satisfied (≥100 valid + ≥95%% match)${NC}\n"
  else
    printf "${YELLOW}⚠️  gate NOT satisfied (need ≥100 valid + ≥95%% match)${NC}\n"
  fi
else
  PHASE_PCT="N/A"
  PHASE_PCT_INT=0
  printf "phaseMatchPct   = N/A (no valid pairs yet)\n"
fi
echo

# ─── Section 7: Mean + p95 SL divergence ─────────────────────
printf "${BOLD}── 7. SL divergence (mean + p95) ──${NC}\n"
MEAN_DIV="N/A"
P95_DIV="N/A"
MEAN_DIV_INT=-1
P95_DIV_INT=-1
if [ "$DIVS_LEN" -eq 0 ]; then
  printf "no ACTIVE-phase pairs yet — skipping mean/p95\n"
else
  DIV_ROWS=$(sqlite3 "$DB" "
    SELECT ABS(s.current_sl - c.current_sl) / s.entry_price * 100.0 AS div_pct
    FROM dsl_parity_log s
    JOIN dsl_parity_log c
      ON c.user_id = s.user_id
      AND c.pos_id = s.pos_id
      AND c.source = 'client'
      AND ABS(c.created_at - s.created_at) <= 2000
    WHERE s.source = 'server'
      AND s.created_at >= ${T0_MS}
      AND s.phase != 'NONE'
      AND c.phase != 'NONE'
      AND s.current_sl > 0
      AND c.current_sl > 0
      AND s.entry_price > 0;
  " 2>/dev/null)

  if [ -n "$DIV_ROWS" ]; then
    STATS=$(echo "$DIV_ROWS" | awk '
      { vals[NR] = $1 + 0; sum += $1 + 0 }
      END {
        n = NR
        if (n == 0) { print "0|0|0"; exit }
        # sort
        for (i = 1; i <= n; i++) {
          for (j = i + 1; j <= n; j++) {
            if (vals[i] > vals[j]) { tmp = vals[i]; vals[i] = vals[j]; vals[j] = tmp }
          }
        }
        mean = sum / n
        idx95 = int(n * 0.95 + 0.999999)
        if (idx95 < 1) idx95 = 1
        if (idx95 > n) idx95 = n
        p95 = vals[idx95]
        printf "%d|%.4f|%.4f", n, mean, p95
      }
    ')
    DIV_N=$(echo "$STATS" | cut -d'|' -f1)
    MEAN_DIV=$(echo "$STATS" | cut -d'|' -f2)
    P95_DIV=$(echo "$STATS" | cut -d'|' -f3)
    printf "n=%s  mean=%s%%  p95=%s%%\n" "$DIV_N" "$MEAN_DIV" "$P95_DIV"
    MEAN_DIV_INT=$(awk "BEGIN { printf \"%d\", $MEAN_DIV * 100 }")
    P95_DIV_INT=$(awk "BEGIN { printf \"%d\", $P95_DIV * 100 }")
    # Gate: mean < 2.0% (= 200 hundredths), p95 < 5.0% (= 500 hundredths)
    if [ "$MEAN_DIV_INT" -lt 200 ] && [ "$P95_DIV_INT" -lt 500 ]; then
      printf "${GREEN}  divergence within thresholds (mean<2%%, p95<5%%)${NC}\n"
    else
      printf "${YELLOW}⚠️  divergence above thresholds (mean=%s%%, p95=%s%%)${NC}\n" "$MEAN_DIV" "$P95_DIV"
    fi
  else
    printf "no rows returned for divergence calc\n"
  fi
fi
echo

# ─── Section 8: Errors în pm2 logs ────────────────────────────
printf "${BOLD}── 8. PM2 log errors (last 100 lines) ──${NC}\n"
ERR_RAW=$(pm2 logs zeus --lines 100 --nostream 2>&1 | grep -iE "error|fatal|TypeError|ReferenceError" | grep -v "SENTRY_DSN" || true)
ERR_COUNT=$(echo -n "$ERR_RAW" | grep -c . || true)
ERR_COUNT=${ERR_COUNT:-0}
printf "real_error_lines = %s\n" "$ERR_COUNT"
if [ "$ERR_COUNT" -gt 0 ]; then
  printf "  sample (top 10):\n"
  echo "$ERR_RAW" | head -10 | sed 's/^/    /'
fi
if [ "$ERR_COUNT" -gt 5 ]; then
  printf "${YELLOW}⚠️  >5 error lines detected — investigate${NC}\n"
fi
echo

# ─── Section 9: atq jobs ─────────────────────────────────────
printf "${BOLD}── 9. atq queue (next check-in scheduled?) ──${NC}\n"
ATQ_OUT=$(atq 2>/dev/null | head)
if [ -n "$ATQ_OUT" ]; then
  echo "$ATQ_OUT"
  ATQ_HAS_JOB=1
else
  printf "${YELLOW}(atq queue empty — no scheduled check-ins)${NC}\n"
  ATQ_HAS_JOB=0
fi
echo

# ─── Section 10: Final verdict ───────────────────────────────
printf "${BOLD}── 10. Verdict ──${NC}\n"

# Compute conditions
COND_DIVS_500=0;       [ "$DIVS_LEN" -ge 500 ] && COND_DIVS_500=1
COND_MEAN_OK=0;        [ "$MEAN_DIV_INT" -ge 0 ] && [ "$MEAN_DIV_INT" -lt 200 ] && COND_MEAN_OK=1
COND_P95_OK=0;         [ "$P95_DIV_INT" -ge 0 ] && [ "$P95_DIV_INT" -lt 500 ] && COND_P95_OK=1
COND_PHASE_PCT_OK=0;   [ "$PHASE_VALID" -ge 100 ] && [ "$PHASE_PCT_INT" -ge 95 ] && COND_PHASE_PCT_OK=1
COND_PAIRED_GROW=0;    [ "$PAIRED_COUNT" -gt 0 ] && COND_PAIRED_GROW=1
COND_NO_ERR=0;         [ "$ERR_COUNT" -le 5 ] && COND_NO_ERR=1
COND_PM2_STABLE=0;     [ "$PM2_STATUS_NOW" = "online" ] && [ "${PM2_UNSTABLE_NOW:-1}" = "0" ] && COND_PM2_STABLE=1

# Pre-T+24h => INFO (insufficient soak time)
if [ "$ELAPSED_H" -lt 24 ]; then
  STATUS="INFO"
  COLOR="$CYAN"
  REASON="T+${ELAPSED_H}h <24h — soak insufficient time (current rates: server=${SERVER_ROWS}, client=${CLIENT_ROWS}, paired=${PAIRED_COUNT}, divs=${DIVS_LEN}). Continue waiting."
elif [ "$DIVS_LEN" -eq 0 ] || [ "$PAIRED_COUNT" -lt 500 ] || \
     { [ "$MEAN_DIV_INT" -ge 500 ] && [ "$MEAN_DIV_INT" -ge 0 ]; } || \
     [ "$ERR_COUNT" -gt 5 ] || [ "$COND_PM2_STABLE" -eq 0 ]; then
  STATUS="RED"
  COLOR="$RED"
  REASON="Hard fail: divs=${DIVS_LEN} paired=${PAIRED_COUNT} mean=${MEAN_DIV} errors=${ERR_COUNT} pm2_status=${PM2_STATUS_NOW}/unstable=${PM2_UNSTABLE_NOW}"
elif [ "$COND_DIVS_500" -eq 1 ] && [ "$COND_MEAN_OK" -eq 1 ] && [ "$COND_P95_OK" -eq 1 ] && \
     [ "$COND_PHASE_PCT_OK" -eq 1 ] && [ "$COND_PAIRED_GROW" -eq 1 ] && \
     [ "$COND_NO_ERR" -eq 1 ] && [ "$COND_PM2_STABLE" -eq 1 ]; then
  STATUS="GREEN"
  COLOR="$GREEN"
  REASON="All gates satisfied: divs=${DIVS_LEN}≥500, mean=${MEAN_DIV}%<2.0, p95=${P95_DIV}%<5.0, phaseMatchPct=${PHASE_PCT}%≥95, paired=${PAIRED_COUNT}, errors=${ERR_COUNT}≤5, PM2 stable"
else
  STATUS="YELLOW"
  COLOR="$YELLOW"
  REASON="One or more gates not met (divs=${DIVS_LEN}, mean=${MEAN_DIV}, p95=${P95_DIV}, phaseValid=${PHASE_VALID}, phasePct=${PHASE_PCT}%, paired=${PAIRED_COUNT}, errors=${ERR_COUNT})"
fi

printf "Reason: %s\n\n" "$REASON"
printf "${COLOR}${BOLD}=== VERDICT: %s ===${NC}\n" "$STATUS"
exit 0
