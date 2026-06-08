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

// [SP2-b 2026-06-07 · T1-3 2026-06-08] Pure core for serverAT.serverFullyOwnsEntries.
// Full server ownership of entries (client locked, single engine — eliminates the
// two-engine race) requires ALL of:
//  - flagFull:  MF.SERVER_AT_FULL_OWNERSHIP (the rollback lever, covers testnet+real)
//  - isCutover: user is in data/sp2_cutover_users.json
//  - engineMode 'live' (demo is already server-owned via SERVER_AT_DEMO)
//  - a per-env enable gate matching the creds:
//      testnet → flagExec  (MF.SERVER_AT_TESTNET_EXEC)
//      real    → flagRealEnabled (MF._SRV_POS_REAL_ENABLED — the master REAL gate)
// [T1-3] REAL was previously hardcoded OFF (credsMode==='testnet' only), so on REAL
// ownership fell back to the SP2-a hybrid (client-present → CLIENT owns) = a
// two-engine race on real money. Now REAL gets the SAME single-engine ownership,
// but ONLY once _SRV_POS_REAL_ENABLED is deliberately turned on — so it stays
// fully INERT today (flag false, no real creds) with zero behavior change.
// Execution permission stays a SEPARATE concern (the 3 fail-closed REAL gates).
function computeFullOwnership(ctx) {
  const { flagFull, flagExec, flagRealEnabled, isCutover, engineMode, credsMode } = ctx || {};
  if (flagFull !== true || isCutover !== true || engineMode !== 'live') return false;
  if (credsMode === 'testnet') return flagExec === true;
  if (credsMode === 'real') return flagRealEnabled === true;
  return false; // unknown/ambiguous creds → never own
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
