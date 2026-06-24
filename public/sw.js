const CACHE_VERSION = 'zt-v175-b84-legal';
// SW_BUILD_TAG: 2026-04-30T22-00-login-network-only
// Bump this comment whenever sw.js logic changes — forces byte-level diff
// so browsers detect the update and reinstall (skipWaiting + clients.claim).
const CACHE_NAME = `zt-cache-${CACHE_VERSION}`;
// /login.html is intentionally NOT in this list — it must always come fresh from network.
const ASSETS = [
    '/css/main.css',
    '/css/components.css',
    '/css/themes.css',
    '/manifest.json',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
];

function _isLoginHtml(urlStr) {
    try {
        const u = new URL(urlStr);
        return u.pathname === '/login.html' || u.pathname === '/' || u.pathname === '';
    } catch (_) { return false; }
}

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        // Drop any other (older) caches.
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
        // Defensive: even within the current cache, purge any /login.html entry
        // left over from previous SW versions that DID precache it.
        try {
            const cache = await caches.open(CACHE_NAME);
            const reqs = await cache.keys();
            await Promise.all(reqs.filter(r => _isLoginHtml(r.url)).map(r => cache.delete(r)));
        } catch (_) {}
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    // Cache API only supports GET — let the browser handle non-GET natively
    if (event.request.method !== 'GET') return;
    const url = event.request.url;

    // /login.html — strict network-only, NEVER cache, NEVER serve stale.
    // This guarantees ticker code and any future login.html change reach every user
    // on the next page load with no manual cache clear required.
    if (_isLoginHtml(url)) {
        event.respondWith(
            fetch(event.request, { cache: 'no-store' }).catch(() =>
                new Response('<html><body style="background:#0a0f16;color:#fff;font-family:sans-serif;text-align:center;padding-top:40px;font-size:18px">Zeus Terminal is offline — reconnecting</body></html>', {
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );
        return;
    }

    const isApi = url.includes('/api/') || url.includes('binance.com') || url.includes('bybit.com') || url.includes('alternative.me') || url.includes('coingecko.com');
    const isExternal = url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com') || url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com') || url.includes('cdnjs.cloudflare.com');
    if (isApi || isExternal) {
        // Network only — do NOT call respondWith so browser handles it natively
        return;
    }
    // [2026-06-24] File downloads (APK etc.) — NEVER let the SW intercept. A navigation to an
    // attachment (Content-Disposition) served back through respondWith() silently fails to
    // download on mobile/standalone PWA, and we'd also try to cache a ~30MB file. Bare return =
    // the browser performs the native download.
    if (url.indexOf('/download/') !== -1 || url.indexOf('.apk') !== -1) {
        return;
    }
    // Navigation requests (other HTML pages) — network first with offline fallback
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).then(resp => {
                if (resp && resp.status === 200) {
                    const respClone = resp.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
                }
                return resp;
            }).catch(() =>
                caches.match(event.request).then(cached =>
                    cached || new Response('<html><body style="background:#0a0f16;color:#fff;font-family:sans-serif;text-align:center;padding-top:40px;font-size:18px">Zeus Terminal is offline — reconnecting</body></html>', {
                        headers: { 'Content-Type': 'text/html' }
                    })
                )
            )
        );
        return;
    }
    // Static assets (icons, manifest) — cache first
    const isStaticAsset = ASSETS.some(asset => url.endsWith(asset) && !url.endsWith('/') && !url.endsWith('/index.html'));
    if (isStaticAsset) {
        event.respondWith(
            caches.match(event.request).then(resp => resp || fetch(event.request))
        );
        return;
    }
    // Everything else (JS/CSS) — network first with cache fallback
    event.respondWith(
        fetch(event.request).then(resp => {
            if (resp && resp.status === 200) {
                const respClone = resp.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
            }
            return resp;
        }).catch(() => caches.match(event.request).then(cached => cached || Response.error()))
    );
});

// Listen for SKIP_WAITING
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});