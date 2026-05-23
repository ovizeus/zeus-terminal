# Bybit Migration — Operator Runbook

## Prerequisites

- Branch: `bybit-phase-1ab`
- BYBIT_DRY_RUN_ONLY=true throughout Phase 1A
- PM2 zeus running stable
- DB backup: `data/zeus.db.pre-bybit-phase-1ab-20260521-233302`

## Common Operations

### 1. Add Bybit Creds for User

```bash
curl -X POST http://localhost:3000/api/exchange/save \
  -H "Cookie: zeus_token=<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"exchange":"bybit","mode":"testnet","apiKey":"<KEY>","apiSecret":"<SECRET>"}'
```

Expected: `{ ok: true, verified: true }`
Creds verified via ping + getBalance before save.

### 2. Switch User to Bybit

```bash
curl -X POST http://localhost:3000/api/exchange/switch \
  -H "Cookie: zeus_token=<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"targetExchange":"bybit"}'
```

Expected: `{ ok: true, from: "binance", to: "bybit" }`
409 if user has open positions.
Switch applies at next brain cycle (explicit barrier).

### 3. Check Feed Health

```bash
curl http://localhost:3000/api/health/feed/bybit
curl http://localhost:3000/api/health/feed/binance
```

States: healthy (<30s), degraded (30-120s), silent (120-600s), dead (>600s).

### 4. Check Recovery Boot Status

```bash
curl http://localhost:3000/api/health/recovery
```

### 5. Check Active Locks

```bash
curl http://localhost:3000/api/health/locks
```

### 6. Force Disconnect (with orphan move)

```bash
curl -X POST http://localhost:3000/api/exchange/disconnect \
  -H "Cookie: zeus_token=<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"exchange":"bybit","force":true}'
```

Moves open positions to at_positions_orphaned. Use with caution.

### 7. Check Parity Shadow

```sql
SELECT user_id, COUNT(*) total,
       SUM(CASE WHEN diverged=0 THEN 1 ELSE 0 END) matched,
       ROUND(100.0 * SUM(CASE WHEN diverged=0 THEN 1 ELSE 0 END) / COUNT(*), 1) parity_pct
FROM dsl_parity_log
WHERE created_at > datetime('now', '-1 day')
GROUP BY user_id;
```

Alert threshold: <80% triggers PARITY_ALERT_LOW in audit_log.

### 8. Emergency: Rollback to Binance-only

```bash
# 1. Switch all users back to Binance
sqlite3 data/zeus.db "UPDATE exchange_accounts SET is_active=1 WHERE exchange='binance'; UPDATE exchange_accounts SET is_active=0 WHERE exchange='bybit';"

# 2. Restart PM2 (recovery boot will reconcile)
pm2 reload zeus --update-env

# 3. Verify
curl http://localhost:3000/api/health/recovery
```

### 9. DB Restore from Backup

```bash
pm2 stop zeus
cp data/zeus.db data/zeus.db.backup-$(date +%Y%m%d-%H%M%S)
cp data/zeus.db.pre-bybit-phase-1ab-20260521-233302 data/zeus.db
pm2 start zeus
```

## Monitoring Queries

### Open Positions by Exchange

```sql
SELECT exchange, COUNT(*) FROM at_positions WHERE status='OPEN' GROUP BY exchange;
```

### Recent Position Events

```sql
SELECT pe.*, ap.data FROM position_events pe LEFT JOIN at_positions ap ON pe.position_seq=ap.seq ORDER BY pe.id DESC LIMIT 20;
```

### Emergency Close Queue (unresolved)

```sql
SELECT * FROM emergency_close_queue WHERE resolved_at IS NULL;
```

### Audit Trail for Exchange Operations

```sql
SELECT * FROM audit_log WHERE action LIKE 'EXCHANGE_%' OR action LIKE 'RECOVERY_%' ORDER BY id DESC LIMIT 20;
```
