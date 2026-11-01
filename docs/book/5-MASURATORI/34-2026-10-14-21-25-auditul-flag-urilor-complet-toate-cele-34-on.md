<!-- generat din docs/BOOK_OF_ALL.md linia 2944 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧾 2026-10-14, 21:25 — AUDITUL FLAG-URILOR, COMPLET (toate cele 34 ON)

Am trecut și palierul cu 1-2 referințe, unde o mențiune poate fi reală sau vacuă.

### Verdicte — inclusiv NEGATIVELE, care contează la fel de mult
| flag | verdict |
|---|---|
| `ML_HYBRID_POOLING_ENABLED` | 🔴 nu comandă nimic (cod negardat, pe tabelă goală, **modul orfan**) |
| `ML_OVERRIDE_RESOLVER_ENABLED` | 🔴 nu comandă nimic (cod negardat) |
| `BYBIT_PARITY_ENABLED` | 🟠 **nu gatează nimic** — vezi mai jos |
| `SERVER_AUTHORITATIVE_POSITIONS` | ✅ **funcțional** — serverul îl raportează, clientul ramifică |
| `_SRV_POS_TESTNET_ENABLED` | ✅ funcțional, același mecanism |
| `BYBIT_TESTNET_ENABLED` | ✅ funcțional — interblocaj în mutex |
| `ML_INGEST_ENABLED`, `ML_DEMO/TESTNET_INFLUENCE_*`, `ML_CRON_SCAN_ENABLED`, `_USERDATA_STREAM_TESTNET_ENABLED` | ✅ `if (...)` real |

**`BYBIT_PARITY_ENABLED`:** singura lui mențiune în cod e un **comentariu** în
`bybitParityShadow.js:4`. Modulul **nu citește flagul**. Dar — și aici trebuie precizie — modulul e
documentat explicit ca *„pure dormant service"*, al cărui consumator urma să fie *„a future S4-B5+
batch"* care **n-a apărut niciodată**. Deci nu e serviciu defect; e un flag care așteaptă un
consumator inexistent. Efectul practic e același: aprins, nu comandă nimic.

### 🎓 De ce merită scrise și negativele
Trei flag-uri arătau moarte la prima numărătoare și **nu sunt**:
`SERVER_AUTHORITATIVE_POSITIONS` și `_SRV_POS_TESTNET_ENABLED` par doar „raportate" pe server, dar
clientul ramifică pe ele (`resolveSrvPosActive` în `liveApi.ts:224`, `resolveEffectiveFlag` în
`state.ts:1049`); `BYBIT_TESTNET_ENABLED` are 0 cititori dar e interblocaj în mutex.

**Un flag citit doar de cealaltă parte a rețelei arată mort dintr-o singură parte.** Dacă auditez
doar serverul, raportez trei flag-uri moarte care de fapt funcționează — și operatorul le-ar stinge.

**Bilanț final: 34 ON, din care 3 nu comandă nimic** (`ML_HYBRID_POOLING`, `ML_OVERRIDE_RESOLVER`,
`BYBIT_PARITY`). Restul sunt funcționale.

---
