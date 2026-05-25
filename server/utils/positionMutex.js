'use strict';

// CJS mirror of client/src/utils/positionMutex.ts for testing.
// SINGLE SOURCE OF TRUTH: if logic changes, update both files.
// This file exists solely because root Jest config can't transpile TS imports.

let _writeSeqCounter = 0;
let _positionWriteLock = 0;
let _writeDropCount = 0;

function acquirePositionWrite() {
    const mySeq = ++_writeSeqCounter;
    if (_positionWriteLock === 0 || mySeq > _positionWriteLock) {
        _positionWriteLock = mySeq;
        return mySeq;
    }
    _writeDropCount++;
    return 0;
}

function releasePositionWrite(seq) {
    if (_positionWriteLock === seq) _positionWriteLock = 0;
}

function getDropCount() { return _writeDropCount; }
function getLockHeld() { return _positionWriteLock; }
function _resetForTest() { _writeSeqCounter = 0; _positionWriteLock = 0; _writeDropCount = 0; }

module.exports = { acquirePositionWrite, releasePositionWrite, getDropCount, getLockHeld, _resetForTest };
