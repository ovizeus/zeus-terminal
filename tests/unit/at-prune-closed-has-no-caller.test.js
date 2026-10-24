// G-4 — `atPruneClosed` trebuie să rămână FĂRĂ APELANT.
//
// Ce face dacă e chemată: `DELETE FROM at_closed WHERE user_id = ? AND seq NOT IN
// (SELECT seq FROM at_closed WHERE user_id = ? ORDER BY closed_at DESC LIMIT 500)`
// — adică păstrează doar ultimele 500 de poziţii închise pe utilizator şi şterge
// restul. Asta e **istoric de tranzacţionare**, clasa pe care R-C-21 o declară
// intangibilă: nu se şterge niciodată, se arhivează.
//
// DE CE EXISTĂ TESTUL ĂSTA. Pe 2026-10-24 am descoperit că funcţia e scrisă,
// exportată, şi necheamată de nimeni. Operatorul mai are toate cele 3 480 de
// poziţii închise **din accident**, nu din proiectare — iar toate măsurătorile
// din octombrie (contrafactualele, pâlnia, cifra pe tranzacţie) s-au făcut pe
// exact istoricul ăla. Dacă cineva o cablează cândva „ca să nu crească tabela",
// pierderea e tăcută şi definitivă.
//
// Un comentariu convinge pe cine îl citeşte. Testul opreşte pe cine nu-l citeşte.
//
// DACĂ TESTUL ĂSTA PICĂ: nu-l actualiza. Ori ai adăugat un apelant şi atunci
// discuţia e cu operatorul (vezi G-4 în Book), ori ai mutat funcţia şi trebuie
// mutat şi testul.

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..', '..', 'server');
const OWNER = path.join('services', 'database.js'); // singurul fişier care are voie s-o menţioneze

/** toate fişierele .js din server/, recursiv */
function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full, out); continue; }
        if (e.name.endsWith('.js')) out.push(full);
    }
    return out;
}

function hits(file) {
    const rel = path.relative(SERVER_DIR, file);
    return fs.readFileSync(file, 'utf8').split('\n')
        .map((line, i) => ({ rel, no: i + 1, line: line.trim() }))
        .filter((r) => r.line.includes('atPruneClosed'));
}

// formele permise, în fişierul proprietar. Orice altceva e un apelant.
const ALLOWED = [
    /^\/\//,                                              // comentariu
    /^atPruneClosed:\s*db\.prepare\(/,                    // instrucţiunea pregătită
    /^function atPruneClosed\(/,                          // definiţia
    /^_stmts\.atPruneClosed\.run\(/,                      // rularea, din interiorul definiţiei
    /^atPruneClosed,$/,                                   // exportul
];

describe('G-4 — atPruneClosed rămâne cod mort, deliberat', () => {
    test('niciun fişier din server/, în afara proprietarului, nu o menţionează', () => {
        const strays = walk(SERVER_DIR)
            .filter((f) => !f.endsWith(OWNER))
            .flatMap(hits)
            .map((h) => `${h.rel}:${h.no}  ${h.line}`);
        expect(strays).toEqual([]);
    });

    test('în database.js apare DOAR în formele care n-o cheamă', () => {
        const bad = hits(path.join(SERVER_DIR, OWNER))
            .filter((h) => !ALLOWED.some((re) => re.test(h.line)))
            .map((h) => `${h.rel}:${h.no}  ${h.line}`);
        expect(bad).toEqual([]);
    });

    test('garda nu e vidă — fişierul proprietar chiar conţine funcţia', () => {
        // fără asta, o redenumire ar face testele de mai sus să treacă pe nimic
        const found = hits(path.join(SERVER_DIR, OWNER)).map((h) => h.line);
        expect(found.some((l) => /^function atPruneClosed\(/.test(l))).toBe(true);
        expect(found.some((l) => /^atPruneClosed,$/.test(l))).toBe(true);
    });
});
