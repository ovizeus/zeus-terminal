// Canonical indicator id set (mirror of client INDICATORS ids) for server-side validation.
'use strict';
const INDICATOR_IDS = new Set([
  'ema', 'wma', 'rsi', 'stoch', 'macd', 'atr', 'obv', 'mfi', 'cci', 'adx', 'willr', 'roc', 'cmf', 'ao', 'aroon',
  'trix', 'uo', 'chop', 'helios', 'atlas', 'pantheon', 'selene', 'themis', 'erebus', 'anemoi', 'cerberus',
  'proteus', 'typhon', 'styx', 'geras', 'kairos', 'nyx', 'psyche', 'hyperion', 'eunomia', 'metis', 'kronos',
  'mentor', 'apollo', 'olympus', 'dolos',
]);
module.exports = { INDICATOR_IDS };
