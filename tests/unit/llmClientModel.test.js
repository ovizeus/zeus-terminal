'use strict';
// tests/unit/llmClientModel.test.js
// [OMEGA MODEL DECOMMISSION 2026-10-07] Operator: "parca nici omega numi mai
// vb cu mine da ceva eroare cheia o schimb eu maine".
//
// It was NOT the key. Verified live against the Groq API with the operator's
// key: GET /models returns HTTP 200 with 11 models (so the key authenticates
// fine — a bad key gives 401), while a chat call to the hardcoded default
// llama-3.3-70b-versatile returns HTTP 404 model_not_found. Groq retired the
// Llama 3.x chat line for this account; no Llama chat model is available any
// more. Changing the key would have fixed nothing.
//
// This guards the default against pointing at a retired model again.

const path = require('path');

const RETIRED = [
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama3-70b-8192',
    'mixtral-8x7b-32768',
    'gemma-7b-it',
];

function freshClient(env) {
    jest.resetModules();
    const saved = { XAI_API_KEY: process.env.XAI_API_KEY, GROQ_API_KEY: process.env.GROQ_API_KEY, GROQ_MODEL: process.env.GROQ_MODEL, XAI_MODEL: process.env.XAI_MODEL };
    for (const k of Object.keys(saved)) delete process.env[k];
    Object.assign(process.env, env);
    const mod = require(path.resolve(__dirname, '../../server/services/ml/_voice/llmClient'));
    return { mod, restore: () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } } };
}

describe('llmClient provider resolution', () => {
    test('the Groq default model is not one Groq has retired', () => {
        const { mod, restore } = freshClient({ GROQ_API_KEY: 'k' });
        try {
            const p = mod._resolveProvider();
            expect(p.name).toBe('groq');
            expect(RETIRED).not.toContain(p.model);
            expect(typeof p.model).toBe('string');
            expect(p.model.length).toBeGreaterThan(0);
        } finally { restore(); }
    });

    test('GROQ_MODEL overrides the default so a future retirement is a config change, not a deploy', () => {
        const { mod, restore } = freshClient({ GROQ_API_KEY: 'k', GROQ_MODEL: 'some/other-model' });
        try {
            expect(mod._resolveProvider().model).toBe('some/other-model');
        } finally { restore(); }
    });

    test('xAI still wins when both keys are present', () => {
        const { mod, restore } = freshClient({ GROQ_API_KEY: 'k', XAI_API_KEY: 'x' });
        try {
            expect(mod._resolveProvider().name).toBe('xai');
        } finally { restore(); }
    });

    test('no keys at all → not available, so the caller falls back to the local responder', () => {
        const { mod, restore } = freshClient({});
        try {
            expect(mod.available()).toBe(false);
        } finally { restore(); }
    });

    test('the Groq endpoint stays the OpenAI-compatible chat completions URL', () => {
        const { mod, restore } = freshClient({ GROQ_API_KEY: 'k' });
        try {
            expect(mod._resolveProvider().url).toBe('https://api.groq.com/openai/v1/chat/completions');
        } finally { restore(); }
    });
});
