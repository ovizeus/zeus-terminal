<!-- generat din docs/BOOK_OF_ALL.md linia 10299 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🎴 2026-11-01 — THE VOICE pleacă de pe pagina principală într-o casetă geamănă cu cea de chat (b359 v1.7.333, doar client)

**El, după a patra încercare:** *„tot e si se vede acolo hai sal scoatem sau sa schimbam cu altceva propune prima data nu fa"*.

Am propus patru variante. A ales **caseta**.

### Întâi ce am stricat eu la b358

În captură se vedea **un singur gând, centrat, cu gol şi sus ŞI jos** — dublasem problema. Cauza e o buclă pe care am introdus-o:

```
masor ce încape → tai → ÎNTIND
      ↑                      ↓
      └── măsor din nou pe noile poziţii ──┘
```

Întinderea mută gândurile în jos, măsurarea se reia pe noile poziţii, mai taie unul, întinde mai mult — şi se opreşte la **un singur gând în mijloc**.

### 📜 Adevărul de dedesubt, ocolit patru build-uri la rând

Zona avea **~290px fixaţi** din grilă şi primea **un gând la ~30 de secunde**.

| build | ce am făcut | ce a fost de fapt |
|---|---|---|
| b355 | degrade peste felie | **ascundea** golul |
| b357 | tăiat gândul parţial | **muta** golul |
| b358 | întins ce rămâne | **despica** golul în două |
| **b359** | **scos cutia de înălţime fixă** | **cauza** |

**Nu există reglaj de aşezare care să împace o cutie mare cu conţinut rar.** Toate trei încercările atacau simptomul. Patru build-uri şi patru capturi de la el ca să ajung la cauză — asta e costul real al reparării simptomului.

### Acum

Pagina principală: **orbul şi două casete gemene** — `THE VOICE` în cyan (câte gânduri sunt + ultimul pe scurt) şi `OMEGA CHAT AI` în auriu. Rândurile lor de grilă sunt **`auto`**, deci fiecare casetă e cât conţinutul ei şi orbul ia ce rămâne. **Nu mai există cutie de înălţime fixă**, deci nu mai are de unde să apară nici gol, nici gând tăiat.

Tap pe `THE VOICE` → lista întreagă pe pagina ei, cu `Back`. E **a cincea** sub-vedere a aceluiaşi tipar (`doctor`, `ring5`, `report`, `chat`, `voice`) — nu un mecanism nou.

**Şters, fiindcă existau doar ca să ascundă cauza:** masca de degrade de pe listă · regula de tăiere `.omega-utter-clipped` · regulile de întindere `.omega-voice-feed-spread` · tot modulul `voiceClip` cu cele 18 teste ale lui. Zero referinţe rămase în bundle-ul servit.

### ⚠️ A cincea mutaţie a supravieţuit prima dată — şi e aceeaşi lecţie a zilei

Testul meu pentru *„taie pe cuvânt, nu la mijlocul unuia"* **nu verifica deloc asta**. Mutaţia care tăia orbeşte la 72 de caractere trecea, fiindcă şi ea producea un prefix terminat cu trei puncte — iar toate cele patru aserţiuni ale mele erau adevărate şi pentru ea.

Testul cere acum ca **în textul original, imediat după ce am păstrat, să urmeze un SPAŢIU**. Aşa moare. *Un test care e adevărat şi pentru varianta stricată nu apără nimic.*

### Dovada

**5 mutaţii moarte:** `THE VOICE` pus iar ca listă pe pagina principală · caseta care nu deschide nimic · tăierea la mijloc de cuvânt · numărul coercit cu `Number` · separatorul orfan când nu e niciun gând.

13 teste noi. **Două teste vechi care apărau vechea aşezare au fost ACTUALIZATE, nu şterse**, ca să apere noua.

Client **172 de fişiere, 1.678 de teste**, `tsc` 0 erori. Verificat în bundle-ul servit.

**Doar client: build, FĂRĂ reload** (R-OP-2).
