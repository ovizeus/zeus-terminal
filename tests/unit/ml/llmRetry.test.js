'use strict';
// [2026-11-02] Cand Groq refuza trecator, replica lui OMEGA murea de tot si
// operatorul primea un sablon care-i spunea sa astepte 30 de secunde. Rar — 5
// din 310 replici — dar o pierdere inutila: al doilea apel reuseste aproape
// mereu. O SINGURA reincercare, si doar pe ce are sens sa fie reincercat.
const llm = require('../../../server/services/ml/_voice/llmClient');

describe('isRetryableStatus', () => {
    it('se reincearca ce e trecator: prea des, sau partea lor', () => {
        for (const s of [408, 429, 500, 502, 503, 504]) expect(llm.isRetryableStatus(s)).toBe(true);
    });

    it('REGRESIE: NU se reincearca ce nu se repara prin repetare', () => {
        // Un 401 inseamna cheie gresita si un 404 model retras (s-a intamplat
        // pe 7 octombrie). A repeta ar arde doar o secunda din timpul omului.
        for (const s of [400, 401, 403, 404, 422]) expect(llm.isRetryableStatus(s)).toBe(false);
    });

    it('ce nu e numar nu e stare — Number(null) e 0 si trece de isFinite', () => {
        for (const v of [null, undefined, NaN, '429', true, {}]) expect(llm.isRetryableStatus(v)).toBe(false);
    });

    it('pauza e scurta — omul asteapta raspunsul, nu un algoritm de backoff', () => {
        expect(llm.RETRY_AFTER_MS).toBeGreaterThan(0);
        expect(llm.RETRY_AFTER_MS).toBeLessThanOrEqual(1500);
    });
});
