'use strict';
// [2026-11-27] Operatorul: „Brain blocked ... ne bombardeaza cu mesaje — lasa doar ce e important".
// Masurat: 2.724 de blocari ale creierului intr-o zi pe contul lui (alerta: 1 / 10 min / moneda / directie →
// zeci pe ora) + „Regime Change" pana la 96 / zi. Nu mai pleaca pe Telegram; raman in audit, jurnal, Doctor,
// gandurile OMEGA. Pe Telegram raman: intrari/iesiri, esecuri, kill switch, SL lipsa, stiri alese, securitate.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../server/services/serverBrain.js'), 'utf8');

test('blocarea creierului (reflection) NU mai trimite pe Telegram', () => {
    expect(src).not.toMatch(/sendToUser\([^)]*buildReflectionAlert/);
});
test('schimbarea de regim NU mai trimite pe Telegram', () => {
    expect(src).not.toMatch(/sendToUser\(userId, _regimeMsg\)/);
});
test('evenimentele raman inregistrate (audit REFLECTION_BLOCKED + saveRegimeChange)', () => {
    expect(src).toContain("record('REFLECTION_BLOCKED'");
    expect(src).toContain('db.saveRegimeChange(');
});
