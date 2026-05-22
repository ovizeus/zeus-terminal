'use strict';

// binanceFeed — alias to marketFeed.js (Binance is the canonical Zeus feed).
// Created as alias for symmetry with bybitFeed.js + feedManager routing.
// Future cleanup may rename marketFeed.js → binanceFeed.js directly, but for
// Phase 1A we keep marketFeed.js name unchanged to minimize diff (~30 call sites
// in server/ + client/ would otherwise need updates).

module.exports = require('./marketFeed');
