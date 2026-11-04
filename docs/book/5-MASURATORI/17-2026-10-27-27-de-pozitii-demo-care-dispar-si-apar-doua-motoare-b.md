<!-- generat din docs/BOOK_OF_ALL.md linia 9505 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 👻 2026-10-27 — 27 de poziţii demo care dispar şi apar: DOUĂ MOTOARE (b342)

**El:** *„vezi de ce am 27 de poziţii pe demo deschise care tot dispar şi apar, că nu e în regulă asta"*.

### Găsit — şi e aceeaşi clasă cu bugul de chart de acum o oră: două surse care se bat

Pe demo rulează **două motoare simultan**:

| steag | valoare | ce face |
|---|---|---|
| `CLIENT_AT` | **true** | motorul din **browser** deschide poziţii demo |
| `SERVER_AT_DEMO` | **true** | şi cel de pe **server** le deschide |
| `CLIENT_BRAIN` + `SERVER_BRAIN_DEMO` | **ambele true** | la fel, pentru decizii |

Şi pentru că `SERVER_AUTHORITATIVE_POSITIONS` + `POSITIONS_WS` sunt pornite, **serverul trimite periodic instantanee cu poziţiile LUI**. Când ale lui sunt zero — iar azi la 21:45 **chiar erau zero** (`at_positions` goală, ultima închidere la **14:01**) — instantaneul le **şterge** pe cele ale clientului.

→ **dispar.** Motorul din browser deschide altele → **apar.**

### Încă o contradicţie în acelaşi loc

| cale | citeşte din |
|---|---|
| REST `/api/at/positions` | `_positions` — **RAM** |
| WS `positions.changed` | `at_positions` — **BAZA** |

Chiar cu un singur motor, cele două pot răspunde diferit.

### Garda exista — dar nu acoperea demo-ul

`migrationFlags.js` îşi declară singur invariantul, **la linia 8**: *„CLIENT_AT and SERVER_AT must NEVER both be true simultaneously"*. Dar `_validateMutex` verifică **doar perechea de producţie**, nu şi variantele `_DEMO`. Deci execuţia dublă pe demo trecea complet neobservată.

### Am adăugat DETECŢIE, nu reparaţie — şi spun de ce

Un detector care **strigă la boot** şi e exportat pentru diagnostic. **NU intră în garda strictă**, apăsat: `_enforceMutexStrict` **aruncă** la încărcarea modulului, deci perechea de demo pusă acolo ar face serverul să **refuze să pornească** cu steagurile de azi. **Un test păzeşte exact împotriva acelui pas.**

**Care motor se stinge e decizia lui**, nu a mea: e o schimbare de steag pe calea banilor, iar regula lui spune că flipurile se fac în etape, de operator.

Măsurat ce înseamnă fiecare variantă: serverul a închis **102 poziţii demo în 7 zile** şi lucrează cu telefonul închis; clientul e oricum partea care pierde azi, fiindcă instantaneele serverului îl şterg.

**8 teste noi, 4 mutaţii moarte.** Confirmat pe steagurile vii: **2 încălcări**.

---
