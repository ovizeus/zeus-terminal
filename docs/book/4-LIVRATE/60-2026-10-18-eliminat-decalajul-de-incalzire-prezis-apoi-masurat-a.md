<!-- generat din docs/BOOK_OF_ALL.md linia 2399 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✂️ 2026-10-18 — ELIMINAT DECALAJUL DE ÎNCĂLZIRE (prezis, apoi măsurat, acum reparat)

Din cele 11 rânduri PRIMARY ale sesiunii lui, **exact unul** a rămas fără pereche: **primul**, la
23:24:00. Toate următoarele s-au împerecheat.

Cauza e costul pe care mi-l asumasem la îngustarea din 16 oct: serverul reîmprospătează lista
userilor activi la 5 minute, deci la primul rând de client el încă nu era pe listă. Scrisesem atunci
*„se auto-corectează în ~5 minute"*. Corect — dar **nu e gratis**: `unpairedRatio` e un **prag al
porții** (≤5%), iar o sesiune scurtă transformă un singur rând de încălzire într-o fracțiune mare.
Eșantionul ăsta a ieșit **9%**.

**Reparat la sursă, fără polling și fără interval mai scurt:** rândul de client *este* dovada că
userul e înapoi, deci el invalidează cache-ul direct și îl adaugă optimist. Ciclul **următor** emite
pentru el. Re-interogarea periodică rămâne sursa de adevăr pentru cine a plecat.

**Mutație dublă:** hook-ul nu mai invalidează → pică; ruta nu-l mai cheamă → pică.
**9484 teste pe felii, 0 picate.** Cere un reload.

---
