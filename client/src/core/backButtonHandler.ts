// Zeus Terminal — Android Back Button Handler (MOB-5 2026-05-13)
//
// Implementează handler nativ pentru butonul Back fizic Android via @capacitor/app.
// No-op pe web — plugin absent în browser context (Capacitor.isNativePlatform=false).
//
// Comportament:
//   1. Modal open      → trigger 'zeus:closeModal' event (modal-aware components dismiss)
//   2. PageView open   → call window.closePageView() (Zeus dock module panel)
//   3. Root/dashboard  → toast confirmation; second Back înăuntru 2s → App.exitApp()
//
// Anterior fără handler: Back fizic Android închidea TOATĂ aplicația (frustrant pe
// navigare normală). Acum Back devine UI-natural în loc de app-killer.
//
// Refs: OPEN_BUGS_PRIORITY_RANKING.md MOB-5 + audit doc origin.

'use strict';

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

const w = window as any;
let _lastBackPress = 0;
const EXIT_CONFIRM_MS = 2000;

function _toast(msg: string): void {
    try {
        if (typeof w.toast === 'function') {
            w.toast(msg, 1800);
            return;
        }
    } catch (_) { /* fallback */ }
    // Fallback minimal toast dacă w.toast absent
    try {
        let t = document.getElementById('zeus-back-toast') as any;
        if (!t) {
            t = document.createElement('div');
            t.id = 'zeus-back-toast';
            t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
                'background:rgba(0,0,0,0.85);color:#fff;padding:10px 18px;border-radius:6px;' +
                'font-size:13px;z-index:99999;pointer-events:none;font-family:var(--ff,system-ui);' +
                'border:1px solid rgba(255,255,255,0.15);';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = '1';
        clearTimeout(t._zbt);
        t._zbt = setTimeout(() => { t.style.opacity = '0'; }, 1800);
    } catch (_) { /* swallow */ }
}

function _isModalOpen(): boolean {
    // Strategy: check Zustand store via window.* OR DOM presence
    try {
        // Method 1: useUiStore.modalOpen state (if exposed)
        const stores = w.zeusStores || {};
        const ui = stores.ui;
        if (ui && typeof ui.getState === 'function') {
            const state = ui.getState();
            if (state && state.modalOpen) return true;
        }
    } catch (_) { /* fall through */ }
    try {
        // Method 2: DOM check for any .modal-open OR .mover (legacy modal overlay)
        const moverActive = document.querySelector('.mover[style*="display:flex"]:not([style*="display:none"])');
        if (moverActive) return true;
        const modalActive = document.querySelector('.modal:not([style*="display:none"]), .z-modal--open, .dlog-overlay:not([style*="display:none"])');
        if (modalActive) return true;
    } catch (_) { /* fall through */ }
    return false;
}

function _isPageViewOpen(): boolean {
    try {
        // [BUG-FIX 2026-05-13 evening] PageView.tsx renders <div className="zpv"
        // id="zeus-page-view">. Element exists ONLY when active panel open
        // (mounted/unmounted by React conditional render). Cele 3 selectors
        // pentru defense-in-depth:
        const pv1 = document.getElementById('zeus-page-view');
        if (pv1) return true;
        const pv2 = document.querySelector('.zpv');
        if (pv2) return true;
        const pv3 = document.querySelector('.zpv-content');
        if (pv3) return true;
    } catch (_) { /* fall through */ }
    return false;
}

function _findPageViewBackBtn(): HTMLElement | null {
    try {
        const btn = document.querySelector('.zpv-back') as HTMLElement | null;
        return btn;
    } catch (_) {
        return null;
    }
}

function _closeModal(): void {
    try {
        document.dispatchEvent(new Event('zeus:closeModal'));
    } catch (_) { /* swallow */ }
}

function _closePageView(): void {
    try {
        // [BUG-FIX 2026-05-13 evening] React PageView component renders own
        // <button className="zpv-back" onClick={onClose}>. Simplest reliable
        // way to close = simulate click pe acel button (calls React onClose
        // handler ce updates store properly). Window.closePageView (legacy
        // fallback) NU funcționează cu noul React PageView.
        const backBtn = _findPageViewBackBtn();
        if (backBtn && typeof backBtn.click === 'function') {
            backBtn.click();
            return;
        }
        // Fallback la legacy pageview.ts API
        if (typeof w.closePageView === 'function') {
            w.closePageView();
        }
    } catch (_) { /* swallow */ }
}

async function _handleBack(): Promise<void> {
    // [DIAG 2026-05-13] Console diagnostic — visible via Chrome remote
    // debugging (chrome://inspect from desktop while phone connected).
    try { console.log('[MOB-5] backButton fired — handler running'); } catch (_) {}
    // Priority 1: Modal open → close it
    if (_isModalOpen()) {
        try { console.log('[MOB-5] modal detected → closing'); } catch (_) {}
        _closeModal();
        return;
    }
    // Priority 2: PageView open → close it
    if (_isPageViewOpen()) {
        try { console.log('[MOB-5] pageView detected → closing'); } catch (_) {}
        _closePageView();
        return;
    }
    // Priority 3: Root dashboard — confirm-to-exit
    const now = Date.now();
    if (now - _lastBackPress < EXIT_CONFIRM_MS) {
        try { console.log('[MOB-5] confirm-exit timeout → exitApp()'); } catch (_) {}
        try {
            await App.exitApp();
        } catch (_) { /* may not be available on some Android versions */ }
        return;
    }
    _lastBackPress = now;
    try { console.log('[MOB-5] root dashboard — show confirm-exit toast'); } catch (_) {}
    _toast('Press Back again to close Zeus');
}

export function initBackButtonHandler(): void {
    // [DIAG 2026-05-13] Always log init attempt — visible via Chrome
    // remote debugging (chrome://inspect cu phone connected).
    try {
        const isNative = Capacitor.isNativePlatform && Capacitor.isNativePlatform();
        console.log('[MOB-5] init called. isNativePlatform=' + isNative + ', Capacitor obj=' + typeof Capacitor);
        if (!isNative) {
            console.log('[MOB-5] Web context detected — handler SKIPPED');
            return;
        }
    } catch (e: any) {
        console.warn('[MOB-5] init platform check failed:', e?.message || e);
        return;
    }
    // [MOB-5 PROMISE-CATCH 2026-05-14] `App.addListener()` returns a Promise.
    // Pe APK-uri vechi (pre-FOLLOWUP-3, fără `registerPlugin(AppPlugin.class)`),
    // promise-ul rejectează cu '"App" plugin is not implemented on android'.
    // Fără .catch() rejection rămâne unhandled → bootstrapError.ts:_showDegradedBanner
    // fires → user vede "ENGINE ERROR — fallback mode active" banner. .catch()
    // swallow → banner NU mai apare. Functional impact: back button still won't
    // work on old APK (need to install latest v1.7.13+), but app stays clean.
    try {
        const _addRes: any = App.addListener('backButton', _handleBack);
        if (_addRes && typeof _addRes.catch === 'function') {
            _addRes.catch((e: any) => {
                console.warn('[MOB-5] addListener rejection (likely old APK without AppPlugin registered):', e?.message || e);
            });
        }
        console.log('[MOB-5] backButton listener attach attempted on native platform');
    } catch (e: any) {
        console.warn('[MOB-5] Failed to attach backButton listener (sync):', e?.message || e);
    }
}
