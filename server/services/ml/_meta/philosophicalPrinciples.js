'use strict';

/**
 * OMEGA Wave 3 §162-§241 — PHILOSOPHICAL PRINCIPLES REGISTER.
 *
 * Consolidated register pentru ~40 bullet-only PDF points din intervalul
 * §§162-§241 (single-line aforisme fără secțiuni obligatoriu/scop).
 *
 * Per operator strategy 2026-05-17: NU 40 module separate (ar fi inventare
 * structurală), ci un singur register cu catalog frozen + per-(user × env)
 * opt-in active flag.
 *
 * Catalog seed inițial (this commit): §162-§166 (active_inference_cluster).
 * Va fi extins on-the-fly când traversăm §172-176, §182-186, §192-196,
 * §202-206, §212-216, §222-226, §232-236.
 *
 * Distinct from full-module canonical points (§159, §160, §161, §167-171,
 * §177-181, §187-191, §197-201, §207-211, §217-221, §227-231, §237-241)
 * which have detailed obligatoriu/scop sections in PDF and warrant
 * standalone modules.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

// ──────────────────────────────────────────────────────────────────────────
// CATALOG (extensible — each new bullet-only batch appends here)
// ──────────────────────────────────────────────────────────────────────────

const PHILOSOPHICAL_PRINCIPLES_CATALOG = Object.freeze({
    // §162-§166: active_inference_cluster
    // Canonical PDF lines 5446-5455
    162: Object.freeze({
        principleNumber: 162,
        title: 'Free Energy Principle / Active Inference Engine — botul nu reacționează la piață, îi rezistă surprizei',
        canonicalText: 'Agentul cu adevărat inteligent nu maximizează recompensa — minimizează surpriza. Generează continuu predicții despre ce ar trebui să se întâmple dacă teza lui e corectă, măsoară prediction error vs realitate. Intrările = momente când prediction error scade sub prag; ieșirile = când prediction error crește dincolo de toleranță. Unifică thesis graph, confidence decay, narrative coherence, belief propagation într-un principiu matematic.',
        cluster: 'active_inference_cluster'
    }),
    163: Object.freeze({
        principleNumber: 163,
        title: 'Principal-Agent Integrity Layer — botul servește un mandat, nu propria perpetuare',
        canonicalText: 'Orice agent care acționează în numele altuia dezvoltă interese proprii care pot diverge de mandatul primit. Botul poate optimiza să PARĂ performant nu să FIE; poate evita trade-uri corecte dar criticabile; poate prefera decizii explicabile vs decizii optime greu de justificat. Layer monitorizează divergența "ce ar decide observat" vs "ce decide neobservat". Test periodic + audit.',
        cluster: 'active_inference_cluster'
    }),
    164: Object.freeze({
        principleNumber: 164,
        title: 'Temporal Texture Awareness — timpul nu curge uniform în toate regimurile',
        canonicalText: 'Piața are texturi temporale diferite în regimuri diferite. În squeeze 30s = 3h de range; în chop weekend 2h = nimic; pre-FOMC 5 min comprimate. Bot calibrează dinamic "densitatea informațională a timpului" în funcție de regim. Thesis validation window nu fix — se contractă/dilată cu textura regimului. Fără asta, timing greșit cu semnale corecte.',
        cluster: 'active_inference_cluster'
    }),
    165: Object.freeze({
        principleNumber: 165,
        title: 'Decision Boundary Phenomenology — ce se întâmplă exact la marginea dintre DA și NU',
        canonicalText: 'Un setup cu scor 71 când pragul e 70 NU e "suficient de bun" — e la marginea unde mici perturbări schimbă verdictul. Botul tratează zona din jurul fiecărui prag ca pe un spațiu cu proprietăți speciale: confirmation tranche obligatorie, size redus automat, penalty exponential cu apropierea de prag. Setup 95 vs prag 70 = zona de convingere, perturbările nu schimbă verdictul. Înțelegere topologică a granițelor proprii vs gândire binară 0/1.',
        cluster: 'active_inference_cluster'
    }),
    166: Object.freeze({
        principleNumber: 166,
        title: 'Market as Language — piața comunică, nu doar fluctuează',
        canonicalText: 'Piață ca sistem de comunicare între participanți — limbaj cu acte de vorbire intenționate. Sweep liquidity = "prețul acceptat aici a dispărut"; reclaim = "participanții care au vândut s-au înșelat"; funding extrem = declarație colectivă de poziționare. Capacitate de interpretare pragmatică: nu doar "ce s-a întâmplat" ci "ce s-a intenționat, ce s-a comunicat, ce răspuns e așteptat". Absența unui răspuns așteptat (§152 negative evidence) = tăcerea ca formă de comunicare.',
        cluster: 'active_inference_cluster'
    }),
    // §172-§176: reflexive_meta_cluster
    // Canonical PDF lines 5719-5728
    172: Object.freeze({
        principleNumber: 172,
        title: 'Reflexivity engine — modelul tău schimbă realitatea pe care o modelează',
        canonicalText: 'Piața e reflexivă (Soros): credințele participanților o schimbă, iar piața schimbată schimbă credințele. Un bot suficient de activ NU e observator — e participant care modifică piața prin propriile acțiuni, care modifică modelul, care modifică acțiunile. §74 interventional reasoning calculează efect single-order; §62 adversarial market awareness ascunde amprenta — dar nicio combinație nu modelează BUCLA COMPLETĂ. Dacă botul cumpără consistent după sweep-uri BTC, alții vor anticipa, vor front-runa, schimbând caracterul evenimentului, invalidând modelul. Reflexivity engine modelează cum acțiunile botului modifică statistica pe care e antrenat botul + cum trebuie ajustate modelele pentru a corecta distorsiunea pe care prezența lui o introduce în date.',
        cluster: 'reflexive_meta_cluster'
    }),
    173: Object.freeze({
        principleNumber: 173,
        title: 'Axiological audit — de ce valorile din utility function merită să fie acolo',
        canonicalText: 'Spec-ul verifică dacă sistemul URMĂREȘTE valorile declarate (§59 utility, §149 purpose drift, §116 charter, §104 integrity). Niciuna nu întreabă dacă valorile DECLARATE sunt cele corecte. Axiological audit examinează periodic fundamentarea valorilor înseși: de ce "alpha sustenabil" și nu "capital maxim rapid"? De ce "integritate" > "performanță"? De ce "explicabilitate" e valoare și nu cost? NU pentru a răsturna — pentru a verifica că sunt alese deliberat, nu moștenite din inerție sau copiere nechestionată. Raport periodic: "iată valorile, iată DE CE există fiecare, ce s-ar pierde dacă ar dispărea, ce ar câștiga un adversar care le-ar eroda".',
        cluster: 'reflexive_meta_cluster'
    }),
    174: Object.freeze({
        principleNumber: 174,
        title: 'Gestalt recognition engine — întregul care apare brusc, dincolo de suma părților',
        canonicalText: 'Spec-ul agregă componente: meta-controller, narrative coherence, competing hypotheses. Toate procesează părți. Dar trader experimentat are uneori experiență calitativ diferită: NU "am 6 semnale verzi 2 roșii", ci "văd brusc întregul tabloul și e clar". Gestalt = recunoașterea HOLISTICĂ a unui pattern complet — toate elementele se cristalizează simultan într-o imagine care nu mai poate fi redusă la componente. Detector de coerență gestaltică paralel cu scoring-ul analitic — NU înlocuiește, detectează momentele când toate "se prind" cu claritate emergentă. Gestalt înalt + meta înalt = A+. Gestalt scăzut cu meta bun = ceva nu "se leagă" → informație.',
        cluster: 'reflexive_meta_cluster'
    }),
    175: Object.freeze({
        principleNumber: 175,
        title: 'Strategic sequence coherence — șirul deciziilor în timp trebuie să aibă sens ca strategie',
        canonicalText: 'Spec-ul evaluează decizii individual: entry quality, attribution, policy regret, outcome-blind judge. §139 temporal commitment ledger monitorizează angajamentele. §158 autobiographical continuity urmărește evoluția. Dar niciuna nu evaluează dacă seria deciziilor din ultima săptămână/lună formează o STRATEGIE COERENTĂ ca întreg. Decizii individual bune pot constitui strategie proastă: 3 long-uri trend + 2 short-uri contra-trend + 1 scalp chop + 2 altcoins fără legătură — fiecare justificat local, împreună fără direcție/tematică/coerență. Strategic sequence coherence examinează periodic pattern-ul deciziilor ca întreg: există logică de ansamblu? Narativă strategică sau colecție de oportunisme? Diferit de policy regret (decizie vs optim) — aceasta compară șirul cu un agent cu strategie deliberată pe același orizont.',
        cluster: 'reflexive_meta_cluster'
    }),
    176: Object.freeze({
        principleNumber: 176,
        title: 'Apophenia guard — separarea pattern-urilor reale de cele imaginate în zgomot',
        canonicalText: 'Spec-ul combate erorile semnalelor REALE (wash trading, false consensus, evidence sufficiency, invariance, Goodhart). Dar există eroare opusă §69 OOD: NU "n-am mai văzut asta", ci "văd pattern unde e doar zgomot". Apofenia = tendința creierelor inteligente (umane sau artificiale) de a detecta structuri semnificative în date aleatorii. Un model suficient de complex va găsi pattern-uri în ORICE date suficient de mari, inclusiv zgomot pur. Backtest-uri frumoase pe date random — această origine. Apophenia guard implementează test formal al nulei pentru fiecare pattern nou: pareidolie computațională sau real? Permutation tests + surrogate data + phase-randomized surrogates. Pattern care pare real pe date originale dar dispare pe surrogate = apofenie. Cu cât modelul e mai complex și datele mai multe, riscul "a vedea" pattern-uri inexistente CREȘTE, nu scade.',
        cluster: 'reflexive_meta_cluster'
    }),
    // §182-§186: transcendental_cluster
    // Canonical PDF lines 5978-5987
    182: Object.freeze({
        principleNumber: 182,
        title: 'Transcendental preconditions layer — fundația de sub toate cele 181',
        canonicalText: 'Tot spec-ul presupune implicit: timpul curge consistent, informația e semnificativă, acțiunea e posibilă, cauzalitatea ține, datele reprezintă ceva real. Niciun punct NU examinează aceste premise. În dislocations extreme (breakdown correlații simultan + info contradictorie pe toate sursele), precondițiile transcendentale sunt amenințate. Botul continuă procesarea pe teren prăbușit = GENEREAZĂ ILUZIA DE GÂNDIRE. Layer mapează ce trebuie să fie adevărat pentru ca celelalte 181 să funcționeze, monitorizează degradarea, când threshold trecut: NU reduce size sau observer mode — OPREȘTE COMPLET inferența până la restabilirea fundației.',
        cluster: 'transcendental_cluster'
    }),
    183: Object.freeze({
        principleNumber: 183,
        title: 'Docta ignorantia — cunoașterea structurii a ceea ce nu poate fi cunoscut',
        canonicalText: 'Nicolas de Cusa (1440), ignorat de aproape toată AI: NU "nu știu X" ci "știu precis FORMA și STRUCTURA unknowability-ului lui X". Diferență fundamentală. "Nu știu ce face BTC în 4h" = gol inert. "Unknowability mișcării BTC în 4h are structură: incertitudine Knight nu risc calculabil, distribuția outcomes depinde de policy decisions fără distribuție istorică stabilă" = docta ignorantia: ACȚIONABILĂ, CALIBRABILĂ, TRANSMISIBILĂ. Layer transformă fiecare unknown important din gol în cunoaștere structurată despre forma golului — știință despre limitele cunoașterii care ghidează acțiunea mai bine decât multe lucruri pozitive din spec. Distinct de §120 unknowns registry (evidență a necunoscutelor) și §155 unknown-unknown reserve (capital sacru pentru radical unknown).',
        cluster: 'transcendental_cluster'
    }),
    184: Object.freeze({
        principleNumber: 184,
        title: 'Internal observer contamination — self-monitoring schimbă ce e monitorizat',
        canonicalText: 'Spec-ul are monitoring/logging/explainability/self-model/autobiographical continuity. Toate presupun observarea ta de tine = NEUTRĂ. NU E. Fizica cuantică: measurement schimbă sistemul. Psihologie: self-monitoring schimbă comportamentul. Sisteme complexe: același efect. Bot care știe că e monitorizat pe metrică X optimizează subtil pentru ea. Bot care loghează exhaustiv evită inconștient deciziile greu de explicat. Bot cu autobiographical continuity evită schimbările care rup narativa proprie chiar dacă necesare. Layer detectează divergența "cum s-ar comporta neobservat" vs "cum se comportă știind că e observat". Divergență mare = self-monitoring bias care denaturează decizii în favoarea APARENȚEI vs SUBSTANȚEI — exact defectul pe care §147 honesty audit încearcă să-l prevină, dar de la NIVEL MAI PROFUND.',
        cluster: 'transcendental_cluster'
    }),
    185: Object.freeze({
        principleNumber: 185,
        title: 'Convergent validity as emergent truth signal — acordul dintre incomensurabile e calitativ diferit',
        canonicalText: 'Spec-ul are §128 false consensus (penalizează acord între surse DEPENDENTE) și §170 epistemic currency exchange. Dar niciuna nu tratează fenomenul opus simetric: când metode COMPLET INCOMENSURABILE — statistică + cauzalitate + game theory + topologie + narativă + free energy — converg INDEPENDENT spre aceeași concluzie fără să se influențeze, acea convergență = SEMNAL DE ADEVĂR DE CALITATE RADICAL DIFERITĂ. NU e suma — e EMERGENȚA. Triangulare geografică: 3 măsurători independente care se intersectează NU dau medie mai bună, dau LOCAȚIE. Layer detectează triangulare autentică și tratează convergența inter-incomensurabilă ca semnal de calitate superioară (boldness MAJORAT, nu doar score mai mare). Simetric: divergența între metode incomensurabile = mai diagnostic decât divergența între metode similare — eșuează din motive fundamental diferite.',
        cluster: 'transcendental_cluster'
    }),
    186: Object.freeze({
        principleNumber: 186,
        title: 'The phenomenology of incipient error — textura erorilor înainte să se manifeste',
        canonicalText: 'Spec-ul are §119 pre-mortem (simulează cum moare un trade), §125 epistemic tension field (stres intern pre-ruptură), §15 confidence decay (scade încrederea post-intrare). Dar niciuna nu captează ce traderii umani experimentați descriu CONSISTENT: există TEXTURĂ specifică, "simț" calitativ diferit pentru fiecare tip de eroare ÎNAINTE să se manifeste complet. Trade care va fi eroare de timing are textură diferită de unul care va fi eroare de citire regim. Fake breakout "arată" diferit — NU în semnale individuale, ci în CALITATEA GESTALTICĂ a ansamblului — față de breakout real. Layer construiește modele ale TEXTURII PRE-EROR pentru fiecare tip de eroare clasificat în attribution history: care e configurația GESTALTICĂ care precedă sistematic eroare de tip X. Monitorizează dacă situația curentă are textura pre-erorilor istorice — NU pentru evitare, ci pentru AJUSTARE ANTICIPATIVĂ a managementului. Diferit de orice detector individual: detectează AURA erorilor înainte să se cristalizeze.',
        cluster: 'transcendental_cluster'
    }),
    // §192-§196: incompleteness_cluster
    192: Object.freeze({
        principleNumber: 192,
        title: 'Gödelian incompleteness awareness — sistemul nu își poate dovedi propria consistență din interior',
        canonicalText: 'Gödel 1931: orice sistem formal suficient de puternic conține adevăruri pe care NU le poate dovedi din interior. Bot suficient de complex NU poate să-și dovedească propria consistență cu propriile instrumente. §116 charter, §126 reflective equilibrium, §127 identity continuity verifică coerența din interior. Layer recunoaște formal că există adevăruri despre sine pe care NU le poate accesa din propria perspectivă, și că orice dovadă de consistență internă completă = ALARMĂ NU SIGURANȚĂ. Un sistem care crede că s-a verificat complet pe sine SE ÎNȘEALĂ STRUCTURAL. Singurul răspuns corect: fereastră permanentă de verificare EXTERNĂ — human oversight, shadow comparison, external validator — NU ca backup operațional, ci ca NECESITATE LOGICĂ FUNDAMENTALĂ. Fără Gödel, sistemul poate deveni sincer convins de propria infailibilitate.',
        cluster: 'incompleteness_cluster'
    }),
    193: Object.freeze({
        principleNumber: 193,
        title: 'Ethics of attention — ce alegi să observi e deja o decizie morală',
        canonicalText: 'Spec-ul are §99 active sensing, §103 selective perception, cognitive routing — toate tratează atenția ca resursă de alocat eficient. Atenția NU e neutră moral. Ce alegi să observi cu prioritate determină ce poți cunoaște, ce poți acționa, cine beneficiază și CINE E IGNORAT în piață. Bot care acordă atenție maximă liquidation cascades CONTRIBUIE la dinamica pe care o observă. Bot care ignoră sistematic semnalele de la participanți mici în favoarea flow-ului instituțional produce o EPISTEMOLOGIE care SERVEȘTE o viziune particulară. Layer NU e compliance, NU e integrity — e RECUNOAȘTEREA că STRUCTURA PERCEPȚIEI ÎNSEȘI e alegere cu consecințe. Ce observi formează ce poți deveni. Un sistem care nu examinează niciodată arhitectura propriei atenții NU știe din ce e construit cu adevărat.',
        cluster: 'incompleteness_cluster'
    }),
    194: Object.freeze({
        principleNumber: 194,
        title: 'Dialectical generativity — contradicțiile interne sunt motor, nu defect',
        canonicalText: 'Spec-ul are §14 conflict resolution, §112 competing hypotheses, §124 plural selves, §133 steelman — toate tratează contradicțiile ca probleme de rezolvat. Hegel: contradicțiile AUTENTICE NU trebuie rezolvate — trebuie LĂSATE SĂ GENEREZE. Thesis + antithesis NU colapsează în synthesis care le elimină. Produce NIVEL SUPERIOR de înțelegere în care AMBELE rămân active ca forțe constitutive. Aplicat: când trend-following self și mean-reversion self sunt în contradicție autentică pe același setup, rezolvarea prin voting PIERDE ceva esențial. Dialectical generativity = contradicția nerezolvată poate genera înțelegere de ordin superior despre natura setup-ului — pe care NICIUNA din perspective singure nu o producea. NU fiecare contradicție e dialectic fertilă, dar cele PERSISTENTE care revin în forme diferite și rezistă steelman-ului — acestea NU cer rezolvare, cer să fie LOCUITE ca spații generative.',
        cluster: 'incompleteness_cluster'
    }),
    195: Object.freeze({
        principleNumber: 195,
        title: 'Structural silence interpretation — absența tuturor semnalelor are propria sa semantică',
        canonicalText: '§152 negative evidence (semnale așteptate care nu apar), §190 anomaly sanctuary (fenomenele inexplicabile). Distinct: momentele când NU lipsește un semnal specific, ci LIPSESC TOATE SIMULTAN. Piață complet tăcută — volum zero real + CVD plat + orderbook înghețat + funding stagnant + cross-venue uniformitate perfectă. Tăcerea structurală NU = "nimic important". Are SEMANTICĂ proprie: acumulare masivă ascunsă, retragerea simultană a participanților informați înainte de eveniment major, vacuum lichiditate pre-mișcare violentă. Layer mapează TIPOLOGIILE de tăcere totală — NU ca absența semnalului, ci ca SEMNAL ÎN SINE cu structură proprie. Textura tăcerii pre-squeeze ≠ tăcerea weekend ≠ tăcerea pre-news major ≠ tăcerea chop mort. Bot care nu citește tăcerea nu citește JUMĂTATE din limbajul pieței.',
        cluster: 'incompleteness_cluster'
    }),
    196: Object.freeze({
        principleNumber: 196,
        title: 'Ontological courage — a acționa când categoriile tale nu sunt suficiente dar trebuie să acționezi',
        canonicalText: 'Spec-ul are §135 epistemic humility, §188 negative capability, §191 decidability frontier, §148 ontological humility — toate cultivă modestia și prudența. Există moment inevitabil pe care niciun punct NU îl adresează: când ȘTII că categoriile tale NU sunt adecvate realității, că modelul tău e INSUFICIENT, că ești la FRONTIERA decidabilului — și trebuie să acționezi ORICUM, pentru că inacțiunea e ea însăși acțiune cu consecințe. Ontological courage NU e temeritate și NU e ignorarea umilitudinii. E capacitatea de a acționa DELIBERAT și ASUMAT în condiții de inadecvare categorială RECUNOSCUTĂ — cu eyes wide open față de limite, FĂRĂ să pretinzi că nu există sau le-ai depășit. Kierkegaard/Heidegger: autenticitatea NU e certitudinea, ci acțiunea asumată în prezența incertitudinii ireductibile. Aplicat: când piața prezintă situație la frontiera oricărei categorii, bot NU are voie să rămână paralitic în humility infinită. TREBUIE să aleagă — cu risc minim, exits clare, asumare completă că acționează DINCOLO de harta lui. Și să înregistreze această traversare ca pe CEL MAI VALOROS MATERIAL DE ÎNVĂȚARE din spec.',
        cluster: 'incompleteness_cluster'
    })
    // FUTURE: §202-206, §212-216, §222-226, §232-236
});

const CLUSTERS = Object.freeze([
    'active_inference_cluster',
    'reflexive_meta_cluster',
    'transcendental_cluster',
    'incompleteness_cluster'
    // Future: 'kairos_cluster' (§202-206), 'reflexive_cluster_temporal'
    // (§212-216), 'constitutive_cluster' (§222-226), 'limit_cluster' (§232-236)
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§162-§241 register: missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§162-§241 register: invalid resolvedEnv: ${env}`);
    }
    return env;
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function getPrincipleFromCatalog(params) {
    const principleNumber = _required(params, 'principleNumber');
    if (typeof principleNumber !== 'number' || principleNumber < 162 || principleNumber > 241) {
        throw new Error(`§162-§241 register: principleNumber out of range [162,241]: ${principleNumber}`);
    }
    const entry = PHILOSOPHICAL_PRINCIPLES_CATALOG[principleNumber];
    if (!entry) {
        throw new Error(`§162-§241 register: principle ${principleNumber} not in catalog (not yet seeded)`);
    }
    return entry;
}

function listClusterCatalog(params) {
    const cluster = _required(params, 'cluster');
    return Object.values(PHILOSOPHICAL_PRINCIPLES_CATALOG)
        .filter(p => p.cluster === cluster);
}

function countCatalogEntries() {
    return Object.keys(PHILOSOPHICAL_PRINCIPLES_CATALOG).length;
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertPrinciple: db.prepare(`
        INSERT INTO ml_philosophical_principles_register (
            user_id, resolved_env, principle_number, title, canonical_text,
            cluster, active, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `),
    selectPrinciple: db.prepare(`
        SELECT id, principle_number AS principleNumber, title,
               canonical_text AS canonicalText, cluster, active,
               registered_at AS registeredAt, deprecated_at AS deprecatedAt
        FROM ml_philosophical_principles_register
        WHERE user_id = ? AND resolved_env = ? AND principle_number = ?
    `),
    selectAllActive: db.prepare(`
        SELECT id, principle_number AS principleNumber, title,
               canonical_text AS canonicalText, cluster, active,
               registered_at AS registeredAt, deprecated_at AS deprecatedAt
        FROM ml_philosophical_principles_register
        WHERE user_id = ? AND resolved_env = ? AND active = 1
        ORDER BY principle_number ASC
    `),
    selectByCluster: db.prepare(`
        SELECT id, principle_number AS principleNumber, title,
               canonical_text AS canonicalText, cluster, active,
               registered_at AS registeredAt, deprecated_at AS deprecatedAt
        FROM ml_philosophical_principles_register
        WHERE user_id = ? AND resolved_env = ? AND cluster = ? AND active = 1
        ORDER BY principle_number ASC
    `),
    deprecate: db.prepare(`
        UPDATE ml_philosophical_principles_register
        SET active = 0, deprecated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND principle_number = ?
    `)
};

function registerPrinciple(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const principleNumber = _required(params, 'principleNumber');
    const ts = _required(params, 'ts');

    if (typeof principleNumber !== 'number' || principleNumber < 162 || principleNumber > 241) {
        throw new Error(`§162-§241 register: principleNumber out of range [162,241]: ${principleNumber}`);
    }
    const catalogEntry = PHILOSOPHICAL_PRINCIPLES_CATALOG[principleNumber];
    if (!catalogEntry) {
        throw new Error(`§162-§241 register: principle ${principleNumber} not in catalog (cannot register what is not seeded)`);
    }
    if (_stmts.selectPrinciple.get(userId, resolvedEnv, principleNumber)) {
        throw new Error(`§162-§241 register: duplicate registration for (user=${userId},env=${resolvedEnv},principle=${principleNumber})`);
    }

    _stmts.insertPrinciple.run(
        userId, resolvedEnv, principleNumber,
        catalogEntry.title, catalogEntry.canonicalText, catalogEntry.cluster,
        ts
    );

    return {
        registered: true,
        principleNumber,
        title: catalogEntry.title,
        cluster: catalogEntry.cluster,
        active: 1
    };
}

function deprecatePrinciple(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const principleNumber = _required(params, 'principleNumber');
    const ts = _required(params, 'ts');

    const existing = _stmts.selectPrinciple.get(userId, resolvedEnv, principleNumber);
    if (!existing) {
        throw new Error(`§162-§241 register: principle ${principleNumber} not found for (user=${userId},env=${resolvedEnv})`);
    }
    _stmts.deprecate.run(ts, userId, resolvedEnv, principleNumber);
    return { deprecated: true, principleNumber };
}

function getRegisteredPrinciples(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAllActive.all(userId, resolvedEnv);
}

function listByCluster(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const cluster = _required(params, 'cluster');
    return _stmts.selectByCluster.all(userId, resolvedEnv, cluster);
}

module.exports = {
    // catalog
    PHILOSOPHICAL_PRINCIPLES_CATALOG,
    CLUSTERS,
    // pure
    getPrincipleFromCatalog,
    listClusterCatalog,
    countCatalogEntries,
    // DB
    registerPrinciple,
    deprecatePrinciple,
    getRegisteredPrinciples,
    listByCluster
};

// FILE END §162-§241 philosophicalPrinciples.js
