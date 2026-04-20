// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.53',
    build: 79,
    date: '2026-04-20',
    changelog: [
        'Post-v2 batch31 b79 v1.7.53 — Phase 10.20.1 DSL PER-MODE + TOAST HOTFIX. Bug1 (DSL demo↔live bleed despite b78): b78 wired brain[mode].dslSettings through the persistence layer but applyBrainCfgForMode wrote to the legacy USER_SETTINGS.dslSettings blob (which nothing else reads) and only dispatched a custom event — useDslStore (the real canonical source for DSL mode/magnet/enabled) + the per-user LS key zeus_dsl_mode:<uid> + window.DSL Proxy + DOM radios (#dsl-atr/fast/swing/defensive/tp) stayed on the previous mode values. Fix: applyBrainCfgForMode dslSettings block now applies cfg.dsl → useDslStore.setMode/setMagnet/setEnabled + LS key + window.DSL + DOM radio buttons. _usSave brain slot snapshots useDslStore.getState() (mode/enabled/magnetEnabled/magnetMode) directly instead of reading the ghost USER_SETTINGS.dslSettings blob. _seedBrainFromFlat seeds dslSettings from current useDslStore state on first-boot if slot empty. Bug2 (toast LIVE showed DEMO): _executeGlobalModeSwitch line 70 had a fallback else that emitted "Demo Mode Activated" when _executionEnv was undefined — changed to "Live Trading Mode Activated" so LIVE switch always shows a LIVE-flavored toast. Files: config.ts (applyBrainCfgForMode+_usSave+_seedBrainFromFlat), marketDataTrading.ts (toast fallback). Backups: config.ts.bak.b79, marketDataTrading.ts.bak.b79, version.js.bak.b79.',
        'Previous: b78 v1.7.52 — Phase 10.20 BRAIN/AT/DSL FULL PER-MODE SPLIT. b77 v1.7.51 — Phase 10.19 CHART DRIFT HOTFIX REVERT B73. b76 v1.7.50 — Phase 10.18.2 BRAIN SPLIT SECOND SWITCH PATH FIX. b75 v1.7.49 — Phase 10.18.1 BRAIN MODE SYNC HOTFIX. b74 v1.7.48 — Phase 10.18 BRAIN DEMO/LIVE NAMESPACE SPLIT. b73 v1.7.47 — Phase 10.17 CHART UX PACK. b72 v1.7.46 — Phase 10.16 DESKTOP CHART WIDTH DRIFT FIX.'
    ].join(' '),
};
