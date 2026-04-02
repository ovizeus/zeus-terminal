// Zeus Terminal — Regime-Adaptive Parameters (Brain V2 — Phase 2E)
// Each regime gets its own parameter profile instead of fixed thresholds.
// Brain uses these to adapt confMin, SL width, RR, DSL mode per regime.
'use strict';

// ══════════════════════════════════════════════════════════════════
// Regime parameter profiles
// ══════════════════════════════════════════════════════════════════

const REGIME_PROFILES = {
    TREND: {
        confMin: 55,        // enter easier with the trend
        slMult: 1.4,        // wider SL — give room to breathe
        rrMin: 2.5,         // require strong R:R
        dslMode: 'swing',   // swing-based trailing
        sizeScale: 1.0,     // full size
        description: 'Trending — ride the wave, wider stops',
    },
    TREND_UP: {
        confMin: 55, slMult: 1.4, rrMin: 2.5, dslMode: 'swing', sizeScale: 1.0,
    },
    TREND_DOWN: {
        confMin: 55, slMult: 1.4, rrMin: 2.5, dslMode: 'swing', sizeScale: 1.0,
    },
    RANGE: {
        confMin: 72,        // enter rarely — range is tricky
        slMult: 0.8,        // tight SL — mean reversion
        rrMin: 1.5,         // lower R:R acceptable
        dslMode: 'fast',    // fast DSL — take profits quick
        sizeScale: 0.8,     // reduced size
        description: 'Ranging — tight stops, quick profits',
    },
    BREAKOUT: {
        confMin: 60,        // moderate threshold
        slMult: 1.2,        // medium SL
        rrMin: 2.0,         // decent R:R
        dslMode: 'def',     // default trailing
        sizeScale: 1.0,
        description: 'Breakout — catch the move with medium risk',
    },
    EXPANSION: {
        confMin: 58, slMult: 1.3, rrMin: 2.2, dslMode: 'def', sizeScale: 1.0,
    },
    SQUEEZE: {
        confMin: 68,        // moderate-high threshold
        slMult: 0.9,        // tighter SL
        rrMin: 2.0,
        dslMode: 'fast',
        sizeScale: 0.9,
        description: 'Squeeze — compression, wait for expansion',
    },
    VOLATILE: {
        confMin: 80,        // very high bar
        slMult: 1.6,        // very wide SL — volatile swings
        rrMin: 3.0,         // need excellent R:R to justify
        dslMode: 'atr',     // ATR-based trailing
        sizeScale: 0.6,     // reduced size
        description: 'Volatile — large stops, small size, high bar',
    },
    CHAOS: {
        confMin: 95,        // practically no trading
        slMult: 2.0,
        rrMin: 4.0,
        dslMode: 'atr',
        sizeScale: 0.3,
        description: 'Chaos — avoid trading',
    },
    LIQUIDATION_EVENT: {
        confMin: 99,        // do not trade
        slMult: 2.5,
        rrMin: 5.0,
        dslMode: 'atr',
        sizeScale: 0.1,
        description: 'Liquidation event — stay out',
    },
};

// Default fallback
const DEFAULT_PROFILE = {
    confMin: 65, slMult: 1.0, rrMin: 2.0, dslMode: 'def', sizeScale: 1.0,
};

// ══════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Get regime-adapted parameters by merging regime profile with user's base STC.
 * @param {string} regime - current market regime
 * @param {object} baseSTC - user's base trading config
 * @returns {object} adapted STC with regime-specific overrides
 */
function getAdaptedParams(regime, baseSTC) {
    const profile = REGIME_PROFILES[regime] || DEFAULT_PROFILE;
    const base = baseSTC || {};

    return {
        // Core thresholds — use regime's confMin (but user can override higher)
        confMin: Math.max(profile.confMin, base.confMin || 0),
        sigMin: base.sigMin || 3,
        adxMin: base.adxMin || 18,
        maxPos: base.maxPos || 3,
        cooldownMs: base.cooldownMs || 300000,

        // Position sizing — scale by regime
        lev: base.lev || 5,
        size: Math.round((base.size || 200) * profile.sizeScale),

        // Risk — adjust SL width by regime multiplier
        slPct: Math.round(((base.slPct || 1.5) * profile.slMult) * 100) / 100,
        rr: Math.max(profile.rrMin, base.rr || 2),

        // DSL mode — regime overrides unless user explicitly set a non-default
        dslMode: (base.dslMode && base.dslMode !== 'def') ? base.dslMode : profile.dslMode,

        // Symbols pass-through
        symbols: base.symbols || null,

        // Metadata
        _regime: regime,
        _profile: profile.description || regime,
        _sizeScale: profile.sizeScale,
        _slMult: profile.slMult,
    };
}

/**
 * Get raw regime profile (for logging/debugging).
 */
function getProfile(regime) {
    return REGIME_PROFILES[regime] || DEFAULT_PROFILE;
}

/**
 * Get adapted params that also account for regime transition.
 * If transitioning, blend current and target regime profiles.
 */
function getTransitionAwareParams(regime, baseSTC, transition) {
    const current = getAdaptedParams(regime, baseSTC);
    if (!transition || !transition.transitioning || !transition.to) return current;

    const targetProfile = REGIME_PROFILES[transition.to] || DEFAULT_PROFILE;
    const blendFactor = Math.min(0.4, (transition.confidence || 50) / 200); // max 40% blend

    // Blend key params toward target regime
    current.confMin = Math.round(current.confMin * (1 - blendFactor) + targetProfile.confMin * blendFactor);
    current.slPct = +(current.slPct * (1 - blendFactor) + (baseSTC.slPct || 1.5) * targetProfile.slMult * blendFactor).toFixed(2);
    current._transitionBlend = { from: regime, to: transition.to, factor: blendFactor };
    return current;
}

module.exports = {
    getAdaptedParams,
    getTransitionAwareParams,
    getProfile,
    REGIME_PROFILES,
};
