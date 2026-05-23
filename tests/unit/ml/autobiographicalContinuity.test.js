'use strict';

/**
 * OMEGA §158 AUTOBIOGRAPHICAL CONTINUITY / SELF-NARRATIVE ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5306-5334.
 *
 * "nu doar exist acum; stiu si cum am devenit ceea ce sunt."
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p158-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/autobiographicalContinuity');

const UID = 9158;
const UID_E = 9258;
const UID_S = 9358;
const UID_GET = 9458;
const UID_ISO_A = 9558;
const UID_ISO_B = 9658;
const UID_ENV = 9758;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_E, UID_S, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_self_narrative_snapshots WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_autobiographical_events WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §158 AUTOBIOGRAPHICAL CONTINUITY', () => {

    describe('Migrations 314+315', () => {
        test('314 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('314_ml_autobiographical_events')).toBeTruthy();
        });
        test('315 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('315_ml_self_narrative_snapshots')).toBeTruthy();
        });
        test('event_type CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_autobiographical_events
                (user_id, resolved_env, event_id, event_type, title, narrative_text,
                 affected_components_json, before_state_summary_json,
                 after_state_summary_json, version_label, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_bk', 'BOGUS', 't', 'n', '[]',
                    null, null, 'v1', _now())).toThrow();
        });
        test('event_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_autobiographical_events
                (user_id, resolved_env, event_id, event_type, title, narrative_text,
                 affected_components_json, before_state_summary_json,
                 after_state_summary_json, version_label, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'e_dup', 'major_change', 't1', 'n1', '[]',
                null, null, 'v1', _now());
            expect(() => stmt.run(UID, ENV, 'e_dup', 'lesson_learned', 't2', 'n2',
                '[]', null, null, 'v2', _now())).toThrow();
        });
        test('snapshot_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_self_narrative_snapshots
                (user_id, resolved_env, snapshot_id, version_label, narrative_summary,
                 stable_principles_json, evolved_aspects_json, abandoned_aspects_json,
                 promises_to_self_json, events_count_at_snapshot, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 's_dup', 'v1', 'n', '[]', '[]', '[]', '[]', 0, _now());
            expect(() => stmt.run(UID, ENV, 's_dup', 'v2', 'n2', '[]',
                '[]', '[]', '[]', 5, _now())).toThrow();
        });
        test('events_count_at_snapshot non-negative CHECK', () => {
            expect(() => db.prepare(`INSERT INTO ml_self_narrative_snapshots
                (user_id, resolved_env, snapshot_id, version_label, narrative_summary,
                 stable_principles_json, evolved_aspects_json, abandoned_aspects_json,
                 promises_to_self_json, events_count_at_snapshot, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_neg', 'v1', 'n', '[]', '[]', '[]', '[]', -1, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('EVENT_TYPES frozen 5 (canonical PDF list)', () => {
            expect(M.EVENT_TYPES).toEqual([
                'major_change', 'identity_milestone', 'promise',
                'lesson_learned', 'continuity_checkpoint'
            ]);
            expect(Object.isFrozen(M.EVENT_TYPES)).toBe(true);
        });
        test('DEFAULT_MAX_NARRATIVE_GAP_MS = 90 days', () => {
            // 90 days * 24 * 3600 * 1000
            expect(M.DEFAULT_MAX_NARRATIVE_GAP_MS).toBe(90 * 24 * 3600 * 1000);
        });
        test('NARRATIVE_CONTINUITY_THRESHOLDS ordered', () => {
            expect(M.NARRATIVE_CONTINUITY_THRESHOLDS.strong).toBe(0.70);
            expect(M.NARRATIVE_CONTINUITY_THRESHOLDS.weak).toBe(0.30);
        });
    });

    describe('computeNarrativeContinuityScore (pure)', () => {
        test('high event count + recent snapshot → high score', () => {
            const r = M.computeNarrativeContinuityScore({
                eventCount: 25,
                snapshotCount: 3,
                gapBetweenSnapshotsMs: 30 * 24 * 3600 * 1000,  // 30 days
                maxGapMs: 90 * 24 * 3600 * 1000  // 90 days
            });
            expect(r.score).toBeGreaterThan(0.70);
        });
        test('no events + no snapshots → low score', () => {
            const r = M.computeNarrativeContinuityScore({
                eventCount: 0,
                snapshotCount: 0,
                gapBetweenSnapshotsMs: Infinity,
                maxGapMs: 90 * 24 * 3600 * 1000
            });
            expect(r.score).toBeLessThan(0.30);
        });
        test('events but gap exceeds maxGap → reduced score', () => {
            const r = M.computeNarrativeContinuityScore({
                eventCount: 10,
                snapshotCount: 1,
                gapBetweenSnapshotsMs: 180 * 24 * 3600 * 1000,  // 180 days, way over
                maxGapMs: 90 * 24 * 3600 * 1000
            });
            expect(r.score).toBeLessThan(0.50);
        });
        test('reasonable narrative ongoing → mid-high score', () => {
            const r = M.computeNarrativeContinuityScore({
                eventCount: 8,
                snapshotCount: 2,
                gapBetweenSnapshotsMs: 60 * 24 * 3600 * 1000,  // 60 days, within max
                maxGapMs: 90 * 24 * 3600 * 1000
            });
            expect(r.score).toBeGreaterThan(0.40);
        });
        test('negative inputs throw', () => {
            expect(() => M.computeNarrativeContinuityScore({
                eventCount: -1,
                snapshotCount: 0,
                gapBetweenSnapshotsMs: 0,
                maxGapMs: 1000
            })).toThrow();
        });
    });

    describe('detectNarrativeGap (pure)', () => {
        test('recent snapshot within max gap → no gap', () => {
            expect(M.detectNarrativeGap({
                lastSnapshotTs: 1000,
                currentTs: 1000 + 10 * 24 * 3600 * 1000,  // 10 days later
                maxGapMs: 90 * 24 * 3600 * 1000
            }).gapDetected).toBe(false);
        });
        test('snapshot older than maxGap → gap detected', () => {
            expect(M.detectNarrativeGap({
                lastSnapshotTs: 1000,
                currentTs: 1000 + 100 * 24 * 3600 * 1000,  // 100 days
                maxGapMs: 90 * 24 * 3600 * 1000
            }).gapDetected).toBe(true);
        });
        test('no last snapshot (null) → gap detected', () => {
            expect(M.detectNarrativeGap({
                lastSnapshotTs: null,
                currentTs: _now(),
                maxGapMs: 90 * 24 * 3600 * 1000
            }).gapDetected).toBe(true);
        });
        test('boundary: gap exactly maxGapMs → no gap (strict greater)', () => {
            const max = 90 * 24 * 3600 * 1000;
            expect(M.detectNarrativeGap({
                lastSnapshotTs: 1000,
                currentTs: 1000 + max,
                maxGapMs: max
            }).gapDetected).toBe(false);
        });
    });

    describe('summarizeRecentChanges (pure)', () => {
        test('groups events by type with counts', () => {
            const events = [
                { eventType: 'major_change', title: 'A' },
                { eventType: 'major_change', title: 'B' },
                { eventType: 'lesson_learned', title: 'C' },
                { eventType: 'promise', title: 'D' }
            ];
            const r = M.summarizeRecentChanges({ events });
            expect(r.summary.major_change.count).toBe(2);
            expect(r.summary.lesson_learned.count).toBe(1);
            expect(r.summary.promise.count).toBe(1);
            expect(r.summary.major_change.titles).toEqual(['A', 'B']);
        });
        test('empty array returns empty summary', () => {
            const r = M.summarizeRecentChanges({ events: [] });
            expect(r.totalEvents).toBe(0);
        });
        test('totalEvents counts all', () => {
            const events = [
                { eventType: 'major_change', title: 'A' },
                { eventType: 'promise', title: 'B' }
            ];
            const r = M.summarizeRecentChanges({ events });
            expect(r.totalEvents).toBe(2);
        });
    });

    describe('recordAutobiographicalEvent', () => {
        test('persists event with all fields', () => {
            const r = M.recordAutobiographicalEvent({
                userId: UID_E, resolvedEnv: ENV,
                eventId: 're_1',
                eventType: 'major_change',
                title: 'Switched from RSI-only to multi-indicator confluence',
                narrativeText: 'After 3 months of testing, single-indicator gave 47% win rate while confluence approach yielded 61%.',
                affectedComponents: ['signal_aggregation', 'entry_logic'],
                beforeStateSummary: { strategy: 'rsi_only', winrate: 0.47 },
                afterStateSummary: { strategy: 'confluence', winrate: 0.61 },
                versionLabel: 'v1.7.69-b95',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.eventId).toBe('re_1');
        });
        test('before/after summary optional', () => {
            const r = M.recordAutobiographicalEvent({
                userId: UID_E, resolvedEnv: ENV,
                eventId: 're_no_summary',
                eventType: 'identity_milestone',
                title: 'First profitable month on real testnet',
                narrativeText: 'Marked the transition from observer to participant in live(test) markets.',
                affectedComponents: ['confidence'],
                versionLabel: 'v1.7.40',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
        });
        test('invalid event_type throws', () => {
            expect(() => M.recordAutobiographicalEvent({
                userId: UID_E, resolvedEnv: ENV,
                eventId: 're_bad', eventType: 'BOGUS',
                title: 't', narrativeText: 'n',
                affectedComponents: [], ts: _now()
            })).toThrow();
        });
        test('affectedComponents must be array', () => {
            expect(() => M.recordAutobiographicalEvent({
                userId: UID_E, resolvedEnv: ENV,
                eventId: 're_arr', eventType: 'major_change',
                title: 't', narrativeText: 'n',
                affectedComponents: 'not array', ts: _now()
            })).toThrow(/array/i);
        });
        test('duplicate eventId throws', () => {
            M.recordAutobiographicalEvent({
                userId: UID_E, resolvedEnv: ENV,
                eventId: 're_dup', eventType: 'major_change',
                title: 't', narrativeText: 'n',
                affectedComponents: [], ts: _now()
            });
            expect(() => M.recordAutobiographicalEvent({
                userId: UID_E, resolvedEnv: ENV,
                eventId: 're_dup', eventType: 'major_change',
                title: 't', narrativeText: 'n',
                affectedComponents: [], ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('recordSelfNarrativeSnapshot (integration)', () => {
        test('persists snapshot with auto-counted events', () => {
            // Seed 3 events first
            for (let i = 0; i < 3; i++) {
                M.recordAutobiographicalEvent({
                    userId: UID_S, resolvedEnv: ENV,
                    eventId: `rs_e_${i}`, eventType: 'major_change',
                    title: `Event ${i}`, narrativeText: 'n',
                    affectedComponents: [], ts: _now()
                });
            }
            const r = M.recordSelfNarrativeSnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_1',
                versionLabel: 'v1.7.69-b95',
                narrativeSummary: 'Three quarters into operation, the bot has evolved from naive momentum scalper to disciplined confluence trader.',
                stablePrinciples: ['risk_first', 'never_average_down'],
                evolvedAspects: ['signal_aggregation', 'position_sizing'],
                abandonedAspects: ['single_indicator_entry', 'martingale'],
                promisesToSelf: ['preserve_capital_above_growth'],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.eventsCountAtSnapshot).toBe(3);
        });
        test('JSON arrays accepted for all _json fields', () => {
            const r = M.recordSelfNarrativeSnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_arrays',
                versionLabel: 'v1', narrativeSummary: 'n',
                stablePrinciples: ['a', 'b'],
                evolvedAspects: ['c'],
                abandonedAspects: [],
                promisesToSelf: ['d', 'e', 'f'],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
        });
        test('non-array field throws', () => {
            expect(() => M.recordSelfNarrativeSnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_bad', versionLabel: 'v1',
                narrativeSummary: 'n',
                stablePrinciples: 'not array',
                evolvedAspects: [], abandonedAspects: [],
                promisesToSelf: [], ts: _now()
            })).toThrow(/array/i);
        });
        test('duplicate snapshotId throws', () => {
            M.recordSelfNarrativeSnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_dup', versionLabel: 'v1',
                narrativeSummary: 'n', stablePrinciples: [],
                evolvedAspects: [], abandonedAspects: [],
                promisesToSelf: [], ts: _now()
            });
            expect(() => M.recordSelfNarrativeSnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_dup', versionLabel: 'v2',
                narrativeSummary: 'n', stablePrinciples: [],
                evolvedAspects: [], abandonedAspects: [],
                promisesToSelf: [], ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getRecentEvents & getLatestSnapshot & getEventTimeline', () => {
        test('getRecentEvents filters by sinceTs and eventType', () => {
            M.recordAutobiographicalEvent({
                userId: UID_GET, resolvedEnv: ENV,
                eventId: 'gr_old', eventType: 'major_change',
                title: 'old', narrativeText: 'n',
                affectedComponents: [], ts: 1000
            });
            M.recordAutobiographicalEvent({
                userId: UID_GET, resolvedEnv: ENV,
                eventId: 'gr_new_mc', eventType: 'major_change',
                title: 'new mc', narrativeText: 'n',
                affectedComponents: [], ts: 5000
            });
            M.recordAutobiographicalEvent({
                userId: UID_GET, resolvedEnv: ENV,
                eventId: 'gr_new_promise', eventType: 'promise',
                title: 'new promise', narrativeText: 'n',
                affectedComponents: [], ts: 5500
            });
            const r = M.getRecentEvents({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 3000, eventType: 'major_change'
            });
            expect(r.length).toBe(1);
            expect(r[0].eventId).toBe('gr_new_mc');
        });
        test('getLatestSnapshot returns most recent or null', () => {
            M.recordSelfNarrativeSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gl_s1', versionLabel: 'v1',
                narrativeSummary: 'n1', stablePrinciples: [],
                evolvedAspects: [], abandonedAspects: [],
                promisesToSelf: [], ts: 1000
            });
            M.recordSelfNarrativeSnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gl_s2', versionLabel: 'v2',
                narrativeSummary: 'n2', stablePrinciples: [],
                evolvedAspects: [], abandonedAspects: [],
                promisesToSelf: [], ts: 2000
            });
            const r = M.getLatestSnapshot({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.snapshotId).toBe('gl_s2');
        });
        test('getLatestSnapshot returns null when none', () => {
            expect(M.getLatestSnapshot({
                userId: UID_GET, resolvedEnv: 'REAL'
            })).toBeNull();
        });
        test('getEventTimeline respects limit', () => {
            for (let i = 0; i < 5; i++) {
                M.recordAutobiographicalEvent({
                    userId: UID_GET, resolvedEnv: ENV,
                    eventId: `gt_${i}`, eventType: 'lesson_learned',
                    title: `t${i}`, narrativeText: 'n',
                    affectedComponents: [], ts: 1000 + i
                });
            }
            const r = M.getEventTimeline({
                userId: UID_GET, resolvedEnv: ENV,
                limit: 3
            });
            expect(r.length).toBe(3);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordAutobiographicalEvent({
                userId: UID_ISO_A, resolvedEnv: ENV,
                eventId: 'iso_a', eventType: 'major_change',
                title: 't', narrativeText: 'n',
                affectedComponents: [], ts: _now()
            });
            M.recordAutobiographicalEvent({
                userId: UID_ISO_B, resolvedEnv: ENV,
                eventId: 'iso_b', eventType: 'major_change',
                title: 't', narrativeText: 'n',
                affectedComponents: [], ts: _now()
            });
            const a = M.getEventTimeline({
                userId: UID_ISO_A, resolvedEnv: ENV, limit: 100
            });
            expect(a.every(e => e.eventId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordAutobiographicalEvent({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                eventId: 'env_d', eventType: 'major_change',
                title: 't', narrativeText: 'n',
                affectedComponents: [], ts: _now()
            });
            const testnet = M.getEventTimeline({
                userId: UID_ENV, resolvedEnv: 'TESTNET', limit: 100
            });
            expect(testnet).toEqual([]);
        });
    });
});
