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
        // PageView system uses #zeusPageView DOM container — check if visible
        const pv = document.getElementById('zeusPageView');
        if (pv && pv.style.display !== 'none' && pv.offsetParent !== null) return true;
        // Alternative class-based check
        if (document.querySelector('.zpv.zpv-open, .zpv[data-open="true"]')) return true;
    } catch (_) { /* fall through */ }
    return false;
}

function _closeModal(): void {
    try {
        document.dispatchEvent(new Event('zeus:closeModal'));
    } catch (_) { /* swallow */ }
}

function _closePageView(): void {
    try {
        if (typeof w.closePageView === 'function') {
            w.closePageView();
        }
    } catch (_) { /* swallow */ }
}

async function _handleBack(): Promise<void> {
    // Priority 1: Modal open → close it
    if (_isModalOpen()) {
        _closeModal();
        return;
    }
    // Priority 2: PageView open → close it
    if (_isPageViewOpen()) {
        _closePageView();
        return;
    }
    // Priority 3: Root dashboard — confirm-to-exit
    const now = Date.now();
    if (now - _lastBackPress < EXIT_CONFIRM_MS) {
        try {
            await App.exitApp();
        } catch (_) { /* may not be available on some Android versions */ }
        return;
    }
    _lastBackPress = now;
    _toast('Apasă Back din nou pentru a închide Zeus');
}

export function initBackButtonHandler(): void {
    // Web context: plugin no-op, skip entirely
    try {
        if (!Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) {
            return;
        }
    } catch (_) {
        return;
    }
    try {
        App.addListener('backButton', _handleBack);
        // Best-effort log pentru debug
        try { (w.ZLOG || console).info && (w.ZLOG ? w.ZLOG.push('MOB', '[MOB-5] backButton listener attached') : console.info('[MOB-5] backButton listener attached')); } catch (_) {}
    } catch (e) {
        try { console.warn('[MOB-5] Failed to attach backButton listener:', (e as Error).message); } catch (_) {}
    }
}
