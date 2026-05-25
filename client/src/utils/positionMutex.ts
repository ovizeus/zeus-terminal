let _writeSeqCounter = 0
let _positionWriteLock = 0
let _writeDropCount = 0

export function acquirePositionWrite(): number {
  const mySeq = ++_writeSeqCounter
  if (_positionWriteLock === 0 || mySeq > _positionWriteLock) {
    _positionWriteLock = mySeq
    return mySeq
  }
  _writeDropCount++
  console.warn(`[SRV-POS] write dropped (stale seq=${mySeq}, current=${_positionWriteLock}), total drops=${_writeDropCount}`)
  return 0
}

export function releasePositionWrite(seq: number): void {
  if (_positionWriteLock === seq) _positionWriteLock = 0
}

export function getDropCount(): number {
  return _writeDropCount
}

export function getLockHeld(): number {
  return _positionWriteLock
}

export function _resetForTest(): void {
  _writeSeqCounter = 0
  _positionWriteLock = 0
  _writeDropCount = 0
}

export function _setCounterForTest(val: number): void {
  _writeSeqCounter = val
}
