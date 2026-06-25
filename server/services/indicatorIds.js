// Canonical indicator id set — MIRROR of the full client INDICATORS list (client/src/core/config.ts).
// Used server-side to validate the per-user active-indicator report and the usage aggregate.
// [2026-06-23] Regenerated to the full 88-id client list — the old 41-id subset silently dropped
// ~47 indicators (and used 'rsi' instead of the client's 'rsi14'), so their usage never counted.
// If you add/rename a client indicator, add it here too or POST /api/indicators/active drops it.
'use strict';
const INDICATOR_IDS = new Set([
  'ema', 'wma', 'st', 'boreas', 'mentor', 'vp', 'magnes', 'cvd', 'macd', 'bb', 'stoch', 'obv', 'atr',
  'vwap', 'ichimoku', 'fib', 'pivot', 'rsi14', 'mfi', 'cci', 'sma', 'hma', 'psar', 'kc', 'dc', 'adx',
  'willr', 'roc', 'cmf', 'ao', 'vwma', 'aroon', 'trix', 'uo', 'chop', 'kera', 'aether', 'ms', 'nem',
  'iris', 'pythia', 'plutus', 'helios', 'hyperion', 'metis', 'eunomia', 'apollo', 'kronos', 'hermes',
  'charon', 'atlas', 'eos', 'pantheon', 'aegis', 'selene', 'kratos', 'prometheus', 'mnemosyne', 'themis',
  'erebus', 'anemoi', 'cerberus', 'proteus', 'typhon', 'styx', 'geras', 'ouranos', 'hades', 'athena',
  'echo', 'kairos', 'tyche', 'nyx', 'olympus', 'dolos', 'gaia', 'ananke', 'psyche', 'hubris', 'okeanos',
  'aurora', 'argus', 'orion', 'phoenix', 'nephele', 'morpheus', 'harmonia', 'daimon',
  'astrape', 'phoebe',
]);
module.exports = { INDICATOR_IDS };
