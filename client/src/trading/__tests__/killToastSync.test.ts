import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [2026-11-15] „WARNING Kill switch active — press RESET or wait for next day"
// nu disparea: sincronizarea cu serverul chema _applyATToggleUI la fiecare ciclu
// si mesajul se reafisa. Sincronizarea trebuie sa fie tacuta.
const SRC = path.join(__dirname, '..', '..')
describe('mesajul de kill switch nu e reafisat de sincronizare', () => {
    it('state.ts cheama _applyATToggleUI cu silent', () => {
        const st = fs.readFileSync(path.join(SRC, 'core', 'state.ts'), 'utf8')
        const calls = st.split('\n').filter((l) => /_applyATToggleUI\(state/.test(l))
        expect(calls.length).toBeGreaterThan(0)
        for (const c of calls) expect(c).toContain('silent: true')
    })
    it('mesajul e sub garda silent si nu e lipit (durata > 0)', () => {
        const at = fs.readFileSync(path.join(SRC, 'trading', 'autotrade.ts'), 'utf8')
        const line = at.split('\n').find((l) => l.includes('press RESET or wait for next day'))!
        expect(line).toContain('!opts?.silent')
        expect(line).not.toMatch(/,\s*0\s*,/)
    })
})
