'use strict';
// [2026-11-14] Corectia istoricului OKX rescrie zeci de mii de randuri, deci se
// verifica pe o baza de proba inainte sa atinga cea vie.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const SCRIPT = path.resolve(__dirname, '../../scripts/fix-okx-liq-contracts.js');

function mk() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okxfix-'));
    const file = path.join(dir, 't.db');
    const db = new Database(file);
    db.exec(`
        CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT);
        CREATE TABLE liq_events (id INTEGER PRIMARY KEY, exchange TEXT, symbol TEXT, side TEXT, price REAL, qty REAL, usd REAL, ts INTEGER);
        INSERT INTO liq_events (exchange,symbol,side,price,qty,usd,ts) VALUES
          ('okx','BTCUSDT','SELL',66000,25,1650000,1),
          ('okx','BTCUSDT','BUY',66000,10,660000,2),
          ('okx','ETHUSDT','SELL',1900,97,184300,3),
          ('okx','SOLUSDT','SELL',77,172,13244,4),
          ('okx','DOGEUSDT','BUY',0.062,193,11.966,5),
          ('okx','GONEUSDT','SELL',1,500,500,6),
          ('okx','SOLUSDT','SELL',77,1,77,100), ('okx','SOLUSDT','SELL',77,1,77,101), ('okx','SOLUSDT','SELL',77,1,77,102), ('okx','SOLUSDT','SELL',77,1,77,103), ('okx','SOLUSDT','SELL',77,1,77,104), ('okx','SOLUSDT','SELL',77,1,77,105), ('okx','SOLUSDT','SELL',77,1,77,106), ('okx','SOLUSDT','SELL',77,1,77,107), ('okx','SOLUSDT','SELL',77,1,77,108), ('okx','SOLUSDT','SELL',77,1,77,109), ('okx','SOLUSDT','SELL',77,1,77,110), ('okx','SOLUSDT','SELL',77,1,77,111), ('okx','SOLUSDT','SELL',77,1,77,112), ('okx','SOLUSDT','SELL',77,1,77,113), ('okx','SOLUSDT','SELL',77,1,77,114), ('okx','SOLUSDT','SELL',77,1,77,115), ('okx','SOLUSDT','SELL',77,1,77,116), ('okx','SOLUSDT','SELL',77,1,77,117), ('okx','SOLUSDT','SELL',77,1,77,118), ('okx','SOLUSDT','SELL',77,1,77,119),
          ('bybit','BTCUSDT','SELL',66000,0.15,9900,7),
          ('gate','BTCUSDT','BUY',66000,0.2,13200,8);
    `);
    db.close();
    const inst = path.join(dir, 'inst.json');
    fs.writeFileSync(inst, JSON.stringify({ code: '0', data: [
        { instId: 'BTC-USDT-SWAP', ctVal: '0.01', ctMult: '1', ctType: 'linear' },
        { instId: 'ETH-USDT-SWAP', ctVal: '0.1', ctMult: '1', ctType: 'linear' },
        { instId: 'SOL-USDT-SWAP', ctVal: '1', ctMult: '1', ctType: 'linear' },
        { instId: 'DOGE-USDT-SWAP', ctVal: '1000', ctMult: '1', ctType: 'linear' },
        { instId: 'BTC-USD-SWAP', ctVal: '100', ctMult: '1', ctType: 'inverse' },
    ] }));
    return { file, inst };
}
const run = (t, ...a) => spawnSync(process.execPath, [SCRIPT, '--db', t.file, '--instruments', t.inst, ...a], { encoding: 'utf8' });
const all = (file) => { const d = new Database(file, { readonly: true }); const r = d.prepare('SELECT exchange,symbol,qty,usd FROM liq_events ORDER BY id').all(); d.close(); return r; };

describe('fix-okx-liq-contracts.js', () => {
    test('fara --apply numara si NU scrie nimic', () => {
        const t = mk();
        const before = all(t.file);
        const r = run(t);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('DRY RUN');
        expect(r.stdout).toMatch(/rescaled: 4\s+unchanged \(contract = 1\): 21\s+dropped \(unknown contract\): 1/);
        expect(all(t.file)).toEqual(before);
    });

    test('--apply: fiecare moneda cu valoarea contractului ei; restul burselor neatinse', () => {
        const t = mk();
        const r = run(t, '--apply');
        expect(r.status).toBe(0);
        const rows = all(t.file);
        const by = (ex, sym) => rows.filter((x) => x.exchange === ex && x.symbol === sym);
        expect(by('okx', 'BTCUSDT').map((x) => [+x.qty.toFixed(6), Math.round(x.usd)])).toEqual([[0.25, 16500], [0.1, 6600]]);
        expect(by('okx', 'ETHUSDT').map((x) => [+x.qty.toFixed(6), Math.round(x.usd)])).toEqual([[9.7, 18430]]);
        expect(by('okx', 'SOLUSDT').map((x) => [x.qty, x.usd])[0]).toEqual([172, 13244]);             // contract = 1
        expect(by('okx', 'DOGEUSDT').map((x) => [x.qty, Math.round(x.usd)])).toEqual([[193000, 11966]]);   // era prea MIC
        expect(by('okx', 'GONEUSDT')).toEqual([]);                                                    // fara contract: sters
        expect(by('bybit', 'BTCUSDT')).toEqual([{ exchange: 'bybit', symbol: 'BTCUSDT', qty: 0.15, usd: 9900 }]);
        expect(by('gate', 'BTCUSDT')).toEqual([{ exchange: 'gate', symbol: 'BTCUSDT', qty: 0.2, usd: 13200 }]);
    });

    test('⛔ a doua rulare refuza: BTC nu se imparte la 100 de doua ori', () => {
        const t = mk();
        expect(run(t, '--apply').status).toBe(0);
        const once = all(t.file);
        const again = run(t, '--apply');
        expect(again.status).toBe(4);
        expect(again.stderr).toMatch(/already applied/);
        expect(all(t.file)).toEqual(once);
        expect(run(t).status).toBe(4);          // nici macar numaratoarea nu mai porneste
    });

    test('⛔ un raspuns OKX gol nu sterge tot istoricul', () => {
        const t = mk();
        fs.writeFileSync(t.inst, JSON.stringify({ code: '0', data: [] }));
        const before = all(t.file);
        const r = run(t, '--apply');
        // fara niciun contract cunoscut, TOATE randurile okx ar fi sterse — refuzat
        expect(r.status).not.toBe(0);
        expect(all(t.file)).toEqual(before);
    });

    test('⛔ o lista de contracte TRUNCHIATA (multe randuri fara contract) e refuzata', () => {
        const t = mk();
        fs.writeFileSync(t.inst, JSON.stringify({ code: '0', data: [{ instId: 'BTC-USDT-SWAP', ctVal: '0.01', ctMult: '1', ctType: 'linear' }] }));
        const before = all(t.file);
        const r = run(t, '--apply');
        expect(r.status).toBe(3);
        expect(r.stderr).toMatch(/instrument list looks incomplete/);
        expect(all(t.file)).toEqual(before);
    });
});
