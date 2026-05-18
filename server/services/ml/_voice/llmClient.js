'use strict';

/**
 * LLM client — free-tier OpenAI-compatible API wrapper for Omega chat fallback.
 *
 * Auto-detects provider from env vars:
 *   XAI_API_KEY  → xAI Grok (grok-2-latest)         api.x.ai/v1
 *   GROQ_API_KEY → Groq Llama 3.3 70B                api.groq.com/openai/v1
 *
 * If both present, xAI is preferred (operator-set). Falls back to Groq.
 * If neither, available()=false → caller falls back to local responder.
 *
 * All errors (timeout, http != 200, malformed) return { ok: false }.
 */

const DEFAULT_TIMEOUT_MS = 8000;

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
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            key: process.env.GROQ_API_KEY
        };
    }
    return null;
}

function available() {
    return _resolveProvider() !== null;
}

function getProviderName() {
    const p = _resolveProvider();
    return p ? p.name : null;
}

async function chat(params) {
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

module.exports = { available, chat, chatStream, getProviderName, DEFAULT_TIMEOUT_MS };
