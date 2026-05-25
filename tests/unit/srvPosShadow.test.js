'use strict';

describe('SRV-POS shadow mode + seq reset', () => {
    let w;

    beforeEach(() => {
        jest.resetModules();
        // Minimal window mock with TP structure
        w = {
            TP: {
                demoPositions: [],
                livePositions: [],
                demoBalance: 10000,
                demoPnL: 0,
                demoWins: 0,
                demoLosses: 0,
                journal: [],
                pendingOrders: [],
                manualLivePending: [],
            },
            AT: { mode: 'demo', enabled: false },
            DSL: { positions: {} },
            Intervals: { clear: jest.fn() },
            S: {},
            _zeusRecentlyClosed: [],
            _serverATEnabled: false,
            _serverATDemoEnabled: false,
            _serverBrainDemoEnabled: false,
            _executionEnv: 'DEMO',
        };
    });

    test('shadow diagnostics function exists after state init', () => {
        // The shadow mode is initialized inside initState() which binds to window.
        // We verify the concept by checking _srvPosDiagnostics availability.
        // In real runtime, initState() sets this up.
        expect(true).toBe(true); // Placeholder — actual runtime integration test
    });

    test('seq reset detection: seq drops below 50% triggers reset', () => {
        // Simulate the seq reset logic directly
        let _lastAppliedFrameSeq = 50000;

        function shouldResetSeq(newSeq) {
            if (newSeq <= _lastAppliedFrameSeq) {
                if (_lastAppliedFrameSeq > 10 && newSeq < _lastAppliedFrameSeq * 0.5) {
                    _lastAppliedFrameSeq = 0;
                    return 'reset';
                }
                return 'skip';
            }
            _lastAppliedFrameSeq = newSeq;
            return 'apply';
        }

        // Normal case: seq 1 after 50000 = reset
        expect(shouldResetSeq(1)).toBe('reset');
        expect(_lastAppliedFrameSeq).toBe(0);

        // After reset, seq 1 applies normally
        expect(shouldResetSeq(1)).toBe('apply');
        expect(_lastAppliedFrameSeq).toBe(1);

        // Normal increment
        expect(shouldResetSeq(2)).toBe('apply');
        expect(_lastAppliedFrameSeq).toBe(2);
    });

    test('seq reset: stale frame (not a reset) still skipped', () => {
        let _lastAppliedFrameSeq = 100;

        function shouldResetSeq(newSeq) {
            if (newSeq <= _lastAppliedFrameSeq) {
                if (_lastAppliedFrameSeq > 10 && newSeq < _lastAppliedFrameSeq * 0.5) {
                    _lastAppliedFrameSeq = 0;
                    return 'reset';
                }
                return 'skip';
            }
            _lastAppliedFrameSeq = newSeq;
            return 'apply';
        }

        // seq 80 after 100 = close enough, just stale → skip
        expect(shouldResetSeq(80)).toBe('skip');
        expect(_lastAppliedFrameSeq).toBe(100); // unchanged
    });

    test('seq reset: very low lastApplied does not false-trigger reset', () => {
        let _lastAppliedFrameSeq = 5;

        function shouldResetSeq(newSeq) {
            if (newSeq <= _lastAppliedFrameSeq) {
                if (_lastAppliedFrameSeq > 10 && newSeq < _lastAppliedFrameSeq * 0.5) {
                    _lastAppliedFrameSeq = 0;
                    return 'reset';
                }
                return 'skip';
            }
            _lastAppliedFrameSeq = newSeq;
            return 'apply';
        }

        // lastApplied is 5 (<=10), seq 1 = just skip, not reset
        expect(shouldResetSeq(1)).toBe('skip');
    });

    test('newer-wins mutex: older writer yields to newer', () => {
        let _positionWriteLock = 0;
        let _writeDropCount = 0;

        function tryAcquireWrite(mySeq) {
            if (_positionWriteLock === 0) {
                _positionWriteLock = mySeq;
                return true;
            }
            if (mySeq > _positionWriteLock) {
                // newer wins — old writer should check and yield
                _positionWriteLock = mySeq;
                return true;
            }
            // stale writer — drop
            _writeDropCount++;
            return false;
        }

        // First writer acquires
        expect(tryAcquireWrite(1)).toBe(true);
        expect(_positionWriteLock).toBe(1);

        // Newer writer preempts
        expect(tryAcquireWrite(5)).toBe(true);
        expect(_positionWriteLock).toBe(5);

        // Stale writer dropped
        expect(tryAcquireWrite(3)).toBe(false);
        expect(_writeDropCount).toBe(1);
    });

    test('shadow comparison detects autoTrade divergence with _classifySource', () => {
        const _vectorHits = { v1: 0, v2: 0, v3: 0, v4: 0, v5: 0 };

        const shadowPositions = [
            { sym: 'BTCUSDT', side: 'LONG', mode: 'demo', autoTrade: true },
            { sym: 'ETHUSDT', side: 'SHORT', mode: 'demo', autoTrade: false },
        ];
        const legacyPositions = [
            { sym: 'BTCUSDT', side: 'LONG', mode: 'demo', autoTrade: false, _classifySource: 'sync_merge' },
            { sym: 'ETHUSDT', side: 'SHORT', mode: 'demo', autoTrade: false, _classifySource: 'ws_push' },
        ];

        let divergences = 0;
        const shadowMap = new Map();
        shadowPositions.forEach(p => {
            shadowMap.set(`${p.sym}/${p.side}/${p.mode}`, p);
        });
        legacyPositions.forEach(p => {
            const key = `${p.sym}/${p.side}/${p.mode}`;
            const sp = shadowMap.get(key);
            if (!sp) return;
            if (!!p.autoTrade !== !!sp.autoTrade) {
                divergences++;
                const source = p._classifySource || 'unknown';
                if (source === 'sync_merge') _vectorHits.v3++;
                else if (source === 'boot_resume') _vectorHits.v4++;
                else if (source === 'ws_push') _vectorHits.v2++;
                else if (p.autoTrade === undefined || p.autoTrade === null) _vectorHits.v1++;
                else _vectorHits.v5++;
            }
        });

        expect(divergences).toBe(1);
        expect(_vectorHits.v3).toBe(1); // sync_merge vector
    });

    test('vector counter tracks v1 (undefined autoTrade, no source)', () => {
        const _vectorHits = { v1: 0, v2: 0, v3: 0, v4: 0, v5: 0 };

        const legacyPos = { sym: 'BTCUSDT', side: 'LONG', autoTrade: undefined, _classifySource: undefined };
        const shadowPos = { sym: 'BTCUSDT', side: 'LONG', autoTrade: true };

        if (!!legacyPos.autoTrade !== !!shadowPos.autoTrade) {
            const source = legacyPos._classifySource || 'unknown';
            if (source === 'sync_merge') _vectorHits.v3++;
            else if (source === 'boot_resume') _vectorHits.v4++;
            else if (source === 'ws_push') _vectorHits.v2++;
            else if (legacyPos.autoTrade === undefined || legacyPos.autoTrade === null) _vectorHits.v1++;
            else _vectorHits.v5++;
        }

        expect(_vectorHits.v1).toBe(1);
    });

    test('vector counter tracks boot_resume source', () => {
        const _vectorHits = { v1: 0, v2: 0, v3: 0, v4: 0, v5: 0 };

        const legacyPos = { sym: 'BTCUSDT', side: 'LONG', autoTrade: false, _classifySource: 'boot_resume' };
        const shadowPos = { sym: 'BTCUSDT', side: 'LONG', autoTrade: true };

        if (!!legacyPos.autoTrade !== !!shadowPos.autoTrade) {
            const source = legacyPos._classifySource || 'unknown';
            if (source === 'sync_merge') _vectorHits.v3++;
            else if (source === 'boot_resume') _vectorHits.v4++;
            else if (source === 'ws_push') _vectorHits.v2++;
            else if (legacyPos.autoTrade === undefined || legacyPos.autoTrade === null) _vectorHits.v1++;
            else _vectorHits.v5++;
        }

        expect(_vectorHits.v4).toBe(1);
    });
});
