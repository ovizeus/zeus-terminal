import { describe, it, expect, beforeEach } from 'vitest'
import { pinHintGet, pinHintSet, lockEarlyIfKnown } from '../pinHint'
import { usePinLockStore } from '../../stores/pinLockStore'

// [2026-11-15] „Intru in aplicatie si abia dupa 1,5–2 s imi cere amprenta."
// Lacatul se pune la autentificare daca dispozitivul stie ca acel cont are PIN.
describe('pinHint', () => {
    beforeEach(() => { localStorage.clear(); sessionStorage.clear(); usePinLockStore.getState().setVisible(false) })

    it('semnul e pe CONT: alt cont de pe acelasi telefon nu e blocat', () => {
        pinHintSet('7', true)
        expect(pinHintGet('7')).toBe(true)
        expect(pinHintGet('8')).toBe(false)
        expect(pinHintGet(null)).toBe(false)
    })
    it('⛔ cont cu PIN, sesiune nedeblocata → lacatul e pus imediat, inainte de orice cerere', () => {
        pinHintSet('7', true)
        expect(lockEarlyIfKnown('7')).toBe(true)
        expect(usePinLockStore.getState().visible).toBe(true)
    })
    it('sesiune deja deblocata (refresh) → nu se pune', () => {
        pinHintSet('7', true); sessionStorage.setItem('zeus_pin_unlocked', '1')
        expect(lockEarlyIfKnown('7')).toBe(false)
        expect(usePinLockStore.getState().visible).toBe(false)
    })
    it('PIN scos → semnul dispare si nu mai blocheaza', () => {
        pinHintSet('7', true); pinHintSet('7', false)
        expect(lockEarlyIfKnown('7')).toBe(false)
    })
})
