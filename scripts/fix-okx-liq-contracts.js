#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Corecteaza istoricul lichidarilor OKX din `liq_events`: marimea a fost
// salvata in CONTRACTE socotite drept monede (vezi server/services/liqOkx.js).
// ═══════════════════════════════════════════════════════════════════════════
//
//   node scripts/fix-okx-liq-contracts.js              (numara, nu scrie)
//   node scripts/fix-okx-liq-contracts.js --apply      (corecteaza)
//
// Ce face cu fiecare rand `exchange = 'okx'`:
//   - simbol cu contract liniar pe USDT cunoscut → qty si usd × valoarea
//     contractului (BTC ×0,01; ETH ×0,1; DOGE ×1000 …);
//   - simbol fara contract cunoscut azi → randul se STERGE (regula casei: mai
//     bine un eveniment pierdut decat o cifra falsa).
//
// Reguli:
//   - fara --apply nu scrie nimic;
//   - cu --apply serverul trebuie sa fie OPRIT si sa porneasca apoi cu codul
//     reparat: randurile scrise de codul vechi dupa corectie ar fi iar gresite;
//   - ruleaza O SINGURA DATA: lasa un semn in `_migrations` si refuza a doua oara
//     (altfel BTC ar fi impartit la 100 de doua ori);
//   - totul intr-o singura tranzactie.
//
// Limita cunoscuta: randurile venite de pe contracte INVERSE (BTC-USD-SWAP,
// 5 monede) sunt salvate sub acelasi simbol si nu mai pot fi deosebite; sunt
// corectate ca si cum ar fi liniare. Raman aproximative, dar de ordinul corect.
const path = require('path');
const Database = require('better-sqlite3');
const okx = require('../server/services/liqOkx');

const MARK = 'data_okx_liq_ctval_fix_20261114';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbPath = arg('--db') || process.env.ZEUS_DB_PATH || path.resolve(__dirname, '../data/zeus.db');
const instFile = arg('--instruments');      // pentru teste: un JSON cu raspunsul OKX

(async () => {
    let inst;
    if (instFile) inst = okx.parseInstruments(JSON.parse(require('fs').readFileSync(instFile, 'utf8')));
    else {
        const r = await fetch(okx.INSTRUMENTS_URL);
        if (!r.ok) { console.error('could not load OKX instruments: HTTP ' + r.status); process.exit(3); }
        inst = okx.parseInstruments(await r.json());
    }
    const linear = {};
    for (const id of Object.keys(inst)) {
        const m = /^([A-Z0-9]+)-USDT-SWAP$/.exec(id);
        if (m && !inst[id].inverse) linear[m[1] + 'USDT'] = inst[id].ctVal;
    }
    if (!Object.keys(linear).length) { console.error('no OKX linear contracts loaded — refusing (every okx row would be deleted)'); process.exit(3); }

    const db = new Database(dbPath, apply ? {} : { readonly: true });
    const already = db.prepare('SELECT name, applied_at FROM _migrations WHERE name = ?').get(MARK);
    if (already) { console.error('already applied at ' + already.applied_at + ' — refusing to rescale twice'); process.exit(4); }

    const rows = db.prepare("SELECT symbol, COUNT(*) n, SUM(usd) usd FROM liq_events WHERE exchange = 'okx' GROUP BY symbol").all();
    let fixN = 0, sameN = 0, dropN = 0, before = 0, after = 0;
    const plan = [];
    for (const r of rows) {
        const ct = linear[r.symbol];
        before += r.usd || 0;
        if (!(ct > 0)) { dropN += r.n; plan.push({ symbol: r.symbol, n: r.n, ct: null, usd: r.usd }); continue; }
        after += (r.usd || 0) * ct;
        if (ct === 1) sameN += r.n; else fixN += r.n;
        plan.push({ symbol: r.symbol, n: r.n, ct, usd: r.usd });
    }
    const m = (x) => (x / 1e6).toFixed(1) + 'M';
    console.log(`okx rows: ${fixN + sameN + dropN} in ${rows.length} symbols`);
    console.log(`  rescaled: ${fixN}   unchanged (contract = 1): ${sameN}   dropped (unknown contract): ${dropN}`);
    console.log(`  okx total before: $${m(before)}   after: $${m(after)}`);
    for (const p of plan.sort((a, b) => (b.usd || 0) - (a.usd || 0)).slice(0, 8)) {
        console.log(`  ${p.symbol.padEnd(14)} ${String(p.n).padStart(7)} rows  ×${p.ct === null ? 'DROP' : p.ct}  $${m(p.usd || 0)} → ${p.ct === null ? 'deleted' : '$' + m((p.usd || 0) * p.ct)}`);
    }
    // Plasa: daca lista de contracte e trunchiata, „necunoscut" ar insemna
    // stergerea unei bucati mari din istoric. Peste 5% din randuri → refuz.
    const total = fixN + sameN + dropN;
    if (total > 0 && dropN / total > 0.05) {
        console.error(`refusing: ${dropN} of ${total} okx rows (${(100 * dropN / total).toFixed(1)}%) have no known contract — the instrument list looks incomplete`);
        process.exit(3);
    }
    if (!apply) { console.log('\nDRY RUN — nothing was written. Add --apply (with the server stopped) to correct.'); process.exit(0); }

    const run = db.transaction(() => {
        const upd = db.prepare("UPDATE liq_events SET qty = qty * ?, usd = usd * ? WHERE exchange = 'okx' AND symbol = ?");
        const del = db.prepare("DELETE FROM liq_events WHERE exchange = 'okx' AND symbol = ?");
        let changed = 0, deleted = 0;
        for (const p of plan) {
            if (p.ct === null) deleted += del.run(p.symbol).changes;
            else if (p.ct !== 1) changed += upd.run(p.ct, p.ct, p.symbol).changes;
        }
        const note = JSON.stringify({ at: new Date().toISOString(), rescaled: changed, deleted, beforeUsd: Math.round(before), afterUsd: Math.round(after) });
        db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, datetime('now'))").run(MARK);
        return { changed, deleted, note };
    });
    const out = run();
    console.log(`\nAPPLIED — rescaled ${out.changed} rows, deleted ${out.deleted}. Marker: ${out.note}`);
    process.exit(0);
})().catch((e) => { console.error('FAILED: ' + (e && e.message)); process.exit(1); });
