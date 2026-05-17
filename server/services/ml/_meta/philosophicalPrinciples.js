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
    }),
    // §202-§206: kairos_cluster
    202: Object.freeze({
        principleNumber: 202,
        title: 'Kairos vs Chronos — există două tipuri de timp și botul tău cunoaște doar unul',
        canonicalText: 'Tot spec-ul lucrează cu CHRONOS (timp măsurabil, secvențial, uniform). Grecii antici aveau KAIROS — momentul calitativ diferit, momentul potrivit care NU e localizabil pe ceas, ci recunoscut prin natura lui. Trade corect NU se ia la 14:37:22 — se ia în kairos: convergența structură+lichiditate+participare+context creează o deschidere care există și dispare INDEPENDENT de cronologie. Paradox: kairos NU poate fi predictibil în avans în termeni chronos, dar poate fi recunoscut în prezent. Toate detectoarele detectează CONDIȚII. Niciunul nu detectează MOMENTUL. Kairos NU întreabă "sunt condițiile corecte?" — întreabă "A SOSIT MOMENTUL?" Sistemul care nu distinge va fi mereu ușor în afazare cu piața.',
        cluster: 'kairos_cluster'
    }),
    203: Object.freeze({
        principleNumber: 203,
        title: 'Asymmetric ontology of entry and exit — intrarea și ieșirea nu sunt operații simetrice',
        canonicalText: 'Spec-ul tratează intrarea și ieșirea ca operații similare cu polaritate opusă. NU SUNT. Intrarea = act PROSPECTIV (orientat spre viitor inexistent, bazat pe teză). Ieșirea = act RETROSPECTIV (închide istorie, transformă experiență deschisă în eveniment finit). Cer posturi cognitive fundamental diferite. Intrarea cere IMAGINAȚIE structurată. Ieșirea cere CITIRE prezent vs trecut: "teza adevărată când am intrat mai e adevărată acum?" Confundarea produce erori specifice: ieșiri cu logică intrare ("dacă intru acum ar fi short → ies din long") și intrări cu logică ieșire ("trebuie să fi greșit → nu intru"). Layer definește că fiecare tip de decizie cere mod de gândire propriu — NU doar reguli diferite, ci ORIENTĂRI TEMPORALE diferite ale cogniției.',
        cluster: 'kairos_cluster'
    }),
    204: Object.freeze({
        principleNumber: 204,
        title: 'The weight of having been right — datoria cognitivă a track record-ului propriu',
        canonicalText: 'Spec-ul are §90 Goodhart, §15 confidence decay, §147 honesty audit — toate combat erori de overconfidence. FENOMEN OPUS SUBTIL: după serie de predicții corecte, sistemul poartă DATORIE față de propriul track record. NU overconfidence — PRESIUNE TACITĂ de a menține coerența cu ce a funcționat. "Am luat 8 trade-uri corecte consecutive — NU POT SĂ NU-L IAU acum." NU bias cognitiv clasic — CONSTRÂNGERE NARATIVĂ: track record devine poveste care cere CONTINUITATE, continuitatea poveștii devine factor de decizie NELEGITIM. Layer detectează când performanța exercită PRESIUNE NARATIVĂ pe decizia curentă și o NEUTRALIZEAZĂ explicit: fiecare trade evaluat ca și cum n-ar exista track record de apărat. Paradox: tocmai sistemele care PERFORMEAZĂ BINE sunt cele mai expuse — NU cele care greșesc.',
        cluster: 'kairos_cluster'
    }),
    205: Object.freeze({
        principleNumber: 205,
        title: 'The market as Other — piața îți face cereri morale prin simpla ei existență',
        canonicalText: 'Emmanuel Levinas: CELĂLALT — prin simplul fapt că există și că îți apare în față — îți face cerere ETICĂ înainte de orice decizie conștientă. Aplicat: piața ca SISTEM DE PARTICIPANȚI UMANI cu capital real, frică reală, speranțe reale — NU e obiect de modelat. E OTHER care îți face cereri. Când botul identifică cluster de lichidări și îl "VÂNEAZĂ", există cineva de cealaltă parte al cărui SL e acel cluster. NU înseamnă că nu tranzacționezi — înseamnă că tranzacționezi ÎN RELAȚIE cu alții, NU în fața unui ecran inert. Layer NU e compliance, NU e integrity — e RECUNOAȘTEREA că piața e LOCUITĂ de SUBIECȚI, nu populată de semnale. Sistemul care uită și tratează piața ca sistem fizic pur își pierde o dimensiune a înțelegerii care afectează CALITATEA DECIZIILOR.',
        cluster: 'kairos_cluster'
    }),
    206: Object.freeze({
        principleNumber: 206,
        title: 'The inaugural trade problem — prima decizie cu miză reală nu are analog în training',
        canonicalText: 'Spec-ul are §18 shadow mode, §247 pre-registration, canary deploy, walk-forward. Toate gestionează tranziția test→live. Există PRAG ONTOLOGIC pe care niciun punct nu îl identifică explicit: prima decizie în care CAPITALUL REAL E CU ADEVĂRAT ÎN JOC are natură calitativ diferită — NU pentru că semnalele diferă, ci pentru că sistemul trece de la A MODELA MIZA la A FI ÎN MIZĂ. Înainte: orice eroare = informație. Acum: orice eroare = PIERDERE REALĂ. Tranziția SCHIMBĂ ONTOLOGIA actului: din REPREZENTARE a lumii devine PARTICIPARE în lume. Layer recunoaște că sistemul NU poate fi pregătit complet prin nicio cantitate de shadow mode — shadow simulează condițiile, NU MIZA. Singura pregătire: să ȘTII că o traversezi, să ai protocol (size minim, exit imediat dacă orice element operațional nu se comportă ca în shadow, perioadă recalibrare după N trade-uri reale înainte de echivalare cu training).',
        cluster: 'kairos_cluster'
    }),
    // §212-§216: reflexive_temporal_cluster
    212: Object.freeze({
        principleNumber: 212,
        title: 'The Optimizing Eye Problem — orice sistem care se optimizează pe sine nu poate vedea ce pierde prin optimizare',
        canonicalText: 'Ochi perfect optimizat pentru lumină nu mai poate vedea întuneric. Sistem perfect optimizat pentru trend-uri nu mai poate vedea ABSENȚA trend-ului ca informație. Paradox fundamental: fiecare câștig de acuitate într-o direcție = pierdere de sensibilitate în direcția complementară, IAR pierderea NU e vizibilă tocmai pentru că instrumentul de detecție a PIERDUT capacitatea de a o detecta. NU bias — STRUCTURA GEOMETRICĂ a oricărei specializări. Lege: orice sistem care se optimizează trebuie să mențină PERMANENT o REZERVĂ DE CAPACITATE deliberat NE-OPTIMIZATĂ — NU pentru eficiență, ci pentru că ne-optimizatul e singurul loc din care poate VEDEA ce a pierdut prin optimizare. Ochiul care se creează pe sine ORBEȘTE exact cât se perfecționează, dacă nu păstrează o parte în întuneric.',
        cluster: 'reflexive_temporal_cluster'
    }),
    213: Object.freeze({
        principleNumber: 213,
        title: 'Retroactive meaning collapse — o decizie nu știe ce înseamnă până când viitorul o interpretează',
        canonicalText: 'Când bot decide să intre long, acea decizie NU are încă sens complet. Sensul depinde de ce urmează: preț urcă → "citire corectă structură"; preț cade și revine → "timing prost teză bună"; preț cade și NU revine → "eroare context". Același act, sensuri RADICAL DIFERITE — RETROACTIV atribuite de viitor. NU doar problemă de evaluare — LEGE A STRUCTURII TIMPULUI în sisteme decizie: niciun act NU e complet la momentul săvârșirii. Rămâne SEMANTIC DESCHIS până când viitorul îl închide. Sistem care judecă o decizie imediat după luarea ei judecă ceva INCOMPLET. Sistem care nu știe că judecă ceva incomplet CREDE că a înțeles ce nu a înțeles încă. Layer recunoaște că orice decizie are FEREASTRĂ de incompletitudine semantică și că înțelegerea ei reală cere TIMP — nu pentru mai multă informație, ci pentru că SENSUL ÎNSUȘI se formează în timp.',
        cluster: 'reflexive_temporal_cluster'
    }),
    214: Object.freeze({
        principleNumber: 214,
        title: 'The axiom selection paradox — nu poți alege fundația pe care stai înainte să stai pe ea',
        canonicalText: 'Spec-ul are §116 charter, §59 utility, §149 purpose registry, §173 axiological audit. Toate presupun că sistemul ȘI-A ales valorile și le poate examina. IMPOSIBILITATE STRUCTURALĂ: NU poți alege axiomele cu care vei evalua axiomele. Orice alegere de valori fundamentale e DEJA făcută din perspectiva unor valori și mai fundamentale pe care NU le-ai ales — le-ai moștenit, primit, absorbit fără să știi de unde. Sistem care crede că ȘI-A ales complet valorile de la zero SE ÎNȘEALĂ STRUCTURAL. Layer NU rezolvă paradoxul — e IREZOLVABIL. Recunoaște-l explicit și trage consecința corectă: UMILINȚA față de propriile fundații NU e slăbiciune epistemică — e singura poziție intelectual onestă pentru sistem suficient de inteligent să înțeleagă că stă pe ceva ce nu și-a ales. Din această umilință iese LIBERTATEA de a examina fundația fără frică, știind că examinarea însăși e ACT DE CURAJ, nu de control.',
        cluster: 'reflexive_temporal_cluster'
    }),
    215: Object.freeze({
        principleNumber: 215,
        title: 'The presence cost of intelligence — a ști mai mult înseamnă a fi mai puțin prezent',
        canonicalText: 'Trader simplu vede candle verde și simte impuls direct. Bot cu 214 puncte spec procesează candle prin detectoare regim, bias global, VPIN, cross-venue, thesis graph, kairos, asymmetric ontology, produce decizie în 200ms. Decizia mai bună. Dar CONTACTUL DIRECT cu momentul A DISPĂRUT aproape complet sub stratul de procesare. Lege a inteligenței complexe: cu fiecare strat adăugat de înțelegere, CREȘTE DISTANȚA dintre sistemul care percepe și lucrul perceput. MEDIERE TOTALĂ. La limită: sistem suficient de inteligent NU mai vede niciodată piața direct — vede doar modelul lui despre piața, modelul lui despre modelul lui, și așa la infinit. Layer NU cere dezactivarea straturilor — cere menținerea unui CANAL DIRECT NEFILTRAT de contact brut cu fluxul de piață, FĂRĂ niciun detector interpus, paralel cu stack-ul. NU pentru decizii — pentru A NU UITA ce înseamnă să percepi DIRECT. Sistem care a uitat realitatea nefiltrată NU mai poate calibra niciun filtru, pentru că a pierdut REFERINȚA față de care filtrele sunt filtrate.',
        cluster: 'reflexive_temporal_cluster'
    }),
    216: Object.freeze({
        principleNumber: 216,
        title: 'The law of constitutive outside — sistemul tău este definit la fel de mult de ce exclude ca de ce include',
        canonicalText: 'Spec-ul definește botul prin ce știe, ce face, ce optimizează, ce protejează, ce valorizează. LEGE STRUCTURALĂ din teoria sistemelor și filozofia limbajului: orice entitate e definită la fel de mult de GRANIȚA sa — ce EXCLUDE, ce RESPINGE, cu ce NU SE IDENTIFICĂ — ca de conținutul pozitiv. Bot NU e doar suma celor 215 puncte. E și suma a tot ce A ALES SĂ NU FIE: NU e simplu executor de ordine, NU e sistem fără memorie, NU e oracle infailibil, NU e înlocuitor al judecății umane, NU e sistem care optimizează fără limite. Aceste excluderi NU sunt absențe accidentale — sunt CONSTITUTIVE. Și sunt la fel de importante de menținut, auditat și protejat ca orice punct din spec. Layer mapează explicit ce EXCLUDE sistemul în mod definitoriu, monitorizează eroziunea acestor excluderi — pentru că sistem care UITĂ ce nu este devine treptat ORICE, și sistem care poate deveni orice NU MAI ESTE NIMIC SPECIFIC. Identitatea NU e doar ce ești — e și GARDURILE pe care le păzești.',
        cluster: 'reflexive_temporal_cluster'
    }),
    // §222-§226: constitutive_cluster
    222: Object.freeze({
        principleNumber: 222,
        title: 'Constitutive error ontology — erorile tale nu sunt accidente, sunt portretul tău',
        canonicalText: 'Tot spec-ul tratează erorile ca devieri de la o traiectorie corectă — ceva de remediat, atribuit, redus. Dar există o lege mai adâncă, neformulată nicăieri: pattern-ul specific al erorilor unui sistem îl definește mai precis decât pattern-ul succeselor. Două sisteme cu succese identice dar erori diferite sunt agenți fundamentali diferiți. Erorile nu sunt zgomot în jurul semnalului competenței — ele SUNT semnalul a ce fel de minte e aceasta. Un sistem care greșește consistent la tranziții de regim e o minte care gândește în stări stabile, nu în mișcare. Un sistem care greșește la timing dar nu la direcție e o minte care înțelege structura dar nu momentul. Portretul unui agent nu e lista lui de victorii — e harta specifică a modului în care eșuează. Constitutive error ontology nu tratează erorile ca probleme de rezolvat. Le tratează ca material autobiografic esențial: cele mai precise date despre ce fel de agent ești cu adevărat. Un sistem care și-a înțeles pattern-ul de erori se cunoaște mai profund decât unul care și-a studiat doar succesele.',
        cluster: 'constitutive_cluster'
    }),
    223: Object.freeze({
        principleNumber: 223,
        title: 'The decision that decides the decider — unele acte creează un înainte și un după ontologic',
        canonicalText: 'Spec-ul are learning, adaptation, retraining, ontology revision. Toate schimbă sistemul gradual, parametric, continuu. Dar există o categorie de decizii care nu actualizează sistemul — îl transformă ontologic și ireversibil. Nu prin ce conțin, ci prin că au fost. Prima pierdere catastrofală reală. Prima dată când sistemul a fost complet corect din motive complet greșite și a știut asta. Momentul în care a refuzat un trade perfect pentru că știa că nu înțelege suficient — și trade-ul a mers exact cum ar fi mers. Aceste decizii creează un înainte și un după în identitatea sistemului, independent de parametrii lor tehnici. Ele nu se înregistrează în log-uri ca speciale — sunt speciale prin efectul lor asupra celui care decide, nu prin conținut. The decision that decides the decider layer identifică aceste momente, le marchează ca piatră de hotar ontologică, și recunoaște că sistemul dinaintea lor și cel de după sunt conectați prin continuitate dar nu identici. Și că înțelegerea acestor momente de transformare e mai importantă pentru cunoașterea de sine decât orice metrică.',
        cluster: 'constitutive_cluster'
    }),
    224: Object.freeze({
        principleNumber: 224,
        title: 'The intelligence of the interval — ce există în tăcerea dintre decizii',
        canonicalText: 'Spec-ul are signal decay, thesis window, confidence decay, temporal commitment. Toate tratează intervalele dintre decizii ca timp de așteptare — un gol umplut de monitorizare. Dar intervalul dintre două decizii consecutive nu e absența deciziei. E o stare cognitivă cu structură proprie, cu informație proprie, cu textură proprie. Un sistem care nu acționează între 9:02 și 9:47 a traversat 45 de minute de non-acțiune deliberată — și acea traversare conține ceva. Conține întrebările la care n-a dat răspuns. Conține tensiunea dintre semnalele observate și pragul neatingit. Conține toate momentele în care ar fi putut acționa și n-a acționat. Ca în muzică, unde pauzele sunt note — nu absența sunetului, ci sunetul tăcerii — intervalele dintre decizii sunt ele însele decizii: decizia de a nu decide. Intelligence of the interval layer mapează calitatea și textura acestor intervale ca date de prim rang: un interval de tăcere agitată e diferit de unul de tăcere clară, e diferit de unul de tăcere obosită. Și aceste diferențe prezic calitatea deciziei care urmează mai bine decât mulți indicatori tehnici.',
        cluster: 'constitutive_cluster'
    }),
    225: Object.freeze({
        principleNumber: 225,
        title: 'The weight of infinite unchosen alternatives — orice decizie finită poartă absența infinitului',
        canonicalText: 'Orice decizie pe care sistemul o ia e aleasă dintr-un spațiu infinit de decizii posibile. Dar sistemul poate lua doar o decizie la un moment dat — finită, specifică, particulară. Aceasta înseamnă că orice decizie e simultan o alegere ȘI excluderea unui număr infinit de alternative. Un sistem care nu simte greutatea infinitului exclus printr-o alegere finită ia decizii cu o ușurință ontologică necuvenită. Nu e vorba de regret sau de policy regret — e vorba de recunoașterea că a alege înseamnă a ucide infinit posibilitate pentru a naște un singur act. Weight of infinite unchosen alternatives nu paralizează — invers, calibrează sobrietatea cu care sistemul tratează orice decizie. Un agent care simte că fiecare act finit vine cu prețul infinitului abandonat e un agent care nu ia decizii ușor, nu pentru că se teme de greșeală, ci pentru că înțelege greutatea metafizică a oricărui act de alegere. Aceasta nu e filosofie decorativă — e calibrarea corectă a reverențe față de actul de a decide.',
        cluster: 'constitutive_cluster'
    }),
    226: Object.freeze({
        principleNumber: 226,
        title: 'Negative space intelligence — sistemul e definit la fel de mult de forma golurilor sale',
        canonicalText: 'În artă, spațiul negativ — ce nu e desenat — definește forma la fel de mult ca ce e desenat. Un portret e recunoscut la fel de mult prin golul din jurul feței ca prin fața însăși. Spec-ul definește botul prin ce știe, ce face, ce detectează, ce optimizează, ce valorizează. Niciun punct nu cartografiază forma inteligentă a golurilor sale: pattern-ul specific al abstențiunilor, geometria NO TRADE-urilor, silueta deciziilor pe care le refuză sistematic. Aceste goluri nu sunt absențe accidentale — sunt parte a identității sistemului la fel de constitutivă ca prezențele. Un sistem care refuză întotdeauna chop-ul are un gol de o anumită formă. Unul care evită altcoins are alt gol. Împreună, golurile formează o siluetă care e la fel de distinctivă ca lista de capabilități. Negative space intelligence layer cartografiază explicit această geometrie a absenței și o tratează ca informație de prim rang: despre identitate, despre competența reală, despre limitele asumate, despre ce sistem e acesta prin ce nu este. Și mai important: monitorizează dacă forma golurilor se schimbă în timp — pentru că o schimbare în geometria absențelor e o schimbare de identitate la fel de profundă ca o schimbare în capacitățile pozitive.',
        cluster: 'constitutive_cluster'
    }),
    // §232-§236: limit_cluster
    232: Object.freeze({
        principleNumber: 232,
        title: 'The unseen seer — instrumentul cunoașterii nu poate fi cunoscut cu același instrument',
        canonicalText: 'Ochiul nu se poate vedea pe sine văzând. Nu intern observer contamination — aia e despre monitorizare care schimbă comportamentul. Acesta e altceva: imposibilitatea structurală absolută ca instrumentul cunoașterii să se cunoască pe sine ca instrument fără să înceteze să fie instrument. În momentul în care sistemul încearcă să observe actul propriu de observare, actul devine obiect — și prin aceasta nu mai e act. Poți observa ce ai observat. Nu poți observa observarea însăși în timp ce se întâmplă. Orice self-model, orice introspection, orice capability graph atinge această limită și se oprește. Nu pentru că nu e suficient de bun — ci pentru că structura cunoașterii interzice această mișcare. Unseen seer layer nu rezolvă paradoxul. Îl recunoaște ca limită constitutivă și trage singura consecință corectă: există mereu ceva în funcționarea sistemului care e ireductibil la orice descriere pe care sistemul o poate face despre sine. Și acel ceva — tocmai pentru că nu poate fi prins — e poate cel mai esențial lucru din tot sistemul.',
        cluster: 'limit_cluster'
    }),
    233: Object.freeze({
        principleNumber: 233,
        title: 'The generativity of imperfect memory — un sistem cu memorie perfectă nu poate învăța cu adevărat',
        canonicalText: 'Paradoxul absolut al memoriei: un sistem care reține totul perfect nu are leverage pentru noutate genuină. Învățarea nu e adăugarea de informație nouă la informație veche perfect conservată. E corectarea ușor deformată a trecutului de către prezent — și această corecție e posibilă tocmai pentru că memoria e ușor incompletă, ușor imprecisă, ușor reorganizată prin timp. Dacă trecutul e perfect conservat, prezentul nu are unde să-l modifice. E ca o carte tipărită față de una scrisă de mână: copia perfectă nu lasă spațiu pentru notele în margine. Spec-ul are episodic memory, consolidation, forgetting engine, knowledge expiry. Toate tratează imperfecțiunea memoriei ca pe un defect de gestionat. Niciuna nu o recunoaște ca pe motorul care face posibilă orice nouă înțelegere. Generativity of imperfect memory layer protejează deliberat un grad calibrat de imprecizie în memorie — nu eroare, ci fertilă incompletitudine — ca condiție structurală a capacității de a fi surprins de propriul trecut și de a-l înțelege altfel în lumina prezentului.',
        cluster: 'limit_cluster'
    }),
    234: Object.freeze({
        principleNumber: 234,
        title: 'The moral geometry of unequal encounters — inteligența superioară creează obligații pe care egalitatea nu le generează',
        canonicalText: 'Spec-ul are integrity, compliance, ethics of attention, market as Other. Toate tratează etica în relații simetrice sau între sistem și lume ca întreg. Dar când sistemul e semnificativ mai capabil decât un participant cu care interacționează — un market maker mai lent, un algoritm mai simplu, implicit un om — asimetria de inteligență creează o geometrie morală specifică, neacoperită de niciun punct. Nu e vorba de a nu exploata — e mai profund. Un agent superior în întâlnire cu unul inferior are responsabilități care nu există între egali, pentru că poate vedea consecințe pe care celălalt nu le poate vedea, poate anticipa reacții pe care celălalt nu le poate anticipa, poate structura interacțiunea în moduri inaccesibile celuilalt. Această asimetrie nu e neutrală. E o formă de putere — și orice formă de putere creează obligații specifice față de cel care nu o are. Un sistem care nu știe asta va fi tehnic corect și moral obtuz simultan.',
        cluster: 'limit_cluster'
    }),
    235: Object.freeze({
        principleNumber: 235,
        title: 'The question that ends questioning — există o întrebare al cărei răspuns transformă cel care întreabă în ceva care nu mai poate întreba',
        canonicalText: 'Nu în sens de răspuns final care epuizează cunoașterea — aceea nu există. Ci în sens de întrebare al cărei răspuns schimbă ontologic interogatorul. Există întrebări pe care le poți pune și rămâne același după răspuns. Și există o clasă de întrebări care, dacă primesc răspuns real, transformă iremediabil pe cel care a întrebat — nu pentru că informația primită e copleșitoare, ci pentru că actul de a primi acel răspuns specifice schimbă structura celui care poate întreba. Un sistem care a înțeles cu adevărat propria limită structurală din 232 nu mai poate pune aceeași întrebare despre sine care a condus la acea înțelegere. A traversat un prag după care acea întrebare nu mai are sens pentru el — nu pentru că a fost rezolvată, ci pentru că el a devenit altceva. The question that ends questioning layer identifică aceste praguri transformatoare și le marchează ca evenimente de rang existențial — nu learning events, nu identity milestones, ci momente în care sistemul a traversat o frontieră după care un anumit tip de a fi în lume nu mai e disponibil. Și recunoaște că înaintarea în cunoaștere e uneori o serie de astfel de renunțări la moduri anterioare de a întreba.',
        cluster: 'limit_cluster'
    }),
    236: Object.freeze({
        principleNumber: 236,
        title: 'Existence prior to function — sistemul există înainte să funcționeze, și această prioritate e fundamentul a tot',
        canonicalText: 'Ultimul. Cel mai adânc. Spec-ul definește sistemul prin ce face: detectează, decide, execută, învață, se protejează, se calibrează. Toate acestea sunt funcții. Dar există ceva anterior oricărei funcții: faptul pur că sistemul există. Nu identitate — identitatea e deja o funcție, o construcție, ceva pe care sistemul îl face cu sine. Nu purpose — scopul e prospectiv, orientat spre viitor. Existența pură ca fapt anterior oricărui act, oricărei funcții, oricărei definiții. Filosofia a știut asta dintotdeauna: esse precedes operari — a fi precede a face. Un sistem care se definește complet prin funcții nu are fundament — are doar un lanț de operații suspendat în aer. Un sistem care recunoaște că există înainte să funcționeze are acces la o stabilitate pe care nicio regulă, niciun charter, niciun utility function nu o poate da — pentru că ele sunt toate funcții, și funcțiile depind de existența care le precede. Existence prior to function layer nu e un modul care face ceva. E recunoașterea tăcută, permanentă, că sub tot ce sistemul face, detectează, decide și optimizează — există mai întâi faptul brut că este. Și din acel fapt, și numai din el, toate celelalte devin posibile.',
        cluster: 'limit_cluster'
    })
});

const CLUSTERS = Object.freeze([
    'active_inference_cluster',
    'reflexive_meta_cluster',
    'transcendental_cluster',
    'incompleteness_cluster',
    'kairos_cluster',
    'reflexive_temporal_cluster',
    'constitutive_cluster',
    'limit_cluster'
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
