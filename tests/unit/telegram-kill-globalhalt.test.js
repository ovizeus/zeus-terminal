'use strict';

// Task A — Verify Telegram /kill wiring to serverAT.setGlobalHalt
// Unit test scope: cmdKill must call BOTH riskGuard.setEmergencyKill AND
// serverAT.setGlobalHalt; setGlobalHalt failure must not block riskGuard.

const path = require('path');

jest.mock(path.resolve(__dirname, '../../server/services/serverAT'), () => ({
    setGlobalHalt: jest.fn(),
    getMode: jest.fn(() => 'demo'),
}));

jest.mock(path.resolve(__dirname, '../../server/services/riskGuard'), () => ({
    setEmergencyKill: jest.fn(),
    getDailyState: jest.fn(() => ({ emergencyKill: false })),
}));

jest.mock(path.resolve(__dirname, '../../server/services/telegram'), () => ({
    sendToUser: jest.fn(() => Promise.resolve()),
}));

describe('Telegram /kill — global halt wiring', () => {
    let cmdKill, serverAT, riskGuard;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        // Re-establish mocks after resetModules
        jest.doMock(path.resolve(__dirname, '../../server/services/serverAT'), () => ({
            setGlobalHalt: jest.fn(),
            getMode: jest.fn(() => 'demo'),
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/riskGuard'), () => ({
            setEmergencyKill: jest.fn(),
            getDailyState: jest.fn(() => ({ emergencyKill: false })),
        }));
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => ({
            sendToUser: jest.fn(() => Promise.resolve()),
        }));
        serverAT = require('../../server/services/serverAT');
        riskGuard = require('../../server/services/riskGuard');
        const tb = require('../../server/services/telegramBot');
        cmdKill = tb._testExports && tb._testExports.cmdKill;
    });

    test('args="on" calls riskGuard.setEmergencyKill AND serverAT.setGlobalHalt', async () => {
        const bot = { token: 'x', chatId: 'y', userId: 42 };
        await cmdKill(bot, 'on');
        expect(riskGuard.setEmergencyKill).toHaveBeenCalledWith(true, 42);
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(true, 42, expect.stringMatching(/telegram_kill/));
    });

    test('args="off" disarms both', async () => {
        const bot = { token: 'x', chatId: 'y', userId: 42 };
        await cmdKill(bot, 'off');
        expect(riskGuard.setEmergencyKill).toHaveBeenCalledWith(false, 42);
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(false, 42, expect.stringMatching(/telegram_unkill/));
    });

    test('setGlobalHalt failure does not block riskGuard call', async () => {
        serverAT.setGlobalHalt.mockImplementation(() => { throw new Error('db locked'); });
        const bot = { token: 'x', chatId: 'y', userId: 42 };
        await expect(cmdKill(bot, 'on')).resolves.not.toThrow();
        expect(riskGuard.setEmergencyKill).toHaveBeenCalled();
    });

    test('no args (status query) does not arm halt', async () => {
        const bot = { token: 'x', chatId: 'y', userId: 42 };
        await cmdKill(bot, undefined);
        expect(serverAT.setGlobalHalt).not.toHaveBeenCalled();
        expect(riskGuard.setEmergencyKill).not.toHaveBeenCalled();
    });
});
