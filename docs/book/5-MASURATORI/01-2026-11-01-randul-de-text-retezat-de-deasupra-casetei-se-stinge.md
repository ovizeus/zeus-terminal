<!-- generat din docs/BOOK_OF_ALL.md linia 10098 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🌫️ 2026-11-01 — Rândul de text retezat de deasupra casetei se stinge acum (b355 v1.7.329, doar client)

**El, după ce a văzut caseta aşezată bine:** *„ai facut bine da scoate scrisurile alea deasupra care se vad"*.

Lista de gânduri e o cutie cu scroll şi margine dură, deci gândul care cădea pe marginea de jos era **retezat la jumătate de cuvânt** — un rând tăiat cu cuţitul exact deasupra casetei `OMEGA CHAT AI`. Caseta era bine, zona de deasupra ei părea nefinisată.

Ultimii **34px** ai listei se sting acum într-un degrade (`mask-image`, cu prefixul `-webkit-` pentru telefonul lui). Un rând care e doar pe jumătate în câmp **se dizolvă** în loc să fie ghilotinat.

### Detaliul care face diferenţa între o reparaţie şi un bug mutat

Lista a primit şi **34px de spaţiu jos**, egal cu degradeul. Fără el, ultimul gând ar fi rămas **şters pentru totdeauna**, chiar şi după ce dai scroll până la capăt — adică aş fi înlocuit un rând tăiat cu un rând pe care nu-l mai poţi citi deloc. Testul cere explicit ca spaţiul să fie ≥ degradeul.

### ⚠️ Ce NU pot proba, şi spun

**Cum ARATĂ nu pot verifica.** În `jsdom` nu există layout, iar browser pe serverul viu n-am voie să pun. Verdictul vizual rămâne al lui.

Ce am probat e proprietatea mecanică de care depinde şi care se pierde uşor la o curăţenie viitoare: **3 mutaţii moarte** — prefixul `-webkit-` scos (masca n-ar mai funcţiona pe telefonul lui) · masca scoasă de tot · spaţiul de jos făcut mai mic decât degradeul.

Client **168 de fişiere, 1.646 de teste**, `tsc` 0 erori. Verificat în CSS-ul servit că **amândouă** formele măştii sunt acolo.

**Doar client: build, FĂRĂ reload** (R-OP-2).
