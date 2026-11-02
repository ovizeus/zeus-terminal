'use strict';

/**
 * LLM client — free-tier OpenAI-compatible API wrapper for Omega chat fallback.
 *
 * Auto-detects provider from env vars:
 *   XAI_API_KEY  → xAI Grok (grok-2-latest)         api.x.ai/v1
 *   GROQ_API_KEY → Groq openai/gpt-oss-120b           api.groq.com/openai/v1
 *
 * If both present, xAI is preferred (operator-set). Falls back to Groq.
 * If neither, available()=false → caller falls back to local responder.
 *
 * All errors (timeout, http != 200, malformed) return { ok: false }.
 */

const DEFAULT_TIMEOUT_MS = 8000;

// [2026-11-02] O singura reincercare pe un refuz TRECATOR.
//
// Nu exista niciuna pana azi: cand Groq raspundea 429, replica lui OMEGA murea
// de tot si operatorul primea un sablon care-i spunea sa astepte 30 de secunde.
// Rar — 5 din 310 replici, 1,6% — dar o pierdere inutila, fiindca al doilea
// apel reuseste aproape mereu.
//
// Se reincearca DOAR ce are sens: 429 (prea des) si 5xx (partea lor). Un 401
// sau un 400 nu se repara prin repetare si a repeta ar insemna doar sa mai arzi
// o secunda din timpul omului.
const RETRY_AFTER_MS = 700;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function isRetryableStatus(status) {
    // Tipul inaintea valorii: Number(null) e 0 si trece de isFinite.
    if (typeof status !== 'number' || !Number.isFinite(status)) return false;
    return RETRYABLE.has(status);
}

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function _resolveProvider() {
    if (process.env.XAI_API_KEY) {
        return {
            name: 'xai',
            url: 'https://api.x.ai/v1/chat/completions',
            model: process.env.XAI_MODEL || 'grok-2-latest',
            key: process.env.XAI_API_KEY
        };
    }
    if (process.env.GROQ_API_KEY) {
        return {
            name: 'groq',
            url: 'https://api.groq.com/openai/v1/chat/completions',
            // [2026-10-07] Was 'llama-3.3-70b-versatile'. Groq RETIRED the
            // Llama 3.x chat line for this account, so every Omega reply failed
            // with HTTP 404 model_not_found and the operator thought the key had
            // died. The key was fine — GET /models answered 200 with 11 models.
            // Of those, only gpt-oss-120b/20b and qwen3.8-27b are chat models;
            // gpt-oss-120b is the most capable and answers in ~1s, well inside the
            // 8s timeout. GROQ_MODEL overrides it, so the next retirement is a
            // config change rather than a deploy.
            model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
            key: process.env.GROQ_API_KEY
        };
    }
    return null;
}

// [2026-11-02] Sub un executor de teste nu se iese pe retea.
//
// Descoperit livrand: dupa ce `symbol` si `market` au trecut la model, un test
// din chatResponderPhaseB a inceput sa primeasca "brain is rate-limited right
// now (Groq free tier)" — adica suita CHEMA cu adevarat Groq si lua 429.
// Testele ardeau cota operatorului si treceau sau cadeau dupa cum raspundea un
// serviciu extern. Fisierul acela incearca sa se apere singur cu un
// `delete process.env.GROQ_API_KEY` la incarcare, dar cheia revine prin
// `dotenv` din lantul de require-uri — o aparare care arata ca functioneaza si
// nu functiona.
//
// Garda sta aici, la singura poarta spre retea, nu in fiecare test.
// `OMEGA_LLM_ALLOW_NET_IN_TEST=1` o ridica explicit, pentru cand chiar vrei sa
// probezi calea reala.
const _UNDER_TEST = !!process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test';

function _netAllowed() {
    if (!_UNDER_TEST) return true;
    return process.env.OMEGA_LLM_ALLOW_NET_IN_TEST === '1';
}

function available() {
    if (!_netAllowed()) return false;
    return _resolveProvider() !== null;
}

function getProviderName() {
    const p = _resolveProvider();
    return p ? p.name : null;
}

