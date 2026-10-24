#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Contrafactual pe semnalele brain: ce ar fi dat ce s-a aruncat, faţă de ce s-a luat.

Rulează ca zeus, doar citire:
    sudo -u zeus python3 -I scripts/signal-counterfactual.py

De ce există, şi de ce începe cu o auto-verificare: versiunea din 22 oct 2026 a acestei
măsurători avea CONVENŢIA DE SEMN ÎNTOARSĂ (direcţia cădea pe LONG implicit, iar
populaţia reală e ~69% SHORT), deci a produs oglinda exactă a realităţii — numere
plauzibile, n uriaş, şi tiparul pe care-l căutam. Din ea au ieşit două concluzii false
("selecţia e anti-selectivă", "blochează doar la 2+ anti-pattern-uri"). Vezi R-V-13.

Deci: NU raportează nimic până nu dovedeşte, pe PnL REALIZAT din at_closed, că semnul
său e corect. Dacă acordul scade sub 99%, iese cu cod 2 şi nu tipăreşte nicio cifră.
"""
import sqlite3, json, bisect, sys, os
from collections import defaultdict

DB = os.environ.get('ZEUS_DB_PATH', '/opt/zeus-terminal/data/zeus.db')
HOR = [('15m', 15 * 60_000), ('60m', 60 * 60_000), ('240m', 240 * 60_000)]
# Închideri care nu sunt decizia sistemului — nu intră în validarea semnului.
DIRTY = ('RECON_PHANTOM', 'MANUAL_CLIENT', 'EXTERNAL_CLOSE')


def connect():
    return sqlite3.connect('file:%s?mode=ro' % DB, uri=True)


def signed_ret(entry, exit_px, side):
    """Convenţia unică a întregului script: + înseamnă că poziţia a mers bine."""
    return (exit_px - entry) / entry * 100.0 * (1.0 if side == 'LONG' else -1.0)


def validate_sign(con, min_rate=99.0):
    """Adevăr de teren: semnul randamentului trebuie să fie semnul PnL-ului realizat."""
    ok = bad = 0
    for (raw,) in con.execute("SELECT data FROM at_closed"):
        try:
            d = json.loads(raw)
        except Exception:
            continue
        ent, ex, side, pnl = d.get('price'), d.get('_lastPrice'), d.get('side'), d.get('closePnl')
        if side not in ('LONG', 'SHORT') or not ent or not ex or pnl is None:
            continue
        if abs(pnl) < 0.01 or d.get('closeReason') in DIRTY:
            continue  # comisionul domină semnul / nu e închidere curată
        if (signed_ret(ent, ex, side) > 0) == (pnl > 0):
            ok += 1
        else:
            bad += 1
    rate = 100.0 * ok / (ok + bad) if ok + bad else 0.0
    print('auto-verificare semn pe PnL realizat: %.2f%% acord (%d/%d)' % (rate, ok, ok + bad))
    if rate < min_rate:
        print('CONVENŢIE NEVALIDATĂ — nu raportez nicio cifră. Vezi R-V-13.')
        sys.exit(2)


def load_series(con):
    """Seria de preţuri per simbol, din brain_decisions — aceeaşi sursă ca semnalul."""
    series = defaultdict(lambda: ([], []))
    for sym, ts, data in con.execute("SELECT symbol, ts, data FROM brain_decisions ORDER BY symbol, ts"):
        try:
            px = json.loads(data).get('price')
        except Exception:
            continue
        if not isinstance(px, (int, float)) or px <= 0:
            continue
        t, p = series[sym]
        if t and ts == t[-1]:
            continue
        t.append(ts); p.append(float(px))
    return series


def longness(d):
    """Direcţia pe care o voia brain-ul. NICIODATĂ implicit — None dacă nu se ştie."""
    fd = (d.get('finalDir') or '').upper()
    if fd == 'LONG':
        return True
    if fd == 'SHORT':
        return False
    cb = d.get('confIsBull')
    return bool(cb) if isinstance(cb, bool) else None


class Acc:
    def __init__(self):
        self.n = 0
        self.sum = {h: 0.0 for h, _ in HOR}
        self.cnt = {h: 0 for h, _ in HOR}
        self.pos = {h: 0 for h, _ in HOR}

    def add(self, f):
        self.n += 1
        for k, v in f.items():
            if v is None:
                continue
            self.sum[k] += v; self.cnt[k] += 1
            if v > 0:
                self.pos[k] += 1

    def line(self):
        return ' | '.join(
            '%+.3f%% (%.1f%% poz, n=%d)' % (self.sum[h] / self.cnt[h], 100.0 * self.pos[h] / self.cnt[h], self.cnt[h])
            if self.cnt[h] else 'n/a' for h, _ in HOR)


def scan(con, series, where, tol_frac=0.10):
    """Rândurile care trec filtrul, fiecare cu randamentele sale forward."""
    out = []
    for sym, ts, data in con.execute("SELECT symbol, ts, data FROM brain_decisions WHERE " + where):
        d = json.loads(data)
        L, px = longness(d), d.get('price')
        if L is None or not px:
            continue
        t, p = series.get(sym, ([], []))
        if not t:
            continue
        f = {}
        for name, dt in HOR:
            want, tol = ts + dt, dt * tol_frac
            i = bisect.bisect_left(t, want)
            best = None
            for j in (i - 1, i):
                if 0 <= j < len(t) and abs(t[j] - want) <= tol:
                    if best is None or abs(t[j] - want) < abs(t[best] - want):
                        best = j
            f[name] = None if best is None else signed_ret(px, p[best], 'LONG' if L else 'SHORT')
        out.append((d, f))
    return out


def report(con, series, tol_frac):
    print('\n' + '=' * 72)
    print('toleranţă de potrivire = %.0f%% din orizont' % (tol_frac * 100))
    print('=' * 72)

    a = Acc()
    for _, f in scan(con, series, "final_action='entry'", tol_frac):
        a.add(f)
    print('\nINTRĂRILE LUATE          n=%-6d %s' % (a.n, a.line()))

    bycnt = defaultdict(Acc); bytype = defaultdict(Acc)
    for d, f in scan(con, series, "final_action='blocked_reflection'", tol_frac):
        c, types = d.get('reflConcernCount'), d.get('reflConcernTypes')
        if isinstance(c, int):
            bycnt[min(c, 3)].add(f)
        if isinstance(types, list):
            for t in set(types):
                bytype[t].add(f)
    print('\nblocate de REFLECŢIE, după numărul de îngrijorări:')
    for k in sorted(bycnt):
        print('  %s%s n=%-6d %s' % (k, '+' if k == 3 else ' ', bycnt[k].n, bycnt[k].line()))
    print('blocate de REFLECŢIE, pe tip (se suprapun):')
    for k, v in sorted(bytype.items(), key=lambda kv: -kv[1].n):
        print('  %-18s n=%-6d %s' % (k, v.n, v.line()))

    gany = defaultdict(Acc); gsing = defaultdict(Acc)
    for d, f in scan(con, series, "final_action='blocked_gates'", tol_frac):
        gr = d.get('gateReasons')
        if not isinstance(gr, list) or not gr:
            continue
        if len(gr) == 1:
            gsing[gr[0]].add(f)
        for g in set(gr):
            gany[g].add(f)
    print('\nblocate de GĂRZI, un singur motiv (cazul curat):')
    for k, v in sorted(gsing.items(), key=lambda kv: -kv[1].n):
        print('  %-18s n=%-6d %s' % (k, v.n, v.line()))
    print('blocate de GĂRZI, orice rând care conţine motivul:')
    for k, v in sorted(gany.items(), key=lambda kv: -kv[1].n):
        print('  %-18s n=%-6d %s' % (k, v.n, v.line()))


def main():
    con = connect()
    validate_sign(con)
    series = load_series(con)
    print('serie: %d simboluri, %d puncte' % (len(series), sum(len(v[0]) for v in series.values())))
    # Trei toleranţe: dacă verdictul se schimbă între ele, e artefact de acoperire,
    # nu rezultat. (Acoperirea pe intrări e mai slabă decât pe rândurile blocate.)
    for tol in (0.10, 0.25, 0.50):
        report(con, series, tol)


if __name__ == '__main__':
    main()
