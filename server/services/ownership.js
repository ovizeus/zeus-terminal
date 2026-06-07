'use strict';
// Pure ownership decision — SP2 spec §4. NO I/O. Callers supply resolved context.
// Entries: EXCLUSIVE, fail-closed (uncertain → treat as client present → don't double-open).
// Exits: always-on server net; disaster backstop is SERVER in EVERY state (never deferred).
//
// [SP2-b 2026-06-07] fullServerOwnership — operator directive: "brain AT să
// ruleze server-side, clientul să nu mai comande". When true, SERVER owns
// entries even with the client PRESENT (the SP2-a hybrid deferred to a
// present client, leaving two engines commanding one account). All other
// prerequisites (cutover, AT active, valid creds) stay mandatory — fail-closed.
function resolveOwnership(ctx) {
  const { clientPresent, atActive, credsValid, cutoverActive, underTakeControl, fullServerOwnership } = ctx;
  const serverMayOpen = (fullServerOwnership === true || !clientPresent) && cutoverActive && atActive && credsValid;
  const entryOwner = serverMayOpen ? 'SERVER' : 'CLIENT';
  const exitOwner = {
    activeManager: underTakeControl ? 'USER' : 'SERVER',
    disasterBackstop: 'SERVER',
  };
  return { entryOwner, exitOwner };
}

// [SP2-b 2026-06-07] Pure core for serverAT.serverFullyOwnsEntries glue.
// True ONLY when every condition holds — any missing piece → false:
//  - flagFull:  MF.SERVER_AT_FULL_OWNERSHIP (the rollback lever)
//  - flagExec:  MF.SERVER_AT_TESTNET_EXEC (SP2-a exec carve-out)
//  - isCutover: user is in data/sp2_cutover_users.json
//  - engineMode 'live' (demo is already server-owned via SERVER_AT_DEMO)
//  - credsMode 'testnet' EXACTLY — REAL stays blocked until explicit GO
function computeFullOwnership(ctx) {
  const { flagFull, flagExec, isCutover, engineMode, credsMode } = ctx || {};
  return flagFull === true
    && flagExec === true
    && isCutover === true
    && engineMode === 'live'
    && credsMode === 'testnet';
}

// [SP2-b 2026-06-07] Defense-in-depth for POST /api/order/place: reject
// client-originated AUTO opens when the server fully owns entries (a fresh
// client whose lockout flag hasn't synced yet could otherwise double-open —
// observed live 2026-06-07, blocked only by insufficient testnet margin).
// reduceOnly (closes) is NEVER rejected — kill switch and manual close must
// always work. Manual/UI orders always pass.
function shouldRejectClientAutoOrder(ctx) {
  const { serverOwnsEntries, source, reduceOnly } = ctx || {};
  if (serverOwnsEntries !== true) return false;
  if (reduceOnly === true) return false;
  return source === 'auto';
}

module.exports = { resolveOwnership, computeFullOwnership, shouldRejectClientAutoOrder };
