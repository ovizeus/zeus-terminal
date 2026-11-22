import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [2026-11-22] „Intru iar in aplicatie si se incarca ~10 s": cele 4 cereri de pornire pleaca
// odata, nu una dupa alta; ordinea de APLICARE ramane flaguri → sync → AT → DSL.
describe('pornirea: cererile pleaca in paralel, se aplica in aceeasi ordine', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bootstrapStartApp.ts'), 'utf8')
  it('toate patru pornesc inainte de primul await', () => {
    const firstAwait = src.indexOf('await _pfFlags')
    for (const u of ['/api/migration/flags', '/api/at/state', '/api/sync/state', '/api/dsl/toggle']) {
      const at = src.indexOf(`fetch('${u}'`)
      expect(at).toBeGreaterThan(-1)
      expect(at).toBeLessThan(firstAwait)
    }
  })
  it('ordinea de aplicare: flaguri, apoi AT+sync, apoi DSL', () => {
    const f = src.indexOf('await _pfFlags'), a = src.indexOf('await Promise.all([_pfAt, _pfSync])'), d = src.indexOf('await _pfDsl')
    expect(f).toBeLessThan(a)
    expect(a).toBeLessThan(d)
  })
})
