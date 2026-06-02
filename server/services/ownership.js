'use strict';
// Pure ownership decision — SP2 spec §4. NO I/O. Callers supply resolved context.
// Entries: EXCLUSIVE, fail-closed (uncertain → treat as client present → don't double-open).
// Exits: always-on server net; disaster backstop is SERVER in EVERY state (never deferred).
function resolveOwnership(ctx) {
  const { clientPresent, atActive, credsValid, cutoverActive, underTakeControl } = ctx;
  const serverMayOpen = (!clientPresent) && cutoverActive && atActive && credsValid;
  const entryOwner = serverMayOpen ? 'SERVER' : 'CLIENT';
  const exitOwner = {
    activeManager: underTakeControl ? 'USER' : 'SERVER',
    disasterBackstop: 'SERVER',
  };
  return { entryOwner, exitOwner };
}
module.exports = { resolveOwnership };
