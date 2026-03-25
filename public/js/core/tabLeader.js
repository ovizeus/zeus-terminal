// ═══════════════════════════════════════════════════════════════════
// [B1] TAB LEADER ELECTION — localStorage heartbeat
// Only the leader tab runs AT execution. All tabs run brain display.
// Fail-open: if leader heartbeat goes stale (>5s), any tab takes over.
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    var KEY = 'zeus_tab_leader';
    var HEARTBEAT_MS = 3000;
    var STALE_MS = 5000;
    var tabId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var _isLeader = false;
    var _heartbeatTimer = null;

    function _read() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (_) { return null; }
    }

    function _write() {
        try {
            localStorage.setItem(KEY, JSON.stringify({ id: tabId, ts: Date.now() }));
        } catch (_) { }
    }

    function _startHeartbeat() {
        if (_heartbeatTimer) clearInterval(_heartbeatTimer);
        _heartbeatTimer = setInterval(function () {
            if (_isLeader) _write();
        }, HEARTBEAT_MS);
    }

    function claim() {
        var current = _read();
        if (!current || current.id === tabId || (Date.now() - current.ts) > STALE_MS) {
            _isLeader = true;
            _write();
            _startHeartbeat();
            console.log('[TabLeader] \uD83D\uDC51 This tab is LEADER (' + tabId + ')');
            return true;
        }
        _isLeader = false;
        console.log('[TabLeader] \uD83D\uDCCB This tab is FOLLOWER (leader=' + current.id + ')');
        return false;
    }

    function release() {
        if (!_isLeader) return;
        var current = _read();
        if (current && current.id === tabId) {
            try { localStorage.removeItem(KEY); } catch (_) { }
        }
        _isLeader = false;
        if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
    }

    // Called each AT cycle — checks if we're leader, claims if vacant/stale (fail-open)
    function checkLeader() {
        var current = _read();
        if (!current || current.id === tabId) {
            if (!_isLeader) {
                _isLeader = true;
                _startHeartbeat();
                _write();
                console.log('[TabLeader] \uD83D\uDC51 Claimed leadership (was vacant)');
            }
            return true;
        }
        if ((Date.now() - current.ts) > STALE_MS) {
            _isLeader = true;
            _write();
            _startHeartbeat();
            console.log('[TabLeader] \uD83D\uDC51 Claimed leadership (previous leader stale)');
            return true;
        }
        _isLeader = false;
        return false;
    }

    // Auto-claim on load
    claim();

    // Listen for storage events from other tabs
    window.addEventListener('storage', function (e) {
        if (e.key !== KEY) return;
        if (!e.newValue) {
            // Leader released — try to claim after small jitter
            setTimeout(function () {
                claim();
                // [S2B1-T3] Read-after-write verification: re-check after 200ms to detect dual-claim race
                if (_isLeader) {
                    setTimeout(function () {
                        var check = _read();
                        if (check && check.id !== tabId) {
                            // Another tab won the race — yield leadership
                            _isLeader = false;
                            if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
                            console.log('[TabLeader] Yielded — another tab (' + check.id + ') won race');
                        }
                    }, 200);
                }
            }, 50 + Math.random() * 100);
        } else {
            try {
                var data = JSON.parse(e.newValue);
                if (data.id !== tabId) { _isLeader = false; }
            } catch (_) { }
        }
    });

    window.TabLeader = {
        isLeader: function () { return _isLeader; },
        checkLeader: checkLeader,
        claim: claim,
        release: release,
        tabId: tabId
    };
})();
