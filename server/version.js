// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.11',
    build: 37,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-U b37 v1.7.11 BRAIN/DSL/AT MODE PROPAGATION FIX — two related bugs: (1) Brain set to DSL=ATR but AT positions opened by Brain activated DSL at 5% (TC globals), not the preset for ATR — caused by the DSL Proxy set trap being a no-op that dropped every write, so setMode() never actually persisted into the Zustand store; getDSLMode() read a stale legacy global; autotrade.ts captured dslModeAtOpen from a stale source; and serverAT.js entry object never serialized dslModeAtOpen. (2) DSL mode toggle dead-clicked on ATR (ATR→FAST worked, FAST→ATR did not) and lost selection after refresh — same Proxy-drop root cause plus per-user scoping broken (single localStorage key was shared across users). Fixes: client Proxy set trap now writes through to useDslStore (enabled/mode/magnet/positions), stateAccessors.getDSLMode reads the store directly with legacy global fallback, brain._applyDslMode and setDslMode call useDslStore.setState({mode}) first, boot hydration in _initBrainCockpit calls setMode(savedDsl) too, all localStorage reads/writes for dslMode are per-user-scoped (zeus_dsl_mode:{userId}), pullMerge server→client sync also invokes setMode. Server: serverAT.js entry object now includes dslModeAtOpen (= stc.dslMode when DSL enabled, null otherwise) so the authoritative position record carries the mode that was active at open — mirrors client autotrade.ts behavior. Previous: batch3-T b36 v1.7.10 (nudge/welcome z-order), batch3-S b35 v1.7.9 (PIN confirmation guard), batch3-R-hotfix b34 v1.7.8 (APK release keystore).'
};
