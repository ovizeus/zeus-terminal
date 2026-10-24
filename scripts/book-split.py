#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sparge `docs/BOOK_OF_ALL.md` in foldere pe categorii, sub `docs/book/`.

Cartea rămâne SURSA (nimic nu se sterge din ea). Asta e doar navigaţia:
un fisier per secţiune, pus in coşul care ii corespunde, plus un index
per coş. Se poate rula din nou oricand — regenereaza tot.

Clasificarea merge pe titlu, prima regula care se potriveste caştiga.
Ordinea regulilor conteaza: „colecteaza" bate „livrat", fiindca o secţiune
poate fi amandoua, si ce ne interesea e ca ASTEAPTA date.

Rulare:  python3 -I scripts/book-split.py
"""
import os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOK = os.path.join(ROOT, 'docs', 'BOOK_OF_ALL.md')
OUT  = os.path.join(ROOT, 'docs', 'book')

CATS = [
    ('1-DE-FACUT',          'Ce e de facut — munca deschisa, in ordinea prioritatii'),
    ('2-DECIZII-ALE-TALE',  'Ce asteapta de la tine — nu pot continua singur'),
    ('3-IN-COLECTARE',      'Masuratori care aduna date acum — nu se citesc inca'),
    ('4-LIVRATE',           'Ce s-a facut — livrat si dovedit pe sistemul viu'),
    ('5-MASURATORI',        'Audituri si masuratori — constatari, fara schimbari de cod'),
    ('6-RETRACTARI',        'Unde am greşit si m-am corectat — citeste inainte sa reiei o cifra'),
    ('7-INCIDENTE',         'Incidente — ce s-a stricat, cine l-a stricat, ce regula a ieşit'),
    ('8-REGULI',            'Regulile dupa care lucram'),
    ('9-ARHIVA',            'Inchise — pastrate pentru istoric'),
]

def fold(s):
    """fara diacritice, majuscule — ca regulile sa prinda si „REPARAT" si „REPARAT"."""
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.upper()

# (categorie, [cuvinte-cheie in titlu]) — prima potrivire caştiga
RULES = [
    ('8-REGULI',          ['REGULILE DUPA CARE LUCRAM']),
    ('9-ARHIVA',          ['REZOLVATE - ARHIVA', 'REZOLVATE — ARHIVA']),
    ('6-RETRACTARI',      ['RETRACTARE', 'RETRAGERE', 'AM GRESIT', 'CORECTIE MAJORA',
                           'INFIRMAT', 'RASTURNARE', 'ARTEFACT', 'SEMNUL INTORS',
                           'CORECTEZ PLANUL', 'ATRIBUIRE GRESITA']),
    ('7-INCIDENTE',       ['INCIDENT', 'PROVOCAT DE MINE', 'CRASH', 'OOM', 'BAN DE IP',
                           'NU S-A TERMINAT NICIODATA']),
    ('3-IN-COLECTARE',    ['COLECTAM', 'IN UMBRA', 'UMBRA', 'DE URMARIT']),
    ('2-DECIZII-ALE-TALE',['DECIZIA OPERATORULUI', 'RAMANE DE DECIS', 'INTRAREA IN CARTE',
                           'ASTEAPTA DECIZIA', 'ALEGEREA LUI', 'PAUZA']),
    ('1-DE-FACUT',        ['DE FACUT', 'PLAN:', 'PLANS', 'ORDINEA REPARATIILOR']),
    ('4-LIVRATE',         ['REPARAT', 'LIVRAT', 'IMPLEMENTAT', 'INVIAT', 'ELIMINAT',
                           'FIXAT', 'REPROIECTARE', 'INGUSTAT', 'CERUT DE OPERATOR',
                           'CERUT 2026', 'INDICATORI NOI', 'BACKUP ZEUS',
                           'STACK TRACE-URI CITIBILE', 'SE CITESTE', 'MTF REAL',
                           'E BUTON', 'DESENATE SINGURE', 'PULSAR', 'ARACHNE',
                           'PROPRIETATEA FISIERELOR', 'GARDA AUTOMATA',
                           'NU MAI MINTE', 'SE DEZARMA', 'SE MUTA SUB TINE',
                           'FIXUL MEU', 'PUNCTUL 1 CADEA', 'SERIA DE LUMANARI']),
    ('5-MASURATORI',      ['AUDIT', 'MASURAT', 'MASURATOARE', 'VERIFICAT', 'GASIT',
                           'CONTRAFACTUAL', 'PALNIA', 'DOVEDIT', 'INSTANTANEU',
                           'INCHIS', 'NUMIT', 'SINCRONIZAREA', 'CIFRA CORECTA',
                           'DE CE NU IESE PE CASTIG', 'CAT DIN ML', 'ML -', 'ML —',
                           'LIMITARE', 'PREDICTIA', 'AVIZ HETZNER', 'RUTE API MOARTE',
                           'CRON-URILE', 'SI SCHEMA', 'SI CLIENTUL', 'TRECERE DE SANATATE',
                           'DIAGNOSTIC INCHIS', 'LANTUL CARE CONTEAZA', 'DOUA BUTOANE',
                           'CEA MAI MARE TABELA', 'POARTA CIRCULARA', 'TERMINATOR',
                           'PRUNING', 'FLAG-URI', 'CONFIRMAT', 'PREDICTIA S-A CONFIRMAT',
                           'RAPORTAT DE OPERATOR', 'DECALAJUL DE INCALZIRE']),
]

# Excepţii explicite: titluri care nu se lasa prinse de nicio regula de cuvant.
# Mai bine scrise pe faţa aici decat sa strambam regulile pana prind si altceva.
OVERRIDES = [
    ('CITIREA PENTRU GEOMETRIE',  '4-LIVRATE'),
    ('BANURILE BINANCE SUNT PE TESTNET', '2-DECIZII-ALE-TALE'),
    ('AM COSTAT IESIREA 2',       '2-DECIZII-ALE-TALE'),
    ('POARTA SP1 MASOARA',        '5-MASURATORI'),
    ('CARTEA ARE FOLDERE',        '4-LIVRATE'),
]

# un titlu care poarta numar de build e, prin definiţie, ceva livrat
BUILD_TAG = re.compile(r'\(B\d+ V1\.7\.\d+\)')

# Negaţii: cuvinte care CONŢIN o regula pozitiva dar inseamna fix pe dos.
# „NEREPARAT" conţine „REPARAT", deci ar fi aterizat in 4-LIVRATE — adica exact
# in coşul contrar. Se verifica INAINTEA oricarei reguli pozitive.
NEGATIONS = [
    ('NEREPARAT', '1-DE-FACUT'),
    ('NELIVRAT', '1-DE-FACUT'),
    ('NEVERIFICAT', '1-DE-FACUT'),
]

def classify(title):
    t = fold(title)
    for key, cat in NEGATIONS:
        if key in t:
            return cat, 'negaţie:' + key
    for key, cat in OVERRIDES:
        if key in t:
            return cat, 'override:' + key
    for cat, keys in RULES:
        for k in keys:
            if k in t:
                return cat, k
    if BUILD_TAG.search(t):
        return '4-LIVRATE', 'build-tag'
    return None, None

def slug(title, n=64):
    t = fold(title).lower()
    t = re.sub(r'[^a-z0-9]+', '-', t).strip('-')
    return t[:n].strip('-') or 'secţiune'

def main():
    src = open(BOOK, encoding='utf-8').read()
    lines = src.split('\n')

    # taie pe `## ` de nivel 2
    starts = [i for i, l in enumerate(lines) if l.startswith('## ')]
    if not starts:
        sys.exit('nicio secţiune `## ` in carte — nu scriu nimic')

    preamble = '\n'.join(lines[:starts[0]]).rstrip()
    secs = []
    for j, s in enumerate(starts):
        e = starts[j + 1] if j + 1 < len(starts) else len(lines)
        title = lines[s][3:].strip()
        body = '\n'.join(lines[s:e]).rstrip()
        secs.append({'line': s + 1, 'title': title, 'body': body})

    unclassified = []
    for sec in secs:
        cat, key = classify(sec['title'])
        if cat is None:
            cat = '5-MASURATORI'
            unclassified.append(sec)
        sec['cat'] = cat

    # scrie — intai CURAT, altfel rularea de ieri lasa fişiere orfane cu
    # indicele vechi si ajungi cu doua copii ale aceleiaşi secţiuni.
    # Se sterge DOAR ce genereaza scriptul; START.md e scris de mana si rămane.
    KEEP = {'START.md'}
    for cat, _ in CATS:
        d = os.path.join(OUT, cat)
        os.makedirs(d, exist_ok=True)
        for f in os.listdir(d):
            if f.endswith('.md') and f not in KEEP:
                os.remove(os.path.join(d, f))
    if os.path.isdir(OUT):
        for f in os.listdir(OUT):
            if f.endswith('.md') and f not in KEEP:
                os.remove(os.path.join(OUT, f))

    # data din titlu, pentru ordonare in index (cele fara data merg la final)
    def datekey(sec):
        m = re.search(r'(\d{4})-(\d{2})-(\d{2})', sec['title'])
        return m.group(0) if m else '0000-00-00'

    written = 0
    for cat, _ in CATS:
        mine = [s for s in secs if s['cat'] == cat]
        mine.sort(key=lambda s: (datekey(s), s['line']), reverse=True)
        for idx, sec in enumerate(mine, 1):
            fn = '%02d-%s.md' % (idx, slug(sec['title']))
            sec['file'] = fn
            path = os.path.join(OUT, cat, fn)
            hdr = ('<!-- generat din docs/BOOK_OF_ALL.md linia %d — NU edita aici, '
                   'editeaza cartea si rulezi scripts/book-split.py -->\n\n' % sec['line'])
            open(path, 'w', encoding='utf-8').write(hdr + sec['body'] + '\n')
            written += 1

        # indexul coşului
        desc = dict(CATS)[cat]
        out = ['# %s' % cat.split('-', 1)[1].replace('-', ' ').title(), '', '> %s' % desc, '',
               '%d secţiuni.' % len(mine), '', '| Data | Secţiunea |', '|---|---|']
        for sec in mine:
            d = datekey(sec)
            d = '—' if d == '0000-00-00' else d
            t = sec['title'].replace('|', '\\|')
            out.append('| %s | [%s](%s) |' % (d, t, sec['file']))
        out += ['', '---', '', '*Generat din `docs/BOOK_OF_ALL.md`. Cartea rămane sursa.*', '']
        open(os.path.join(OUT, cat, 'README.md'), 'w', encoding='utf-8').write('\n'.join(out))

    # preambulul cartii
    open(os.path.join(OUT, '0-PREAMBUL.md'), 'w', encoding='utf-8').write(preamble + '\n')

    # indexul complet, toate secţiunile intr-un tabel
    allsecs = sorted(secs, key=lambda s: (datekey(s), s['line']), reverse=True)
    out = ['# Index complet — toate secţiunile cartii', '',
           'Toate cele %d secţiuni, cele mai noi primele. Coloana „Coş" iţi spune unde sta.' % len(secs),
           '', '| Data | Coş | Secţiunea |', '|---|---|---|']
    for sec in allsecs:
        d = datekey(sec)
        d = '—' if d == '0000-00-00' else d
        t = sec['title'].replace('|', '\\|')
        out.append('| %s | `%s` | [%s](%s/%s) |' % (d, sec['cat'], t, sec['cat'], sec['file']))
    out += ['', '---', '', '*Generat din `docs/BOOK_OF_ALL.md` de `scripts/book-split.py`.*', '']
    open(os.path.join(OUT, 'INDEX.md'), 'w', encoding='utf-8').write('\n'.join(out))

    print('secţiuni: %d  fişiere scrise: %d' % (len(secs), written))
    for cat, _ in CATS:
        print('  %-20s %d' % (cat, sum(1 for s in secs if s['cat'] == cat)))
    if unclassified:
        print('\nNECLASIFICATE (puse in 5-MASURATORI, adauga o regula):')
        for s in unclassified:
            print('  linia %5d  %s' % (s['line'], s['title']))

if __name__ == '__main__':
    main()
