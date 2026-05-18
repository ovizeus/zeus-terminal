'use strict';

// [Day 32D] llmClient.chatStream — SSE streaming wrapper. Parses
// OpenAI-compatible chunks from Groq / xAI and yields text fragments
// through an onChunk callback. End-of-stream marker handled cleanly.

describe('llmClient.chatStream', () => {
    let origFetch;
    let llmClient;

    beforeEach(() => {
        jest.resetModules();
        origFetch = global.fetch;
        process.env.GROQ_API_KEY = 'test_key_abc';
        delete process.env.XAI_API_KEY;
        llmClient = require('../../../server/services/ml/_voice/llmClient');
    });

    afterEach(() => {
        global.fetch = origFetch;
        delete process.env.GROQ_API_KEY;
    });

    function mockSSEResponse(sseLines) {
        // Build a ReadableStream of SSE bytes
        const encoder = new TextEncoder();
        const body = sseLines.join('') ;
        return {
            ok: true,
            status: 200,
            body: {
                getReader() {
                    let sent = false;
                    return {
                        async read() {
                            if (sent) return { done: true, value: undefined };
                            sent = true;
                            return { done: false, value: encoder.encode(body) };
                        },
                        cancel() { /* noop */ },
                        releaseLock() { /* noop */ },
                    };
                },
            },
        };
    }

    test('returns ok=false when no API key configured', async () => {
        delete process.env.GROQ_API_KEY;
        delete process.env.XAI_API_KEY;
        jest.resetModules();
        const lc = require('../../../server/services/ml/_voice/llmClient');
        const result = await lc.chatStream({
            messages: [{ role: 'user', content: 'hi' }],
            onChunk: () => {},
        });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('no_api_key');
    });

    test('parses SSE chunks and invokes onChunk per delta token', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo "}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"boss"}}]}\n\n',
            'data: [DONE]\n\n',
        ];
        global.fetch = jest.fn().mockResolvedValue(mockSSEResponse(sse));

        const chunks = [];
        const result = await llmClient.chatStream({
            messages: [{ role: 'user', content: 'hi' }],
            onChunk: (text) => chunks.push(text),
        });

        expect(result.ok).toBe(true);
        expect(chunks).toEqual(['hel', 'lo ', 'boss']);
        expect(result.text).toBe('hello boss');
    });

    test('ignores SSE lines without delta.content', async () => {
        const sse = [
            'data: {"choices":[{"delta":{}}]}\n\n',  // empty delta
            'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
            'data: {"choices":[{"finish_reason":"stop"}]}\n\n',  // no delta
            'data: [DONE]\n\n',
        ];
        global.fetch = jest.fn().mockResolvedValue(mockSSEResponse(sse));

        const chunks = [];
        const result = await llmClient.chatStream({
            messages: [{ role: 'user', content: 'x' }],
            onChunk: (text) => chunks.push(text),
        });

        expect(result.ok).toBe(true);
        expect(chunks).toEqual(['hi']);
        expect(result.text).toBe('hi');
    });

    test('handles malformed JSON lines without crashing', async () => {
        const sse = [
            'data: {bogus json\n\n',
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
            'data: [DONE]\n\n',
        ];
        global.fetch = jest.fn().mockResolvedValue(mockSSEResponse(sse));

        const chunks = [];
        const result = await llmClient.chatStream({
            messages: [{ role: 'user', content: 'x' }],
            onChunk: (text) => chunks.push(text),
        });

        expect(result.ok).toBe(true);
        expect(chunks).toEqual(['ok']);
    });

    test('returns ok=false when upstream returns non-2xx', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, body: null });
        const result = await llmClient.chatStream({
            messages: [{ role: 'user', content: 'x' }],
            onChunk: () => {},
        });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('http_429');
    });

    test('passes stream:true in request body', async () => {
        const sse = ['data: [DONE]\n\n'];
        const fetchMock = jest.fn().mockResolvedValue(mockSSEResponse(sse));
        global.fetch = fetchMock;

        await llmClient.chatStream({
            messages: [{ role: 'user', content: 'x' }],
            onChunk: () => {},
        });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.stream).toBe(true);
    });
});
