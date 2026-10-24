#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Citeste umbra lui LiqDanger: ce face valoarea de ACUM vs cea CORECTA.

    sudo -u zeus python3 -I scripts/liqdanger-shadow.py [zile]

De ce exista, si de ce se livreaza ODATA cu colectarea: cohortul `shadow` a stat
patru luni cu semantica gresita fiindca nimeni nu se uita la el. Colectarea fara
citire nu e masuratoare, e speranta.

Context (b312, 2026-10-24): `MAGNETS.nearPct` e DISTANTA pana la cel mai apropiat
magnet de lichiditate, in procente — deci MIC inseamna APROAPE, adica periculos.
Clientul o foloseste direct ca pericol (sens INVERS) si o mai imparte o data la 100,
desi era deja procent. Rezultat masurat: mediana 0,00, deci penalizarea
`confF *= (1 - liqDanger * 0.55)` nu se aplica practic niciodata.

`LiqDangerFix` e valoarea corecta, emisa ALATURI, fara sa atinga decizia. Scriptul
asta arata ce ar schimba daca am muta decizia pe ea.
"""
import sqlite3, re, sys, os, statistics as st

DB = os.environ.get('ZEUS_DB_PATH', '/opt/zeus-terminal/data/zeus.db')
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 7
COEF = 0.55  # confF *= (1 - liqDanger * COEF) — identic pe client si pe server

con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
cut = __import__('time').time() * 1000 - DAYS * 86400000

rows = []
for (r,) in con.execute(
        "SELECT reasons FROM brain_parity_log WHERE source='client' AND created_at > ? "
        "AND reasons LIKE '%LiqDangerFix%'", (cut,)):
    old = re.search(r'LiqDanger:(-?[\d.]+)%', r or '')
    new = re.search(r'LiqDangerFix:(-?[\d.]+)%', r or '')
    if not (old and new):
        continue
    try:
        dist = float(old.group(1))           # distanta in procente
        fix = float(new.group(1)) / 100.0    # pericolul corect, 0..1
    except ValueError:
        continue
    rows.append((dist, fix))

if not rows:
    print('Niciun rand cu LiqDangerFix in ultimele %d zile.' % DAYS)
    print('Daca tocmai s-a livrat b312, mai lasa-l sa colecteze.')
    sys.exit(0)

dists = sorted(r[0] for r in rows)
fixes = sorted(r[1] for r in rows)
olds = sorted(min(1.0, max(0.0, d / 100.0)) for d in dists)   # formula de ACUM


def line(name, vals):
    q = st.quantiles(vals, n=4) if len(vals) > 3 else [vals[0]] * 3
    print('  %-26s min %.4f | p25 %.4f | mediana %.4f | p75 %.4f | max %.4f | medie %.4f'
          % (name, vals[0], q[0], st.median(vals), q[2], vals[-1], sum(vals) / len(vals)))


print('randuri: %d, ultimele %d zile\n' % (len(rows), DAYS))
print('distanta pana la magnet (%):')
line('nearPct', dists)
print('\npericol, 0..1:')
line('ACUM (nearPct/100)', olds)
line('CORECT (apropiere)', fixes)

print('\npenalizarea de incredere aplicata, in puncte procentuale:')
print('  ACUM   medie %.2f pp, mediana %.2f pp' %
      (100 * COEF * sum(olds) / len(olds), 100 * COEF * st.median(olds)))
print('  CORECT medie %.2f pp, mediana %.2f pp' %
      (100 * COEF * sum(fixes) / len(fixes), 100 * COEF * st.median(fixes)))

# Cat de des ar discrimina de fapt. O valoare care e mereu mare nu e semnal, e taxa.
for thr in (0.25, 0.5, 0.75):
    n = sum(1 for v in fixes if v >= thr)
    print('  CORECT >= %.2f : %5d randuri = %.1f%%' % (thr, n, 100.0 * n / len(fixes)))
print('\nDe citit: daca „CORECT" sta mereu sus (ex. peste 75%% din randuri >= 0,75),')
print('atunci NU e un semnal care alege, e o taxa constanta — si pragul')
print('LIQ_PROXIMITY_PCT din client/src/trading/liqDanger.ts trebuie stramtat.')
