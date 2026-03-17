// Zeus v122 — data/storage.js
// LocalStorage helpers, trade journal, cloud save
'use strict';

// Safe localStorage set
function _safeLocalStorageSet(key, data) {
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    if (str.length > 900000) { // ~900KB safety limit (localStorage max is ~5MB)
      console.warn('[ZEUS] localStorage cap hit for key:', key, str.length, 'bytes');
      return false;
    }
    localStorage.setItem(key, str);
    return true;
  } catch (e) {
    console.warn('[ZEUS] localStorage write failed:', key, e.message);
    return false;
  }
}


// Trade journal
function addTradeToJournal(trade) {
  TP.journal.unshift(trade);
  // [FIX v85 BUG5] Redus de la 1000 la 200 în memorie pentru a preveni overflow
  if (TP.journal.length > 200) TP.journal.length = 200;
  renderTradeJournal();
  // Salvează doar ultimele 50 în localStorage pentru a economisi spațiu
  _safeLocalStorageSet('zt_journal', TP.journal.slice(0, 50));
  // [v122 ANALYTICS] Record daily PnL + drawdown on close
  if (trade.journalEvent === 'CLOSE' && typeof recordDailyClose === 'function') recordDailyClose(trade);
}
function renderTradeJournal() {
  const body = el('journalBody'); if (!body) return;
  if (!TP.journal.length) { body.innerHTML = '<div style="padding:10px;text-align:center;font-size:12px;color:var(--dim)">No trades yet</div>'; return; }
  body.innerHTML = TP.journal.map(t => {
    const win = t.pnl >= 0;
    const pnlStr = (win ? '+' : '') + '$' + t.pnl.toFixed(2);
    const ep = '$' + fP(t.entry) + '→$' + fP(t.exit);
    // [FIX R11] Sanitize user-sourced fields to prevent stored XSS
    const _time = typeof escHtml === 'function' ? escHtml(t.time || '') : (t.time || '');
    const _side = typeof escHtml === 'function' ? escHtml(t.side || '') : (t.side || '');
    const _reason = typeof escHtml === 'function' ? escHtml(t.reason || '—') : (t.reason || '—');
    return `<div class="journal-row ${win ? 'win' : 'loss'}">
      <span style="color:var(--dim)">${_time}</span>
      <span style="color:${t.side === 'LONG' ? 'var(--grn)' : 'var(--red)'}">${_side}</span>
      <span style="color:var(--dim);font-size:11px">${ep}</span>
      <span style="color:${win ? 'var(--grn)' : 'var(--red)'};font-weight:700">${pnlStr}</span>
      <span style="color:var(--dim);font-size:11px">${_reason}</span>
    </div>`;
  }).join('');
}
function loadJournalFromStorage() {
  try {
    const raw = localStorage.getItem('zt_journal');
    if (raw) { TP.journal = JSON.parse(raw); renderTradeJournal(); }
  } catch (e) {
    // [v106 FIX1] Journal corupt in localStorage — logat, jurnal resetat la gol
    console.warn('[loadJournalFromStorage] Parse failed:', e.message);
    if (typeof ZLOG !== 'undefined') ZLOG.push('ERROR', '[loadJournalFromStorage] ' + e.message);
    TP.journal = [];
  }
}
function exportJournalCSV() {
  if (!TP.journal.length) { toast('No trades to export'); return; }
  const hdr = 'Time,Side,Symbol,Entry,Exit,PnL,Leverage,Reason\n';
  const rows = TP.journal.map(t => `${t.time},${t.side},${t.sym || S.symbol.replace('USDT', '')},${t.entry},${t.exit},${t.pnl.toFixed(2)},${t.lev || '—'},${t.reason || 'Manual'}`).join('\n');
  const csv = hdr + rows;
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `zeus_journal_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); toast('✅ Journal exported!');
}


// Funding Rate countdown
function startFRCountdown() {
  Intervals.set('frCountdown', () => {
    if (!S.frCd) return;
    const now = Date.now(); const rem = S.frCd - now;
    if (rem <= 0) { const cd = el('frCd'); if (cd) cd.style.display = 'none'; return; }
    const mm = Math.floor(rem / 60000); const ss = Math.floor((rem % 60000) / 1000);
    const str = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
    const cd = el('frCd');
    if (cd) {
      cd.textContent = str;
      cd.style.display = 'inline';
      cd.className = 'fr-cd' + (rem < 300000 ? ' warn' : '');
    }
    const dtfrc = el('dtfrc'); if (dtfrc) dtfrc.textContent = str;
  }, 1000);
}

// ===== OI DELTA TRACKING =====
// [MOVED TO TOP] oiHistory

// OI Delta tracking
function trackOIDelta() {
  if (!S.oi) return;
  const now = Date.now();
  oiHistory.push({ oi: S.oi, ts: now });
  ZT_capArr(oiHistory, 2000); // [v119-p6 FIX3] hard cap numeric suplimentar
  // Keep 20 min of history
  while (oiHistory.length > 0 && oiHistory[0].ts < now - 1200000) oiHistory.shift();
  // Calculate 5m delta
  const t5 = now - 300000;
  const old5 = oiHistory.find(h => h.ts >= t5);
  const delta5 = el('oiDelta5m');
  if (delta5 && old5 && S.oi) {
    const pct = ((S.oi - old5.oi) / old5.oi * 100);
    if (Math.abs(pct) > 0.01) {
      delta5.style.display = 'inline';
      delta5.textContent = (pct > 0 ? '▲' : pct < 0 ? '▼' : '') + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
      delta5.className = 'oi-delta ' + (pct > 0 ? 'up' : 'dn');
    } else delta5.style.display = 'none';
  }
}
// [oidelta interval started in startApp()]

// ===== MULTI-SYMBOL WATCHLIST =====
// [MOVED TO TOP] WL_SYMS
// [MOVED TO TOP] wlPrices
// BUG1 FIX: Global price map — populated from ALL WebSocket ticks
// [MOVED TO TOP] allPrices

// FIX 20: ZStore — lightweight central store reference (non-breaking, additive)
// Existing S/BM/AT/TP/DSL/PERF/DHF objects remain canonical.