async function chat(params) {
    // Garda si aici, nu doar in available(): un apelant care sare peste
    // verificare tot nu are voie sa iasa pe retea dintr-un test.
    if (!_netAllowed()) return { ok: false, error: 'blocked_in_test' };
    const provider = _resolveProvider();
    if (!provider) return { ok: false, error: 'no_api_key' };

    const messages = params.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        return { ok: false, error: 'messages_required' };
    }
    const model = params.model || provider.model;
    const timeoutMs = params.timeoutMs || DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(provider.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + provider.key
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: params.temperature ?? 0.7,
                max_tokens: params.maxTokens ?? 200
            }),
            signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) {
            // [2026-11-02] O singura reincercare, si doar pe un refuz trecator.
            if (isRetryableStatus(res.status) && params._retried !== true) {
                await _sleep(RETRY_AFTER_MS);
                return chat({ ...params, _retried: true });
            }
            return { ok: false, error: `http_${res.status}`, provider: provider.name };
        }
        const body = await res.json();
        const text = body && body.choices && body.choices[0] && body.choices[0].message
            && body.choices[0].message.content;
        if (!text) return { ok: false, error: 'malformed_response', provider: provider.name };
        return {
            ok: true,
            text: String(text).trim(),
            model,
            provider: provider.name,
            usage: body.usage || null
        };
    } catch (err) {
        clearTimeout(timer);
        return {
            ok: false,
            error: err.name === 'AbortError' ? 'timeout' : err.message,
            provider: provider.name
        };
    }
}

// [Day 32D] Streaming variant — parses OpenAI-compatible SSE chunks from
// Groq / xAI and invokes onChunk per delta.content token. Returns the full
// concatenated text in result.text on completion. Same {ok, error, model,
// provider} contract as chat(). The caller is responsible for pushing chunks
// downstream (e.g. SSE proxy on /api/omega/chat-stream).
async function chatStream(params) {
    // Garda si aici, nu doar in available(): un apelant care sare peste
    // verificare tot nu are voie sa iasa pe retea dintr-un test.
    if (!_netAllowed()) return { ok: false, error: 'blocked_in_test' };
    const provider = _resolveProvider();
    if (!provider) return { ok: false, error: 'no_api_key' };

    const messages = params.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        return { ok: false, error: 'messages_required' };
    }
    const model = params.model || provider.model;
    const timeoutMs = params.timeoutMs || DEFAULT_TIMEOUT_MS;
    const onChunk = typeof params.onChunk === 'function' ? params.onChunk : () => {};

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
        res = await fetch(provider.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + provider.key,
                'Accept': 'text/event-stream',
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: params.temperature ?? 0.7,
                max_tokens: params.maxTokens ?? 320,
                stream: true,
            }),
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        return {
            ok: false,
            error: err.name === 'AbortError' ? 'timeout' : err.message,
            provider: provider.name,
        };
    }

    if (!res.ok) {
        clearTimeout(timer);
        return { ok: false, error: `http_${res.status}`, provider: provider.name };
    }
    if (!res.body || typeof res.body.getReader !== 'function') {
        clearTimeout(timer);
        return { ok: false, error: 'no_body_stream', provider: provider.name };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // SSE frames are separated by \n\n; flush complete frames only
            let nlIdx;
            while ((nlIdx = buffer.indexOf('\n\n')) !== -1) {
                const frame = buffer.slice(0, nlIdx);
                buffer = buffer.slice(nlIdx + 2);
                // Each frame can have multiple "data:" lines; we only care about content
                const lines = frame.split('\n');
                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (!payload) continue;
                    if (payload === '[DONE]') {
                        // End-of-stream marker
                        clearTimeout(timer);
                        return { ok: true, text: fullText, model, provider: provider.name };
                    }
                    let parsed;
                    try { parsed = JSON.parse(payload); }
                    catch (_) { continue; }  // malformed line — skip silently
                    const delta = parsed
                        && parsed.choices
                        && parsed.choices[0]
                        && parsed.choices[0].delta;
                    const content = delta && delta.content;
                    if (typeof content === 'string' && content.length > 0) {
                        fullText += content;
                        try { onChunk(content); } catch (_) { /* swallow consumer error */ }
                    }
                }
            }
        }
    } catch (err) {
        clearTimeout(timer);
        return {
            ok: false,
            error: err.name === 'AbortError' ? 'timeout' : err.message,
            provider: provider.name,
            partialText: fullText,
        };
    }

    clearTimeout(timer);
    return { ok: true, text: fullText, model, provider: provider.name };
}

module.exports = {
    isRetryableStatus, RETRY_AFTER_MS, _netAllowedForTest: _netAllowed, available, chat, chatStream, getProviderName, DEFAULT_TIMEOUT_MS, _resolveProvider };
