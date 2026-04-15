const CACHE_VERSION = 'zt-v160-b25';
const CACHE_NAME = `zt-cache-${CACHE_VERSION}`;
const ASSETS = [
    '/login.html',
    '/css/main.css',
    '/css/components.css',
    '/css/themes.css',
    '/manifest.json',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    // Cache API only supports GET — let the browser handle non-GET natively
    if (event.request.method !== 'GET') return;
    const url = event.request.url;
    const isApi = url.includes('/api/') || url.includes('binance.com') || url.includes('bybit.com') || url.includes('alternative.me');
    const isExternal = url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com') || url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com') || url.includes('cdnjs.cloudflare.com');
    if (isApi || isExternal) {
        // Network only — do NOT call respondWith so browser handles it natively
        return;
    }
    // Navigation requests (HTML pages) — network first with offline fallback
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