'use strict';
// [2026-10-09 audit B4] The settings route filters the incoming body through a
// whitelist and DISCARDS everything else with no log line at all. That is
// precisely how two real features were lost:
//   b193 — `indicators` was not whitelisted, so every save of the active
//          indicator map was dropped and nobody could tell why.
//   b248 — `overlays` the same, months later.
// In both cases the client was saving correctly, the server was answering 200,
// and the setting simply evaporated. One warning naming the rejected key would
// have turned a multi-day hunt into a grep. The filter is pure, so it is tested
// as a function rather than through the whole route.

const { _filterSettings, SETTINGS_WHITELIST } = require('../../server/routes/trading');

describe('settings whitelist reports what it throws away', () => {
    test('allowed keys pass through untouched', () => {
        const known = [...SETTINGS_WHITELIST][0];
        const { clean, dropped } = _filterSettings({ [known]: 42 });
        expect(clean[known]).toBe(42);
        expect(dropped).toEqual([]);
    });

    test('an unknown key is dropped AND named', () => {
        const { clean, dropped } = _filterSettings({ totallyNewSetting: true });
        expect(clean).toEqual({});
        expect(dropped).toEqual(['totallyNewSetting']);
    });

    test('the b193/b248 shape: a real setting missing from the whitelist is reported', () => {
        const { dropped } = _filterSettings({ indicators: { rsi14: true }, overlays: { liq: true } });
        // Both are whitelisted TODAY, so nothing should be dropped. If a future
        // edit removes either, this test says so instead of the user noticing.
        expect(dropped).toEqual([]);
    });

    test('a mix reports only the rejects', () => {
        const known = [...SETTINGS_WHITELIST][0];
        const { clean, dropped } = _filterSettings({ [known]: 1, nope: 2, alsoNope: 3 });
        expect(Object.keys(clean)).toEqual([known]);
        expect(dropped.sort()).toEqual(['alsoNope', 'nope']);
    });
});
