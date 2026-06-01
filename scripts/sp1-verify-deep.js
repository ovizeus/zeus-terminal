// [SP1 deep-verify] Adversarial fuzz: prove server _fuseDecision == client
// computeFusionDecision steps 7-9, bit-for-bit, over random inputs. Also runs
// live DB sanity. Explicit process.exit so the open service handles don't hang.
const brain = require('../server/services/serverBrain');
const db = require('../server/services/database');
const fuse = brain.__sp1.fuseDecision;

// ---- Exact port of client autotrade.ts computeFusionDecision steps 7-9 ----
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clampFB = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function clientFuse({ conf, ofi, probN, regimeN, liqDangerN, sigDirBonus }) {
  const confN = clamp01((conf - 50) / 50);
  const ofiN = (ofi + 1) / 2;
  let dirScore = 0;
  dirScore += ofi * 0.55;
  dirScore += ((conf - 50) / 50) * 0.30;
  // client applies sigDir as +0.25/-0.25/0 — passed in as sigDirBonus
  dirScore += sigDirBonus;
  dirScore = clampFB(dirScore, -1, 1);
  const dir = dirScore > 0.15 ? 'long' : dirScore < -0.15 ? 'short' : 'neutral';
  const alignN = dir === 'neutral' ? 0 : (dir === 'long' ? ofiN : (1 - ofiN));
  let confF = (confN * 0.35) + (probN * 0.25) + (regimeN * 0.20) + (alignN * 0.20);
  confF *= (1 - (liqDangerN * 0.55));
  confF = clamp01(confF);
  const confidence = Math.round(confF * 100);
  let decision;
  if (dir === 'neutral') decision = 'NO_TRADE';
  else if (confidence >= 82 && conf >= 75 && regimeN >= 0.55) decision = 'LARGE';
  else if (confidence >= 72 && conf >= 68) decision = 'MEDIUM';
  else if (confidence >= 62 && conf >= 60) decision = 'SMALL';
  else decision = 'NO_TRADE';
  const score = Math.round(dirScore * confidence);
  return { dir, decision, confidence, score };
}

const N = 100000;
const regimes = [0.35, 0.5, 0.55, 0.75];
const bonuses = [-0.25, 0, 0.25];
let mismatches = 0;
const examples = [];
for (let i = 0; i < N; i++) {
  const inp = {
    conf: Math.round(Math.random() * 100),
    ofi: Math.random() * 2 - 1,
    probN: Math.random(),
    regimeN: regimes[Math.floor(Math.random() * regimes.length)],
    liqDangerN: Math.random(),
    sigDirBonus: bonuses[Math.floor(Math.random() * bonuses.length)],
  };
  const s = fuse(inp);
  const c = clientFuse(inp);
  if (s.dir !== c.dir || s.decision !== c.decision || s.confidence !== c.confidence || s.score !== c.score) {
    mismatches++;
    if (examples.length < 5) examples.push({ inp, server: s, client: c });
  }
}
console.log('=== FUZZ ' + N + ' random inputs: server _fuseDecision vs client formula ===');
console.log('mismatches:', mismatches);
if (examples.length) console.log('examples:', JSON.stringify(examples, null, 1));

// ---- Live sanity ----
console.log('\n=== LIVE checks ===');
try {
  console.log('isTestnetShadowTarget(1)=', brain.__sp1.isTestnetShadowTarget(1),
              ' (2)=', brain.__sp1.isTestnetShadowTarget(2));
} catch (e) { console.log('target check err', e.message); }

const since = Date.now() - 600000;
const bySrcUser = db.db.prepare(
  "SELECT user_id, source, COUNT(*) c FROM brain_parity_log WHERE created_at>=? GROUP BY user_id, source ORDER BY user_id, source"
).all(since);
console.log('parity rows last10min by user/source:', JSON.stringify(bySrcUser));

// duplicate check: more than one server row per (user,symbol,cycle) in window?
const dups = db.db.prepare(
  "SELECT user_id, symbol, cycle, COUNT(*) c FROM brain_parity_log WHERE source='server' AND created_at>=? GROUP BY user_id,symbol,cycle HAVING c>1 LIMIT 5"
).all(since);
console.log('server dup (user,symbol,cycle) rows:', JSON.stringify(dups), dups.length === 0 ? 'OK none' : 'DUPLICATES!');

const open = db.db.prepare("SELECT COUNT(*) c FROM at_positions WHERE user_id=1 AND status='OPEN'").get();
console.log('uid=1 OPEN positions:', open.c);

process.exit(mismatches === 0 && dups.length === 0 ? 0 : 2);
