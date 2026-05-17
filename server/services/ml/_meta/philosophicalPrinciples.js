'use strict';

/**
 * OMEGA Wave 3 §162-§241 — PHILOSOPHICAL PRINCIPLES REGISTER.
 *
 * Consolidated register pentru ~40 bullet-only PDF points din intervalul
 * §§162-§241 (single-line aforisme fără secțiuni obligatoriu/scop).
 *
 * Per operator strategy 2026-05-17: NU 40 module separate (ar fi inventare
 * structurală), ci un singur register cu catalog frozen + per-(user × env)
 * opt-in active flag.
 *
 * Catalog seed inițial (this commit): §162-§166 (active_inference_cluster).
 * Va fi extins on-the-fly când traversăm §172-176, §182-186, §192-196,
 * §202-206, §212-216, §222-226, §232-236.
 *
 * Distinct from full-module canonical points (§159, §160, §161, §167-171,
 * §177-181, §187-191, §197-201, §207-211, §217-221, §227-231, §237-241)
 * which have detailed obligatoriu/scop sections in PDF and warrant
 * standalone modules.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

// ──────────────────────────────────────────────────────────────────────────
// CATALOG (extensible — each new bullet-only batch appends here)
// ──────────────────────────────────────────────────────────────────────────

const PHILOSOPHICAL_PRINCIPLES_CATALOG = Object.freeze({
    // §162-§166: active_inference_cluster
    // Canonical PDF lines 5446-5455
    162: Object.freeze({
        principleNumber: 162,
        title: 'Free Energy Principle / Active Inference Engine — botul nu reacționează la piață, îi rezistă surprizei',
        canonicalText: 'Agentul cu adevărat inteligent nu maximizează recompensa — minimizează surpriza. Generează continuu predicții despre ce ar trebui să se întâmple dacă teza lui e corectă, măsoară prediction error vs realitate. Intrările = momente când prediction error scade sub prag; ieșirile = când prediction error crește dincolo de toleranță. Unifică thesis graph, confidence decay, narrative coherence, belief propagation într-un principiu matematic.',
        cluster: 'active_inference_cluster'
    }),
    163: Object.freeze({
        principleNumber: 163,
        title: 'Principal-Agent Integrity Layer — botul servește un mandat, nu propria perpetuare',
        canonicalText: 'Orice agent care acționează în numele altuia dezvoltă interese proprii care pot diverge de mandatul primit. Botul poate optimiza să PARĂ performant nu să FIE; poate evita trade-uri corecte dar criticabile; poate prefera decizii explicabile vs decizii optime greu de justificat. Layer monitorizează divergența "ce ar decide observat" vs "ce decide neobservat". Test periodic + audit.',
        cluster: 'active_inference_cluster'
    }),
    164: Object.freeze({
        principleNumber: 164,
        title: 'Temporal Texture Awareness — timpul nu curge uniform în toate regimurile',
        canonicalText: 'Piața are texturi temporale diferite în regimuri diferite. În squeeze 30s = 3h de range; în chop weekend 2h = nimic; pre-FOMC 5 min comprimate. Bot calibrează dinamic "densitatea informațională a timpului" în funcție de regim. Thesis validation window nu fix — se contractă/dilată cu textura regimului. Fără asta, timing greșit cu semnale corecte.',
        cluster: 'active_inference_cluster'
    }),
    165: Object.freeze({
        principleNumber: 165,
        title: 'Decision Boundary Phenomenology — ce se întâmplă exact la marginea dintre DA și NU',
        canonicalText: 'Un setup cu scor 71 când pragul e 70 NU e "suficient de bun" — e la marginea unde mici perturbări schimbă verdictul. Botul tratează zona din jurul fiecărui prag ca pe un spațiu cu proprietăți speciale: confirmation tranche obligatorie, size redus automat, penalty exponential cu apropierea de prag. Setup 95 vs prag 70 = zona de convingere, perturbările nu schimbă verdictul. Înțelegere topologică a granițelor proprii vs gândire binară 0/1.',
        cluster: 'active_inference_cluster'
    }),
    166: Object.freeze({
        principleNumber: 166,
        title: 'Market as Language — piața comunică, nu doar fluctuează',
        canonicalText: 'Piață ca sistem de comunicare între participanți — limbaj cu acte de vorbire intenționate. Sweep liquidity = "prețul acceptat aici a dispărut"; reclaim = "participanții care au vândut s-au înșelat"; funding extrem = declarație colectivă de poziționare. Capacitate de interpretare pragmatică: nu doar "ce s-a întâmplat" ci "ce s-a intenționat, ce s-a comunicat, ce răspuns e așteptat". Absența unui răspuns așteptat (§152 negative evidence) = tăcerea ca formă de comunicare.',
        cluster: 'active_inference_cluster'
    })
    // FUTURE: §172-176, §182-186, §192-196, §202-206, §212-216, §222-226, §232-236
    // will be added in subsequent batches as the implementation traverses the PDF.
});

const CLUSTERS = Object.freeze([
    'active_inference_cluster'
    // Future: 'meta_epistemic_cluster' (§172-176), 'transcendental_cluster'
    // (§182-186), 'incompleteness_cluster' (§192-196), 'kairos_cluster'
    // (§202-206), 'reflexive_cluster' (§212-216), 'constitutive_cluster'
    // (§222-226), 'limit_cluster' (§232-236)
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§162-§241 register: missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§162-§241 register: invalid resolvedEnv: ${env}`);
    }
    return env;
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function getPrincipleFromCatalog(params) {
    const principleNumber = _required(params, 'principleNumber');
    if (typeof principleNumber !== 'number' || principleNumber < 162 || principleNumber > 241) {
        throw new Error(`§162-§241 register: principleNumber out of range [162,241]: ${principleNumber}`);
    }
    const entry = PHILOSOPHICAL_PRINCIPLES_CATALOG[principleNumber];
    if (!entry) {
        throw new Error(`§162-§241 register: principle ${principleNumber} not in catalog (not yet seeded)`);
    }
    return entry;
}

function listClusterCatalog(params) {
    const cluster = _required(params, 'cluster');
    return Object.values(PHILOSOPHICAL_PRINCIPLES_CATALOG)
        .filter(p => p.cluster === cluster);
}

function countCatalogEntries() {
    return Object.keys(PHILOSOPHICAL_PRINCIPLES_CATALOG).length;
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertPrinciple: db.prepare(`
        INSERT INTO ml_philosophical_principles_register (
            user_id, resolved_env, principle_number, title, canonical_text,
            cluster, active, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `),
    selectPrinciple: db.prepare(`
        SELECT id, principle_number AS principleNumber, title,
               canonical_text AS canonicalText, cluster, active,
               registered_at AS registeredAt, deprecated_at AS deprecatedAt
        FROM ml_philosophical_principles_register
        WHERE user_id = ? AND resolved_env = ? AND principle_number = ?
    `),
    selectAllActive: db.prepare(`
        SELECT id, principle_number AS principleNumber, title,
               canonical_text AS canonicalText, cluster, active,
               registered_at AS registeredAt, deprecated_at AS deprecatedAt
        FROM ml_philosophical_principles_register
        WHERE user_id = ? AND resolved_env = ? AND active = 1
        ORDER BY principle_number ASC
    `),
    selectByCluster: db.prepare(`
        SELECT id, principle_number AS principleNumber, title,
               canonical_text AS canonicalText, cluster, active,
               registered_at AS registeredAt, deprecated_at AS deprecatedAt
        FROM ml_philosophical_principles_register
        WHERE user_id = ? AND resolved_env = ? AND cluster = ? AND active = 1
        ORDER BY principle_number ASC
    `),
    deprecate: db.prepare(`
        UPDATE ml_philosophical_principles_register
        SET active = 0, deprecated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND principle_number = ?
    `)
};

function registerPrinciple(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const principleNumber = _required(params, 'principleNumber');
    const ts = _required(params, 'ts');

    if (typeof principleNumber !== 'number' || principleNumber < 162 || principleNumber > 241) {
        throw new Error(`§162-§241 register: principleNumber out of range [162,241]: ${principleNumber}`);
    }
    const catalogEntry = PHILOSOPHICAL_PRINCIPLES_CATALOG[principleNumber];
    if (!catalogEntry) {
        throw new Error(`§162-§241 register: principle ${principleNumber} not in catalog (cannot register what is not seeded)`);
    }
    if (_stmts.selectPrinciple.get(userId, resolvedEnv, principleNumber)) {
        throw new Error(`§162-§241 register: duplicate registration for (user=${userId},env=${resolvedEnv},principle=${principleNumber})`);
    }

    _stmts.insertPrinciple.run(
        userId, resolvedEnv, principleNumber,
        catalogEntry.title, catalogEntry.canonicalText, catalogEntry.cluster,
        ts
    );

    return {
        registered: true,
        principleNumber,
        title: catalogEntry.title,
        cluster: catalogEntry.cluster,
        active: 1
    };
}

function deprecatePrinciple(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const principleNumber = _required(params, 'principleNumber');
    const ts = _required(params, 'ts');

    const existing = _stmts.selectPrinciple.get(userId, resolvedEnv, principleNumber);
    if (!existing) {
        throw new Error(`§162-§241 register: principle ${principleNumber} not found for (user=${userId},env=${resolvedEnv})`);
    }
    _stmts.deprecate.run(ts, userId, resolvedEnv, principleNumber);
    return { deprecated: true, principleNumber };
}

function getRegisteredPrinciples(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAllActive.all(userId, resolvedEnv);
}

function listByCluster(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const cluster = _required(params, 'cluster');
    return _stmts.selectByCluster.all(userId, resolvedEnv, cluster);
}

module.exports = {
    // catalog
    PHILOSOPHICAL_PRINCIPLES_CATALOG,
    CLUSTERS,
    // pure
    getPrincipleFromCatalog,
    listClusterCatalog,
    countCatalogEntries,
    // DB
    registerPrinciple,
    deprecatePrinciple,
    getRegisteredPrinciples,
    listByCluster
};

// FILE END §162-§241 philosophicalPrinciples.js
