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
