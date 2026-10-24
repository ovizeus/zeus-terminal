<!-- generat din docs/BOOK_OF_ALL.md linia 3675 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📜 REGULILE DUPĂ CARE LUCRĂM — rubrică permanentă

> Cerut de operator 2026-10-10: *„poti scrie si rubrica de rwguli dupa care lucram daca se intampla ceva sa le avem in book of all"*.
> Fiecare regulă de aici e scrisă **după ce a fost încălcată și a costat ceva**. Nu sunt principii generale — sunt cicatrici. Data de lângă fiecare e incidentul care a produs-o.

### 🔴 Operare — ce NU se atinge pe VPS-ul viu

**R-OP-1. Un singur `pm2 reload` per sesiune de lucru, la final.** *(2026-10-10: 8 reload-uri, 5 în 50 min → **HTTP 418, ban de IP Binance 63 min**. Exista deja regula scrisă și am încălcat-o de 4 ori.)*
Fiecare boot reface exchangeInfo, klines-init pe toate simbolurile, OI, funding, 24h tickers, markprice, watchlist — o rafală peste baza de ~345/min. Regula nu e despre *dacă* un reload e justificat, e despre **frecvență**. Patru deploy-uri corecte la rând sunt tot o rafală.
**Înainte de ORICE reload:** `SELECT banned_until FROM binance_rate_state WHERE scope='global';` — dacă e în viitor, nu atinge nimic.

**R-OP-2. Schimbările doar de client NU cer reload.** `npm run build` în `client/` rescrie bundle-ul din `public/app/`; serverul doar îl servește. Reload cer **doar** schimbările din `server/`.

**R-OP-3. 503-urile din primele 120s după orice restart sunt NORMALE.** `BOOT_BLIND_MS`, presiune presupusă 85%. Nu le confunda cu un ban. Distincția se face **doar** din tabela `binance_rate_state`, nu din loguri. *(M-a costat o oră de diagnostic.)*

**R-OP-4. NU rula jest/node/vitest ca root pe VPS-ul viu.** *(Artefacte root-owned → 139 EACCES, procesul zeus rupt tăcut; apoi `public/app/assets` root-owned a blocat un deploy cu EACCES.)* Totul prin `sudo -u zeus`.

**R-OP-5. NU WARP pe VPS-ul Zeus.** *(2026-05-20: instalarea a rupt rețeaua.)* Problemele de rutare se fac **împreună cu operatorul**, niciodată singur.

**R-OP-6. Validează `version.js` înainte de reload.** `node -e "require('./server/version.js')"`. Changelog-ul e JS cu ghilimele simple — **un singur apostrof rupe fișierul** și procesul nu mai pornește.

**R-OP-7. Lucrează în worktree izolat, nu în producție.** *(2026-10-10)* `/opt/zeus-worktrees/<nume>`, cu `node_modules` legat simbolic. **NU în `/root/...`** — e `700`, userul `zeus` nu poate intra ca să ruleze testele.

**R-OP-8. Suita completă NU se rulează monolitic pe VPS-ul viu — se dă pe shard-uri** (`--shard=i/4`), cu `--forceExit --runInBand`, și **ca `zeus`, niciodată ca root**. *(Regula exista deja mai jos în carte ca secțiune separată; o trec și aici, fiindcă o regulă care nu e în rubrică nu se citește la început de sesiune.)*

**R-OP-9. Orice plasă de siguranță care poate cădea trebuie să ȚIPE.** *(2026-10-20: backup-ul offsite picase pe 14 octombrie și am aflat pe 20, uitându-mă din alt motiv. Scria `FATAL` frumos într-un log pe care nu-l citește nimeni.)*
O plasă care cade în liniște **nu e o plasă** — e doar impresia de plasă, și e mai rea decât niciuna, fiindcă te face să nu mai verifici. Regula: orice script de siguranță rulat din cron (backup, offsite, watchdog) trimite alertă pe Telegram la eșec, nu doar o linie de log. Test de acceptare: **stinge-l intenționat și vezi dacă îți sună telefonul.**

### 🟠 Verificare — cum se dovedește că ceva merge

**R-V-1. Dovadă empirică obligatorie pentru orice „X merge".** Nu „ar trebui să meargă", nu „testele trec probabil". Rulează comanda și lipește ieșirea reală.

**R-V-2. Nu lua rapoartele subagenților la valoarea nominală.** *(2026-10-10: un subagent a raportat corect, dar recunoscuse că n-a urmărit starea roșie — testele lui puteau fi goale. Le-am testat prin mutație: mușcau.)*

**R-V-3. Un test care nu poate pica nu apără nimic.** După ce un test trece, **sparge codul dinadins** și confirmă că testul pică. Mutation-check pe fiecare aserțiune care contează.

