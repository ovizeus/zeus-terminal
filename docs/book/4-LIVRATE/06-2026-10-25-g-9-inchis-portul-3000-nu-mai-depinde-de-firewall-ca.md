<!-- generat din docs/BOOK_OF_ALL.md linia 8088 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔒 2026-10-25 — G-9 ÎNCHIS: portul 3000 nu mai depinde de firewall ca să fie închis (b319 v1.7.293)

> Cerere operator: *„fa si g9 daca zici ca e ok"*. I-o dădusem ca decizie a lui fiindcă e **schimbare de
> reţea pe serverul viu** şi, dacă greşesc, Zeus devine inaccesibil. A cerut-o — şi asta e partea de
> *„împreună cu tine"* pe care o ceream.

**Ce era**, şi comentariul spunea adevărul:

```js
// ─── Bind to 0.0.0.0 for LAN access (phone over Wi-Fi) ───
const server = app.listen(PORT, '0.0.0.0', () => {
```

Motivul era real — **pe un laptop**, cu telefonul pe acelaşi Wi-Fi. Pe VPS telefonul intră prin nginx
pe 443, şi nimic n-a ajuns vreodată la portul 3000 din afară. **Dar era închis de UN singur strat**:
`ufw` permite 22, 80 şi 443, politica lanţului INPUT e `DROP`. În ziua în care `ufw` e oprit sau golit,
aplicaţia e pe internet **fără TLS şi fără antetele de securitate**, care trăiesc în nginx. Exact
[[R-V-21]].

### Ce am verificat ÎNAINTE să schimb ceva

Un bind greşit nu dă eroare, dă **tăcere**. Deci întrebarea n-a fost *ce scriu*, ci *cine se conectează
local şi cum*:

| Consumator | Cum cheamă aplicaţia |
|---|---|
| nginx (3 locuri) | `proxy_pass http://127.0.0.1:3000` — **literal IPv4** |
| `scripts/m1-rollback-drill.sh` | `http://127.0.0.1:3000` — **literal IPv4** |
| `client/vite.config.ts` | `localhost:3000` — **doar dezvoltare**, nu rulează pe VPS |
| `.claude/settings.local.json` | `localhost:3000` — uneltele mele, nu producţia |

**Capcana pe care o căutam era `localhost`:** se poate rezolva la `::1` înaintea lui `127.0.0.1`, şi
atunci o legare doar pe IPv4 rupe clientul fără niciun mesaj. **Nu are ce prinde aici** — tot ce contează
în producţie foloseşte literalul IPv4.

### Ce am livrat

**`server/config/bindHost.js`** — o funcţie pură, deci testabilă fără să pornească serverul.

**Implicit loopback, LAN prin opţiune — şi pe ordinea asta dinadins.** Dacă implicitul rămânea `0.0.0.0`
şi `.env` îl închidea, întărirea **n-ar fi supravieţuit unui deploy pe o maşină nouă**, fiindcă `.env` e
gitignorat. Aia ar fi fost aceeaşi greşeală de-un-singur-strat, cu altă pălărie.

**Rezolvatorul cedează ÎNCHIS.** `listen()` aruncă pe un host pe care nu-l poate parsa, iar o aruncătură
acolo e **buclă de restart în pm2**, adică serverul jos. Deci `BIND_HOST=0.0.0.o` (cu `o` în loc de zero)
cade pe loopback cu un avertisment, nu pe podea. **A ceda închis costă accesul din LAN; a ceda deschis
sau a ceda tare costă Zeus.**

**Şi bannerul de boot nu mai minte.** Scria `Network: http://<ip-lan>:3000` necondiţionat — pe loopback
linia aia e o minciună, iar o minciună în logul de pornire e felul în care ajungi să depanezi lucrul
greşit la 3 dimineaţa. Acum spune `(not exposed — bound to 127.0.0.1; set BIND_HOST=0.0.0.0 for LAN)`.

### Dovada, pe soclu real, ÎNAINTE de a atinge Zeus

Pe un port liber, cu acelaşi rezolvator, ca `zeus`:

| De unde | Rezultat |
|---|---|
| `127.0.0.1:39123` | **200** |
| `178.104.64.124:39123` (IP-ul public) | **refuzat (000)** |

Şi refuzul vine fiindcă **soclul nu există acolo**, nu fiindcă `ufw` îl blochează. Aia e toată
diferenţa dintre înainte şi după, arătată pe un socket adevărat.

**13 teste noi, 4 mutaţii, toate moarte:**

| Mutaţia | Ce a picat |
|---|---|
| implicitul redevine `0.0.0.0` | 4 teste |
| typo-ul nu mai cade pe loopback (ajunge la `listen()`) | testul de cedare-închisă |
| validarea IPv4 acceptă octeţi peste 255 | testul de typo |
| `server.js` se întoarce la literalul hardcodat | 2 teste |

### Planul de întoarcere, scris ÎNAINTE de reload

Dacă ceva merge prost, revenirea **nu cere cod**: `BIND_HOST=0.0.0.0` în `.env` plus un reload şi
comportamentul e exact cel de dinainte. L-am avut pregătit înainte să apăs.

---
