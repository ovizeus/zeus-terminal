<!-- generat din docs/BOOK_OF_ALL.md linia 562 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔗 REPARAT — paritatea DSL se alimentează, şi acum ştim CÂT de desincronizate sunt — 2026-10-21 (b298 v1.7.272)

**Client-only → build, fără al doilea reload** (R-OP-2; reload-ul sesiunii s-a dus pe b297).

### Fixul

Emisia clientului era păzită de `localStorage.zeus_dsl_parity_shadow === 'true'` — **un cititor,
zero scriitori**, niciun comutator în interfaţă. Nu exista nicio cale s-o aprinzi în afară de
consola browserului. De aceea `dsl_parity_log` avea 649 833 de rânduri şi **toate `source='server'`**.

Poarta devine **opt-OUT**, aliniată la **sora care merge**: paritatea de brain (2 316 rânduri
reale de client) **nu are niciun semafor** — emite direct, best-effort, iar **serverul** decide
dacă scrie. Acelaşi contract e deja implementat pe ruta DSL, iar **`DSL_PARITY_SHADOW_ENABLED=true`
în `.env`**: serverul aştepta de la început.

Noul predicat pur `_dslParityEmitEnabled()` întoarce fals **doar** pe şirul `'false'`. Cheie
absentă, valoare fără sens, sau un `localStorage` care aruncă (fereastră privată, date blocate)
→ emisia rămâne pornită; altfel diagnosticul ar muri exact pe dispozitivele unde nu-l vedem.
Cost: **un POST per poziţie deschisă la 5 s** (throttle-ul existent). Tăiere:
`localStorage.setItem('zeus_dsl_parity_shadow', 'false')`.

### 16. Măsurat: cele două creiere se contrazic

Odată ce am citit datele corect (vezi corecţia de mai sus), paritatea de brain a putut fi
**măsurată**, nu doar explicată. **1 678 de decizii împerecheate în ±30 s:**

| | | |
|---|---|---|
| direcţie **identică** | 757 | **45,1%** |
| direcţii **direct opuse** | 480 | **28,6%** |
| încredere medie | client **5,1** | server **22,7** |

Matricea: `client short → server long` **332** (19,8%), `client long → server short` 148 (8,8%),
`client long → server neutral` 207 (12,3%).

Hazardul pur pe trei categorii ar da ~33%. **45,1% acord, cu 28,6% direct opuse, înseamnă că nu
sunt două vederi ale unui creier — sunt două creiere** care se contrazic pe direcţie în peste un
sfert din cazuri. Asta e „de ce nu e sincronizat", în cifre, nu în teorie.

### Corecţia pe care o fac la propriul audit

Afirmaţia mea că **`brain_parity_log.dir` e NULL pe toate rândurile era greşită**. `dir` e scris
pe toate cele 322 867, dar minuscul. **Interogarea mea era bugul, nu codul.** A treia corecţie
publică din acest audit — le las pe toate la vedere.

### Verificare

5 teste noi pe predicat (inclusiv `localStorage` care aruncă). Client: **139 de fişiere, 1 137 de
teste verzi**, `tsc` curat. Build verificat **structural în bundle** — minificatorul foloseşte
backtick-uri, deci un grep naiv cu ghilimele minte; funcţia livrată e
`function dd(){try{return typeof localStorage>\`u\`?!0:localStorage.getItem(\`zeus_dsl_parity_shadow\`)!==\`false\`}catch{return!0}}`.
Asset servit **HTTP 200**, `zeus:zeus`, zero artefacte root în `public/app` (R8).
