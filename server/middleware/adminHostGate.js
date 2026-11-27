'use strict';
/**
 * [2026-11-27] Securitate etapa 2 — adminul pe un subdomeniu separat (ex. admin.zeus-terminal.com), cu
 * Cloudflare Access in fata lui (cod pe email inainte sa vezi pagina).
 *
 * INACTIV pana la `ADMIN_HOST=admin.zeus-terminal.com` in .env. Activ: /auth/admin/* si /api/admin/*
 * raspund 404 pe ORICE alt domeniu — altfel Access s-ar ocoli prin domeniul principal.
 * Hostul se ia din antetul Host (nginx: `proxy_set_header Host $host`), NU din X-Forwarded-Host
 * (cu `trust proxy` Express l-ar crede, iar oricine il poate trimite).
 * Pasii pentru operator sunt in Book (2026-11-27, „Admin separat").
 */
const ADMIN_PATHS = ['/auth/admin/', '/api/admin/'];

function adminHostOf(env) {
    const h = String((env && env.ADMIN_HOST) || '').trim().toLowerCase();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
}

function createAdminHostGate(getHost) {
    return function adminHostGate(req, res, next) {
        const want = getHost();
        if (!want) return next();
        const p = req.path || '';
        if (!ADMIN_PATHS.some((x) => p.startsWith(x) || p === x.slice(0, -1))) return next();
        const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
        if (host === want) return next();
        return res.status(404).json({ error: 'Not found' });
    };
}

module.exports = { createAdminHostGate, adminHostOf, ADMIN_PATHS };
