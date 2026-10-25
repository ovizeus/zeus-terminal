'use strict';
// tests/unit/migration-numbers-unique.test.js
//
// [2026-10-25] Am numerotat o migraţie nouă cu 416, care era deja luat.
//
// Nu s-a stricat nimic — `migrate(name, fn)` cheamă după NUME, nu după număr,
// deci două migraţii cu acelaşi prefix rulează amândouă. Dar azi am scris în
// carte despre R-C-15, o regulă al cărei număr fusese dat între timp altei
// reguli, şi despre ce a costat: o regulă de pe calea banilor trăia sub un
// număr care arăta spre altceva.
//
// Un număr duplicat nu doare când îl faci. Doare când cineva spune „migraţia
// 416" şi sunt două.
//
// Cauza a fost că am citit ultimul număr cu un `grep | tail -3` care a ratat
// linii. Verificarea aia nu e treaba mea de făcut din ochi — e treaba unui test.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'services', 'database.js'), 'utf8');

function migrationNames() {
    return [...SRC.matchAll(/migrate\('(\d+)_([a-z0-9_]+)'/g)].map(m => ({
        num: m[1], name: `${m[1]}_${m[2]}`,
    }));
}

describe('numerele de migraţie', () => {

    test('scanarea găseşte migraţiile (gardă împotriva unei treceri în gol)', () => {
        expect(migrationNames().length).toBeGreaterThan(300);
    });

    test('fiecare NUME e unic — două migraţii cu acelaşi nume, una nu rulează', () => {
        const names = migrationNames().map(m => m.name);
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        expect([...new Set(dupes)]).toEqual([]);
    });

    test('fiecare NUMĂR e unic — altfel „migraţia 416" arată spre două lucruri', () => {
        const nums = migrationNames().map(m => m.num);
        const seen = new Map();
        const clashes = [];
        for (const m of migrationNames()) {
            if (seen.has(m.num)) clashes.push(`${seen.get(m.num)} <-> ${m.name}`);
            else seen.set(m.num, m.name);
        }
        // Mesajul contează mai mult decât aserţiunea: spune EXACT care se bat.
        expect(clashes).toEqual([]);
        expect(nums.length).toBe(new Set(nums).size);
    });

    test('o migraţie nouă primeşte un număr mai mare decât toate — nu reciclează', () => {
        const nums = migrationNames().map(m => Number(m.num));
        const max = Math.max(...nums);
        expect(nums.filter(n => n === max)).toHaveLength(1);
    });
});
