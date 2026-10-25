<!-- generat din docs/BOOK_OF_ALL.md linia 7888 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔒 2026-10-25 — CE A ZIS UN PRIETEN PE DISCORD, verificat pe serverul TĂU punct cu punct

> Captură trimisă de operator **din aplicaţie** (`data/book_uploads/`, 20:58). Mesajul, cuvânt cu cuvânt:
>
> *„buy claude or gpt .. ask to make a website with ai chat .. buy api credits and in 1 week someone
> will hack you website.. steal the api and use credits or access database"*
>
> *„ask to install vnc on your server and it will make it 0.0.0.0 allow to public with ctrl+del to boot
> without root"*

**Avertismentul e generic, deci nu l-am comentat — l-am rulat ca listă de verificare pe Zeus.**
Nu contează dacă are dreptate în general. Contează dacă are dreptate **aici**.

### Punct cu punct

| Ce spune | Pe Zeus | Dovada |
|---|---|---|
| **VNC instalat, legat 0.0.0.0, public** | **NU există** | niciun pachet vnc/xrdp/teamviewer/anydesk, nimic care ascultă |
| **boot fără root** | nu se aplică | n-avem desktop la distanţă deloc |
| **chat AI expus** | **închis** | `POST /api/omega/chat` fără sesiune → **403**; prin nginx, din afară → **403** |
| **„access database"** prin API | **închis** | `/api/exchange/keys`, `/api/admin/users`, `/api/sync/settings`, `/api/journal` → toate **401** |
| **„steal the api"** din git | **niciodată** | `.env` n-a fost urmărit şi nu apare în tot istoricul git; `.gitignore` are `.env` şi `.env.*` |
| cheile în bază | **criptate** | `exchange_accounts.api_key_encrypted`, AES-256-GCM, prefix `v1:` |
| fişierele cu secrete | **0600 zeus:zeus** | `.env`, `data/zeus.db` |

**Poarta de autentificare e globală**, la `server.js:228`, înaintea tuturor rutelor, şi **respinge**, nu
doar populează `req.user`: 401 pe `/api/`, redirect la login în rest. Verifică explicit
`algorithms: ['HS256']` — deci nu merge trucul cu `alg: none` — plus statusul contului şi
`token_version`. **Testat pe viu, nu citit:** toate cererile de mai sus au fost făcute fără cookie, şi
prin nginx, exact cum ar veni de afară.

### UN singur lucru nou, şi are exact forma din avertisment

**Şi mă corectez din start: portul 3000 NU e o descoperire a mea.** E deja în carte, din trecerea de
securitate anterioară, cu test extern făcut atunci (cod 000, nu se poate ocoli nginx). L-am
re-confirmat astăzi — `ufw` activ, `deny` implicit, `ACCEPT` doar 22/80/443, `INPUT DROP` — dar nu-l
anunţ ca nou. La fel SSH-ul: cele 8 073 de parole eşuate în 7 zile şi `PermitRootLogin yes` sunt deja
scrise, şi rămân neatinse fiindcă aşa ai cerut.

**Nou e ăsta: copiile zilnice ale bazei erau `0644`. Baza vie e `0600`.**

```
data/zeus.db                       -rw-------   0600
data/zeus.db.bak.pre-*             -rw-------   0600   (făcute cu cp)
data/db_backups/zeus-2026-10-*.db  -rw-r--r--   0644   ← şapte, câte 2,9 GB
```

Fiecare e o copie **completă**: utilizatori, parole hash-uite, cheile de exchange criptate, jurnalul,
seiful. **Cauza:** `db.backup(dest)` creează fişierul cu ce dă umask-ul; copiile făcute de mână cu `cp`
au moştenit `0600` de la sursă. **O copie a unui secret moşteneşte secretul, nu umask-ul.**

**N-au fost niciodată citibile**, şi spun asta la fel de apăsat ca problema: `data/` e `0750`, deci alt
utilizator nu poate **intra** în director. **Verificat practic, încercând ca `nobody`:** citire blocată,
listare blocată. Pe maşină există doar `root` şi `zeus` cu shell. **Nu era o breşă, era o plasă care
lipsea** — iar ziua în care `data/` e relaxat din orice motiv, şapte copii complete devin
world-readable fără nicio altă greşeală.

**Reparat pe clasă şi pe instanţă:** rutina de backup îşi pune singură modul
(`fs.chmodSync(dest, 0o600)`) în loc să-l moştenească, şi cele şapte fişiere existente plus directorul
au fost strânse acum. **5 teste noi, 1 mutaţie moartă** (scot `chmod`-ul → pică 2 teste).

### Verdictul meu, de vreme ce l-ai cerut

**Prietenul tău are dreptate ca tipar şi greşeşte ca diagnostic pe Zeus.** Tiparul e real şi merită
luat în serios: un site făcut repede, cu chat AI şi credite API, **e** o ţintă, şi greşelile pe care le
numeşte — legare pe 0.0.0.0, chei lăsate la vedere, bază accesibilă — sunt exact greşelile care se fac.
**Nu e vorbă în vânt.**

Dar pe Zeus: chat-ul e în spatele autentificării, cheile sunt criptate şi n-au atins **niciodată**
git-ul, baza nu e expusă prin nicio rută, şi VNC nu există. **Din cinci afirmaţii, zero se aplică direct.
Dar două au aici jumătate de urmă** — şi pe una dintre ele am găsit-o abia fiindcă el a spus-o.

**Lucrul care merită reţinut, şi l-am scris ca regulă ([[R-V-21]]):** cele două nu ies la un audit care
întreabă **un singur strat**. Portul 3000 e „închis" dacă întrebi firewall-ul şi „deschis" dacă întrebi
aplicaţia. Copiile sunt „inaccesibile" dacă întrebi directorul şi „citibile de oricine" dacă întrebi
fişierul. Auditul din 24 iunie a ieşit *„ZERO vuln"* — şi avea dreptate, la stratul pe care l-a întrebat.

### 🔶 Ce NU am verificat ([[R-V-18]])

- **n-am testat din afara maşinii.** Re-confirmarea pentru portul 3000 vine din regulile `ufw` şi
  `iptables` citite pe loc. Testul extern din carte e de la trecerea anterioară, **nu de azi**;
- **n-am schimbat legarea pe `127.0.0.1`.** Ar fi corect — ar face din două straturi două adevărate —
  dar e o schimbare de reţea pe serverul viu, şi regula ta spune că rutarea se face **împreună cu tine**.
  Dacă greşesc, Zeus devine inaccesibil. **A ta e decizia** → **G-9** în registru;
- **n-am atins SSH-ul deloc**, cum ai cerut. Deci nu ştiu dacă s-a schimbat ceva acolo din iunie încoace,
  şi nici dacă există fail2ban;
- n-am citit `.env` şi n-am verificat dacă cheia de criptare a fost rotită vreodată — [[R-OP-14]] spune
  că cheile nu apar în conversaţie, deci nu le-am scos nici ca să le număr;
- **criptarea în repaus are o limită pe care o spun răspicat:** cheia stă în `.env`, **pe aceeaşi
  maşină** cu baza. Protejează o copie furată — un backup pierdut, un disc scos — **nu** pe cineva care
  ajunge să execute cod ca `zeus`. Pentru al doilea caz nu există criptare care să ajute, şi nici n-am
  pretins că ar fi;
- **n-am făcut un audit de securitate complet azi.** Am verificat **exact** ce a spus prietenul tău, plus
  ce a ieşit în cale. Nu e acelaşi lucru, şi n-aş vrea să rămână în carte ca şi cum ar fi.

---
