'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r7-tracer-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');
const tracer = require('../../server/services/ml/R7_meta/interRingTracer');

beforeEach(() => db.prepare("DELETE FROM ml_inter_ring_trace").run());

describe('interRingTracer.wrap', () => {
    test('wrap returns instrumented fn that records caller→callee call', () => {
        const original = (a, b) => a + b;
        const wrapped = tracer.wrap('serverBrain', 'mathUtils', 'add', original);
        const result = wrapped(2, 3);
        expect(result).toBe(5);
        const rows = db.prepare("SELECT * FROM ml_inter_ring_trace").all();
        expect(rows.length).toBe(1);
        expect(rows[0].caller_module).toBe('serverBrain');
        expect(rows[0].callee_module).toBe('mathUtils');
        expect(rows[0].method).toBe('add');
        expect(rows[0].ok).toBe(1);
        expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);
    });

    test('wrap records ok=0 when fn throws', () => {
        const throwing = () => { throw new Error('boom'); };
        const wrapped = tracer.wrap('serverBrain', 'serverAT', 'failOp', throwing);
        expect(() => wrapped()).toThrow('boom');
        const rows = db.prepare("SELECT * FROM ml_inter_ring_trace").all();
        expect(rows.length).toBe(1);
        expect(rows[0].ok).toBe(0);
    });

    test('wrap truncates input_summary at 200 chars', () => {
        const original = (longArg) => longArg;
        const wrapped = tracer.wrap('a', 'b', 'echo', original);
        const longInput = 'x'.repeat(500);
        wrapped(longInput);
        const row = db.prepare("SELECT input_summary FROM ml_inter_ring_trace").get();
        expect(row.input_summary.length).toBeLessThanOrEqual(200);
    });

    test('wrap captures async functions correctly', async () => {
        const asyncFn = async (n) => { await new Promise(r => setTimeout(r, 5)); return n * 2; };
        const wrapped = tracer.wrap('caller', 'callee', 'asyncMul', asyncFn);
        const result = await wrapped(4);
        expect(result).toBe(8);
        const rows = db.prepare("SELECT * FROM ml_inter_ring_trace").all();
        expect(rows.length).toBe(1);
        expect(rows[0].ok).toBe(1);
        expect(rows[0].duration_ms).toBeGreaterThanOrEqual(5);
    });

    test('recent(N) returns last N traces in DESC order by ts', () => {
        const wrapped = tracer.wrap('a', 'b', 'op', () => 'ok');
        wrapped();
        wrapped();
        wrapped();
        const recent = tracer.recent(2);
        expect(recent.length).toBe(2);
        expect(recent[0].ts).toBeGreaterThanOrEqual(recent[1].ts);
    });

    test('recent default limit 50, cap 500', () => {
        const wrapped = tracer.wrap('a', 'b', 'op', () => 'ok');
        for (let i = 0; i < 10; i++) wrapped();
        const recent = tracer.recent();
        expect(recent.length).toBeLessThanOrEqual(50);
        const big = tracer.recent(99999);
        expect(big.length).toBeLessThanOrEqual(500);
    });
});
