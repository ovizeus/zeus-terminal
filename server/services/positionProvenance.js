'use strict';

// [PROVENANCE FIX 2026-10-21] Un singur loc pur care decide provenienţa unui
// rând de poziţie: CINE l-a deschis (`userId`) şi UNDE se execută (`env`).
//
// De ce există: auditul din 2026-10-21 a arătat că obiectul poziţiei era
// persistat incomplet pe ambele căi de execuţie (binanceOps + bybitOps scriau
// symbol/side/qty/.../mode, dar nu `userId` şi nu `env`). Coloana `user_id`
// primea uid-ul; obiectul citit la rulare nu. Acelaşi câmp lipsă dezarma două
// mecanisme independente:
//   `userId` lipsă → `_findSameModeOpposite` (serverAT.js:1149) compară
//      `p.userId === userId`, deci nu vedea poziţia opusă şi garda direcţională
//      lăsa brain-ul să deschidă LONG+SHORT în acelaşi mod.
//   `env` lipsă → poarta `pos.env === 'TESTNET'` (serverAT.js:3600) sărea
//      SMART_CUT, tăietorul de pierderi.
// Pus într-un modul comun, nu duplicat în fiecare bursă: duplicarea e exact ce
// a produs bugul — `mode` a fost reparat în ambele locuri, `userId` în niciunul.
// Pur, fără dependenţe → testabil izolat, imposibil de ciclat.

// Oglindeşte semantica rezolvatorului canonic `_resolveExecutionEnv`
// (serverAT.js:3951). Regula lui, păstrată intactă aici: NU presupune niciodată
// 'REAL' când adevărul e incert — mai bine `null` şi blocaj în amonte decât o
// execuţie pe bani reali dedusă din lipsa unei informaţii.
function _resolveEnv(params, creds) {
    if (params && params.mode === 'demo') return 'DEMO';
    const m = creds && creds.mode;
    if (m === 'testnet') return 'TESTNET';
    if (m === 'live') return 'REAL';
    return null;
}

// uid → număr, sau null. NU se completează cu o valoare implicită: un uid greşit
// e mai rău decât unul lipsă, fiindcă ar lega poziţia de contul altcuiva
// (acelaşi raţionament ca garda [C5] de la încărcare, serverAT.js:760, care
// refuză explicit să presupună utilizatorul 1).
function _resolveUserId(uid) {
    const n = Number(uid);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveProvenance(uid, params, creds) {
    return { userId: _resolveUserId(uid), env: _resolveEnv(params, creds) };
}

module.exports = { resolveProvenance };
