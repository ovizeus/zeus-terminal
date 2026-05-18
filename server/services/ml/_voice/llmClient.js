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

module.exports = { available, chat, getProviderName, DEFAULT_TIMEOUT_MS };
