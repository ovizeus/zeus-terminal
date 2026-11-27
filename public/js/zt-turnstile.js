/* [2026-11-27] Cloudflare Turnstile pentru login / inscriere / resetare — folosit de pagina de
 * start (login.html) SI de aplicatia React (core/turnstile.ts il incarca), ca sa existe o singura
 * implementare.
 *
 *   window.ztTurnstileToken() → Promise<string|undefined>
 *     - undefined: Turnstile nu e pornit pe server (fara cheie) — cererea pleaca exact ca inainte;
 *     - string: un token NOU (Cloudflare accepta fiecare token o singura data);
 *     - null: verificarea n-a reusit (serverul va refuza; utilizatorul reincearca).
 * Widget-ul apare doar cand Cloudflare chiar are nevoie de o bifa (appearance: interaction-only).
 */
(function () {
    'use strict';
    if (window.ztTurnstileToken) return;
    var state = { cfg: null, ready: null, id: null, waiters: [] };

    function config() {
        if (!state.cfg) {
            state.cfg = fetch('/auth/turnstile-config', { credentials: 'same-origin' })
                .then(function (r) { return r.ok ? r.json() : {}; })
                .then(function (j) { return (j && typeof j.siteKey === 'string' && j.siteKey) ? j.siteKey : null; })
                .catch(function () { return null; });
        }
        return state.cfg;
    }

    function finish(token) {
        var w = state.waiters; state.waiters = [];
        for (var i = 0; i < w.length; i++) w[i](token);
    }

    function load(siteKey) {
        if (state.ready) return state.ready;
        state.ready = new Promise(function (resolve) {
            var box = document.createElement('div');
            box.id = 'zt-turnstile';
            box.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:100000';
            document.body.appendChild(box);
            window.__ztTurnstileOnload = function () {
                state.id = window.turnstile.render('#zt-turnstile', {
                    sitekey: siteKey,
                    execution: 'execute',
                    appearance: 'interaction-only',
                    callback: function (t) { finish(t); },
                    'error-callback': function () { finish(null); },
                    'expired-callback': function () { finish(null); },
                });
                resolve(true);
            };
            var s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__ztTurnstileOnload';
            s.async = true;
            s.onerror = function () { resolve(false); };
            document.head.appendChild(s);
        });
        return state.ready;
    }

    window.ztTurnstileToken = function () {
        return config().then(function (siteKey) {
            if (!siteKey) return undefined;
            return load(siteKey).then(function (ok) {
                if (!ok || !window.turnstile || state.id == null) return null;
                return new Promise(function (resolve) {
                    var done = false;
                    state.waiters.push(function (t) { if (!done) { done = true; resolve(t); } });
                    setTimeout(function () { if (!done) { done = true; resolve(null); } }, 30000);
                    try { window.turnstile.reset(state.id); window.turnstile.execute(state.id); } catch (_) { finish(null); }
                });
            });
        });
    };
})();
