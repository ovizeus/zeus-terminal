<!-- generat din docs/BOOK_OF_ALL.md linia 675 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔒 AVIZ HETZNER (PHP) — verificat: NU ne priveşte. Plus o trecere de securitate — 2026-10-24

Operatorul a urcat o captură: e-mail Hetzner, **două vulnerabilităţi critice în PHP**, actualizări
lansate, iar pe server dedicat/cloud instalarea e în sarcina clientului.

### Verdict: nu se aplică

**PHP nu există pe VPS-ul Zeus.** Verificat pe patru căi:

| verificare | rezultat |
|---|---|
| binar (`which php`, `/usr/bin/php*`, `/etc/php`) | **absent** |
| pachete (`dpkg -l \| grep php`) | **zero** |
| procese | **niciunul** |
| handler în nginx (`nginx -T`) | **niciunul** — singura potrivire e un exemplu **comentat** din `nginx.conf`-ul standard (modulul mail), iar `/etc/nginx/fastcgi_params` e fişierul stock, neinclus de niciun site |

nginx face doar proxy invers către Node (`proxy_pass http://127.0.0.1:3000`). **Nicio acţiune
necesară.**

### Trecerea de securitate cerută de e-mail („monitor for suspicious activity")

**Curat:**
- **Accesele SSH, 7 zile:** toate `root`, de pe IP-uri româneşti consistente (82.77.x, 213.233.x).
  **Niciun acces neaşteptat.**
- **Portul 3000** e legat pe `0.0.0.0`, dar **ufw e activ** şi permite doar 22/80/443, cu politică
  `INPUT DROP`. Testul extern a eşuat (cod 000) → **nu se poate ocoli nginx.**
- Restul porturilor: 53 doar local, 5037 (adb) doar pe `127.0.0.1`.

**De semnalat, fără acţiune:**
- **8 073 de parole eşuate în 7 zile**, explicate de `PasswordAuthentication yes` +
  `PermitRootLogin yes`. E zgomot de forţă brută pe un SSH expus, nu o breşă — niciun acces reuşit
  neaşteptat.
- **NU am atins nimic**: regula operatorului e explicită — *M2 amânat, nu se schimbă `sshd_config`*
  ([[no-ssh-hardening]]). Raportat ca fapt, cu cifra, atât.
