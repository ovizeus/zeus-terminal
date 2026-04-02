// Zeus Terminal — Sentry Instrumentation
// MUST be imported before any other modules in server.js
'use strict';

const Sentry = require('@sentry/node');

Sentry.init({
    dsn: process.env.SENTRY_DSN || 'https://c34e302cfbc932bf228713c699d0bfb3@o4511152491855872.ingest.de.sentry.io/4511152522395728',
    environment: process.env.NODE_ENV || 'production',
    release: (() => {
        try { const v = require('./version'); return `zeus-terminal@${v.version}-b${v.build}`; }
        catch (_) { return 'zeus-terminal@unknown'; }
    })(),
    sendDefaultPii: true,
    // Performance: sample 20% of transactions (adjust as needed)
    tracesSampleRate: 0.2,
    // Don't send expected errors (rate limit 429s, auth 401s)
    beforeSend(event) {
        if (event.exception && event.exception.values) {
            const msg = event.exception.values[0] && event.exception.values[0].value;
            // Skip noisy expected errors
            if (msg && (msg.includes('ECONNRESET') || msg.includes('EPIPE'))) return null;
        }
        return event;
    },
});

module.exports = Sentry;
