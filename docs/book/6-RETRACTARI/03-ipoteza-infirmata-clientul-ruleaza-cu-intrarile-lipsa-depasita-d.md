<!-- generat din docs/BOOK_OF_ALL.md linia 1002 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔇 Ipoteză INFIRMATĂ — „clientul rulează cu intrările lipsă" (depăşită de secţiunea de deasupra) — 2026-10-23

**Firul dus până la capăt, cu dovadă convergentă. Asta e răspunsul la „de ce nu e sincronizat",
la nivel de cauză, nu de simptom.**

### Ce arătau datele

Clientul **are** direcţie (`long`/`short` în 2 443 din 2 527 de rânduri — nu e neutru), dar
încrederea e **exact `0,0` în 90% din ele**. O direcţie cu încredere zero nu e „n-am opinie", e un
calcul care se prăbuşeşte.

### Mecanismul, în cod

`confF` e o **sumă** de patru termeni nenegativi (`autotrade.ts:623`), deci pentru exact 0 toţi
patru trebuie să fie 0. Şi fiecare are o valoare-de-lipsă care e exact 0:

| termen | ce îl face 0 |
|---|---|
| `confNDirectional(conf, dir)` | `conf` cade pe **50** când `BM.confluenceScore` lipseşte (`:558`), iar `(50−50)/50 = 0` |
| `probN` | `prob == null → 0,5`, **dar `prob = 0 → 0`** (`:573`) |
| `regimeN` | 0 când regimul lipseşte |
| `alignN` | 0 când OFI lipseşte |

Iar `dirScore` primeşte **±0,25 doar din `LAST_SCAN.sigDir`** (`:613-615`), ceea ce e de ajuns să
treacă pragul de ±0,15 → deci **direcţia se produce din scanare singură**, fără nicio altă intrare.

### Dovada, din motivele înregistrate

Ce intrări apar efectiv în `reasons` ale clientului, din 2 527 de rânduri:

| intrare | n | % |
|---|---|---|
| Confluence | 315 | 12,5% |
| Regime | 315 | 12,5% |
| OFI | 312 | 12,3% |
| DirScore | 315 | 12,5% |
| **MultiScan** | **2 212** | **87,5%** |

**Şi potrivirea închide cazul: 315 rânduri au intrări complete, 321 au încredere nenulă.**
Practic acelaşi set.

### Concluzia

**Clientul nu e „mai prudent" decât serverul şi nu e vetoat — rulează cu intrările principale
nepopulate în 87,5% din timp.** Emite o direcţie din singurul semnal pe care-l are (scanarea), iar
încrederea iese 0 fiindcă toate cele patru componente sunt la valorile lor de lipsă.

De aceea, în cele 52 de cazuri în care una voia să tranzacţioneze, **94,2% au fost „doar serverul"**:
serverul are intrări, clientul nu.

Asta localizează definitiv „client brain inert" din auditurile vechi
([[brain-serverside-parity-truth]], D3): nu e un prag de încredere prea mare, e **lipsa datelor de
intrare**. Şi explică de ce gardul SP1 pe paritate nu putea trece niciodată — compara un creier cu
date cu unul fără.

**Nu am schimbat nimic.** Următorul pas, dacă vrei: de găsit de ce `BM.confluenceScore`, regimul şi
OFI ajung la fuziunea clientului doar în 12,5% din cicluri. E o problemă de alimentare, nu de
matematică — aceeaşi clasă ca punţile lipsă din Quant, dar pe calea de decizie.

---
