'use strict';

/**
 * bybitFeed — Bybit WebSocket feed stub.
 * Implemented in Task 13+. This file exists so feedManager can lazy-require it.
 */

const EventEmitter = require('events');

class BybitFeed extends EventEmitter {
    constructor() {
        super();
        this._connected = false;
    }

    start() {
        this._connected = true;
    }

    stop() {
        this._connected = false;
    }

    getConnectionState() {
        return { connected: this._connected };
    }
}

module.exports = new BybitFeed();
