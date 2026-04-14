// Zeus Terminal — Sentry Instrumentation
// MUST be imported before any other modules in server.js
'use strict';

const Sentry = require('@sentry/node');

const DSN = process.env.SENTRY_DSN;
if (DSN) {
    Sentry.init({
        dsn: DSN,
        environment: process.env.NODE_ENV || 'production',
        release: (() => {
            try { const v = require('./version'); return `zeus-terminal@${v.version}-b${v.build}`; }
            catch (_) { return 'zeus-terminal@unknown'; }
        })(),
        sendDefaultPii: true,
        tracesSampleRate: 0.2,
        beforeSend(event) {
            if (event.exception && event.exception.values) {
                const msg = event.exception.values[0] && event.exception.values[0].value;
                if (msg && (msg.includes('ECONNRESET') || msg.includes('EPIPE'))) return null;
            }
            return event;
        },
    });
} else {
    console.warn('[sentry] SENTRY_DSN not set — error reporting disabled');
}

module.exports = Sentry;