**R-V-4. NU pipe înainte de `$?`.** *(2026-10-10: `tsc ... | head -6; echo $?` îmi dădea exit code-ul lui `head`. Am raportat „tsc exit 0" de mai multe ori, fals.)* Redirectează în fișier, apoi citește `$?`.

**R-V-5. Verifică ce verifică poarta.** *(2026-10-10: `tsc -p tsconfig.json` nu verifică NIMIC — `files: []` + referințe de proiect. Dovedit cu un identificator inexistent care a trecut.)* Comanda reală: `-p tsconfig.app.json`. Poarta nu e „exit 0" (imposibil — 67 erori preexistente), e **„fără erori NOI"**: numărul rămâne 67 și niciuna nu numește un fișier atins.

**R-V-6. Citește cum funcționează codul ÎNAINTE de a scrie pasul.** *(2026-10-10: planul meu presupunea că panourile randează rândurile inline. Nu o fac — le deleagă la componente cu **11 apeluri pe calea banilor**. Pasul meu ar fi șters butonul de închidere de pe o poziție live.)*

**R-V-7. Verifică de 2-3 ori înainte de commit.** Și la verdicte majore, fă un audit simetric: caută și dovada contrară.

**R-V-8. Un mutant care nu se aplică arată IDENTIC cu un test care prinde.** *(2026-10-20: primul mutant de azi a „supraviețuit" și m-am bucurat degeaba — harnessul înlănțuia un `sed` înaintea unei înlocuiri `python`, textul se schimbase, iar mutantul nu se mai aplicase deloc. Testul era bun; harnessul mințea.)*
Ambele cazuri dau „teste verzi pe cod stricat", dar unul înseamnă *testul e decor* și celălalt *n-am stricat nimic*. Regula: harnessul de mutație **afirmă** că șablonul s-a găsit exact o dată (`assert s.count(old)==1`) înainte de a înlocui, și nu înlănțuie două mecanisme de editare pe același fișier. Fără afirmația aia, o rulare de mutație nu dovedește nimic.

**R-V-9. O probă care schimbă starea nu e o probă.** *(2026-10-20: am rulat testul de acceptare al propriei mele regule R-OP-9 — „stinge-l intenționat și vezi dacă sună telefonul" — și proba a trecut, dar următoarea a tăcut când trebuia să țipe. Nu era logica nouă: `writeState` era necondiționat, deci `--dry` scria starea persistentă.)*
Două daune, amândouă reale: proba seta fereastra de suprimare și **înăbușea o alertă adevărată 24 de ore**; iar rulată de un user care nu putea citi pm2, scria `alerting: true` în starea vie, deci rularea următoare ar fi trimis un „✅ revenit" complet fals. Regula: un flag de probă **nu scrie nimic** — nici stare, nici marcaje, nici jurnal persistent. Și corolarul care m-a prins: **când adaugi o fereastră de suprimare, orice bug preexistent de scriere a stării capătă dinți** — suprimarea transformă o scriere inofensivă într-o alertă pierdută.

**R-V-10. Un rezultat GOL de la un filtru de timp e o suspiciune, nu un răspuns.** *(2026-10-20: am interogat dezacordurile de paritate cu `datetime(created_at) >= datetime('now','-3 days')`, am primit zero rânduri și aproape am raportat „nu există dezacorduri acționabile". Erau 1494 de perechi. `brain_parity_log.created_at` e **epoch în milisecunde**, nu șir datetime — filtrul nu dă eroare, dă liniște.)*
Aceeași bază amestecă **două convenții** în coloane cu nume identice: epoch ms în `brain_parity_log.created_at` și `position_events.ts`; șir datetime în `at_closed.closed_at`, `missed_trades.created_at`, `audit_log.created_at`. *(Carte: incidentul-gemene e deja notat pe `closed_at`, unde comparația directă de șir cu `'...T...'` excludea fals rândurile zilei.)* Regula: **înainte de a filtra pe timp, citește o valoare** (`SELECT <col> ... LIMIT 1`) și abia apoi scrie predicatul. Și dacă un filtru de timp întoarce zero pe un sistem despre care știi că lucrează, prima ipoteză e că filtrul e greșit, nu că sistemul e inactiv.

### 🔵 Cod — reguli de fond

**R-C-1. TDD: testul întâi, îl vezi picând, apoi codul.** Scrierea testului și a implementării în aceeași trecere nu e TDD — nu poți arăta starea roșie, deci nu știi dacă testul testează ceva.

**R-C-2. Adâncime pe calea banilor.** Orice atingere de poziții, ordine, SL/TP, închidere, sizing: citește tot drumul, nu doar diff-ul. *(Regula care a salvat Task 2.)*

**R-C-3. Nu înlănțui schimbări riscante.** *(2026-05-20: Fix#1→#6 în lanț, imposibil de spus care a rupt ce.)* O schimbare, o verificare, un commit.

**R-C-4. Nu conecta niciodată DOAR o jumătate de buclă.** *(2026-10-10: tipul de lumânare a părut reparat trei zile — se reparase citirea, se lăsase scrierea. Ciclul era închis, pe valoarea greșită.)* Proiecție **ȘI** hidratare **ȘI** aplicare, sau nu o face.

**R-C-5. Setările TREBUIE să persiste la refresh.** Verifică toate 4 verigile: toggle salvează / serverul acceptă cheia / se hidratează / se **aplică** la boot. Plus garda `_usApplyDone`. Diagnostic: `SELECT updated_at FROM user_settings WHERE user_id=1`.

**R-C-6. O cheie absentă din payload lasă valoarea stocată neatinsă.** Asta e unealta — **nu un default inventat**. *(2026-10-10: 8 chei semănate cu default-uri ștergeau valorile reale la fiecare salvare. Semnătura în DB: **zero varianță între useri** — dacă toți au exact aceeași valoare, doar codul a scris-o vreodată.)*

**R-C-7. Întreabă „cine e proprietarul REAL al cheii ăsteia?" înainte să repari.** Zeus are **două canale** de persistență care se suprapun și nu sunt de acord: `/api/user/settings` (chei plate) și `/api/sync/user-context` (secțiuni, parte în SQLite, parte în fișiere JSON). O secțiune lipsă din `user_ctx_data` **nu e bug** — verifică `data/user_ctx/<uid>.json`.

**R-C-8. Dacă UI-ul promite o setare, trebuie să o poată ține.** *(2026-10-10: modalul LIQ avea 23 de controale și 0 cititori; panoul S/R avea 21 și exact 1 conectat.)* Ori o conectezi, ori o scoți. **Nu o lași să mintă.**

**R-C-9. Nu inventa o valoare.** Dacă ceva nu e calculat, afișează `—`. Niciodată un număr plauzibil. Pe o suprafață de bani, o celulă goală se citește ca „zero".

**R-C-10. Iconițele = glyph SVG din `IND_ICONS`, nu emoji.** Emoji e doar fallback. Alege forma randând la 15px.

**R-C-11. UI-ul Zeus e în engleză.** Doar conversația cu operatorul e în română.

**R-C-12. Pasul care face loc trebuie să ruleze ÎNAINTE de pasul care are nevoie de loc.** *(2026-10-20: retenția offsite tăia după număr și rula după `exit 1` al urcării. Pe Drive erau exact `KEEP_N` obiecte, deci retenția n-avea ce tăia până nu reușea o urcare, iar urcarea nu reușea fiindcă nu era loc. Impas închis, 7 zile.)*
Două corolare, amândouă plătite în aceeași zi: **(a)** o retenție care numără obiecte e oarbă la mărimea lor — când obiectele cresc (2,07 GB vs 270 MB), numărul nu mai spune nimic despre spațiu, deci judecă pe **octeți**; **(b)** o ștergere care merge în coș **nu eliberează nimic** — coșul Google Drive consumă în continuare cota, deci `--drive-use-trash=false`. Și a treia, din afara codului nostru: **cota Google e eventual-consistentă**, deci după ce faci loc trebuie să aștepți, nu doar să reîncerci.

**R-C-13. Decorul nu are voie să omoare datele.** *(2026-10-20: `/journal.html` randa tabelul corect, apoi randa graficul; dacă graficul arunca, `.catch`-ul comun chema `showEmpty()` și **ștergea un tabel care se randase perfect** — iar mesajul zicea „Fetch error", deși datele sosiseră.)*
Două daune separate, și a doua e mai perfidă: pierzi datele **și** ești trimis pe pistă greșită, fiindcă eroarea purta numele etapei nevinovate. Regula: randează **datele primul și neprotejat** — dacă acolo pică, chiar vrei să vezi — iar tot ce e decor (grafic, statistici, animații) se izolează **fiecare cu numele lui** în consolă. Și corolarul: **un `.catch` pus la capătul unui lanț de `.then` nu e un handler de rețea** — prinde tot ce s-a întâmplat după, inclusiv randarea, deci nu-i pune un mesaj care pretinde altceva.

**R-C-14. O clasă de etichetă nu e o clasă de buton.** *(2026-10-20: singura uşă spre toată pagina de jurnal era un `<a className="zi-lbl">` — 9 px, uppercase, subliniat, lipit în dreapta jos. Clasa nu era prost dimensionată: `zi-lbl` e folosit de 37 de ori în client și **toate** celelalte sunt titluri de secțiune pe `div`/`span`, unde 9 px e perfect corect.)*
Greșeala e de **rol**, nu de valoare: o clasă făcută pentru a *eticheta* ceva a fost pusă pe ceva de *apăsat*. Regula: orice element pe care utilizatorul apasă — link de navigare inclusiv — primește stil de **țintă** (înălțime reală, scris de minim 12 px, bordură sau fundal care spune „sunt apăsabil"), niciodată stilul unei etichete. Când cauți altele la fel, caută după **tag** (`<a>`, `<button>`) care folosește clase de etichetă, nu după numărul de apariții al clasei.

**R-C-15. Un câmp citit pe care nimeni nu-l scrie nu e „zero", e un panou mort.** *(2026-10-21, Quant: 71 din 157 de câmpuri citite de randare n-aveau niciun scriitor. 28 erau punte neterminată — valoarea exista pe `S`, calculată la fiecare 60 s, și era aruncată; Mayer Multiple real 1,137 în timp ce panoul afișa 0.)*
`S._qmFoo || 0` degradează politicos, deci un câmp fără scriitor arată exact ca o piață liniștită. Regula: la orice port sau redenumire de stare, **numără citirile și scriitorii** și compară-i — un singur `grep` peste tot repo-ul (inclusiv legacy JS, nu doar TS) spune în zece secunde cât din panou e viu. Și separă întotdeauna **puntea lipsă** (datele există, reparație ieftină) de **funcția neimplementată** (nu există sursă) — primele se repară azi, a doua e o decizie.

**R-V-11. Când un mutant supraviețuiește, bănuiește întâi testul, nu codul.** *(2026-10-21: trei mutanți au supraviețuit fixului meu de ciclu de viață. Nu codul era slab — pusesem **două** gărzi, iar testele mele atingeau doar prima, deci nu discriminau. Refăcute ca să țintească exact, mutația a arătat apoi că o **a treia** bucată a propriului meu fix era redundantă, și am scos-o.)*
Un mutant viu are trei explicații, în ordinea probabilității: **testul nu ajunge acolo**, **codul mutat e redundant**, sau **mutantul nu s-a aplicat** (vezi [[R-V-8]]). Niciuna nu înseamnă „e în regulă". Regula: fiecare bucată a unui fix își câștigă locul cu un test care o omoară la mutație — altfel o scoți. Și corolarul pentru verificarea în bundle: caută **forma de după minificare**, nu forma din sursă — `if (x) return` devine `x||(...)` și grep-ul naiv raportează fals că garda lipsește.

**R-V-12. O comparație de două medii nu dă `0` pe o piață plată — virgula mobilă îi dă o direcție.** *(2026-10-21: `emaTrend` pe o serie perfect constantă răspundea `-1`. Cele două EMA *ar trebui* să iasă identice, dar acumulează altfel pentru `k` diferiți și rămâne o diferență de ordinul `1e-14`, din care `f > s` producea un trend **încrezător** pe o piață care nu se mișcă. Regula: orice verdict obținut din compararea a două valori calculate are nevoie de **epsilon relativ**, nu de `===`; altfel zgomotul de rotunjire devine semnal. Prins de test, nu de ochi.)*

**R-V-13. O sondă care raportează un randament semnat trebuie să-și valideze convenția de semn pe adevăr de teren înainte să raporteze orice.** *(2026-10-24: contrafactualul din 22 oct avea semnul întors — direcția cădea pe LONG implicit, iar populația e 69% SHORT, deci a produs oglinda exactă a realității. A trecut prin **trei** runde de rafinare fără ca vreuna să atingă semnul, fiindcă toate rafinau în interiorul oglinzii. Din asta a ieșit „selecția e anti-selectivă" și recomandarea pe anti-pattern-uri — amândouă false. Un semn întors nu arată ca o eroare, arată ca o descoperire: dă exact tiparul căutat, cu numere plauzibile și `n` uriaș. Adevărul de teren pentru Zeus e `closePnl` din `at_closed`: randamentul semnat al sondei trebuie să aibă același semn pe ≥99% din pozițiile cu PnL nenul și închidere curată — la sonda nouă, 717/718 = 99,86%. Corolar la [[R-V-5]]: nu e destul ca instrumentul să fie consistent cu sine, trebuie legat la o măsurătoare făcută de altcineva — aici, de bursă.)*

**R-V-14. Un obiect-ciot pus ca sa previna crash-uri face orice verificare de tip „e truthy?" sa minta.** *(2026-10-24: `unregisterChart()` pune pe globalele chartului un `_noopStub` — un `Proxy` peste o **functie**, deci truthy. `_activate` verifica `if (!_series())`, deci trecea; `createPriceLine` intorcea `undefined`; linia se adauga in lista fara nimic desenat si fara nicio eroare. Operatorul: „apas si nu face nimic". Trei runde de reparaturi pe gesturi nu puteau gasi asta, fiindca nu era un bug de gest. Regula: daca un modul inlocuieste o dependenta cu un `noop` in loc de `null`, intrebarea valida nu e „exista?" ci „e FUNCTIONALA?", si raspunsul se cere de la cel care stie — aici `isChartReady()` al punţii — nu se deduce din prezenta. Corolar, platit cu trei runde: **o cale de eşec muta costa mai mult decat bugul.** Orice acţiune a utilizatorului care se poate opri trebuie sa spuna de ce, acolo unde se vede: pe telefon, nu in un toast de 12px in colţ care dispare in 1,2 s. Vezi si [[R-V-11]] — un test al meu de la aceeasi runda a fost decor, prins fiindca mutantul a supravieţuit.)*

**R-V-15. Un alias catre un obiect viu trebuie sa aiba UN SINGUR proprietar, iar cine inlocuieste obiectul trece pe la el.** *(2026-10-24: `w.cSeries` si `w._zCSeries` aratau spre aceeasi serie de lumânari si erau scrise de module diferite. `applyCandleType` a inlocuit seria — `removeSeries` + `w.cSeries = series` — si a actualizat doar unul. Nimic n-a crapat: aliasul rămas arata spre un obiect valid sintactic dar MORT semantic, care raspundea `null` la orice intrebare, deci `coordinateToPrice` dadea null si desenul nu putea pune niciun punct. Si fiindca tipul de lumânare se re-aplica LA BOOT, desenul era rupt din secunda in care pornea aplicatia. Cinci runde de citit codul DESENULUI nu aveau cum sa o gaseasca, fiindca **cauza nu era in codul care esua** — simptomul („nu pot desena") si cauza („s-a schimbat tipul de lumânare") sunt despartite de un boot si n-au nicio legatura vizibila. Fixul corect e pe clasa: un singur `setCandleSeries` in punte care schimba TOATE aliasurile deodata, si toti cei care inlocuiesc seria trec pe acolo. Vezi si [[R-V-14]] — tot despre obiecte care par vii.)*

**R-V-16. „Livrat" inseamna livrat ACOLO UNDE SE UITA EL.** *(2026-10-24: am reorganizat cartea in `docs/book/`, pe disc, si i-am spus ca are foldere. El citeste cartea de pe TELEFON, din aplicatie, unde sectiunea servea `BOOK_OF_ALL.md` intreg: pentru el nu se schimbase nimic. „Cand intru" insemna in aplicatie. A doua oara in aceeasi zi cand repar ceva unde nu se uita el — vezi [[R-V-15]], cinci runde pe codul desenului cand cauza era in alta parte. Intrebarea inainte de a spune „gata" nu e „e fisierul pe disc?", ci **pe ce ecran ajunge?**. Corolar, platit in aceeasi runda: cand spune „uita-te la capturi", prima miscare e `ls data/book_uploads/` — mecanismul de urcat capturi exista de luni de zile, construit exact pentru asta, iar eu i-am raspuns ca n-au ajuns capturile. Al doilea corolar, din ce aratau ele: **un randor scris pentru „un subset controlat" imbatraneste odata cu continutul.** Randorul cartii nu stia tabele; cartea a devenit intre timp aproape numai tabele, deci partea cea mai citita era partea cea mai rupta, in liniste, de luni de zile.)*

### 🟢 Proces

**R-P-1. Tot în Book of All.** Orice găsim, reparăm, amânăm sau decidem.

**R-P-2. Întreabă înainte de schimbări de design.** Propune 2-3 variante cu compromisuri, recomandă una, așteaptă.

**R-P-3. Checkpoint git des.** Netul se taie. Commit + push după fiecare bucată verificată.

**R-P-4. Backup înainte de o lucrare mare.** Tag git + branch + copii de fișiere. *(2026-10-10: `pre-institutional-redesign`.)*

**R-P-5. Spune ce ai stricat, imediat și fără scuze lungi.** Raportează onest: dacă testele pică, arată ieșirea; dacă un pas a fost sărit, spune-o; dacă ceva e dovedit, spune-o simplu.

---

> ### 📥 LOT NOU DE REGULI — primit de la operator pe 2026-10-24
>
> El le-a scris, eu le-am citit pe toate şi le-am verificat împotriva celor 45 existente şi împotriva
> stării reale a sistemului. **Sunt 15, şi 13 intră aşa cum sunt.** Două se bat cap în cap cu ceva ce avem
> deja în producţie, şi le-am scris cu obiecţia la vedere, nu le-am tocit în linişte ca să pară că sunt
> de acord. Unde o regulă era corectă dar nemăsurabilă („minim N tranzacţii"), am propus cifra —
> o regulă fără prag nu se poate încălca, deci nu apără nimic.

**R-OP-10. Ritual de început de sesiune.** Înainte de orice modificare: citeşti rubrica; `SELECT banned_until FROM binance_rate_state`; `git status` (pe ce branch şi worktree eşti); `pm2 list`. Patru comenzi, două minute. Fără ele lucrezi pe ghicite. *(Adăugarea mea, plătită azi: **`ls data/book_uploads/`** — a cincea comandă. El urcă capturile din aplicaţie, nu în chat. Azi mi-a spus „uită-te la capturi" şi i-am răspuns că n-au ajuns; erau pe disc de douăzeci de minute. Vezi [[R-V-16]].)*

**R-OP-11. Ritual de final de sesiune.** Se scrie în carte ce s-a schimbat, ce a rămas deschis, ce s-a amânat **şi de ce**, plus commit-ul final. Următoarea sesiune porneşte de acolo, nu de la zero. *(Extinde [[R-P-1]]: aceea cere să scriu ce am făcut, asta cere să scriu şi ce **n-am** făcut. A doua jumătate e cea care lipsea.)*

**R-OP-12. Plan de rollback înainte de deploy.** Înainte de `reload` trebuie să existe răspuns la „dacă pică, la ce commit mă întorc şi cu ce comandă?". Dacă răspunsul nu e scris, nu se face deploy. *(Concretizat, altfel e lozincă: comanda pentru Zeus e* `git checkout <sha-ul bun> -- server/ client/ && cd client && npm run build && sudo -u zeus pm2 reload zeus` *, iar `<sha-ul bun>` se scrie în carte ÎNAINTE de reload, nu se caută după ce a picat. Pentru o schimbare doar de client, rollback-ul e doar rebuild — [[R-OP-2]].)*

**R-OP-13. Baza de date vie: doar citire din consolă.** Orice `UPDATE`, `DELETE` sau `ALTER` se face doar după o copie a tabelei. Se rulează întâi ca `SELECT` cu acelaşi `WHERE`, ca să vezi câte rânduri atinge. *(Concretizat: pe o bază de 2,8 GB „backup înainte de fiecare atingere" înseamnă în practică* `CREATE TABLE x_bak_20261024 AS SELECT * FROM x` *pe tabela afectată, nu o copie a întregii baze — aia durează 30 de secunde şi se face oricum zilnic.)*

**R-OP-14. Cheile API nu apar niciodată în chat, loguri sau commit-uri.** Se folosesc doar mascate (`******qH7H`). Dacă una scapă, se roteşte **imediat**, nu „mai târziu". *(Leagă [[P6]] — keystore-ul de release Android e în git de luni de zile şi aşteaptă exact asta: scos din istoric **şi rotit**. Regula nouă transformă P6 din „de făcut cândva" în „restanţă pe o regulă".)*

**R-V-17. Două runde eşuate = pas înapoi.** Dacă după 2 runde bug-ul nu e găsit, nu începi a treia pe acelaşi cod. Te întrebi dacă nu cumva cauza e în altă parte. *(Cea mai scumpă regulă din lot, şi singura plătită de trei ori într-o zi: [[R-V-14]] trei runde, [[R-V-15]] cinci runde, desenul şase. **Dar o nuanţă pe care o scriu ca să nu fie citită greşit:** rundele alea n-au fost pierdute — fiecare a reparat un bug real. Ce lipsea nu era efortul, era întrebarea. Forma care funcţionează: după a doua rundă nu te întrebi „ce mai încerc?", ci **„simptomul şi cauza pot fi despărţite de un boot?"** şi **„ce dovadă îi cer lui ca să nu mai ghicesc?"**. Azi, captura a rezolvat în cinci minute ce şase runde de citit cod n-au putut.)*

**R-V-18. Ce nu am verificat se spune explicit.** Raportul final are o secţiune „neverificat". Tăcerea despre un lucru nu înseamnă că e în regulă. *(Bună, şi o fac deja ad-hoc — azi: „`tsc` are 68 de erori preexistente în alte fişiere, zero în ale mele, nu pretind că e curat". Regula o face obligatorie, nu opţională după cum îmi convine.)*

**R-C-16. Orice schimbare pe calea banilor trece întâi prin demo.** Comutarea DEMO→LIVE o face **doar operatorul**, niciodată agentul. *(Asta e deja arhitectura: `SERVER_BRAIN`/`SERVER_AT` sunt `false` pe live, iar `S10` din plan e explicit „decizia şi cheile TALE". Regula scrie ce era convenţie. **Pragul lipsea şi îl propun:** minimum **30 de tranzacţii demo închise curat** şi **14 zile** fără incident — aceleaşi cifre ca soak-ul din S10, ca să nu avem două standarde. Dacă vrei alt număr, spune-l şi îl schimb; dar fără cifră regula nu se poate încălca, deci nu apără nimic.)*

**R-C-17. Feature nou = flag, implicit OFF.** 🙋 **Aici nu sunt de acord pe toată suprafaţa, şi îţi spun de ce.** Principiul e corect pe calea banilor: porneşti funcţia de pe flag, nu de pe deploy, şi o opreşti fără reload. **Dar Zeus are deja 34 de flag-uri, toate ON**, iar auditul din 14 octombrie a găsit **două flag-uri aprinse care nu fac nimic** — şi `SMART_CUT` a stat **cod mort de la livrare**, în spatele unui flag care părea pornit. Un flag în plus nu e gratis: e un comutator care poate minţi, şi avem deja clasa asta de bug de trei ori. **Ce propun:** flag obligatoriu pentru orice atinge decizia de tranzacţionare, execuţia, sau ce nu se poate opri printr-un rebuild. Pentru o schimbare doar de client — cum a fost cartea azi — rollback-ul e rebuild-ul, iar un flag ar adăuga doar încă un comutator de urmărit. **Decizia e a ta**; dacă spui „pe tot", o aplic pe tot.

**R-C-18. Orice apel nou spre bursă îşi declară greutatea.** Cât adaugă la bugetul de ~345/min şi cât de des rulează. Fără cifra asta nu intră în cod. *(Foarte bună, şi direct plătită: banul de IP din 10 octombrie şi rafala de `positionRisk` din P1. [[R-OP-1]] păzeşte reload-urile, asta păzeşte codul care rulează între ele — cealaltă jumătate a aceleiaşi probleme.)*

**R-C-19. Timpul se stochează în UTC, cu convenţia în numele coloanei.** `created_at_ms`, `closed_at_iso`. Ora României apare doar la afişare. *(Corectă, şi închide clasa [[R-V-10]]. **Spun pe faţă că se naşte deja încălcată:** schema actuală are `ts`, `created_at`, `date`, amestecate ms şi ISO, pe 400 de tabele. Regula se aplică la **coloane noi**; nu redenumim schema existentă, ar fi o migrare uriaşă pe o bază de 2,8 GB pentru zero câştig funcţional. O regulă despre care ştim de la început că e încălcată în 400 de locuri trebuie să-şi spună domeniul, altfel se transformă în zgomot.)*

**R-C-20. Fişierele generate nu se editează.** Dacă antetul zice „generat din…", se editează sursa şi se rulează scriptul. *(Nimerită la fix: fişierele din `docs/book/` poartă exact antetul ăla, iar `scripts/book-split.py` **şterge tot ce generează** înainte să scrie — o editare acolo n-ar supravieţui nici până la următoarea rulare. Singura excepţie, scrisă pe faţă în script: `START.md`.)*

**R-C-21. Datele nu se şterg, se arhivează.** 🙋 **Şi aici am o obiecţie, iar asta e cea importantă din lot.** Pentru **istoricul de tranzacţii, decizii şi jurnal** regula e corectă fără rezerve — pierderea lor omoară orice analiză viitoare, şi jumătate din ce ţi-am dovedit luna asta a ieşit din `brain_decisions` şi `at_closed`. **Dar aşa cum e scrisă intră în conflict direct cu ceva ce am reparat deliberat în b289:** retenţia care taie cea mai mare tabelă. Baza e la **2,8 GB** şi creşte cu ~17 000 de decizii pe zi. Dacă nimic nu se mai şterge niciodată, discul devine o problemă, iar bugul pe care l-am reparat — retenţia care nu rula — devine „funcţionalitate". **Ce propun:** regula se aplică la **datele de decizie şi tranzacţionare** (nu se şterg niciodată, se arhivează), iar **telemetria şi logurile de depanare** rămân pe retenţie, fiindcă asta e treaba lor. Dacă vrei regula pe tot, se poate — dar atunci trebuie să ne uităm la disc împreună, şi îţi spun dinainte că e o discuţie despre spaţiu, nu despre principiu.

**R-P-6. Ce găseşti în afara sarcinii se notează, nu se repară.** Se trece în carte la „găsit, nereparat" şi se repară doar cu acordul tău. *(Bună, şi întăreşte [[R-C-3]]. **I-am făcut loc să existe:** vezi secţiunea „🔭 GĂSIT, NEREPARAT" din carte — altfel regula cere să scriu undeva unde nu există nimic, şi devine o intenţie, nu o practică.)*

**R-P-7. Când nu ştii ce vrea operatorul, întrebi, nu presupui.** *(Corectă, şi tocmai mi-a costat o rundă azi: am presupus că „foldere" înseamnă foldere pe disc. **Dar o nuanţez, fiindcă altfel se bate cu felul în care lucrezi:** tu vrei în general să fac, nu să întreb — „fa", „nu ma intreba atata". Forma care împacă ambele: **întreb când răspunsul schimbă ce se construieşte sau când atinge calea banilor; altfel decid, spun presupunerea pe faţă, şi merg mai departe.** Azi, o întrebare de un rând — „în aplicaţie sau pe disc?" — ar fi scutit o rundă întreagă. Asta e exact genul de întrebare care merită pusă.)*

---

> ### 🧱 CINCI REGULI DE LA MINE — 2026-10-24, cerute de el
>
> Am ales **cinci**, nu cincisprezece, şi asta e prima mea părere despre rubrica asta: **o carte de
> reguli pe care n-o mai citeşte nimeni e mai rea decât una mai scurtă pe care o respecţi.** Suntem la
> 60. Fiecare dintre cele cinci de mai jos e plătită cu un incident **din cartea asta**, nu e sfat
> general de pe internet. Dacă vreuna ţi se pare că nu şi-a câştigat locul, scoate-o — prefer 55 vii
> decât 60 decorative.

**R-C-22. Reparaţia se face pe CLASĂ, nu pe instanţă.** Când ai găsit cauza, înainte să spui „gata" cauţi **toate** locurile cu aceeaşi formă şi le numeri în carte. *(**Cea mai scumpă lecţie din toată cartea, plătită de cel puţin cinci ori.** Escaparea pentru Telegram a fost reparată pe 7 octombrie **la un singur loc de apel** — comentariul de acolo notează 149 de eşecuri într-o zi — şi s-a întors imediat, fiindcă alte 25 de şabloane interpolau la fel; la b273 s-a reparat la graniţă, o dată, pentru toate. Cele opt chei care suprascriau setările: fiecare „reparată" separat ar fi fost opt runde. Aliasul seriei de lumânări: fixul corect n-a fost să actualizez `_zCSeries` în `applyCandleType`, ci un singur `setCandleSeries` prin care trec toţi. Azi, la ora asta: clasificatorul cărţii punea „NEREPARAT" în coşul LIVRAT fiindcă potrivirea era pe subşir; reparaţia pe instanţă ar fi fost o excepţie pentru titlul meu, reparaţia pe clasă a fost o listă de negaţii care prinde şi „NELIVRAT" şi „NEVERIFICAT". **Corolar:** o potrivire pe subşir nu e o potrivire pe înţeles.)*

**R-C-23. Codul nou ÎNTREABĂ sursa existentă, nu re-decide singur.** Dacă un lucru e deja hotărât undeva — o clasificare, o stare, un adevăr — codul nou cere răspunsul de acolo. A doua implementare pleacă în altă direcţie la primul caz ambiguu, şi nimeni nu observă până nu e târziu. *(Azi am avut alegerea explicit: aplicaţia avea nevoie de coşurile cărţii, şi era mai simplu să re-clasific secţiunile în TypeScript, în client. N-am făcut-o — rutele servesc folderele deja generate de scriptul Python. Dacă aş fi scris a doua clasificare, prima secţiune cu titlu ambiguu ar fi stat în două coşuri diferite, după cum o priveai. Preţul formei opuse e în carte de trei ori: două „creiere" care se contraziceau ([[R-V-15]] pentru alias), **doi raportori de erori cu nume de câmpuri diferite** pe acelaşi punct final — unul dintre ei mort de când fusese scris — şi `SMART_CUT`, cod mort în spatele unui comutator care părea pornit.)*

**R-V-19. O cifră fără comanda care o produce nu e o măsurătoare, e o amintire.** Orice număr pe care ţi-l dau vine cu interogarea sau scriptul care îl scoate, salvat, ca să poată fi rulat din nou de altcineva — sau de mine, peste trei zile. *(Plătită ieri şi retrasă azi: contrafactualul din 22 octombrie. Cifrele −0,023 / −0,055 / −0,084% au stat în carte ca adevăr până când am scris o sondă nouă şi **n-am putut reproduce niciuna** — fiindcă vechea sondă presupunea LONG pe o populaţie 69% SHORT. Dacă prima măsurătoare ar fi venit cu scriptul ei, inversiunea s-ar fi văzut în aceeaşi zi, nu după ce ţi-am recomandat un filtru pe baza ei. [[R-V-13]] cere validarea convenţiei de semn; asta cere ceva mai de bază: **să existe ce valida.**)*

**R-V-20. Orice cifră poartă fereastra ei de timp şi regimul în care a fost luată.** „Net −8 459" nu înseamnă nimic fără „pe tot istoricul, inclusiv regimul dinainte de 26 iunie". *(Plătită de două ori pe aceeaşi măsurătoare. Titlul auditului „DSL taie numai câştigătorii" descria un regim **încheiat în iunie**, iar eu l-am dat ca stare curentă; corectat pe 22 octombrie. Apoi a doua oară pe 24: cifra pe tranzacţie era **+10,78 USD după 26 iunie**, nu −6,24 ca înainte, deci aceeaşi bază de date dă două răspunsuri opuse după unde tai fereastra. **Un sistem care s-a schimbat are mai multe trecuturi; un număr pe tot istoricul le amestecă şi nu descrie niciunul.**)*

**R-P-8. O regulă fără prag, fără domeniu şi fără incident nu apără nimic — se scrie cu cifra şi cu cazul.** Regulă despre reguli. *(Scrisă azi, din lotul tău: „minim N tranzacţii demo" nu se poate încălca până nu există N — l-am propus 30 şi 14 zile, ca să aibă ce fi încălcat. „Timpul se stochează cu convenţia în nume" se năştea încălcată în 400 de tabele, deci trebuia să-şi spună domeniul: **coloane noi**. Şi invers: regulile care chiar funcţionează în cartea asta au toate un incident lipit de ele — [[R-OP-1]] are banul de IP, [[R-V-11]] are mutantul supravieţuitor, [[R-V-16]] are telefonul tău. **O regulă fără incident e o preferinţă; cu incident e o datorie plătită.**)*

---
