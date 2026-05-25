import {
  acquirePositionWrite,
  releasePositionWrite,
  getDropCount,
  getLockHeld,
  _resetForTest,
  _setCounterForTest,
} from '../../client/src/utils/positionMutex'

beforeEach(() => {
  _resetForTest()
})

describe('acquirePositionWrite', () => {
  test('first acquire succeeds when lock is free', () => {
    const seq = acquirePositionWrite()
    expect(seq).toBe(1)
    expect(getLockHeld()).toBe(1)
  })

  test('sequential acquires always succeed (newer-wins)', () => {
    const seq1 = acquirePositionWrite()
    const seq2 = acquirePositionWrite()
    expect(seq1).toBe(1)
    expect(seq2).toBe(2)
    expect(getLockHeld()).toBe(2)
    expect(getDropCount()).toBe(0)
  })

  test('older writer dropped when lock held by newer (simulated async interleave)', () => {
    // Simulate: WS push already acquired at seq=10
    _setCounterForTest(9)
    acquirePositionWrite() // seq=10, lock=10

    // Now simulate liveApi resuming from before WS — counter was at 3 when it started
    _setCounterForTest(2)
    const staleSeq = acquirePositionWrite() // seq=3, lock=10 → 3 < 10 → DROP
    expect(staleSeq).toBe(0)
    expect(getDropCount()).toBe(1)
  })

  test('multiple drops increment counter correctly', () => {
    _setCounterForTest(99)
    acquirePositionWrite() // seq=100, lock=100

    _setCounterForTest(0)
    acquirePositionWrite() // seq=1, DROP
    acquirePositionWrite() // seq=2, DROP
    acquirePositionWrite() // seq=3, DROP
    expect(getDropCount()).toBe(3)
  })
})

describe('releasePositionWrite', () => {
  test('release with correct seq frees the lock', () => {
    const seq = acquirePositionWrite()
    releasePositionWrite(seq)
    expect(getLockHeld()).toBe(0)
  })

  test('release with wrong seq does NOT free the lock', () => {
    const seq = acquirePositionWrite()
    releasePositionWrite(999)
    expect(getLockHeld()).toBe(seq)
  })

  test('release after newer writer took over is a no-op', () => {
    const seq1 = acquirePositionWrite()
    const seq2 = acquirePositionWrite() // newer, takes lock
    releasePositionWrite(seq1) // old seq, lock still at seq2
    expect(getLockHeld()).toBe(seq2)
    releasePositionWrite(seq2)
    expect(getLockHeld()).toBe(0)
  })
})

describe('integration patterns', () => {
  test('liveApiSyncState pattern: acquire → work → release', () => {
    const seq = acquirePositionWrite()
    expect(seq).toBeGreaterThan(0)
    // ... do work (await getPositions etc)
    releasePositionWrite(seq)
    expect(getLockHeld()).toBe(0)
  })

  test('WS preempts liveApi: liveApi acquires, WS acquires newer, liveApi release is no-op', () => {
    const liveApiSeq = acquirePositionWrite() // seq=1
    const wsSeq = acquirePositionWrite()       // seq=2, newer, takes lock
    expect(getLockHeld()).toBe(wsSeq)

    // liveApi tries to release its old seq — no-op
    releasePositionWrite(liveApiSeq)
    expect(getLockHeld()).toBe(wsSeq) // still held by WS

    // WS releases
    releasePositionWrite(wsSeq)
    expect(getLockHeld()).toBe(0)
  })

  test('boot restore: acquires, if 0 skips safely', () => {
    // Simulate WS already holding lock
    _setCounterForTest(99)
    acquirePositionWrite() // seq=100, lock=100

    _setCounterForTest(0)
    const bootSeq = acquirePositionWrite() // seq=1, lock=100 → DROP
    expect(bootSeq).toBe(0)
    // Boot skips — positions will come from WS instead
    expect(getDropCount()).toBe(1)
  })
})

describe('_resetForTest', () => {
  test('clears all state', () => {
    acquirePositionWrite()
    _setCounterForTest(99)
    acquirePositionWrite()
    _resetForTest()
    expect(getLockHeld()).toBe(0)
    expect(getDropCount()).toBe(0)
  })
})
